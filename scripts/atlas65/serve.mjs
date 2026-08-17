#!/usr/bin/env node
// ATLAS-65 stage 4: validate-then-serve. Every /graph-snapshot.json response
// body is literally the byte buffer the existing gbrain-read/v1 contract CLI
// just accepted: the snapshot file is read ONCE into a buffer, that buffer is
// written to a private tmp file, the contract CLI validates request+tmp, and on
// pass the very same buffer is served (no re-read window; invalid -> 503).
// Startup refuses (exit 1) unless the request+snapshot+provenance triple is
// complete (D9 atomic pair: a missing sidecar means a torn publish) and the
// snapshot bytes validate. Any per-request IO error yields 500 E_SERVE_IO —
// a single bad read must never kill the server. Localhost only.
// Failure idiom: process.exitCode + natural termination for the startup path;
// a successfully started server keeps the process alive by listening.
//
// ATLAS-39 additions, all backwards compatible — the defaults below reproduce
// the ATLAS-65 behaviour exactly:
//   --viewer <name>   serve viewer/<name>/ instead of viewer/atlas65/ (default
//                     atlas65). A viewer may ship stylesheets and ES modules, so
//                     the directory is walked ONCE at startup into a
//                     url -> absolute path map; request handling is a map lookup
//                     and nothing else, which makes path traversal impossible by
//                     construction rather than by sanitising the request.
//   --request <file>  the read-request document used for contract validation
//                     (default <dir>/read-request.json), so a viewer can be run
//                     against the committed evidence directory, which carries a
//                     snapshot and a provenance sidecar but no request.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { OUT_DIR, repoRoot } from '../../src/atlas65/paths.mjs'

const ASSET_CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.json': 'application/json'
}

// Walks the viewer directory once and returns the complete set of URLs this
// server will ever answer with a file. Anything not in the map is a 404: the
// request path is never joined onto a filesystem path.
function buildAssetManifest(viewerDir) {
  const manifest = new Map()
  const walk = (absolute) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const child = join(absolute, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.isFile()) continue // symlinks and devices are not viewer assets
      const type = ASSET_CONTENT_TYPES[extname(entry.name)]
      if (!type) continue
      manifest.set(`/${relative(viewerDir, child).split(sep).join('/')}`, { path: child, type })
    }
  }
  walk(viewerDir)
  return manifest
}

function main() {
  const args = process.argv.slice(2)
  const argValue = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i === -1 ? fallback : args[i + 1]
  }
  const dir = argValue('--dir', OUT_DIR)
  const port = Number(argValue('--port', '4365'))
  const viewerName = argValue('--viewer', 'atlas65')
  const CONTRACT_CLI = join(repoRoot, 'src/gbrain-read-contract/cli.mjs')
  // A viewer name is a directory name, never a path: refusing separators keeps
  // --viewer from reaching outside viewer/.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(viewerName)) {
    process.stderr.write(`atlas65-serve: E_VIEWER_INVALID: --viewer must be a simple directory name (got ${JSON.stringify(viewerName)})\n`)
    process.exitCode = 1
    return
  }
  const viewerDir = join(repoRoot, 'viewer', viewerName)
  const VIEWER = join(viewerDir, 'index.html')
  if (!existsSync(VIEWER)) {
    process.stderr.write(`atlas65-serve: E_VIEWER_MISSING: no viewer at viewer/${viewerName}/index.html\n`)
    process.exitCode = 1
    return
  }
  const assets = buildAssetManifest(viewerDir)

  // Validates the EXACT bytes that will be served: the caller passes the buffer
  // it intends to send; the contract CLI runs against a tmp copy of that buffer.
  const requestPath = argValue('--request', join(dir, 'read-request.json'))

  function validateBytes(bytes) {
    const request = requestPath
    if (!existsSync(request)) return { ok: false, why: 'request missing' }
    const tmp = join(tmpdir(), `atlas65-serve-check-${process.pid}-${randomUUID()}.json`)
    writeFileSync(tmp, bytes)
    try {
      const res = spawnSync(process.execPath, [CONTRACT_CLI, request, tmp], { encoding: 'utf8' })
      return res.status === 0 ? { ok: true } : { ok: false, why: `contract CLI exit ${res.status}` }
    } finally {
      try { unlinkSync(tmp) } catch { /* tmp cleanup is best effort */ }
    }
  }

  function validateStartup() {
    const request = requestPath
    const snapshot = join(dir, 'graph-snapshot.json')
    const provenance = join(dir, 'provenance.json')
    if (!existsSync(request) || !existsSync(snapshot) || !existsSync(provenance)) {
      return { ok: false, why: 'snapshot, request or provenance missing' }
    }
    return validateBytes(readFileSync(snapshot))
  }

  const startup = validateStartup()
  if (!startup.ok) {
    process.stderr.write(`atlas65-serve: E_SNAPSHOT_INVALID: refusing to serve (${startup.why})\n`)
    process.exitCode = 1
    return
  }

  const server = createServer((req, res) => {
    try {
      const url = req.url?.split('?')[0]
      if (url === '/') {
        const body = readFileSync(VIEWER)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(body)
        return
      }
      if (url === '/graph-snapshot.json') {
        const body = readFileSync(join(dir, 'graph-snapshot.json'))
        const check = validateBytes(body)
        if (!check.ok) {
          res.writeHead(503, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'E_SNAPSHOT_INVALID', detail: check.why }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(body)
        return
      }
      if (url === '/provenance.json') {
        const body = readFileSync(join(dir, 'provenance.json'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(body)
        return
      }
      // Viewer assets: a lookup in the startup manifest. An unknown URL is a
      // 404 and never touches the filesystem.
      const asset = url ? assets.get(url) : undefined
      if (asset) {
        const body = readFileSync(asset.path)
        res.writeHead(200, { 'content-type': asset.type })
        res.end(body)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    } catch (e) {
      process.stderr.write(`atlas65-serve: E_SERVE_IO: ${e.message}\n`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'E_SERVE_IO' }))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(
      `atlas65-serve: listening on http://127.0.0.1:${port}/ (viewer ${viewerName}, dir ${dir}, ${assets.size} assets)\n`
    )
  })
}

main()

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
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { OUT_DIR, repoRoot } from '../../src/atlas65/paths.mjs'

function main() {
  const args = process.argv.slice(2)
  const argValue = (flag, fallback) => {
    const i = args.indexOf(flag)
    return i === -1 ? fallback : args[i + 1]
  }
  const dir = argValue('--dir', OUT_DIR)
  const port = Number(argValue('--port', '4365'))
  const CONTRACT_CLI = join(repoRoot, 'src/gbrain-read-contract/cli.mjs')
  const VIEWER = join(repoRoot, 'viewer/atlas65/index.html')

  // Validates the EXACT bytes that will be served: the caller passes the buffer
  // it intends to send; the contract CLI runs against a tmp copy of that buffer.
  function validateBytes(bytes) {
    const request = join(dir, 'read-request.json')
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
    const request = join(dir, 'read-request.json')
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
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    } catch (e) {
      process.stderr.write(`atlas65-serve: E_SERVE_IO: ${e.message}\n`)
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'E_SERVE_IO' }))
    }
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`atlas65-serve: listening on http://127.0.0.1:${port}/ (dir ${dir})\n`)
  })
}

main()

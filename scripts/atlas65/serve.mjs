#!/usr/bin/env node
// ATLAS-65 stage 4: validate-then-serve. The browser can only ever receive the
// exact bytes of a snapshot that the existing gbrain-read/v1 contract CLI has
// just accepted: validation runs at startup (invalid -> refuse to start) AND on
// every /graph-snapshot.json request (invalid -> 503). Localhost only.
// Failure idiom: process.exitCode + natural termination for the startup path;
// a successfully started server keeps the process alive by listening.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
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

  function validate() {
    const request = join(dir, 'read-request.json')
    const snapshot = join(dir, 'graph-snapshot.json')
    if (!existsSync(request) || !existsSync(snapshot)) return { ok: false, why: 'snapshot or request missing' }
    const res = spawnSync(process.execPath, [CONTRACT_CLI, request, snapshot], { encoding: 'utf8' })
    return res.status === 0 ? { ok: true } : { ok: false, why: `contract CLI exit ${res.status}` }
  }

  const startup = validate()
  if (!startup.ok) {
    process.stderr.write(`atlas65-serve: E_SNAPSHOT_INVALID: refusing to serve (${startup.why})\n`)
    process.exitCode = 1
    return
  }

  const server = createServer((req, res) => {
    const url = req.url?.split('?')[0]
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(readFileSync(VIEWER))
      return
    }
    if (url === '/graph-snapshot.json') {
      const check = validate()
      if (!check.ok) {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'E_SNAPSHOT_INVALID', detail: check.why }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(readFileSync(join(dir, 'graph-snapshot.json')))
      return
    }
    if (url === '/provenance.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(readFileSync(join(dir, 'provenance.json')))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  })

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`atlas65-serve: listening on http://127.0.0.1:${port}/ (dir ${dir})\n`)
  })
}

main()

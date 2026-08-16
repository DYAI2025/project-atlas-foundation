// ATLAS-39 reuses the accepted ATLAS-65 validate-then-serve server rather than
// standing up a second one, so the shell inherits its fail-closed guarantees
// unchanged. What is new is a viewer selector and an asset route, and both are
// security-relevant: an asset route is exactly where a static server usually
// grows a path-traversal hole. It cannot here, because the server never joins a
// request path onto a filesystem path — it answers only from a manifest built
// once at startup. These tests pin that.
//
// test/atlas65-serve.test.mjs is deliberately untouched and must stay green:
// together the two files prove the ATLAS-39 flags are additive.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const SERVE = join(repoRoot, 'scripts/atlas65/serve.mjs')
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const REQUEST = join(repoRoot, 'config/atlas39-read-request.json')
const CONTRACT_CLI = join(repoRoot, 'src/gbrain-read-contract/cli.mjs')

async function startServer(extraArgs, port) {
  const child = spawn(process.execPath, [SERVE, '--port', String(port), ...extraArgs], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: repoRoot
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  for (let i = 0; i < 50 && !out.includes('listening'); i++) await sleep(100)
  return { child, out: () => out }
}

const ATLAS39_ARGS = ['--viewer', 'atlas39', '--dir', EVIDENCE, '--request', REQUEST]

test('the committed request is accepted against the committed real snapshot', () => {
  const result = spawnSync(process.execPath, [CONTRACT_CLI, REQUEST, join(EVIDENCE, 'graph-snapshot.json')], {
    encoding: 'utf8',
    cwd: repoRoot
  })
  assert.equal(result.status, 0, result.stderr)
  const verdict = JSON.parse(result.stdout)
  assert.equal(verdict.valid, true)
  assert.equal(verdict.project_id, 'ATLAS')
})

test('the workspace shell is served against the committed evidence directory', async () => {
  const { child, out } = await startServer(ATLAS39_ARGS, 43900)
  try {
    assert.match(out(), /viewer atlas39/)
    const page = await fetch('http://127.0.0.1:43900/')
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /Semantic Atlas Workspace/)
    assert.match(html, /a39-skip/)

    const snapshot = await fetch('http://127.0.0.1:43900/graph-snapshot.json')
    assert.equal(snapshot.status, 200)
    assert.equal(await snapshot.text(), readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))

    const provenance = await fetch('http://127.0.0.1:43900/provenance.json')
    assert.equal(provenance.status, 200)
    assert.equal(await provenance.text(), readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
  } finally {
    child.kill()
  }
})

test('viewer stylesheets and ES modules are served with correct content types', async () => {
  const { child } = await startServer(ATLAS39_ARGS, 43901)
  try {
    for (const [path, type] of [
      ['/tokens.css', 'text/css; charset=utf-8'],
      ['/stage.css', 'text/css; charset=utf-8'],
      ['/shell.css', 'text/css; charset=utf-8'],
      ['/app.mjs', 'text/javascript; charset=utf-8'],
      ['/core/view-model.mjs', 'text/javascript; charset=utf-8'],
      ['/core/layout.mjs', 'text/javascript; charset=utf-8'],
      ['/core/render-svg.mjs', 'text/javascript; charset=utf-8']
    ]) {
      const res = await fetch(`http://127.0.0.1:43901${path}`)
      assert.equal(res.status, 200, `${path} -> ${res.status}`)
      assert.equal(res.headers.get('content-type'), type, path)
    }
  } finally {
    child.kill()
  }
})

test('no request path can escape the viewer directory', async () => {
  const { child } = await startServer(ATLAS39_ARGS, 43902)
  try {
    for (const path of [
      '/../package.json',
      '/../../package.json',
      '/core/../../../package.json',
      '/%2e%2e/package.json',
      '/core/%2E%2E%2Fapp.mjs',
      '/index.html/../../../etc/hosts',
      '/nonexistent.css'
    ]) {
      const res = await fetch(`http://127.0.0.1:43902${path}`, { redirect: 'manual' })
      assert.equal(res.status, 404, `${path} -> ${res.status}`)
    }
  } finally {
    child.kill()
  }
})

test('an unknown viewer refuses startup instead of serving nothing', () => {
  const result = spawnSync(process.execPath, [SERVE, '--viewer', 'does-not-exist', '--dir', EVIDENCE, '--request', REQUEST, '--port', '43903'], {
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 10000
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /E_VIEWER_MISSING/)
})

test('a viewer name that is a path is refused outright', () => {
  for (const name of ['../scripts', 'atlas39/core', '/etc', 'ATLAS39']) {
    const result = spawnSync(process.execPath, [SERVE, '--viewer', name, '--dir', EVIDENCE, '--request', REQUEST, '--port', '43904'], {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 10000
    })
    assert.equal(result.status, 1, name)
    assert.match(result.stderr, /E_VIEWER_INVALID/, name)
  }
})

test('the workspace shell still refuses to start on a contract-invalid snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas39-serve-'))
  try {
    const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
    snapshot.edges[0].to = 'ATLAS:confluence:14778372:999999999' // dangling endpoint
    writeFileSync(join(dir, 'graph-snapshot.json'), JSON.stringify(snapshot))
    copyFileSync(join(EVIDENCE, 'provenance.json'), join(dir, 'provenance.json'))
    const result = spawnSync(process.execPath, [SERVE, '--viewer', 'atlas39', '--dir', dir, '--request', REQUEST, '--port', '43905'], {
      encoding: 'utf8',
      cwd: repoRoot,
      timeout: 15000
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /E_SNAPSHOT_INVALID/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing --request file refuses startup rather than serving unvalidated bytes', () => {
  const result = spawnSync(process.execPath, [SERVE, '--viewer', 'atlas39', '--dir', EVIDENCE, '--request', join(EVIDENCE, 'no-such-request.json'), '--port', '43906'], {
    encoding: 'utf8',
    cwd: repoRoot,
    timeout: 15000
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /E_SNAPSHOT_INVALID/)
})

test('the documented one-command launch is what package.json actually runs', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
  const command = pkg.scripts['atlas39:serve']
  assert.ok(command, 'atlas39:serve script missing')
  for (const fragment of [
    '--viewer atlas39',
    '--dir docs/evidence/atlas-65',
    '--request config/atlas39-read-request.json',
    '--port 4339'
  ]) {
    assert.ok(command.includes(fragment), `atlas39:serve is missing ${fragment}`)
  }
  assert.equal(pkg.scripts['atlas65:serve'], 'node scripts/atlas65/serve.mjs', 'the ATLAS-65 command must stay unchanged')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const SERVE = join(repoRoot, 'scripts/atlas65/serve.mjs')

function makeDir(valid = true) {
  const dir = mkdtempSync(join(tmpdir(), 'atlas65-serve-'))
  copyFileSync(join(repoRoot, 'fixtures/gbrain-read/valid-graph-snapshot.json'), join(dir, 'graph-snapshot.json'))
  writeFileSync(join(dir, 'read-request.json'), JSON.stringify({
    contract_version: '1.0.0',
    request_id: 'serve-test',
    project: { selector_kind: 'project_id', selector_value: 'PLUMBLINE' },
    operation: 'read_graph'
  }))
  writeFileSync(join(dir, 'provenance.json'), JSON.stringify({
    schema_version: '1.0', generated_from: 'gbrain-readback', generated_at: 'T0', project_id: 'PLUMBLINE',
    source: { source_kind: 'confluence', source_id: '7503873' },
    pages: [{ page_id: '900000001', title: 'Synthetic root', version: 1, confluence_url: 'https://x/1', captured_at: 'T', gbrain_slug: 'pages/900000001' }]
  }))
  if (!valid) {
    const s = JSON.parse(readFileSync(join(dir, 'graph-snapshot.json'), 'utf8'))
    s.edges[0].from = 'PLUMBLINE:confluence:7503873:999999999' // dangling endpoint
    writeFileSync(join(dir, 'graph-snapshot.json'), JSON.stringify(s))
  }
  return dir
}

async function startServer(dir, port) {
  const child = spawn(process.execPath, [SERVE, '--dir', dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  for (let i = 0; i < 50 && !out.includes('listening'); i++) await sleep(100)
  return { child, out: () => out }
}

test('serves the validated snapshot byte-identical', async () => {
  const dir = makeDir(true)
  const { child } = await startServer(dir, 43650)
  try {
    const res = await fetch('http://127.0.0.1:43650/graph-snapshot.json')
    assert.equal(res.status, 200)
    assert.equal(await res.text(), readFileSync(join(dir, 'graph-snapshot.json'), 'utf8'))
    const page = await fetch('http://127.0.0.1:43650/')
    assert.equal(page.status, 200)
    assert.match(await page.text(), /ATLAS-65/)
  } finally {
    child.kill()
  }
})

test('refuses to start on a contract-invalid snapshot (fail closed, exit 1)', () => {
  const dir = makeDir(false)
  const r = spawnSync(process.execPath, [SERVE, '--dir', dir, '--port', '43651'], { encoding: 'utf8' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SNAPSHOT_INVALID/)
})

test('a snapshot invalidated while running yields 503, never invalid data', async () => {
  const dir = makeDir(true)
  const { child } = await startServer(dir, 43652)
  try {
    const s = JSON.parse(readFileSync(join(dir, 'graph-snapshot.json'), 'utf8'))
    s.nodes = []
    writeFileSync(join(dir, 'graph-snapshot.json'), JSON.stringify(s))
    const res = await fetch('http://127.0.0.1:43652/graph-snapshot.json')
    assert.equal(res.status, 503)
  } finally {
    child.kill()
  }
})

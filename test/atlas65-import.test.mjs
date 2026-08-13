import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'scripts/atlas65/import-to-gbrain.mjs')
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME }

test('import CLI: unknown project is denied fail-closed', () => {
  const r = spawnSync(process.execPath, [CLI, '--project', 'NOPE'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('import CLI: capture belonging to a different project is refused (E_SCOPE)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas65-'))
  const capture = join(dir, 'capture.json')
  writeFileSync(capture, JSON.stringify({
    schema_version: '1.0',
    project_id: 'PLUMBLINE',
    source: { source_kind: 'confluence', source_id: '7503873' },
    captured_at: 'x',
    pages: []
  }))
  const r = spawnSync(process.execPath, [CLI, '--project', 'ATLAS', '--capture', capture], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SCOPE/)
})

test('import CLI: missing capture file is an explicit failure, never a fixture fallback', () => {
  const r = spawnSync(process.execPath, [CLI, '--project', 'ATLAS', '--capture', '/nonexistent/capture.json'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_CAPTURE_UNREADABLE/)
})

test('import CLI: structurally invalid capture is refused before any gbrain contact (E_CAPTURE_INVALID)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas65-'))
  const capture = join(dir, 'capture.json')
  writeFileSync(capture, JSON.stringify({
    schema_version: '1.0',
    project_id: 'ATLAS',
    source: { source_kind: 'confluence', source_id: '14778372' },
    captured_at: 'x',
    pages: [{ page_id: '14778372' }] // missing title/version/parent_id/confluence_url/body_storage
  }))
  const r = spawnSync(process.execPath, [CLI, '--project', 'ATLAS', '--capture', capture], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_CAPTURE_INVALID/)
})

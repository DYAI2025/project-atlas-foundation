import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '../scripts/gen-dependencies.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')
const DOC_PATH = join(repoRoot, 'DEPENDENCIES.md')
const SCRIPT = join(repoRoot, 'scripts/gen-dependencies.mjs')

const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
const doc = await readFile(DOC_PATH, 'utf8')

// --- lock supply-chain invariants (ATLAS-21) ----------------------------------

test('lock has the expected shape and at least one upstream', () => {
  assert.equal(lock.schema_version, '1.0')
  assert.ok(Array.isArray(lock.upstreams) && lock.upstreams.length >= 1)
})

test('every upstream id is unique', () => {
  const ids = lock.upstreams.map((u) => u.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every upstream pins a full 40-hex commit SHA', () => {
  for (const u of lock.upstreams) {
    assert.match(u.source_commit, /^[0-9a-f]{40}$/, u.id)
  }
})

test('every upstream carries a 64-hex archive SHA-256', () => {
  for (const u of lock.upstreams) {
    assert.match(u.archive_sha256, /^[0-9a-f]{64}$/, u.id)
  }
})

test('every upstream documents a license', () => {
  for (const u of lock.upstreams) {
    assert.ok(typeof u.license === 'string' && u.license.trim().length > 0, u.id)
  }
})

test('approval_required upstreams are never enabled', () => {
  for (const u of lock.upstreams) {
    assert.equal(typeof u.enabled, 'boolean', u.id)
    assert.equal(typeof u.approval_required, 'boolean', u.id)
    if (u.approval_required) assert.equal(u.enabled, false, u.id)
  }
})

test('no rendered lock field contains a pipe or newline (table integrity)', () => {
  for (const u of lock.upstreams) {
    for (const v of [u.id, u.version, u.source_commit, u.license, u.archive_sha256, u.integration_status]) {
      assert.doesNotMatch(String(v), /[|\n]/, u.id)
    }
  }
})

// --- lock → document parity ---------------------------------------------------

test('committed DEPENDENCIES.md is exactly the rendered lock (no drift, no invented data)', () => {
  assert.equal(doc, render(lock))
})

test('every lock entry appears as exactly one table row with version, SHA, license, checksum', () => {
  for (const u of lock.upstreams) {
    const rows = doc.split('\n').filter((line) => line.startsWith(`| ${u.id} |`))
    assert.equal(rows.length, 1, `${u.id} must appear exactly once as a table row`)
    for (const value of [u.version, u.source_commit, u.license, u.archive_sha256]) {
      assert.ok(rows[0].includes(String(value)), `${u.id} row missing ${value}`)
    }
  }
})

test('DEPENDENCIES.md documents the upgrade policy and the authoritative source', () => {
  assert.ok(doc.includes('## Upgrade-Policy'))
  assert.ok(doc.includes('third_party/upstreams.lock.json'))
})

// --- determinism ---------------------------------------------------------------

test('render is deterministic in-process', () => {
  assert.equal(render(lock), render(lock))
})

test('repeated generator runs produce byte-identical output, independent of CWD', () => {
  const hash = () => createHash('sha256').update(readFileSync(DOC_PATH)).digest('hex')
  const before = hash()
  for (const cwd of [repoRoot, tmpdir()]) {
    const res = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /DEPENDENCIES\.md written: \d+ upstreams/)
    assert.equal(hash(), before, `run from ${cwd} changed DEPENDENCIES.md`)
  }
})

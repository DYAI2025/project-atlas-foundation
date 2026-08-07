import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')

const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))

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

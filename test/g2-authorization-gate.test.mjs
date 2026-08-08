import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateAuthorization,
  parseAuthorizationArtifact,
  PO_LOGIN,
} from '../scripts/g2-authorization-gate.mjs'

const HEAD = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0'
const OTHER_HEAD = 'ffffffffffffffffffffffffffffffffffffffff'
const GATE_TIME = new Date('2026-08-08T12:00:00Z')
const PR = 9

let nextId = 1000
function comment({ login = PO_LOGIN, body, created = '2026-08-08T10:00:00Z', updated = null }) {
  const id = nextId++
  return {
    id,
    html_url: `https://github.com/DYAI2025/project-atlas-foundation/pull/${PR}#issuecomment-${id}`,
    user: { login },
    body,
    created_at: created,
    updated_at: updated ?? created,
  }
}

function artifactBody({ pr = PR, head = HEAD, prefix = 'Freigabe erteilt.\n\n' } = {}) {
  return `${prefix}G2-AUTHORIZATION\nPR: #${pr}\nHEAD: ${head}\n`
}

function evaluate(comments, overrides = {}) {
  return evaluateAuthorization(comments, {
    prNumber: PR,
    headSha: HEAD,
    gateTime: GATE_TIME,
    ...overrides,
  })
}

// --- positive path (ATLAS-56) -------------------------------------------------

test('valid pre-existing PO artifact authorizes and is referenced', () => {
  const c = comment({ body: artifactBody() })
  const result = evaluate([c])
  assert.equal(result.authorized, true)
  assert.equal(result.artifact.id, c.id)
  assert.equal(result.artifact.url, c.html_url)
  assert.deepEqual(result.reasons, [])
})

test('one valid artifact among invalid comments authorizes', () => {
  const noise = comment({ body: 'READY FOR MERGE' })
  const wrongPr = comment({ body: artifactBody({ pr: 8 }) })
  const valid = comment({ body: artifactBody() })
  const result = evaluate([noise, wrongPr, valid])
  assert.equal(result.authorized, true)
  assert.equal(result.artifact.id, valid.id)
})

// --- negative paths: no inference from READY states (ATLAS-56 AC 2) -----------

test('READY FOR MERGE without artifact blocks', () => {
  const result = evaluate([comment({ body: 'READY FOR MERGE' })])
  assert.equal(result.authorized, false)
  assert.equal(result.artifact, null)
  assert.ok(result.reasons.some((r) => /artifact/i.test(r)))
})

test('READY FOR PO AUTHORIZATION without artifact blocks', () => {
  const result = evaluate([comment({ body: 'READY FOR PO AUTHORIZATION' })])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.length > 0)
})

test('prose authorization claim without artifact blocks (real PR #8 wording)', () => {
  const body =
    'granted by the Product Owner in the session order of 2026-08-07 ' +
    '("G2-Autorisierung erteilt für PR #8 — Merge ausführen") after the ' +
    'PO code review (READY FOR MERGE)'
  const result = evaluate([comment({ body })])
  assert.equal(result.authorized, false)
})

// --- negative paths: PR and head binding (ATLAS-56 AC 1) ----------------------

test('artifact for a different PR blocks with a PR-mismatch reason', () => {
  const result = evaluate([comment({ body: artifactBody({ pr: 8 }) })])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.some((r) => /PR #8/.test(r)))
})

test('artifact for a different head SHA blocks with a head-mismatch reason', () => {
  const result = evaluate([comment({ body: artifactBody({ head: OTHER_HEAD }) })])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.some((r) => /head/i.test(r)))
})

// --- negative paths: pre-existence, no retroactive validation (ATLAS-56 AC 1) -

test('artifact created after the gate time blocks', () => {
  const c = comment({ body: artifactBody(), created: '2026-08-08T12:00:01Z' })
  const result = evaluate([c])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.some((r) => /gate time/i.test(r)))
})

test('artifact edited after the gate time blocks (edit injection)', () => {
  const c = comment({
    body: artifactBody(),
    created: '2026-08-08T10:00:00Z',
    updated: '2026-08-08T13:00:00Z',
  })
  const result = evaluate([c])
  assert.equal(result.authorized, false)
})

// --- negative paths: author and self-referential claims (ATLAS-56 AC 3) -------

test('valid block from a non-PO author blocks with an author reason', () => {
  const c = comment({ login: 'someone-else', body: artifactBody() })
  const result = evaluate([c])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.some((r) => /someone-else/.test(r)))
})

test('audit comments never count as artifacts, even with a valid block', () => {
  const body = `PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION\n\n${artifactBody({ prefix: '' })}`
  const result = evaluate([comment({ body })])
  assert.equal(result.authorized, false)
})

test('quoted artifact block does not count', () => {
  const body = `> G2-AUTHORIZATION\n> PR: #${PR}\n> HEAD: ${HEAD}\n`
  const result = evaluate([comment({ body })])
  assert.equal(result.authorized, false)
})

// --- fail-closed input handling (ATLAS-56) ------------------------------------

test('empty comment list blocks with a reason', () => {
  const result = evaluate([])
  assert.equal(result.authorized, false)
  assert.ok(result.reasons.length > 0)
})

test('invalid inputs block instead of throwing', () => {
  assert.equal(evaluate([], { prNumber: 0 }).authorized, false)
  assert.equal(evaluate([], { headSha: 'short' }).authorized, false)
  assert.equal(evaluate([], { gateTime: 'not-a-date' }).authorized, false)
  assert.equal(evaluateAuthorization('nope', { prNumber: PR, headSha: HEAD, gateTime: GATE_TIME }).authorized, false)
})

// --- artifact block parsing (ATLAS-56) ----------------------------------------

test('parseAuthorizationArtifact extracts PR number and head SHA', () => {
  assert.deepEqual(parseAuthorizationArtifact(artifactBody()), { pr: PR, head: HEAD })
})

test('parseAuthorizationArtifact rejects incomplete or malformed blocks', () => {
  assert.equal(parseAuthorizationArtifact(`G2-AUTHORIZATION\nPR: #${PR}\n`), null)
  assert.equal(parseAuthorizationArtifact(`PR: #${PR}\nHEAD: ${HEAD}\n`), null)
  assert.equal(parseAuthorizationArtifact(`G2-AUTHORIZATION\nPR: #${PR}\nHEAD: ${HEAD.slice(0, 39)}\n`), null)
  assert.equal(
    parseAuthorizationArtifact(`G2-AUTHORIZATION\nPR: #${PR}\nHEAD: ${HEAD.toUpperCase()}\n`),
    null
  )
  assert.equal(parseAuthorizationArtifact(42), null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DiscoveryError,
  resolveNextUrl,
  resolveFetchableUrl,
  getJson,
  paginate,
  MAX_PAGINATION_REQUESTS,
  assertDescendantShape,
  assertPageDetailShape,
  lifecycleFor,
  LIFECYCLES,
  STATUS_TO_LIFECYCLE
} from '../src/atlas25/discovery.mjs'

const BASE = 'https://example.invalid'
const AUTH = 'Basic dGVzdA=='

// Synthetic 9xxxxxxxx page refs per repo convention — logic tests only.
// Real-source acceptance evidence comes exclusively from the live run.

test('resolveNextUrl resolves a site-relative next link against the base url', () => {
  assert.equal(
    resolveNextUrl(BASE, '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=abc'),
    'https://example.invalid/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=abc'
  )
})

test('resolveNextUrl accepts an absolute next link on the same origin', () => {
  assert.equal(
    resolveNextUrl(BASE, 'https://example.invalid/wiki/api/v2/pages/900000001/descendants?cursor=abc'),
    'https://example.invalid/wiki/api/v2/pages/900000001/descendants?cursor=abc'
  )
})

test('resolveNextUrl fails closed on a next link that leaves the configured origin', () => {
  assert.throws(
    () => resolveNextUrl(BASE, 'https://attacker.invalid/wiki/api/v2/pages/1/descendants?cursor=abc'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /origin/.test(e.message)
  )
})

test('resolveNextUrl fails closed on a protocol-relative next link pointing at another host', () => {
  // "//attacker.invalid/x" DOES parse and resolves to the attacker's origin, so
  // this is caught by the origin check rather than by the parse guard.
  assert.throws(
    () => resolveNextUrl(BASE, '//attacker.invalid/wiki/api/v2/pages/1/descendants'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /origin/.test(e.message)
  )
})

for (const [name, link, expected] of [
  ['an empty next link', '', /is missing or not a string/],
  ['a non-string next link', 42, /is missing or not a string/],
  // Bare relative junk: WHATWG parsing does NOT throw on this (see Deviation D-1),
  // it silently resolves against the base. It must be rejected for not being
  // rooted at "/", never resolved into a same-origin URL we would then fetch.
  ['a bare relative next link', 'ht!tp://%%%', /is not a resolvable URL/],
  ['a relative next link that is not rooted at /', 'descendants?cursor=abc', /is not a resolvable URL/],
  // These genuinely throw in the URL parser, exercising the parse guard itself.
  ['an unparseable absolute next link', 'http://', /is not a resolvable URL/],
  ['a next link with an unterminated host', 'http://[', /is not a resolvable URL/]
]) {
  test(`resolveNextUrl fails closed on ${name}`, () => {
    assert.throws(
      () => resolveNextUrl(BASE, link),
      (e) =>
        e instanceof DiscoveryError &&
        e.code === 'E_DISCOVERY_PAGINATION' &&
        expected.test(e.message) &&
        // D-1: none of these may be caught incidentally by a LATER guard —
        // that would mean the rooted/parse guard had stopped doing its job.
        // Widened past `origin` because D-2 added scheme and userinfo checks
        // between the parse and origin checks, which the old wording missed.
        !/origin|scheme|userinfo/.test(e.message)
    )
  })
}

// --- cursor pagination ------------------------------------------------------

// Builds a fetchImpl serving a fixed list of pages of results, keyed by url.
// `inits` records the second fetch argument as well, so the suite can assert what
// actually went out on the wire — the credential and the absence of body-format.
// Recording only the URL is what let the Authorization header go untested (I6).
function pagedFetch(pages) {
  const calls = []
  const inits = []
  const impl = async (url, init) => {
    calls.push(url)
    inits.push(init)
    const body = pages.get(url)
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  impl.calls = calls
  impl.inits = inits
  return impl
}

const START = `${BASE}/wiki/api/v2/pages/900000001/descendants?limit=100`

test('paginate returns a single page of results without following any cursor', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: {} }]
  ]))
  const out = await paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl })
  assert.deepEqual(out.results, [{ id: '900000002' }])
  assert.equal(out.requests, 1)
  assert.deepEqual(fetchImpl.calls, [START])
})

test('paginate traverses every cursor page in order and concatenates all results', async () => {
  const p2 = `${BASE}/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2`
  const p3 = `${BASE}/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c3`
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' } }],
    [p2, { results: [{ id: '900000003' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c3' } }],
    [p3, { results: [{ id: '900000004' }], _links: {} }]
  ]))
  const out = await paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl })
  assert.deepEqual(out.results.map((r) => r.id), ['900000002', '900000003', '900000004'])
  assert.equal(out.requests, 3)
  assert.deepEqual(fetchImpl.calls, [START, p2, p3]) // proves real cursor traversal, not one call
})

test('paginate fails closed when a cursor page repeats — non-progressing sequence', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100' } }]
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /did not progress/.test(e.message)
  )
})

test('paginate fails closed when the walk exceeds the request cap', async () => {
  // Every page hands out a fresh cursor, so the walk is progressing but endless.
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return {
      ok: true,
      status: 200,
      json: async () => {
        const n = Number(new URL(url).searchParams.get('cursor') ?? 0) + 1
        return { results: [{ id: `9000000${n}` }], _links: { next: `/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=${n}` } }
      }
    }
  }
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl, maxRequests: 5 }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /exceeded 5 requests/.test(e.message)
  )
  // The integer is what makes a cap a cap: an off-by-one (>= vs >) changes how
  // many requests actually go out while leaving the message assertion green.
  assert.equal(calls.length, 5)
  assert.equal(MAX_PAGINATION_REQUESTS, 200) // the shipped default is a real cap, not Infinity
})

test('paginate fails closed when a cursor page has no results array — never a silent truncation', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { _links: {} }]
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /results/.test(e.message)
  )
})

test('paginate fails closed on a mid-walk HTTP error — no partial result is returned', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' } }]
    // page 2 is deliberately absent -> the stub answers 404
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /HTTP 404/.test(e.message)
  )
})

test('paginate fails closed when fetch itself rejects', async () => {
  const underlying = new Error('socket hang up')
  const fetchImpl = async () => { throw underlying }
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_UNREADABLE' &&
      /network failure/.test(e.message) &&
      // The transport error must survive as `cause`, or the stack that actually
      // explains the failure is discarded at the wrapper.
      e.cause === underlying
  )
})

test('paginate fails closed when a response body is not JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /not JSON/.test(e.message)
  )
})

// --- outgoing request shape (D-2 / I6) --------------------------------------

test('paginate sends the Authorization header on every request', async () => {
  const p2 = `${BASE}/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2`
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' } }],
    [p2, { results: [{ id: '900000003' }], _links: {} }]
  ]))
  await paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl })
  // Without this the credential could be dropped from getJson and the whole
  // suite would stay green while every live request came back 401.
  assert.equal(fetchImpl.inits.length, 2)
  for (const init of fetchImpl.inits) {
    assert.equal(init.headers.authorization, AUTH)
    assert.equal(init.headers.accept, 'application/json')
  }
})

test('paginate never requests a page body — DEC-04 stays enforced by a test, not by habit', async () => {
  const p2 = `${BASE}/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2`
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' } }],
    [p2, { results: [{ id: '900000003' }], _links: {} }]
  ]))
  await paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl })
  assert.equal(fetchImpl.calls.length, 2)
  for (const url of fetchImpl.calls) assert.doesNotMatch(url, /body-format/)
})

// --- C1 regressions: corruption must never end the walk as if complete -------

test('paginate fails closed on an empty-string next cursor — not a silently truncated result', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: { next: '' } }]
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /is missing or not a string/.test(e.message)
  )
})

test('paginate fails closed when _links is not an object — not a silently truncated result', async () => {
  const fetchImpl = pagedFetch(new Map([
    // `"CORRUPT"?.next` is undefined, which the pre-D-2 code read as "walk complete".
    [START, { results: [{ id: '900000002' }], _links: 'CORRUPT' }]
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /"_links" is not an object/.test(e.message)
  )
})

test('paginate fails closed when _links is an array — arrays are objects to typeof', async () => {
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: [] }]
  ]))
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /"_links" is not an object/.test(e.message)
  )
})

// --- resolveFetchableUrl scheme and userinfo guards (D-2 / I2, I2b) ---------

test('resolveFetchableUrl rejects a blob: url whose inner origin matches the base', () => {
  // URL.origin reports the INNER origin for blob:, so an origin-only check passes
  // this straight through to fetch. The scheme check is what stops it.
  assert.throws(
    () => resolveFetchableUrl(BASE, 'blob:https://example.invalid/abc'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /does not use the configured scheme/.test(e.message)
  )
})

test('resolveFetchableUrl rejects a scheme downgrade to http', () => {
  assert.throws(
    () => resolveFetchableUrl(BASE, 'http://example.invalid/wiki/x'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /does not use the configured scheme/.test(e.message)
  )
})

test('resolveFetchableUrl rejects embedded userinfo without leaking the secret into the message', () => {
  assert.throws(
    () => resolveFetchableUrl(BASE, 'https://u:s3cr3t@example.invalid/wiki/x'),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_PAGINATION' &&
      /carries embedded userinfo credentials/.test(e.message) &&
      // The point of the guard is that no credential can reach a log by
      // construction, so the rejection message must not quote it back.
      !/s3cr3t/.test(e.message)
  )
})

test('resolveFetchableUrl rejects a userinfo-disguised host that reads as another origin', () => {
  // "https://attacker.invalid@example.invalid/x" targets example.invalid, but a
  // human triaging a log reads the first host. Rejected rather than explained.
  assert.throws(
    () => resolveFetchableUrl(BASE, 'https://attacker.invalid@example.invalid/wiki/x'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /carries embedded userinfo credentials/.test(e.message)
  )
})

// --- startUrl is held to the same rules as a server-supplied cursor (I4) ----

test('paginate rejects a foreign-origin startUrl BEFORE any fetch — the credential never leaves', async () => {
  const fetchImpl = pagedFetch(new Map())
  await assert.rejects(
    // https, so the scheme guard cannot answer for the origin guard: this input
    // must be stopped by the origin check specifically.
    paginate({ startUrl: 'https://attacker.invalid/steal', baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) =>
      e instanceof DiscoveryError &&
      // A caller-supplied start url is a config defect, not a pagination defect.
      e.code === 'E_DISCOVERY_CONFIG' &&
      /start url/.test(e.message) &&
      /leaves the configured Confluence origin/.test(e.message)
  )
  // The load-bearing assertion: zero requests means the Authorization header was
  // never handed to the attacker's host.
  assert.deepEqual(fetchImpl.calls, [])
  assert.deepEqual(fetchImpl.inits, [])
})

test('paginate fetches the NORMALIZED startUrl, not the raw string it was given', async () => {
  // The start url genuinely changes under normalization ("/v2/../v2/" collapses).
  // Validating it but then fetching the raw value would defeat the repeat guard,
  // letting the same resource be fetched twice before it tripped (M2).
  const rawStart = `${BASE}/wiki/api/v2/../v2/pages/900000001/descendants?limit=100`
  assert.notEqual(rawStart, START) // the fixture is only meaningful if it differs
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: {} }]
  ]))
  const out = await paginate({ startUrl: rawStart, baseUrl: BASE, authorization: AUTH, fetchImpl })
  assert.deepEqual(out.results, [{ id: '900000002' }])
  assert.equal(fetchImpl.calls[0], START)
  assert.deepEqual(fetchImpl.calls, [START])
})

// --- getJson guards (D-2 / I3, M6, and the previously untested 404 path) ----

test('getJson fails closed on a missing authorization before issuing any request', async () => {
  const fetchImpl = pagedFetch(new Map())
  await assert.rejects(
    getJson(START, { fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_AUTH_MISSING' && /no authorization header supplied/.test(e.message)
  )
  // A local config defect must not be laundered into a remote HTTP 401.
  assert.deepEqual(fetchImpl.calls, [])
})

test('getJson rejects a literal JSON null body so it cannot impersonate the 404 signal', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => null })
  await assert.rejects(
    getJson(START, { authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /literally null/.test(e.message)
  )
})

test('getJson returns null for a 404 only when allow404 is set, and throws otherwise', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) })
  assert.equal(await getJson(START, { authorization: AUTH, fetchImpl, allow404: true }), null)
  await assert.rejects(
    getJson(START, { authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /HTTP 404/.test(e.message)
  )
})

test('getJson wraps a non-Error throw without degrading to "undefined"', async () => {
  const fetchImpl = async () => { throw 'socket hang up' } // eslint-disable-line no-throw-literal
  await assert.rejects(
    getJson(START, { authorization: AUTH, fetchImpl }),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_UNREADABLE' &&
      /network failure \(socket hang up\)/.test(e.message) &&
      !/undefined/.test(e.message) &&
      // `name` is what a log line and a stack header show; without it every
      // DiscoveryError reads as a bare "Error".
      e.name === 'DiscoveryError' &&
      // cause is forwarded even when the thrown value was not an Error.
      e.cause === 'socket hang up'
  )
})

// --- triage-code separation and the remaining seams (re-review) --------------

test('resolveFetchableUrl reports a bad base url as a config defect, not a pagination defect', () => {
  // A broken base url is a deployment problem. Sharing the pagination code would
  // route it to the wrong triage path — the defect M3 was raised to fix.
  assert.throws(
    () => resolveFetchableUrl('not a url', '/wiki/api/v2/pages/900000001/descendants'),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_CONFIG' &&
      /configured base url is not a URL/.test(e.message)
  )
})

test('resolveFetchableUrl rejects userinfo consisting of a password alone', () => {
  // "https://:pw@host/" leaves username empty, so a guard checking username only
  // would let the credential through.
  assert.throws(
    () => resolveFetchableUrl(BASE, 'https://:pw@example.invalid/wiki/x'),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_PAGINATION' &&
      /carries embedded userinfo credentials/.test(e.message) &&
      !/pw/.test(e.message)
  )
})

test('paginate treats _links: null as absent and ends the walk normally', async () => {
  // The one seam where corruption and completion still coincide, per D-2's
  // comment: JSON null means "no next link". Pinned so the intent is recorded
  // rather than incidental, and so a future tightening is a deliberate choice.
  const fetchImpl = pagedFetch(new Map([
    [START, { results: [{ id: '900000002' }], _links: null }]
  ]))
  const out = await paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl })
  assert.deepEqual(out.results, [{ id: '900000002' }])
  assert.equal(out.requests, 1)
  assert.deepEqual(fetchImpl.calls, [START])
})

// --- page shape / revision provenance ---------------------------------------

const descendant = (over = {}) => ({
  id: '900000002', status: 'current', title: 'Page 2', type: 'page',
  parentId: '900000001', depth: 1, childPosition: 0, ...over
})
const detail = (over = {}) => ({
  id: '900000002', status: 'current', title: 'Page 2',
  parentId: '900000001', spaceId: '55', version: { number: 7 }, ...over
})

test('assertDescendantShape accepts a complete page descendant', () => {
  assert.deepEqual(assertDescendantShape(descendant()), {
    page_id: '900000002', title: 'Page 2', type: 'page',
    parent_id: '900000001', depth: 1, source_status: 'current'
  })
})

test('assertDescendantShape normalizes a numeric id and a null parentId', () => {
  const d = assertDescendantShape(descendant({ id: 900000002, parentId: null }))
  assert.equal(d.page_id, '900000002')
  assert.equal(d.parent_id, null)
})

for (const [name, over] of [
  ['a missing id', { id: undefined }],
  ['an empty title', { title: '' }],
  ['a missing status', { status: undefined }],
  ['a non-string type', { type: 7 }],
  ['a non-integer depth', { depth: 1.5 }]
]) {
  test(`assertDescendantShape fails closed on ${name}`, () => {
    assert.throws(
      () => assertDescendantShape(descendant(over)),
      (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_METADATA'
    )
  })
}

test('assertPageDetailShape captures the revision identifier', () => {
  assert.deepEqual(assertPageDetailShape(detail(), '900000002'), {
    page_id: '900000002', title: 'Page 2', version: 7,
    parent_id: '900000001', source_status: 'current'
  })
})

test('assertPageDetailShape fails closed when Confluence supplies no revision', () => {
  // The whole point of the revision scan: a page without version.number must
  // never be reported as a verified revision, and no revision is ever invented.
  assert.throws(
    () => assertPageDetailShape(detail({ version: undefined }), '900000002'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_METADATA' &&
      /revision provenance cannot be established/.test(e.message)
  )
})

for (const [name, over] of [
  ['a non-integer version', { version: { number: 1.5 } }],
  ['a string version', { version: { number: '7' } }],
  ['an empty title', { title: '' }],
  ['a missing status', { status: '' }]
]) {
  test(`assertPageDetailShape fails closed on ${name}`, () => {
    assert.throws(
      () => assertPageDetailShape(detail(over), '900000002'),
      (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_METADATA'
    )
  })
}

test('assertPageDetailShape fails closed when the response answers with a different page id', () => {
  assert.throws(
    () => assertPageDetailShape(detail({ id: '900000009' }), '900000002'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_METADATA' && /does not match/.test(e.message)
  )
})

// --- lifecycle --------------------------------------------------------------

for (const [status, lifecycle] of [
  ['current', 'active'],
  ['archived', 'archived'],
  ['trashed', 'deleted'],
  ['deleted', 'deleted']
]) {
  test(`lifecycleFor maps status "${status}" to "${lifecycle}"`, () => {
    assert.equal(lifecycleFor(status), lifecycle)
  })
}

test('lifecycleFor fails closed on an unknown status rather than guessing', () => {
  assert.throws(
    () => lifecycleFor('historical'),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_LIFECYCLE' && /historical/.test(e.message)
  )
})

test('lifecycleFor fails closed on a missing status', () => {
  assert.throws(
    () => lifecycleFor(''),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_LIFECYCLE'
  )
})

test('lifecycleFor does not walk the prototype chain', () => {
  // "constructor"/"toString" must be unknown statuses, not inherited members.
  for (const evil of ['constructor', 'toString', '__proto__']) {
    assert.throws(
      () => lifecycleFor(evil),
      (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_LIFECYCLE'
    )
  }
})

test('archived and deleted are never reported as ordinary active content', () => {
  assert.notEqual(lifecycleFor('archived'), 'active')
  assert.notEqual(lifecycleFor('trashed'), 'active')
  assert.deepEqual(
    [...LIFECYCLES].sort(),
    ['absent', 'active', 'archived', 'deleted', 'removed_from_scope']
  )
  // The mapping is a closed allowlist, not an open passthrough.
  assert.deepEqual(Object.keys(STATUS_TO_LIFECYCLE).sort(), ['archived', 'current', 'deleted', 'trashed'])
})

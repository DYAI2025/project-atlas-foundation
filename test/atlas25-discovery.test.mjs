import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  DiscoveryError,
  resolveNextUrl,
  resolveFetchableUrl,
  resolveConfluenceBase,
  CONFLUENCE_BASE_URL_ENV,
  getJson,
  paginate,
  MAX_PAGINATION_REQUESTS,
  assertDescendantShape,
  assertPageDetailShape,
  assertCrossReadConsistent,
  lifecycleFor,
  LIFECYCLES,
  STATUS_TO_LIFECYCLE,
  discoverProject,
  digestOf,
  SCHEMA_VERSION,
  applyPrevious,
  requireAuth
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

// --- discoverProject --------------------------------------------------------

const PROJECT = {
  project_id: 'PLUMBLINE',
  jira_key: 'PLUM',
  confluence_space_key: 'PRODUKTMAN',
  root_page_id: '900000001',
  status: 'active'
}
const ENV = {
  ATLAS65_CONFLUENCE_BASE_URL: BASE,
  ATLAS65_CONFLUENCE_EMAIL: 'u@example.com',
  ATLAS65_CONFLUENCE_API_TOKEN: 't'
}

// Serves: root detail, a two-page cursor walk of descendants, and one detail per
// descendant. Any page id not registered answers 404.
function siteFetch({ descendantPages, details }) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const u = new URL(url)
    if (u.pathname.endsWith('/descendants')) {
      const cursor = u.searchParams.get('cursor') ?? '0'
      const body = descendantPages.get(cursor)
      if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => body }
    }
    const id = u.pathname.split('/').pop()
    const d = details.get(id)
    if (d === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => d }
  }
  impl.calls = calls
  return impl
}

const TWO_PAGE_WALK = new Map([
  ['0', {
    results: [descendant({ id: '900000002', parentId: '900000001', depth: 1 })],
    _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' }
  }],
  ['c2', {
    results: [
      descendant({ id: '900000003', parentId: '900000002', depth: 2, status: 'archived' }),
      descendant({ id: '900000004', parentId: '900000001', depth: 1, type: 'whiteboard' })
    ],
    _links: {}
  }]
])
const DETAILS = new Map([
  ['900000001', detail({ id: '900000001', parentId: null, version: { number: 12 }, title: 'Root' })],
  ['900000002', detail({ id: '900000002', parentId: '900000001', version: { number: 7 } })],
  ['900000003', detail({ id: '900000003', parentId: '900000002', version: { number: 2 }, status: 'archived', title: 'Old' })]
])

test('discoverProject walks the registered root subtree and captures revisions', async () => {
  const fetchImpl = siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: '2026-08-15T10:00:00.000Z', fetchImpl
  })

  assert.equal(doc.schema_version, SCHEMA_VERSION)
  assert.equal(doc.semantic.project_id, 'PLUMBLINE')
  assert.deepEqual(doc.semantic.source, {
    source_kind: 'confluence',
    source_id: '900000001',
    space_key: 'PRODUKTMAN',
    base_url: BASE
  })
  // Root + type=page descendants only; the whiteboard is counted, not dropped.
  assert.deepEqual(doc.semantic.pages.map((p) => p.page_id), ['900000001', '900000002', '900000003'])
  assert.equal(doc.semantic.discovery.non_page_descendants, 1)
  assert.deepEqual(
    doc.semantic.pages.map((p) => [p.page_id, p.version, p.lifecycle, p.source_status]),
    [
      ['900000001', 12, 'active', 'current'],
      ['900000002', 7, 'active', 'current'],
      ['900000003', 2, 'archived', 'archived']
    ]
  )
  assert.equal(doc.semantic.pages[1].parent_id, '900000001')
  assert.equal(doc.semantic.pages[0].parent_id, null)
  assert.equal(
    doc.semantic.pages[1].confluence_url,
    'https://example.invalid/wiki/spaces/PRODUKTMAN/pages/900000002'
  )
  assert.equal(doc.capture.captured_at, '2026-08-15T10:00:00.000Z')
  assert.equal(doc.capture.pagination_requests, 2) // proves the cursor was actually traversed
})

test('discoverProject is idempotent: identical source state yields an identical digest', async () => {
  const mk = () => siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  const a = await discoverProject({ env: ENV, project: PROJECT, capturedAt: '2026-08-15T10:00:00.000Z', fetchImpl: mk() })
  const b = await discoverProject({ env: ENV, project: PROJECT, capturedAt: '2027-01-01T23:59:59.000Z', fetchImpl: mk() })

  assert.equal(JSON.stringify(a.semantic), JSON.stringify(b.semantic)) // byte-identical
  assert.equal(a.discovery_digest, b.discovery_digest)
  assert.notEqual(a.capture.captured_at, b.capture.captured_at) // timestamps differ...
  assert.equal(JSON.stringify(a.semantic).includes('2026-08-15'), false) // ...and are not identity
})

test('discoverProject output order does not depend on the order Confluence returns pages', async () => {
  const reversed = new Map([
    ['0', {
      results: [descendant({ id: '900000003', parentId: '900000002', depth: 2, status: 'archived' })],
      _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' }
    }],
    ['c2', {
      results: [
        descendant({ id: '900000004', parentId: '900000001', depth: 1, type: 'whiteboard' }),
        descendant({ id: '900000002', parentId: '900000001', depth: 1 })
      ],
      _links: {}
    }]
  ])
  const a = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  const b = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: reversed, details: DETAILS })
  })
  assert.equal(a.discovery_digest, b.discovery_digest)
})

test('discoverProject fails closed when a descendant id appears twice in the walk', async () => {
  const dup = new Map([['0', { results: [descendant({ id: '900000002' }), descendant({ id: '900000002' })], _links: {} }]])
  await assert.rejects(
    discoverProject({ env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: dup, details: DETAILS }) }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_SCOPE' && /twice/.test(e.message)
  )
})

test('discoverProject fails closed when a descendant collides with the root id', async () => {
  const collide = new Map([['0', { results: [descendant({ id: '900000001', depth: 1 })], _links: {} }]])
  await assert.rejects(
    discoverProject({ env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: collide, details: DETAILS }) }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_SCOPE' && /root/.test(e.message)
  )
})

test('discoverProject fails closed without credentials, before any network call', async () => {
  const fetchImpl = async () => { throw new Error('must not be reached') }
  await assert.rejects(
    discoverProject({ env: { ATLAS65_CONFLUENCE_BASE_URL: BASE }, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e.code === 'E_SOURCE_AUTH_MISSING'
  )
})

test('discoverProject fails closed when the root page itself is unreadable', async () => {
  const fetchImpl = siteFetch({ descendantPages: TWO_PAGE_WALK, details: new Map() })
  await assert.rejects(
    discoverProject({ env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE'
  )
})

// --- incremental delta ------------------------------------------------------

// A previous scan that saw four pages: the root, 900000002 (v6), 900000003 (v2)
// and 900000005 (v1, since removed from the subtree).
const PREVIOUS_SEMANTIC = {
  schema_version: SCHEMA_VERSION,
  project_id: 'PLUMBLINE',
  source: { source_kind: 'confluence', source_id: '900000001', space_key: 'PRODUKTMAN', base_url: BASE },
  discovery: { rule: 'x', page_count: 4, non_page_descendants: 0 },
  pages: [
    { page_id: '900000001', title: 'Root', version: 12, parent_id: null, depth: 0, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
    { page_id: '900000002', title: 'Page 2', version: 6, parent_id: '900000001', depth: 1, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
    { page_id: '900000003', title: 'Old', version: 2, parent_id: '900000002', depth: 2, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
    { page_id: '900000005', title: 'Gone', version: 1, parent_id: '900000001', depth: 1, lifecycle: 'active', source_status: 'current', confluence_url: 'u' }
  ],
  // No `delta` here: the delta is lineage and lives under `capture`, outside the
  // digested body. A fixture that still carried it would be asserting the old,
  // history-chained identity contract.
  absent: []
}

// A previous scan is now only accepted if its digest matches its own body, so
// every fixture derives the digest from the body it actually carries. Hand-typed
// digests would make each fixture prove nothing except the digest guard.
function previousEnvelope(semantic, envelopeOver = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    discovery_digest: digestOf(semantic),
    semantic,
    capture: { captured_at: 'then', pagination_requests: 1, previous_digest: null, delta: null },
    ...envelopeOver
  }
}

function previousScan(semanticOver = {}, envelopeOver = {}) {
  return previousEnvelope({ ...PREVIOUS_SEMANTIC, ...semanticOver }, envelopeOver)
}

const PREVIOUS = previousScan()

async function discoverWithPrevious(previous, extraDetails = new Map()) {
  const details = new Map([...DETAILS, ...extraDetails])
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: '2026-08-15T10:00:00.000Z',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details })
  })
  return applyPrevious(doc, previous, {
    env: ENV, project: PROJECT,
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details })
  })
}

test('applyPrevious reports added, unchanged, version_changed and lifecycle_changed', async () => {
  // 900000005 is absent from the subtree AND 404s on a direct read -> "absent".
  const doc = await discoverWithPrevious(PREVIOUS)
  assert.deepEqual(doc.capture.delta, {
    previous_digest: PREVIOUS.discovery_digest,
    added: [],
    unchanged: ['900000001'],
    version_changed: [{ page_id: '900000002', from: 6, to: 7 }],
    lifecycle_changed: [{ page_id: '900000003', from: 'active', to: 'archived' }],
    absent: ['900000005']
  })
  assert.equal(doc.capture.previous_digest, PREVIOUS.discovery_digest)
})

test('applyPrevious records an absent page with its 404 evidence, never as "deleted"', async () => {
  const doc = await discoverWithPrevious(PREVIOUS)
  assert.deepEqual(doc.semantic.absent, [{
    page_id: '900000005',
    lifecycle: 'absent',
    evidence: 'http_404_on_direct_read',
    last_seen_version: 1
  }])
  assert.equal(doc.semantic.absent.some((a) => a.lifecycle === 'deleted'), false)
})

test('applyPrevious records an API-evidenced deleted state when the direct read returns a trashed status', async () => {
  const doc = await discoverWithPrevious(PREVIOUS, new Map([
    ['900000005', detail({ id: '900000005', parentId: '900000001', version: { number: 1 }, status: 'trashed', title: 'Gone' })]
  ]))
  assert.deepEqual(doc.semantic.absent, [{
    page_id: '900000005',
    lifecycle: 'deleted',
    evidence: 'direct_read_status_trashed',
    last_seen_version: 1
  }])
})

test('applyPrevious distinguishes a page that still exists but left the registered subtree', async () => {
  const doc = await discoverWithPrevious(PREVIOUS, new Map([
    ['900000005', detail({ id: '900000005', parentId: '900000009', version: { number: 4 }, status: 'current', title: 'Moved' })]
  ]))
  assert.deepEqual(doc.semantic.absent, [{
    page_id: '900000005',
    lifecycle: 'removed_from_scope',
    evidence: 'direct_read_status_current',
    last_seen_version: 1
  }])
})

test('applyPrevious with no previous scan leaves delta null and absent empty', async () => {
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  // Deviation D-3: applyPrevious is async, so its result MUST be awaited even on
  // the early-return path. The plan's draft read `same.semantic` off the pending
  // promise, which is `undefined` — the test would have failed with a TypeError
  // rather than proving the no-previous behaviour.
  const same = await applyPrevious(doc, null, {})
  assert.equal(same.capture.delta, null)
  assert.deepEqual(same.semantic.absent, [])
  assert.equal(same.discovery_digest, doc.discovery_digest)
})

test('applyPrevious fails closed when the previous scan belongs to a different project', async () => {
  // Digest recomputed over the altered body, so this fixture is intact and can
  // only be rejected by the project-scope check — not incidentally by the
  // integrity checks that now run before it.
  const foreign = previousScan({ project_id: 'ATLAS' })
  await assert.rejects(
    discoverWithPrevious(foreign),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_SCOPE' && /project/.test(e.message)
  )
})

test('applyPrevious fails closed when the previous scan used a different root', async () => {
  const foreign = previousScan({ source: { ...PREVIOUS_SEMANTIC.source, source_id: '900000099' } })
  await assert.rejects(
    discoverWithPrevious(foreign),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_SCOPE' && /root/.test(e.message)
  )
})

test('applyPrevious fails closed on a structurally invalid previous scan', async () => {
  await assert.rejects(
    discoverWithPrevious({ semantic: { project_id: 'PLUMBLINE' } }),
    (e) => e instanceof DiscoveryError && e.code === 'E_PREVIOUS_INVALID'
  )
})

test('rerunning against an unchanged previous scan reports every page unchanged and an empty delta body', async () => {
  const first = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'a',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  const second = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'b',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  const withDelta = await applyPrevious(second, first, {
    env: ENV, project: PROJECT, fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  assert.deepEqual(withDelta.capture.delta.added, [])
  assert.deepEqual(withDelta.capture.delta.version_changed, [])
  assert.deepEqual(withDelta.capture.delta.lifecycle_changed, [])
  assert.deepEqual(withDelta.capture.delta.absent, [])
  assert.deepEqual(withDelta.capture.delta.unchanged, ['900000001', '900000002', '900000003'])
  assert.equal(withDelta.capture.delta.previous_digest, first.discovery_digest)
  // The source did not change, so comparing it against a predecessor must not
  // change what it IS. Identity is the digest of the current source state alone.
  assert.equal(withDelta.discovery_digest, second.discovery_digest)
  assert.equal(withDelta.discovery_digest, first.discovery_digest)
})

// --- previous-scan integrity (PO finding 1) ---------------------------------
//
// "Structurally plausible" is not "an intact scan". A previous scan drives the
// delta AND is carried forward as provenance in capture.previous_digest, so its
// integrity is checked before any field is believed. The digest is an unkeyed
// SHA-256 content digest: it detects edited or truncated bodies, it does not
// authenticate an author.

test('applyPrevious accepts a previous scan whose digest matches its own semantic body', async () => {
  // The positive case, pinned explicitly: the fixture's digest is not a literal,
  // it is recomputed from the body, so this test fails if digestOf ever changes
  // meaning rather than passing on a hardcoded constant.
  assert.equal(PREVIOUS.discovery_digest, digestOf(PREVIOUS.semantic))
  const doc = await discoverWithPrevious(PREVIOUS)
  assert.equal(doc.capture.previous_digest, PREVIOUS.discovery_digest)
  assert.notEqual(doc.capture.delta, null)
})

// A body edited after the fact: the digest still belongs to the ORIGINAL body.
const TAMPERED_PREVIOUS = {
  ...PREVIOUS,
  semantic: {
    ...PREVIOUS.semantic,
    pages: PREVIOUS.semantic.pages.map((p) => (p.page_id === '900000002' ? { ...p, version: 999 } : p))
  }
}

test('applyPrevious fails closed on a previous scan whose semantic body was tampered with', async () => {
  assert.notEqual(JSON.stringify(TAMPERED_PREVIOUS.semantic), JSON.stringify(PREVIOUS.semantic))
  assert.equal(TAMPERED_PREVIOUS.discovery_digest, PREVIOUS.discovery_digest) // stale by construction
  await assert.rejects(
    discoverWithPrevious(TAMPERED_PREVIOUS),
    (e) => e instanceof DiscoveryError && e.code === 'E_PREVIOUS_INVALID' && /discovery_digest does not match/.test(e.message)
  )
})

test('applyPrevious fails closed on an arbitrary forged discovery_digest', async () => {
  const forged = { ...PREVIOUS, discovery_digest: 'f'.repeat(64) }
  await assert.rejects(
    discoverWithPrevious(forged),
    (e) => e instanceof DiscoveryError && e.code === 'E_PREVIOUS_INVALID' && /discovery_digest does not match/.test(e.message)
  )
})

// Two rows for one page id, digest recomputed so the document is otherwise
// intact: only the duplicate guard can reject it.
const DUPLICATE_PREVIOUS = previousScan({
  pages: [
    ...PREVIOUS_SEMANTIC.pages,
    { page_id: '900000002', title: 'Page 2 (second row)', version: 999, parent_id: '900000001', depth: 1, lifecycle: 'active', source_status: 'current', confluence_url: 'u' }
  ]
})

test('applyPrevious fails closed when the previous scan lists one page id twice', async () => {
  assert.equal(DUPLICATE_PREVIOUS.discovery_digest, digestOf(DUPLICATE_PREVIOUS.semantic)) // intact, not stale
  await assert.rejects(
    discoverWithPrevious(DUPLICATE_PREVIOUS),
    (e) => e instanceof DiscoveryError && e.code === 'E_PREVIOUS_INVALID' && /lists page 900000002 more than once/.test(e.message)
  )
})

test('applyPrevious fails closed on a previous lifecycle outside the closed model', async () => {
  const bad = previousScan({
    pages: PREVIOUS_SEMANTIC.pages.map((p) => (p.page_id === '900000003' ? { ...p, lifecycle: 'historical' } : p))
  })
  await assert.rejects(
    discoverWithPrevious(bad),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_PREVIOUS_INVALID' &&
      /outside the closed lifecycle model/.test(e.message) &&
      /"historical"/.test(e.message)
  )
})

test('applyPrevious accepts every lifecycle the closed model actually declares', async () => {
  // The guard must reject unknown values without narrowing the declared model —
  // a stricter allowlist here would silently redefine the lifecycle contract.
  for (const lifecycle of LIFECYCLES) {
    const ok = previousScan({
      pages: PREVIOUS_SEMANTIC.pages.map((p) => (p.page_id === '900000005' ? { ...p, lifecycle } : p))
    })
    const doc = await discoverWithPrevious(ok)
    assert.equal(doc.capture.previous_digest, ok.discovery_digest)
  }
})

for (const [where, semanticOver, envelopeOver] of [
  ['the semantic body', { schema_version: '2.0' }, {}],
  ['the envelope', {}, { schema_version: '0.9' }]
]) {
  test(`applyPrevious fails closed on an incompatible previous schema version in ${where}`, async () => {
    await assert.rejects(
      discoverWithPrevious(previousScan(semanticOver, envelopeOver)),
      (e) =>
        e instanceof DiscoveryError &&
        e.code === 'E_PREVIOUS_INVALID' &&
        /schema version/.test(e.message) &&
        new RegExp(`is not the supported "${SCHEMA_VERSION}"`).test(e.message)
    )
  })
}

// --- previous-scan absent list (incremental state closure) ------------------
//
// The absent list is now read back on the next run, so it is validated like the
// page list instead of being trusted because nothing looked at it.

test('applyPrevious fails closed when the previous scan carries no absent list', async () => {
  const semantic = { ...PREVIOUS_SEMANTIC }
  delete semantic.absent
  await assert.rejects(
    discoverWithPrevious(previousEnvelope(semantic)),
    (e) => e instanceof DiscoveryError && e.code === 'E_PREVIOUS_INVALID' && /structurally invalid/.test(e.message)
  )
})

for (const [name, entry] of [
  ['no page_id', { lifecycle: 'absent', evidence: 'http_404_on_direct_read', last_seen_version: 1 }],
  ['no last_seen_version', { page_id: '900000007', lifecycle: 'absent', evidence: 'http_404_on_direct_read' }],
  ['a non-integer last_seen_version', { page_id: '900000007', lifecycle: 'absent', evidence: 'x', last_seen_version: 1.5 }],
  ['no evidence', { page_id: '900000007', lifecycle: 'absent', last_seen_version: 1 }]
]) {
  test(`applyPrevious fails closed on a previous absent entry with ${name}`, async () => {
    await assert.rejects(
      discoverWithPrevious(previousScan({ absent: [entry] })),
      (e) =>
        e instanceof DiscoveryError &&
        e.code === 'E_PREVIOUS_INVALID' &&
        /absent entry without id, last_seen_version, lifecycle or evidence/.test(e.message)
    )
  })
}

test('applyPrevious fails closed on a previous absent entry outside the closed lifecycle model', async () => {
  await assert.rejects(
    discoverWithPrevious(previousScan({
      absent: [{ page_id: '900000007', lifecycle: 'vanished', evidence: 'http_404_on_direct_read', last_seen_version: 1 }]
    })),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_PREVIOUS_INVALID' &&
      /outside the closed lifecycle model/.test(e.message) &&
      /"vanished"/.test(e.message)
  )
})

test('applyPrevious fails closed when one page id is listed both as a page and as absent', async () => {
  // Ambiguous previously-observed state: whichever row wins the comparison map
  // silently decides the delta. It cannot be both in scope and absent at once.
  await assert.rejects(
    discoverWithPrevious(previousScan({
      absent: [{ page_id: '900000005', lifecycle: 'absent', evidence: 'http_404_on_direct_read', last_seen_version: 1 }]
    })),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_PREVIOUS_INVALID' &&
      /lists page 900000005 more than once across its pages and absent lists/.test(e.message)
  )
})

test('applyPrevious fails closed when the previous absent list repeats one page id', async () => {
  const twice = {
    page_id: '900000007', lifecycle: 'absent', evidence: 'http_404_on_direct_read', last_seen_version: 1
  }
  await assert.rejects(
    discoverWithPrevious(previousScan({ absent: [twice, { ...twice, last_seen_version: 2 }] })),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_PREVIOUS_INVALID' &&
      /lists page 900000007 more than once/.test(e.message)
  )
})

// --- incremental state closure: chained reruns ------------------------------
//
// One source state, observed three times: a plain scan and two chained
// incremental scans. Two invariants are at stake and they are separate.
//   1. Identity comes from the CURRENT SOURCE STATE alone. Which predecessor a
//      run happened to be compared against is lineage and must not enter the
//      digest, or every rerun of an unchanged source mints a new identity.
//   2. An absence, once directly observed, keeps being carried and re-verified.
//      A page that is gone must not slip out of the scan just because the
//      predecessor stopped listing it as a page.

const chainScan = (walk, details, capturedAt) => discoverProject({
  env: ENV, project: PROJECT, capturedAt, fetchImpl: siteFetch({ descendantPages: walk, details })
})
const chainPrev = (doc, previous, walk, details) => applyPrevious(doc, previous, {
  env: ENV, project: PROJECT, fetchImpl: siteFetch({ descendantPages: walk, details })
})

// Source state S1 — root + 900000002 + 900000005.
const WALK_WITH_5 = new Map([['0', {
  results: [
    descendant({ id: '900000002', parentId: '900000001', depth: 1 }),
    descendant({ id: '900000005', parentId: '900000001', depth: 1, title: 'Gone later' })
  ],
  _links: {}
}]])
const DETAILS_WITH_5 = new Map([
  ['900000001', detail({ id: '900000001', parentId: null, version: { number: 12 }, title: 'Root' })],
  ['900000002', detail({ id: '900000002', parentId: '900000001', version: { number: 7 } })],
  ['900000005', detail({ id: '900000005', parentId: '900000001', version: { number: 1 }, title: 'Gone later' })]
])
// Source state S2 — 900000005 has left the walk AND 404s on a direct read.
const WALK_WITHOUT_5 = new Map([['0', {
  results: [descendant({ id: '900000002', parentId: '900000001', depth: 1 })],
  _links: {}
}]])
const DETAILS_WITHOUT_5 = new Map([
  ['900000001', detail({ id: '900000001', parentId: null, version: { number: 12 }, title: 'Root' })],
  ['900000002', detail({ id: '900000002', parentId: '900000001', version: { number: 7 } })]
])

const ABSENT_5 = {
  page_id: '900000005',
  lifecycle: 'absent',
  evidence: 'http_404_on_direct_read',
  last_seen_version: 1
}

test('three chained runs over one unchanged source state hold exactly one discovery identity', async () => {
  const run1 = await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T1')
  const run2 = await chainPrev(await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T2'), run1, WALK_WITH_5, DETAILS_WITH_5)
  const run3 = await chainPrev(await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T3'), run2, WALK_WITH_5, DETAILS_WITH_5)

  // Byte-identical bodies, so this is an identity claim rather than a digest
  // coincidence.
  assert.equal(JSON.stringify(run2.semantic), JSON.stringify(run1.semantic))
  assert.equal(JSON.stringify(run3.semantic), JSON.stringify(run2.semantic))
  assert.equal(run2.discovery_digest, run1.discovery_digest)
  assert.equal(run3.discovery_digest, run2.discovery_digest)

  // The predecessor DOCUMENTS differ — different capture, different provenance —
  // and each run still records which one it used. Their digests coincide only
  // because identity is now stable, which is precisely the repaired behaviour.
  assert.notEqual(JSON.stringify(run1.capture), JSON.stringify(run2.capture))
  assert.equal(run2.capture.previous_digest, run1.discovery_digest)
  assert.equal(run3.capture.previous_digest, run2.discovery_digest)

  // The delta is not dropped, only relocated out of the digested body.
  assert.deepEqual(run3.capture.delta.unchanged, ['900000001', '900000002', '900000005'])
  assert.deepEqual(run3.capture.delta.added, [])
  assert.deepEqual(run3.capture.delta.version_changed, [])
  assert.deepEqual(run3.capture.delta.lifecycle_changed, [])
  assert.deepEqual(run3.capture.delta.absent, [])

  // No lineage may sit inside the digested body — not the field, not the value.
  assert.equal(Object.hasOwn(run3.semantic, 'delta'), false)
  assert.equal(JSON.stringify(run3.semantic).includes(run3.capture.previous_digest), false)
})

test('a different predecessor changes the reported delta but never the discovery identity', async () => {
  // The sharpest form of the invariant: one current source state, two genuinely
  // different predecessors (one saw 900000002 at v6, one at v7), so the deltas
  // must differ and the identity must not.
  const older = PREVIOUS
  const newer = previousScan({
    pages: PREVIOUS_SEMANTIC.pages.map((p) => (p.page_id === '900000002' ? { ...p, version: 7 } : p))
  })
  assert.notEqual(older.discovery_digest, newer.discovery_digest)

  const a = await discoverWithPrevious(older)
  const b = await discoverWithPrevious(newer)

  assert.deepEqual(a.capture.delta.version_changed, [{ page_id: '900000002', from: 6, to: 7 }])
  assert.deepEqual(b.capture.delta.version_changed, [])
  assert.notEqual(a.capture.previous_digest, b.capture.previous_digest)
  assert.equal(JSON.stringify(a.semantic), JSON.stringify(b.semantic))
  assert.equal(a.discovery_digest, b.discovery_digest)
})

test('a page observed absent stays represented as absent on every following run', async () => {
  const run1 = await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T1')
  const run2 = await chainPrev(await chainScan(WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T2'), run1, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
  const run3 = await chainPrev(await chainScan(WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T3'), run2, WALK_WITHOUT_5, DETAILS_WITHOUT_5)

  assert.deepEqual(run1.semantic.pages.map((p) => p.page_id), ['900000001', '900000002', '900000005'])
  assert.deepEqual(run2.semantic.pages.map((p) => p.page_id), ['900000001', '900000002'])
  assert.deepEqual(run2.semantic.absent, [ABSENT_5])

  // The load-bearing case: run3's predecessor lists 900000005 only under
  // `absent`, never under `pages`. Reading the page list alone dropped it here,
  // and the page vanished from the scan with no error and no evidence.
  assert.deepEqual(run3.semantic.absent, [ABSENT_5])
  assert.deepEqual(run3.capture.delta.absent, ['900000005'])
  assert.equal(JSON.stringify(run3.semantic).includes('900000005'), true)

  // Absence is a fixed point: re-probing a persistent 404 reproduces the record
  // byte for byte, including the revision it was last seen at.
  assert.equal(JSON.stringify(run3.semantic), JSON.stringify(run2.semantic))
  assert.equal(run3.discovery_digest, run2.discovery_digest)
})

test('a page that reappears after an observed absence is a lifecycle transition, not a new page', async () => {
  const run1 = await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T1')
  const run2 = await chainPrev(await chainScan(WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T2'), run1, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
  const run3 = await chainPrev(await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T3'), run2, WALK_WITH_5, DETAILS_WITH_5)

  assert.deepEqual(run3.semantic.pages.map((p) => p.page_id), ['900000001', '900000002', '900000005'])
  assert.deepEqual(run3.semantic.absent, [])
  // Known-and-absent, not first-seen. Without the carried absence the page would
  // be reported as `added` and the fact that it had been absent would be gone.
  assert.deepEqual(run3.capture.delta.added, [])
  assert.deepEqual(run3.capture.delta.lifecycle_changed, [{ page_id: '900000005', from: 'absent', to: 'active' }])
  assert.deepEqual(run3.capture.delta.version_changed, [])
  // Same source state as run1, so the same identity — the absence episode left
  // lineage behind, not a different source.
  assert.equal(run3.discovery_digest, run1.discovery_digest)
})

test('a persistent disappearance never hardens into "deleted" — only an API status does that', async () => {
  let doc = await chainScan(WALK_WITH_5, DETAILS_WITH_5, 'T1')
  for (const capturedAt of ['T2', 'T3', 'T4']) {
    doc = await chainPrev(await chainScan(WALK_WITHOUT_5, DETAILS_WITHOUT_5, capturedAt), doc, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
    // Four consecutive 404s are four observations of absence, never an inference
    // of deletion — no matter how long the page stays gone.
    assert.deepEqual(doc.semantic.absent, [ABSENT_5])
    assert.equal(doc.semantic.absent.some((a) => a.lifecycle === 'deleted'), false)
  }
  const trashed = new Map([
    ...DETAILS_WITHOUT_5,
    ['900000005', detail({ id: '900000005', parentId: '900000001', version: { number: 1 }, status: 'trashed', title: 'Gone later' })]
  ])
  const final = await chainPrev(await chainScan(WALK_WITHOUT_5, trashed, 'T5'), doc, WALK_WITHOUT_5, trashed)
  assert.deepEqual(final.semantic.absent, [{
    page_id: '900000005',
    lifecycle: 'deleted',
    evidence: 'direct_read_status_trashed',
    last_seen_version: 1
  }])
})

// --- cross-read source consistency (PO finding 2) ---------------------------

test('assertCrossReadConsistent accepts an agreeing descendant observation and detail read', () => {
  assert.equal(
    assertCrossReadConsistent(
      { page_id: '900000002', parent_id: '900000001', depth: 1, source_status: 'current' },
      { page_id: '900000002', parent_id: '900000001', version: 7, source_status: 'current' }
    ),
    undefined
  )
})

test('assertCrossReadConsistent fails closed on a parent_id that changed between the two reads', () => {
  assert.throws(
    () => assertCrossReadConsistent(
      { page_id: '900000002', parent_id: '900000001', depth: 1, source_status: 'current' },
      { page_id: '900000002', parent_id: '900000009', version: 7, source_status: 'current' }
    ),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_METADATA' &&
      /source metadata changed during the scan/.test(e.message) &&
      /parent_id/.test(e.message)
  )
})

test('assertCrossReadConsistent fails closed on a status that changed between the two reads', () => {
  assert.throws(
    () => assertCrossReadConsistent(
      { page_id: '900000002', parent_id: '900000001', depth: 1, source_status: 'current' },
      { page_id: '900000002', parent_id: '900000001', version: 7, source_status: 'archived' }
    ),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_METADATA' &&
      /source metadata changed during the scan/.test(e.message) &&
      /status/.test(e.message)
  )
})

test('discoverProject emits page records only when both reads agree on parent and status', async () => {
  // The happy path stated as a consistency claim rather than as a side effect of
  // the main walk test: every emitted record matches the descendants observation.
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  const observed = new Map([['900000002', ['900000001', 'current']], ['900000003', ['900000002', 'archived']]])
  for (const [pageId, [parentId, status]] of observed) {
    const record = doc.semantic.pages.find((p) => p.page_id === pageId)
    assert.deepEqual([record.parent_id, record.source_status], [parentId, status])
  }
})

test('discoverProject fails closed when the detail read reports a different parent than the walk', async () => {
  // descendants said parentId 900000001; the detail read says 900000009.
  const moved = new Map([...DETAILS, ['900000002', detail({ id: '900000002', parentId: '900000009', version: { number: 7 } })]])
  await assert.rejects(
    discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x',
      fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: moved })
    }),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_METADATA' &&
      /page 900000002/.test(e.message) &&
      /source metadata changed during the scan/.test(e.message) &&
      /parent_id/.test(e.message)
  )
})

test('discoverProject fails closed when the detail read reports a different status than the walk', async () => {
  // descendants said archived; the detail read says current.
  const restated = new Map([...DETAILS, ['900000003', detail({ id: '900000003', parentId: '900000002', version: { number: 2 }, status: 'current', title: 'Old' })]])
  await assert.rejects(
    discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x',
      fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: restated })
    }),
    (e) =>
      e instanceof DiscoveryError &&
      e.code === 'E_DISCOVERY_METADATA' &&
      /page 900000003/.test(e.message) &&
      /source metadata changed during the scan/.test(e.message) &&
      /status/.test(e.message)
  )
})

test('the registered root may have a parent above the scope boundary — that is not an inconsistency', async () => {
  // The root is a deliberate scope boundary, not a tree root. Requiring
  // parent_id === null would make every legitimately nested project fail.
  const rootHasParent = new Map([
    ...DETAILS,
    ['900000001', detail({ id: '900000001', parentId: '900000000', version: { number: 12 }, title: 'Root' })]
  ])
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: rootHasParent })
  })
  assert.equal(doc.semantic.pages[0].page_id, '900000001')
  assert.equal(doc.semantic.pages[0].parent_id, '900000000')
  assert.equal(doc.semantic.pages.some((p) => p.page_id === '900000000'), false) // no page invented
})

test('a page whose parent is a non-page intermediary is kept, and its parent is not invented as a page', async () => {
  // Confluence allows folder/whiteboard intermediaries. The scope rule is "all
  // type=page descendants", so 900000006 stays in scope even though its parent
  // 900000004 is a whiteboard and therefore never becomes a page record.
  const walk = new Map([
    ['0', {
      results: [descendant({ id: '900000002', parentId: '900000001', depth: 1 })],
      _links: { next: '/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=c2' }
    }],
    ['c2', {
      results: [
        descendant({ id: '900000003', parentId: '900000002', depth: 2, status: 'archived' }),
        descendant({ id: '900000004', parentId: '900000001', depth: 1, type: 'whiteboard' }),
        descendant({ id: '900000006', parentId: '900000004', depth: 2 })
      ],
      _links: {}
    }]
  ])
  const details = new Map([
    ...DETAILS,
    ['900000006', detail({ id: '900000006', parentId: '900000004', version: { number: 3 }, title: 'Under a whiteboard' })]
  ])
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: walk, details })
  })
  assert.deepEqual(doc.semantic.pages.map((p) => p.page_id), ['900000001', '900000002', '900000003', '900000006'])
  assert.equal(doc.semantic.pages.find((p) => p.page_id === '900000006').parent_id, '900000004')
  assert.equal(doc.semantic.pages.some((p) => p.page_id === '900000004'), false) // parent not invented
  assert.equal(doc.semantic.discovery.non_page_descendants, 1)
})

// --- mutation / counterexample proofs ---------------------------------------
//
// Each guard is proved load-bearing by loading a COPY of the SHIPPED module with
// exactly that guard's source removed and showing the same input is then
// accepted. Without this, a guard could be deleted and its test could still pass
// for some unrelated reason. The occurrence count is asserted before the cut, so
// a mutation that silently matched nothing cannot masquerade as evidence.

const MODULE_PATH = fileURLToPath(new URL('../src/atlas25/discovery.mjs', import.meta.url))
const AUTH_MODULE_URL = pathToFileURL(fileURLToPath(new URL('../src/atlas65/confluence-source.mjs', import.meta.url))).href
const RELATIVE_AUTH_IMPORT = "'../atlas65/confluence-source.mjs'"

// `replacement` is '' for a guard cut. Defect A was not a missing guard but a
// misplaced field, so proving it load-bearing means RESTORING the old mechanism
// rather than deleting a check — a cut alone could never put lineage back into
// the digested body.
async function withMutatedSource(fragment, replacement, run) {
  const source = await readFile(MODULE_PATH, 'utf8')
  assert.equal(
    source.split(fragment).length - 1, 1,
    'mutation target must occur exactly once in the shipped source — otherwise the cut proves nothing'
  )
  assert.equal(source.split(RELATIVE_AUTH_IMPORT).length - 1, 1)
  // The copy lives outside the tree, so its relative dependency is rewritten to
  // an absolute file URL. The shipped file itself is never modified.
  const mutated = source.split(fragment).join(replacement).replace(RELATIVE_AUTH_IMPORT, JSON.stringify(AUTH_MODULE_URL))
  assert.equal(mutated.includes(fragment), replacement.includes(fragment))
  assert.notEqual(mutated, source)
  const dir = await mkdtemp(join(tmpdir(), 'atlas25-mutant-'))
  try {
    const file = join(dir, 'discovery.mjs')
    await writeFile(file, mutated)
    await run(await import(pathToFileURL(file).href))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const withoutGuard = (fragment, run) => withMutatedSource(fragment, '', run)

async function discoverWithPreviousUsing(mod, previous, details = DETAILS) {
  const doc = await mod.discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details })
  })
  return mod.applyPrevious(doc, previous, {
    env: ENV, project: PROJECT, fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details })
  })
}

const DIGEST_GUARD = [
  '  if (digestOf(s) !== previous.discovery_digest) {',
  '    throw new DiscoveryError(',
  "      'E_PREVIOUS_INVALID',",
  "      'previous scan discovery_digest does not match a digest recomputed from its own semantic body'",
  '    )',
  '  }'
].join('\n')

const DUPLICATE_GUARD = [
  '    if (seenPageIds.has(p.page_id)) {',
  "      throw new DiscoveryError('E_PREVIOUS_INVALID', `previous scan lists page ${p.page_id} more than once`)",
  '    }'
].join('\n')

const PARENT_GUARD = [
  '  if (detail.parent_id !== observed.parent_id) {',
  '    fail(',
  '      `parent_id ${JSON.stringify(detail.parent_id)} from the detail read does not match ` +',
  '      `${JSON.stringify(observed.parent_id)} observed in the descendants walk`',
  '    )',
  '  }'
].join('\n')

const STATUS_GUARD = [
  '  if (detail.source_status !== observed.source_status) {',
  '    fail(',
  '      `status ${JSON.stringify(detail.source_status)} from the detail read does not match ` +',
  '      `${JSON.stringify(observed.source_status)} observed in the descendants walk`',
  '    )',
  '  }'
].join('\n')

test('counterexample: without the digest guard, a tampered previous scan is accepted', async () => {
  await withoutGuard(DIGEST_GUARD, async (mod) => {
    const doc = await discoverWithPreviousUsing(mod, TAMPERED_PREVIOUS)
    // The forged "version 999" is believed, and the stale digest is carried
    // forward as this scan's provenance. Exactly what the guard prevents.
    assert.deepEqual(doc.capture.delta.version_changed, [{ page_id: '900000002', from: 999, to: 7 }])
    assert.equal(doc.capture.previous_digest, PREVIOUS.discovery_digest)
  })
})

test('counterexample: without the duplicate-page_id guard, one of the duplicate rows disappears silently', async () => {
  await withoutGuard(DUPLICATE_GUARD, async (mod) => {
    const doc = await discoverWithPreviousUsing(mod, DUPLICATE_PREVIOUS)
    // new Map(pages.map(...)) keeps the LAST row; the version-6 row vanishes
    // with nothing reported. No error, no warning, a wrong delta.
    assert.deepEqual(doc.capture.delta.version_changed, [{ page_id: '900000002', from: 999, to: 7 }])
  })
})

test('counterexample: the pre-fix implementation accepted a parent_id that changed between the two reads', async () => {
  // Removing the parent check restores the shipped-before-repair behaviour for
  // this input: the descendants walk said 900000001, the detail read said
  // 900000009, and a page record was emitted anyway.
  const moved = new Map([...DETAILS, ['900000002', detail({ id: '900000002', parentId: '900000009', version: { number: 7 } })]])
  await withoutGuard(PARENT_GUARD, async (mod) => {
    const doc = await mod.discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: moved })
    })
    const record = doc.semantic.pages.find((p) => p.page_id === '900000002')
    assert.equal(record.parent_id, '900000009') // contradicts the walk, emitted regardless
    assert.equal(record.depth, 1) // depth still came from the walk — two source states in one record
  })
})

test('counterexample: the pre-fix implementation accepted a status that changed between the two reads', async () => {
  const restated = new Map([...DETAILS, ['900000003', detail({ id: '900000003', parentId: '900000002', version: { number: 2 }, status: 'current', title: 'Old' })]])
  await withoutGuard(STATUS_GUARD, async (mod) => {
    const doc = await mod.discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: restated })
    })
    const record = doc.semantic.pages.find((p) => p.page_id === '900000003')
    // The walk observed "archived", the record says active/current.
    assert.deepEqual([record.lifecycle, record.source_status], ['active', 'current'])
  })
})

// --- incremental state closure counterexamples ------------------------------

const modScan = (mod, walk, details, capturedAt) => mod.discoverProject({
  env: ENV, project: PROJECT, capturedAt, fetchImpl: siteFetch({ descendantPages: walk, details })
})
const modPrev = (mod, doc, previous, walk, details) => mod.applyPrevious(doc, previous, {
  env: ENV, project: PROJECT, fetchImpl: siteFetch({ descendantPages: walk, details })
})

const ABSENT_CARRY_FORWARD = [
  '  for (const a of prev.absent) {',
  '    previousById.set(a.page_id, { version: a.last_seen_version, lifecycle: a.lifecycle })',
  '  }'
].join('\n')

test('counterexample: without the absent carry-forward, the next run forgets an absent page entirely', async () => {
  await withoutGuard(ABSENT_CARRY_FORWARD, async (mod) => {
    const run1 = await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T1')
    const run2 = await modPrev(mod, await modScan(mod, WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T2'), run1, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
    const run3 = await modPrev(mod, await modScan(mod, WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T3'), run2, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
    // Recorded once...
    assert.deepEqual(run2.semantic.absent, [ABSENT_5])
    // ...and gone on the very next run, with no error and no evidence that a page
    // the project had observed ever existed.
    assert.deepEqual(run3.semantic.absent, [])
    assert.deepEqual(run3.capture.delta.absent, [])
    assert.equal(JSON.stringify(run3.semantic).includes('900000005'), false)
  })
})

test('counterexample: without the absent carry-forward, a reappearing page is misreported as new', async () => {
  await withoutGuard(ABSENT_CARRY_FORWARD, async (mod) => {
    const run1 = await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T1')
    const run2 = await modPrev(mod, await modScan(mod, WALK_WITHOUT_5, DETAILS_WITHOUT_5, 'T2'), run1, WALK_WITHOUT_5, DETAILS_WITHOUT_5)
    const run3 = await modPrev(mod, await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T3'), run2, WALK_WITH_5, DETAILS_WITH_5)
    // "added" claims first sighting; the recorded absence episode is lost.
    assert.deepEqual(run3.capture.delta.added, ['900000005'])
    assert.deepEqual(run3.capture.delta.lifecycle_changed, [])
  })
})

// Defect A was a misplaced field, not a missing check, so the proof RESTORES the
// pre-repair mechanism instead of deleting a guard: put the delta back inside the
// digested body and the churn returns.
const IDENTITY_WITHOUT_LINEAGE = [
  '  const semantic = {',
  '    ...doc.semantic,',
  '    absent: absent.sort(sortById)',
  '  }'
].join('\n')
const IDENTITY_WITH_LINEAGE = [
  '  const semantic = {',
  '    ...doc.semantic,',
  '    absent: absent.sort(sortById),',
  '    delta',
  '  }'
].join('\n')

test('counterexample: with the delta back inside the digested body, an unchanged source churns its identity forever', async () => {
  await withMutatedSource(IDENTITY_WITHOUT_LINEAGE, IDENTITY_WITH_LINEAGE, async (mod) => {
    const run1 = await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T1')
    const run2 = await modPrev(mod, await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T2'), run1, WALK_WITH_5, DETAILS_WITH_5)
    const run3 = await modPrev(mod, await modScan(mod, WALK_WITH_5, DETAILS_WITH_5, 'T3'), run2, WALK_WITH_5, DETAILS_WITH_5)

    // The source state is provably unchanged across all three runs...
    assert.equal(JSON.stringify(run2.semantic.pages), JSON.stringify(run3.semantic.pages))
    assert.deepEqual(run2.semantic.absent, [])
    assert.deepEqual(run3.semantic.absent, [])
    // ...and the ONLY difference between the two digested bodies is the
    // predecessor reference, i.e. pure lineage.
    assert.equal(
      JSON.stringify({ ...run2.semantic, delta: null }),
      JSON.stringify({ ...run3.semantic, delta: null })
    )
    // Yet every run mints a new identity. That is the defect.
    assert.notEqual(run1.discovery_digest, run2.discovery_digest)
    assert.notEqual(run2.discovery_digest, run3.discovery_digest)
  })
})

// --- configured base url is a credential boundary (pre-live repair) ----------
//
// The reused ATLAS-65 requireAuth() accepts ANY base string and only strips
// trailing slashes, and ATLAS-25's first credentialed request (the root detail
// read) was issued from it directly. resolveFetchableUrl could not answer for
// that: it compares a URL AGAINST the base, and a URL built from a hostile base
// is same-origin and same-scheme with it by construction. Every test below
// asserts a fetch COUNT, because "did the Authorization header leave" is the
// only question that matters here.

// Records every request without ever inspecting a credential value, and refuses
// to answer, so reaching it is unambiguous evidence and never a passing path.
function noFetch() {
  const calls = []
  const inits = []
  const impl = async (url, init) => {
    calls.push(url)
    inits.push(init)
    throw new Error('fetch stub reached — the credential boundary did not hold')
  }
  impl.calls = calls
  impl.inits = inits
  return impl
}

const envWithBase = (base) => ({ ...ENV, ATLAS65_CONFLUENCE_BASE_URL: base })

test('resolveConfluenceBase accepts a valid https origin and returns it canonically', () => {
  assert.equal(resolveConfluenceBase(BASE), BASE)
  assert.equal(resolveConfluenceBase('https://example.invalid/'), BASE)
  assert.equal(resolveConfluenceBase('https://example.invalid:8443'), 'https://example.invalid:8443')
})

test('discoverProject succeeds against the DEFAULT base url when none is configured', async () => {
  // requireAuth's default must satisfy the new gate, or the documented
  // "BASE_URL is optional" contract would be broken by this repair.
  const { ATLAS65_CONFLUENCE_BASE_URL: _omitted, ...envWithoutBase } = ENV
  const fetchImpl = siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  const doc = await discoverProject({ env: envWithoutBase, project: PROJECT, capturedAt: 'x', fetchImpl })
  assert.equal(doc.semantic.source.base_url, 'https://dyai2026.atlassian.net')
  assert.match(fetchImpl.calls[0], /^https:\/\/dyai2026\.atlassian\.net\//)
})

test('discoverProject succeeds against an explicitly configured https base url', async () => {
  const fetchImpl = siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  const doc = await discoverProject({ env: envWithBase(BASE), project: PROJECT, capturedAt: 'x', fetchImpl })
  assert.equal(doc.semantic.source.base_url, BASE)
  assert.equal(doc.semantic.pages.length, 3)
})

test('discoverProject accepts a configured base url with only a trailing slash', async () => {
  // requireAuth strips it; the gate must then see a root path, not reject the
  // most common way an operator writes a site URL.
  const fetchImpl = siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  const doc = await discoverProject({
    env: envWithBase('https://example.invalid/'), project: PROJECT, capturedAt: 'x', fetchImpl
  })
  assert.equal(doc.semantic.source.base_url, BASE)
})

// Each row: the rejected base, and what the message must say. `mustNotAppear` is
// the credential-shaped substring that may never reach a log.
for (const [name, base, expected, mustNotAppear] of [
  ['a plaintext http base', 'http://attacker.invalid', /must use https/, null],
  ['a base carrying embedded userinfo', 'https://leaked-user:s3cr3t@attacker.invalid', /carries embedded userinfo credentials/, 's3cr3t'],
  ['a base carrying a query string', 'https://attacker.invalid?token=s3cr3t', /must not carry a query string/, 's3cr3t'],
  ['a base carrying a fragment', 'https://attacker.invalid#s3cr3t', /must not carry a fragment/, 's3cr3t'],
  ['a base carrying a non-root path', 'https://attacker.invalid/deep/path', /must be an origin without a path/, null],
  ['an unparseable base', 'ht!tp://%%%', /is not a parseable URL/, null]
  // NOT in this list: the empty string. requireAuth reads it as "unset" and
  // substitutes the default, so it never reaches the gate through this path —
  // pinned separately below rather than asserted here as a rejection it is not.
]) {
  test(`discoverProject rejects ${name} BEFORE the first request — fetch count 0`, async () => {
    const fetchImpl = noFetch()
    await assert.rejects(
      discoverProject({ env: envWithBase(base), project: PROJECT, capturedAt: 'x', fetchImpl }),
      (e) =>
        e instanceof DiscoveryError &&
        e.code === 'E_DISCOVERY_CONFIG' &&
        expected.test(e.message) &&
        // Diagnostic without reproducing anything credential-shaped.
        (mustNotAppear === null || !e.message.includes(mustNotAppear)) &&
        // The env var is named so the operator knows what to fix.
        e.message.includes(CONFLUENCE_BASE_URL_ENV)
    )
    // The load-bearing assertion: the Authorization header never left.
    assert.equal(fetchImpl.calls.length, 0)
    assert.deepEqual(fetchImpl.inits, [])
  })

  test(`applyPrevious rejects ${name} BEFORE any absent probe — fetch count 0`, async () => {
    // applyPrevious is separately exported and does its own credentialed reads,
    // so it may not inherit a caller's validation.
    const doc = await discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x',
      fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
    })
    const fetchImpl = noFetch()
    await assert.rejects(
      applyPrevious(doc, PREVIOUS, { env: envWithBase(base), project: PROJECT, fetchImpl }),
      (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_CONFIG' && expected.test(e.message)
    )
    assert.equal(fetchImpl.calls.length, 0)
  })
}

test('an empty ATLAS65_CONFLUENCE_BASE_URL falls back to the default rather than failing', () => {
  // Pinning the seam: requireAuth treats "" as unset (|| default), so the empty
  // string never reaches resolveConfluenceBase through the normal path. The
  // "is missing or not a string" branch above is a direct-call guard.
  assert.equal(resolveConfluenceBase(requireAuth(envWithBase('')).baseUrl), 'https://dyai2026.atlassian.net')
  assert.throws(
    () => resolveConfluenceBase(''),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_CONFIG'
  )
})

// --- every credentialed URL passes the gate, not just the paginated ones -----
//
// A URL built by string concatenation is not evidence of a target. These tests
// force each built URL to CHANGE under the gate's normalization, so the value
// that reached the stub proves the gate ran on that specific call site.

// Answers every request with a 404 and records the URL. Enough to observe which
// URL was requested; the scan then fails closed, which is the point.
function recordingFetch(bodies = new Map()) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const body = bodies.get(url)
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  impl.calls = calls
  return impl
}

test('the ROOT detail request passes the URL gate before the fetch — it is normalized, not concatenated', async () => {
  // "…/pages/900000001/../../../../evil" normalizes to "/wiki/evil". Only the
  // gate normalizes; a concatenated string would have gone out verbatim.
  const traversalRoot = { ...PROJECT, root_page_id: '900000001/../../../../evil' }
  const fetchImpl = recordingFetch()
  await assert.rejects(
    discoverProject({ env: ENV, project: traversalRoot, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof DiscoveryError
  )
  assert.deepEqual(fetchImpl.calls, ['https://example.invalid/wiki/evil'])
})

test('a NON-ROOT detail request passes the URL gate before the fetch', async () => {
  const walk = new Map([['0', {
    results: [descendant({ id: '900000002/../../../../x', parentId: '900000001', depth: 1 })],
    _links: {}
  }]])
  const fetchImpl = recordingFetch(new Map([
    ['https://example.invalid/wiki/api/v2/pages/900000001', detail({ id: '900000001', parentId: null, version: { number: 12 }, title: 'Root' })],
    ['https://example.invalid/wiki/api/v2/pages/900000001/descendants?limit=100', { results: walk.get('0').results, _links: {} }]
  ]))
  await assert.rejects(
    discoverProject({ env: ENV, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof DiscoveryError
  )
  // Root, descendants walk, then the NORMALIZED non-root detail url: the string
  // pageDetailUrl built ended in "…/pages/900000002/../../../../x".
  assert.equal(fetchImpl.calls.length, 3)
  assert.equal(fetchImpl.calls[2], 'https://example.invalid/wiki/x')
})

test('a probeAbsent direct read passes the URL gate before the fetch', async () => {
  const previousSemantic = {
    ...PREVIOUS_SEMANTIC,
    pages: [
      ...PREVIOUS_SEMANTIC.pages.filter((p) => p.page_id !== '900000005'),
      { ...PREVIOUS_SEMANTIC.pages[3], page_id: '900000005/../../../../y' }
    ]
  }
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
  })
  const fetchImpl = recordingFetch()
  await applyPrevious(doc, previousEnvelope(previousSemantic), { env: ENV, project: PROJECT, fetchImpl })
  // The probe is the only request applyPrevious makes, and it is normalized.
  assert.deepEqual(fetchImpl.calls, ['https://example.invalid/wiki/y'])
})

test('every URL of a full scan+delta run is on the configured origin, https, and userinfo-free', async () => {
  // The property assertion behind the individual call-site tests: root detail,
  // descendants start url, cursor url, each non-root detail and each absent
  // probe. If any call site ever bypasses the gate again, this fails.
  const seen = []
  const wrap = (inner) => {
    const impl = async (url, init) => { seen.push(url); return inner(url, init) }
    return impl
  }
  const doc = await discoverProject({
    env: ENV, project: PROJECT, capturedAt: 'x',
    fetchImpl: wrap(siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS }))
  })
  await applyPrevious(doc, PREVIOUS, {
    env: ENV, project: PROJECT, fetchImpl: wrap(siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS }))
  })
  assert.equal(seen.length, 6) // root + 2 cursor pages + 2 details + 1 absent probe
  for (const raw of seen) {
    const u = new URL(raw)
    assert.equal(u.origin, BASE)
    assert.equal(u.protocol, 'https:')
    assert.equal(u.username, '')
    assert.equal(u.password, '')
    // Fixed point of the gate: the value fetched is the value the gate returns.
    assert.equal(resolveFetchableUrl(BASE, raw), raw)
  }
})

// --- counterexample: the base-url gate is load-bearing -----------------------

const DISCOVER_BASE_GATE = [
  '  // root detail read below is the first credentialed fetch, and it used to go out',
  '  // against whatever string the environment happened to carry.',
  '  const baseUrl = resolveConfluenceBase(auth.baseUrl)'
].join('\n')

const APPLY_PREVIOUS_BASE_GATE = [
  '  // separately exported and issues its own credentialed direct reads, so it may',
  '  // not assume a caller validated the base first.',
  '  const baseUrl = resolveConfluenceBase(auth.baseUrl)'
].join('\n')

const UNGATED_BASE = '  const baseUrl = auth.baseUrl'

// Deliberately WITHOUT the userinfo case. Removing the base gate alone leaves
// getJsonWithinBase's per-request check in place, and that check rejects userinfo
// on any URL regardless of base — so a userinfo base is stopped by the second
// layer. Listing it here would claim a defect this mutation does not produce.
// The pre-repair state had NEITHER layer; that is proved separately below.
const HOSTILE_BASES = [
  ['http downgrade', 'http://attacker.invalid'],
  ['query string', 'https://attacker.invalid?token=s3cr3t'],
  ['fragment', 'https://attacker.invalid#s3cr3t'],
  ['non-root path', 'https://attacker.invalid/deep/path']
]

for (const [name, base] of HOSTILE_BASES) {
  test(`counterexample: without the base gate, a ${name} base reaches the fetch stub with the credential`, async () => {
    await withMutatedSource(DISCOVER_BASE_GATE, UNGATED_BASE, async (mod) => {
      const fetchImpl = noFetch()
      await assert.rejects(
        mod.discoverProject({ env: envWithBase(base), project: PROJECT, capturedAt: 'x', fetchImpl }),
        // Not E_DISCOVERY_CONFIG: nothing stopped it, the STUB did.
        (e) => /fetch stub reached/.test(e.message) || e.code === 'E_DISCOVERY_UNREADABLE'
      )
      // The defect, stated as a number: one credentialed request left.
      assert.equal(fetchImpl.calls.length, 1)
      assert.equal(typeof fetchImpl.inits[0].headers.authorization, 'string')
      // The per-request gate cannot save this: a URL built from a hostile base is
      // same-origin and same-scheme with that base by construction.
      assert.equal(new URL(fetchImpl.calls[0]).hostname, 'attacker.invalid')
    })
  })
}

test('counterexample: without the base gate in applyPrevious, an absent probe reaches a hostile host', async () => {
  await withMutatedSource(APPLY_PREVIOUS_BASE_GATE, UNGATED_BASE, async (mod) => {
    // The doc is produced against the GOOD base; only applyPrevious is misconfigured.
    const doc = await mod.discoverProject({
      env: ENV, project: PROJECT, capturedAt: 'x',
      fetchImpl: siteFetch({ descendantPages: TWO_PAGE_WALK, details: DETAILS })
    })
    const fetchImpl = noFetch()
    await assert.rejects(
      mod.applyPrevious(doc, PREVIOUS, {
        env: envWithBase('http://attacker.invalid'), project: PROJECT, fetchImpl
      }),
      (e) => /fetch stub reached/.test(e.message) || e.code === 'E_DISCOVERY_UNREADABLE'
    )
    assert.equal(fetchImpl.calls.length, 1)
    assert.equal(typeof fetchImpl.inits[0].headers.authorization, 'string')
    assert.equal(new URL(fetchImpl.calls[0]).protocol, 'http:')
    assert.equal(new URL(fetchImpl.calls[0]).hostname, 'attacker.invalid')
  })
})

// The mutation above cuts ONE layer. This one restores the literal pre-repair
// root read — ungated base AND a bare getJson with no URL boundary at all —
// which is the state PR #19 actually shipped at ba18bcd. It is the only mutation
// that reproduces the userinfo leak, because both layers had to be absent.
const PRE_REPAIR_ROOT_READ = [
  '  // Validated BEFORE the first request, never inferred from it afterwards: the',
  '  // root detail read below is the first credentialed fetch, and it used to go out',
  '  // against whatever string the environment happened to carry.',
  '  const baseUrl = resolveConfluenceBase(auth.baseUrl)',
  '  const { authorization } = auth',
  '  const rootId = String(project.root_page_id)',
  '',
  '  // 1) The root itself. The descendants endpoint never returns it.',
  '  const rootRaw = await getJsonWithinBase(',
  "    baseUrl, pageDetailUrl(baseUrl, rootId), 'root page url', { authorization, fetchImpl }",
  '  )'
].join('\n')

const PRE_REPAIR_ROOT_READ_RESTORED = [
  '  const { baseUrl, authorization } = auth',
  '  const rootId = String(project.root_page_id)',
  '',
  '  const rootRaw = await getJson(pageDetailUrl(baseUrl, rootId), { authorization, fetchImpl })'
].join('\n')

for (const [name, base, expectedHost] of [
  ['embedded userinfo', 'https://leaked-user:s3cr3t@attacker.invalid', 'attacker.invalid'],
  ['http downgrade', 'http://attacker.invalid', 'attacker.invalid']
]) {
  test(`counterexample: the pre-repair root read sends the credential to a ${name} base`, async () => {
    await withMutatedSource(PRE_REPAIR_ROOT_READ, PRE_REPAIR_ROOT_READ_RESTORED, async (mod) => {
      const fetchImpl = noFetch()
      await assert.rejects(
        mod.discoverProject({ env: envWithBase(base), project: PROJECT, capturedAt: 'x', fetchImpl }),
        (e) => /fetch stub reached/.test(e.message) || e.code === 'E_DISCOVERY_UNREADABLE'
      )
      assert.equal(fetchImpl.calls.length, 1)
      assert.equal(typeof fetchImpl.inits[0].headers.authorization, 'string')
      assert.equal(new URL(fetchImpl.calls[0]).hostname, expectedHost)
    })
  })
}

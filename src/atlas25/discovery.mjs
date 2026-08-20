// ATLAS-25 Confluence project discovery and revision scan.
//
// Scope rule (binding, documented in docs/atlas-25-discovery.md): a project's
// pages are the registered root_page_id plus every type="page" descendant at any
// depth. Scope comes from the writer registry only — never from titles, body
// content or semantic similarity (DEC-09).
//
// Fail-closed by design: every unreadable response, malformed page, unknown
// lifecycle status and non-progressing cursor aborts the whole scan. There is no
// partial result and no synthetic fallback. No page body is ever requested here,
// so no raw Confluence content enters this path (DEC-04).
//
// Identity vs lineage (binding): `semantic` is the CURRENT SOURCE STATE — the
// pages, their revisions, their lifecycle evidence, and the directly observed
// absence state. `capture` is LINEAGE — when this scan was taken, what it cost,
// which predecessor it was compared against, and what that comparison found.
// Only `semantic` is digested. Lineage must never redefine source identity: an
// unchanged source state has to keep the same discovery_digest no matter which
// predecessor it happens to be compared against, or every chained rerun mints a
// new identity forever.
import { createHash } from 'node:crypto'
// Credentials are NOT re-implemented here. requireAuth is the single existing
// credential contract (ATLAS65_CONFLUENCE_* env vars) and keeps its own
// E_SOURCE_AUTH_MISSING code so the runbook stays consistent across pipelines.
// It SUPPLIES a base URL but does not constrain one: it accepts any string and
// only strips trailing slashes. ATLAS-25 therefore validates that base itself in
// resolveConfluenceBase before any request is issued — see there for why the
// check is local rather than pushed into the shared contract.
import { requireAuth } from '../atlas65/confluence-source.mjs'
export { requireAuth }

export class DiscoveryError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'DiscoveryError'
    this.code = code
  }
}

// 1.1 removed `delta` from the digested `semantic` body (it moved to
// `capture.delta`) and made `absent` a required, validated part of that body.
// The digest therefore covers a different field set than it did under 1.0, so a
// 1.0 document must be rejected rather than compared as if the two identities
// meant the same thing.
export const SCHEMA_VERSION = '1.1'
export const DEFAULT_PAGE_LIMIT = 100
// Hard backstop against a cursor walk that never terminates. Exceeding it is a
// failure, never a silent truncation.
export const MAX_PAGINATION_REQUESTS = 200

export const CONFLUENCE_BASE_URL_ENV = 'ATLAS65_CONFLUENCE_BASE_URL'

// Scheme + host(:port) only — never userinfo, path, query or fragment. Every one
// of those is a place an operator can paste a token by accident, and an error
// message is a log line.
function redactedOrigin(url) {
  return `${url.protocol}//${url.host}`
}

// The configured base is the ORIGIN BOUNDARY every ATLAS-25 request is held to,
// so it is validated ONCE, before a single request is issued — never inferred
// afterwards from the URLs built out of it. resolveFetchableUrl below can only
// compare a URL *against* this base; it cannot tell that the base itself is
// hostile, because a malicious base and a URL built from it are trivially
// same-origin and same-scheme. The root detail read was the first credentialed
// fetch and went out with the Authorization header before any gate ran.
//
// Deliberately ATLAS-25-local and NOT folded into the shared requireAuth():
// requireAuth is also the ATLAS-65 credential contract, and tightening it here
// would silently change what ATLAS-65 accepts, outside this ticket's scope.
// requireAuth still supplies the credential and the raw base string; this
// function decides whether that base may be fetched from at all.
export function resolveConfluenceBase(rawBaseUrl) {
  const fail = (what) => {
    throw new DiscoveryError(
      'E_DISCOVERY_CONFIG',
      `configured Confluence base url (${CONFLUENCE_BASE_URL_ENV}) ${what}`
    )
  }
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.length === 0) fail('is missing or not a string')

  let url
  try {
    url = new URL(rawBaseUrl)
  } catch {
    // The raw value is deliberately NOT echoed. An unparseable base is exactly
    // the case where a mistyped "https://user:token@host" would be printed into
    // a log by the very error meant to protect it.
    fail('is not a parseable URL (value withheld: it may carry credentials)')
  }
  // Checked FIRST, so no later message can be produced while userinfo is present.
  if (url.username !== '' || url.password !== '') fail('carries embedded userinfo credentials')
  // Plaintext http would put the Basic credential on the wire in clear. There is
  // no downgrade path and no opt-out: this pipeline reads a credentialed API.
  if (url.protocol !== 'https:') {
    fail(`must use https, got ${JSON.stringify(url.protocol)} (${redactedOrigin(url)})`)
  }
  // A query or fragment on the base is never part of an origin, and concatenating
  // a path onto one silently RELOCATES that path: "https://host?x=1" + "/wiki/…"
  // requests "/" with a query, and "https://host#f" + "/wiki/…" requests "/" with
  // a fragment. Both looked like a page read and were neither.
  if (url.search !== '') fail(`must not carry a query string (${redactedOrigin(url)})`)
  if (url.hash !== '') fail(`must not carry a fragment (${redactedOrigin(url)})`)
  // REJECTED, not normalized away. Dropping a configured path would fetch from
  // somewhere other than where the operator wrote it, and a silent reinterpretation
  // of a security-relevant setting is worse than a startup failure.
  if (url.pathname !== '/') {
    fail(`must be an origin without a path, got path ${JSON.stringify(url.pathname)} (${redactedOrigin(url)})`)
  }
  // url.origin, not the raw string: one canonical, trailing-slash-free spelling
  // that every built URL and every later same-origin comparison agrees with.
  return url.origin
}

// The single gate for every URL this module will fetch — the start URL and every
// cursor link go through it, so a caller cannot hand the walk a target that a
// server would not have been allowed to supply. Returns the NORMALIZED href, so
// the caller's repeat-detection compares like with like.
// `code` is a parameter because a bad SERVER-supplied cursor and a bad
// CALLER-supplied start URL are different triage paths: the first is a remote
// defect, the second a local one. Sharing one code would re-create exactly the
// problem that gave a malformed base URL its own E_DISCOVERY_CONFIG.
export function resolveFetchableUrl(baseUrl, link, label = 'next cursor link', code = 'E_DISCOVERY_PAGINATION') {
  const fail = (what) => {
    throw new DiscoveryError(code, `${label} ${what}`)
  }
  if (typeof link !== 'string' || link.length === 0) fail('is missing or not a string')

  let base
  try {
    base = new URL(baseUrl)
  } catch {
    // A bad base URL is a deployment/config defect, not a pagination defect;
    // sharing the pagination code would route it to the wrong triage path.
    throw new DiscoveryError('E_DISCOVERY_CONFIG', `configured base url is not a URL: ${JSON.stringify(baseUrl)}`)
  }

  // Confluence returns _links.next as a site-relative path ("/wiki/api/v2/...").
  // Only a rooted path may be resolved against the base; anything else has to be
  // an absolute URL already. Resolving a BARE relative string would be unsafe:
  // WHATWG parsing does not throw on junk like "ht!tp://%%%" (an illegal scheme
  // character just makes it a relative reference), so it would be silently
  // promoted into a same-origin URL that the cursor walk then fetches.
  let url
  try {
    url = link.startsWith('/') ? new URL(link, base) : new URL(link)
  } catch {
    fail(`is not a resolvable URL: ${JSON.stringify(link)}`)
  }

  // Same origin is NOT sufficient on its own. `blob:https://host/x` reports the
  // INNER origin, so an origin-only check passes it straight through to fetch.
  if (url.protocol !== base.protocol) {
    fail(`does not use the configured scheme (${url.protocol} != ${base.protocol})`)
  }
  // `origin` excludes userinfo, so `https://u:pw@host/` would be accepted, then
  // fetched, then written verbatim into any error message. Rejecting it makes
  // "no credential reaches the logs" true by construction rather than by luck.
  // It also removes `https://attacker.invalid@example.invalid/x`, which a human
  // triaging a log reads as pointing at the wrong host.
  if (url.username !== '' || url.password !== '') {
    fail('carries embedded userinfo credentials')
  }
  // Also covers protocol-relative "//other.host/path", which parses fine but
  // resolves to a foreign origin — as does a rooted "/\\evil.com/x", because
  // WHATWG treats a backslash as a slash for special schemes and promotes it to
  // an authority. That case is stopped HERE, not by the rooted check above.
  if (url.origin !== base.origin) {
    fail(`leaves the configured Confluence origin (${url.origin} != ${base.origin})`)
  }
  return url.toString()
}

// Kept as the cursor-link-flavoured name used by paginate and its tests.
export function resolveNextUrl(baseUrl, nextLink) {
  return resolveFetchableUrl(baseUrl, nextLink)
}

// Reads one JSON document. `allow404` turns a 404 into `null` so the caller can
// treat "Confluence no longer exposes this page" as evidence instead of an
// error; every other non-2xx stays a hard failure.
export async function getJson(url, { authorization, fetchImpl = fetch, allow404 = false } = {}) {
  // A missing credential is a LOCAL config defect. Without this guard the header
  // goes out as the literal string "undefined" and comes back as a remote HTTP
  // 401, pointing triage at the wrong system.
  if (typeof authorization !== 'string' || authorization.length === 0) {
    throw new DiscoveryError('E_DISCOVERY_AUTH_MISSING', `${url}: no authorization header supplied`)
  }
  let res
  try {
    res = await fetchImpl(url, { headers: { authorization, accept: 'application/json' } })
  } catch (e) {
    // A non-Error throw would otherwise degrade to "network failure (undefined)".
    throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: network failure (${e?.message ?? String(e)})`, { cause: e })
  }
  if (allow404 && res.status === 404) return null
  if (!res.ok) throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: HTTP ${res.status}`)
  let body
  try {
    body = await res.json()
  } catch (e) {
    throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: response is not JSON`, { cause: e })
  }
  // `null` is this function's 404 signal. A literal JSON `null` body must not be
  // able to impersonate it: Task 5 reads `null` as evidence that a page is gone.
  if (body === null) {
    throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: response body is literally null`)
  }
  return body
}

// The single credentialed-read boundary for every request outside paginate. A
// URL built by pageDetailUrl() is a STRING built by concatenation, and a string
// is not evidence of a target: it is re-parsed and re-checked against the
// validated base here, so "no credential leaves the configured origin" is a
// property of the code path rather than of each call site having remembered.
// resolveFetchableUrl is reused on purpose — one URL gate, not two that drift.
// The code is E_DISCOVERY_CONFIG because a URL this module built itself failing
// the gate is a local defect, never a remote one.
async function getJsonWithinBase(baseUrl, url, label, options) {
  return getJson(resolveFetchableUrl(baseUrl, url, label, 'E_DISCOVERY_CONFIG'), options)
}

export async function paginate({
  startUrl,
  baseUrl,
  authorization,
  fetchImpl = fetch,
  maxRequests = MAX_PAGINATION_REQUESTS
}) {
  const results = []
  const visited = new Set()
  // The start URL is held to exactly the same rules as a server-supplied cursor
  // link. It used to be fetched unvalidated WITH the Authorization header, so a
  // caller bug could send the credential to any host; and being unnormalized, it
  // could fetch the same resource twice before the repeat guard noticed.
  let url = resolveFetchableUrl(baseUrl, startUrl, 'start url', 'E_DISCOVERY_CONFIG')
  let requests = 0

  while (url !== null) {
    if (requests >= maxRequests) {
      throw new DiscoveryError(
        'E_DISCOVERY_PAGINATION',
        `cursor walk exceeded ${maxRequests} requests — refusing a possibly non-terminating pagination sequence`
      )
    }
    // Identity check, not a progress proof: a server handing out cursor=1,2,3…
    // never repeats a URL and never terminates, and only the request cap above
    // stops that. This catches the narrower case of a cursor pointing back at a
    // page already fetched, where continuing would loop or duplicate results.
    if (visited.has(url)) {
      throw new DiscoveryError('E_DISCOVERY_PAGINATION', `cursor walk did not progress: ${url} was requested twice`)
    }
    visited.add(url)
    requests += 1

    const body = await getJson(url, { authorization, fetchImpl })
    // The `body === null` clause is not redundant: getJson returns null for a
    // 404 under allow404, and the moment a caller threads that through here a
    // bare property read would raise a TypeError instead of a DiscoveryError.
    if (body === null || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.results)) {
      throw new DiscoveryError(
        'E_DISCOVERY_PAGINATION',
        `${url}: response has no "results" array — refusing a possibly truncated walk`
      )
    }
    // Spreading a whole page into arguments would RangeError on a large enough
    // page; the walk must not have a size above which it breaks.
    for (const entry of body.results) results.push(entry)

    // End of results is the ABSENCE of _links.next. A malformed _links or any
    // other next value is corruption, not completion — treating it as "done"
    // would return a silently truncated set, exactly what the results guard
    // above exists to prevent. Everything non-absent falls through to the
    // validator and fails closed there.
    const links = body._links
    if (links !== undefined && links !== null && (typeof links !== 'object' || Array.isArray(links))) {
      throw new DiscoveryError(
        'E_DISCOVERY_PAGINATION',
        `${url}: "_links" is not an object — refusing a possibly truncated walk`
      )
    }
    // `_links: null` is read as absent, per the JSON convention that null means
    // "no value" — the one place where corruption and completion still coincide.
    // Every OTHER non-object _links is rejected above.
    const next = links === undefined || links === null ? undefined : links.next
    url = next === undefined ? null : resolveNextUrl(baseUrl, next)
  }

  return { results, requests }
}

function normalizeId(value) {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isInteger(value)) return String(value)
  return null
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

// Shape of one entry from GET /wiki/api/v2/pages/{id}/descendants.
// No version here — the descendants endpoint does not return one; revisions come
// exclusively from assertPageDetailShape.
export function assertDescendantShape(raw) {
  const fail = (what) => {
    throw new DiscoveryError('E_DISCOVERY_METADATA', `descendant ${JSON.stringify(raw?.id ?? null)}: ${what}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('entry is not an object')
  const pageId = normalizeId(raw.id)
  if (pageId === null) fail('id missing or not an id')
  if (!isNonEmptyString(raw.title)) fail('title missing or empty')
  if (!isNonEmptyString(raw.status)) fail('status missing or empty — lifecycle cannot be established')
  if (!isNonEmptyString(raw.type)) fail('type missing or empty')
  if (!Number.isInteger(raw.depth)) fail('depth missing or not an integer')
  const parentId = raw.parentId === undefined || raw.parentId === null ? null : normalizeId(raw.parentId)
  if (raw.parentId !== undefined && raw.parentId !== null && parentId === null) fail('parentId is not an id')
  return {
    page_id: pageId,
    title: raw.title,
    type: raw.type,
    parent_id: parentId,
    depth: raw.depth,
    source_status: raw.status
  }
}

// Shape of GET /wiki/api/v2/pages/{id} (requested WITHOUT body-format, so no
// page body is ever read here).
export function assertPageDetailShape(raw, expectedId) {
  const fail = (what) => {
    throw new DiscoveryError('E_DISCOVERY_METADATA', `page ${expectedId}: ${what}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('response is not an object')
  const pageId = normalizeId(raw.id)
  if (pageId === null) fail('id missing or not an id')
  if (pageId !== String(expectedId)) fail(`response id ${JSON.stringify(raw.id)} does not match the requested id`)
  if (!isNonEmptyString(raw.title)) fail('title missing or empty')
  if (!isNonEmptyString(raw.status)) fail('status missing or empty — lifecycle cannot be established')
  if (!Number.isInteger(raw.version?.number)) {
    fail('version.number missing or not an integer — revision provenance cannot be established')
  }
  const parentId = raw.parentId === undefined || raw.parentId === null ? null : normalizeId(raw.parentId)
  if (raw.parentId !== undefined && raw.parentId !== null && parentId === null) fail('parentId is not an id')
  return {
    page_id: pageId,
    title: raw.title,
    version: raw.version.number,
    parent_id: parentId,
    source_status: raw.status
  }
}

// The descendants walk and the per-page detail read are two separate requests.
// Confluence can move, archive or trash a page between them, and the two reads
// then describe different source states. Building one page record out of both
// would report a state that never existed in any single observation, so a
// disagreement aborts the scan instead of being silently merged.
//
// Deliberately NOT checked here:
//   - the registered root: it has no descendant observation at all (the
//     descendants endpoint never returns the root) and its own parent may
//     legitimately sit above the registered scope boundary;
//   - whether the observed parent is itself a type="page" in the result set:
//     Confluence allows non-page intermediaries (folder, whiteboard, …) and the
//     scope rule is "all type=page descendants", not "a closed page tree".
//
// Both shapes above already REQUIRE a non-empty status, so by the time this runs
// "both reads expose a status" is true by construction and the comparison needs
// no presence guard.
export function assertCrossReadConsistent(observed, detail) {
  const fail = (what) => {
    throw new DiscoveryError(
      'E_DISCOVERY_METADATA',
      `page ${detail.page_id}: source metadata changed during the scan — ${what}`
    )
  }
  if (detail.parent_id !== observed.parent_id) {
    fail(
      `parent_id ${JSON.stringify(detail.parent_id)} from the detail read does not match ` +
      `${JSON.stringify(observed.parent_id)} observed in the descendants walk`
    )
  }
  if (detail.source_status !== observed.source_status) {
    fail(
      `status ${JSON.stringify(detail.source_status)} from the detail read does not match ` +
      `${JSON.stringify(observed.source_status)} observed in the descendants walk`
    )
  }
}

// Closed allowlist. A status Confluence starts returning that is not listed here
// must fail the scan, not be silently normalized into "active".
export const STATUS_TO_LIFECYCLE = Object.freeze({
  current: 'active',
  archived: 'archived',
  trashed: 'deleted',
  deleted: 'deleted'
})

// "absent" and "removed_from_scope" are never derived from a status field; they
// are only assigned by the previous-scan probe (see probeAbsent).
export const LIFECYCLES = Object.freeze([
  'active',
  'archived',
  'deleted',
  'removed_from_scope',
  'absent'
])

export function lifecycleFor(sourceStatus) {
  if (!isNonEmptyString(sourceStatus)) {
    throw new DiscoveryError('E_DISCOVERY_LIFECYCLE', 'page status missing — lifecycle cannot be established')
  }
  // Object.hasOwn, never `in`: "constructor"/"__proto__" must not resolve.
  if (!Object.hasOwn(STATUS_TO_LIFECYCLE, sourceStatus)) {
    throw new DiscoveryError(
      'E_DISCOVERY_LIFECYCLE',
      `unknown Confluence page status ${JSON.stringify(sourceStatus)} — refusing to guess a lifecycle state`
    )
  }
  return STATUS_TO_LIFECYCLE[sourceStatus]
}

export const DISCOVERY_RULE =
  'registered root_page_id + every type="page" descendant at any depth; scope from the writer registry only'

export function descendantsUrl(baseUrl, rootPageId, limit = DEFAULT_PAGE_LIMIT) {
  return `${baseUrl}/wiki/api/v2/pages/${rootPageId}/descendants?limit=${limit}`
}

// Deliberately no body-format: discovery never reads page bodies (DEC-04).
export function pageDetailUrl(baseUrl, pageId) {
  return `${baseUrl}/wiki/api/v2/pages/${pageId}`
}

function byPageId(a, b) {
  return a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0
}

// Field order is written out explicitly, never spread, so identical input
// serializes byte-identically.
function buildPageRecord({ detail, depth, baseUrl, spaceKey }) {
  return {
    page_id: detail.page_id,
    title: detail.title,
    version: detail.version,
    parent_id: detail.parent_id,
    depth,
    lifecycle: lifecycleFor(detail.source_status),
    source_status: detail.source_status,
    confluence_url: `${baseUrl}/wiki/spaces/${spaceKey}/pages/${detail.page_id}`
  }
}

// An UNKEYED SHA-256 over the serialized current source state. It proves content
// integrity and gives the state a stable identity; it is not a MAC or a signature
// and proves nothing about who produced the document. Anyone able to edit a scan
// can recompute a matching digest.
export function digestOf(semantic) {
  return createHash('sha256').update(JSON.stringify(semantic)).digest('hex')
}

export async function discoverProject({
  env,
  project,
  capturedAt,
  fetchImpl = fetch,
  limit = DEFAULT_PAGE_LIMIT,
  maxRequests = MAX_PAGINATION_REQUESTS
}) {
  const auth = requireAuth(env) // throws E_SOURCE_AUTH_MISSING before any network use
  // Validated BEFORE the first request, never inferred from it afterwards: the
  // root detail read below is the first credentialed fetch, and it used to go out
  // against whatever string the environment happened to carry.
  const baseUrl = resolveConfluenceBase(auth.baseUrl)
  const { authorization } = auth
  const rootId = String(project.root_page_id)

  // 1) The root itself. The descendants endpoint never returns it.
  const rootRaw = await getJsonWithinBase(
    baseUrl, pageDetailUrl(baseUrl, rootId), 'root page url', { authorization, fetchImpl }
  )
  const rootDetail = assertPageDetailShape(rootRaw, rootId)

  // 2) The full subtree, cursor-paginated.
  const walk = await paginate({
    startUrl: descendantsUrl(baseUrl, rootId, limit),
    baseUrl,
    authorization,
    fetchImpl,
    maxRequests
  })

  const descendants = walk.results.map(assertDescendantShape)
  const pageDescendants = descendants.filter((d) => d.type === 'page')
  const nonPageDescendants = descendants.length - pageDescendants.length

  // The WHOLE descendant observation is kept, not only its depth: the detail read
  // that follows is checked against it, and a check needs something to check
  // against. Keeping depth alone is what let two contradictory reads be combined.
  const observedById = new Map()
  for (const d of pageDescendants) {
    if (d.page_id === rootId) {
      throw new DiscoveryError(
        'E_DISCOVERY_SCOPE',
        `descendant ${d.page_id} is the registered root — a page cannot be its own descendant`
      )
    }
    if (observedById.has(d.page_id)) {
      throw new DiscoveryError(
        'E_DISCOVERY_SCOPE',
        `page ${d.page_id} appeared twice in the cursor walk — refusing an ambiguous scope`
      )
    }
    observedById.set(d.page_id, d)
  }

  // 3) One detail read per page: the only place a revision comes from. Every
  // detail read must still agree with what the walk observed for that page.
  const pages = [buildPageRecord({ detail: rootDetail, depth: 0, baseUrl, spaceKey: project.confluence_space_key })]
  for (const pageId of [...observedById.keys()].sort()) {
    const observed = observedById.get(pageId)
    const raw = await getJsonWithinBase(
      baseUrl, pageDetailUrl(baseUrl, pageId), 'page detail url', { authorization, fetchImpl }
    )
    const d = assertPageDetailShape(raw, pageId)
    assertCrossReadConsistent(observed, d)
    pages.push(buildPageRecord({ detail: d, depth: observed.depth, baseUrl, spaceKey: project.confluence_space_key }))
  }
  pages.sort(byPageId)

  const semantic = {
    schema_version: SCHEMA_VERSION,
    project_id: project.project_id,
    source: {
      source_kind: 'confluence',
      source_id: rootId,
      space_key: project.confluence_space_key,
      base_url: baseUrl
    },
    discovery: {
      rule: DISCOVERY_RULE,
      page_count: pages.length,
      non_page_descendants: nonPageDescendants
    },
    pages,
    // Current source state, not history: a plain scan has observed no absence,
    // so this is empty rather than absent-as-a-field. A scan with `--previous`
    // fills it from direct reads it actually performed.
    absent: []
  }

  return {
    schema_version: SCHEMA_VERSION,
    discovery_digest: digestOf(semantic),
    semantic,
    capture: {
      captured_at: capturedAt,
      pagination_requests: walk.requests,
      previous_digest: null,
      delta: null
    }
  }
}

function assertPreviousShape(previous, project) {
  const s = previous?.semantic
  if (
    previous === null || typeof previous !== 'object' || Array.isArray(previous) ||
    s === null || typeof s !== 'object' || Array.isArray(s) ||
    !Array.isArray(s.pages) || !Array.isArray(s.absent) || typeof previous.discovery_digest !== 'string' ||
    s.source === null || typeof s.source !== 'object'
  ) {
    throw new DiscoveryError('E_PREVIOUS_INVALID', 'previous scan document is structurally invalid')
  }
  // A document written by another schema version can carry these same field
  // names with different meaning. Reading it as if it were this version is
  // exactly the silent acceptance this guard exists to prevent, so both the
  // envelope and the semantic body must declare the supported version.
  if (previous.schema_version !== SCHEMA_VERSION || s.schema_version !== SCHEMA_VERSION) {
    throw new DiscoveryError(
      'E_PREVIOUS_INVALID',
      `previous scan schema version ${JSON.stringify(previous.schema_version)} / ` +
      `${JSON.stringify(s.schema_version)} is not the supported ${JSON.stringify(SCHEMA_VERSION)}`
    )
  }
  const seenPageIds = new Set()
  for (const p of s.pages) {
    if (!isNonEmptyString(p?.page_id) || !Number.isInteger(p?.version) || !isNonEmptyString(p?.lifecycle)) {
      throw new DiscoveryError('E_PREVIOUS_INVALID', 'previous scan contains a page without id, version or lifecycle')
    }
    // Duplicates collapse silently in `new Map(prev.pages.map(...))` below, so a
    // previous page could drop out of the comparison with nothing failing.
    if (seenPageIds.has(p.page_id)) {
      throw new DiscoveryError('E_PREVIOUS_INVALID', `previous scan lists page ${p.page_id} more than once`)
    }
    seenPageIds.add(p.page_id)
    // Closed for the same reason lifecycleFor is closed: an unrecognised value
    // must fail, never be compared as though its meaning were known.
    if (!LIFECYCLES.includes(p.lifecycle)) {
      throw new DiscoveryError(
        'E_PREVIOUS_INVALID',
        `previous scan page ${p.page_id} carries lifecycle ${JSON.stringify(p.lifecycle)}, ` +
        'which is outside the closed lifecycle model'
      )
    }
  }
  // The absent list is previously observed state that the NEXT run re-verifies,
  // so it is held to the same closed model as the page list. Before the
  // incremental-state repair it was never validated, because nothing read it —
  // and nothing read it because an absent page was silently dropped from
  // tracking after one run.
  for (const a of s.absent) {
    if (
      !isNonEmptyString(a?.page_id) || !Number.isInteger(a?.last_seen_version) ||
      !isNonEmptyString(a?.lifecycle) || !isNonEmptyString(a?.evidence)
    ) {
      throw new DiscoveryError(
        'E_PREVIOUS_INVALID',
        'previous scan contains an absent entry without id, last_seen_version, lifecycle or evidence'
      )
    }
    // One id cannot be both in scope and absent in a single observation, and a
    // repeat would let one row silently overwrite the other in the comparison
    // map — the same defect the page-list duplicate guard exists to stop.
    if (seenPageIds.has(a.page_id)) {
      throw new DiscoveryError(
        'E_PREVIOUS_INVALID',
        `previous scan lists page ${a.page_id} more than once across its pages and absent lists`
      )
    }
    seenPageIds.add(a.page_id)
    if (!LIFECYCLES.includes(a.lifecycle)) {
      throw new DiscoveryError(
        'E_PREVIOUS_INVALID',
        `previous scan absent entry ${a.page_id} carries lifecycle ${JSON.stringify(a.lifecycle)}, ` +
        'which is outside the closed lifecycle model'
      )
    }
  }
  // The digest is the only thing that proves this document is an intact scan
  // produced by this implementation rather than an edited or fabricated one. It
  // is recomputed over the exact body the delta is then read from, so a stale or
  // forged digest cannot be carried into capture.previous_digest as provenance.
  if (digestOf(s) !== previous.discovery_digest) {
    throw new DiscoveryError(
      'E_PREVIOUS_INVALID',
      'previous scan discovery_digest does not match a digest recomputed from its own semantic body'
    )
  }
  if (s.project_id !== project.project_id) {
    throw new DiscoveryError(
      'E_DISCOVERY_SCOPE',
      `previous scan is for project ${JSON.stringify(s.project_id)}, not ${JSON.stringify(project.project_id)}`
    )
  }
  if (String(s.source.source_id) !== String(project.root_page_id)) {
    throw new DiscoveryError(
      'E_DISCOVERY_SCOPE',
      `previous scan used root ${JSON.stringify(s.source.source_id)}, not the registered root ${project.root_page_id}`
    )
  }
  return s
}

// A page that was seen before but is not in the current subtree is NEVER assumed
// deleted. It is re-read directly and classified only from what the API returns:
// an HTTP 404, or an actual status field.
async function probeAbsent({ pageId, lastSeenVersion, baseUrl, authorization, fetchImpl }) {
  const raw = await getJsonWithinBase(
    baseUrl, pageDetailUrl(baseUrl, pageId), 'absent page probe url', { authorization, fetchImpl, allow404: true }
  )
  if (raw === null) {
    return {
      page_id: pageId,
      lifecycle: 'absent',
      evidence: 'http_404_on_direct_read',
      last_seen_version: lastSeenVersion
    }
  }
  const d = assertPageDetailShape(raw, pageId)
  const mapped = lifecycleFor(d.source_status)
  return {
    page_id: pageId,
    // The page still resolves but is no longer under the registered root: it left
    // the project's scope. That is a different fact from being deleted.
    lifecycle: mapped === 'active' ? 'removed_from_scope' : mapped,
    evidence: `direct_read_status_${d.source_status}`,
    last_seen_version: lastSeenVersion
  }
}

export async function applyPrevious(doc, previous, { env, project, fetchImpl = fetch } = {}) {
  if (previous === null || previous === undefined) return doc

  const prev = assertPreviousShape(previous, project)
  const auth = requireAuth(env)
  // Same gate as discoverProject, applied independently: applyPrevious is
  // separately exported and issues its own credentialed direct reads, so it may
  // not assume a caller validated the base first.
  const baseUrl = resolveConfluenceBase(auth.baseUrl)
  const { authorization } = auth

  const currentById = new Map(doc.semantic.pages.map((p) => [p.page_id, p]))
  // Previously observed state is the page list AND the absent list. Building this
  // map from `prev.pages` alone is what let an already-absent page fall out of
  // tracking on the very next run: it was no longer a page, so nothing compared
  // it, nothing re-probed it, and it disappeared from the scan with no error and
  // no evidence — indistinguishable from never having existed.
  // An absent entry's `last_seen_version` IS its last observed revision, so it
  // carries forward unchanged and a persistent 404 re-probes to a byte-identical
  // record: the absent state is a fixed point, not a decaying one.
  const previousById = new Map(prev.pages.map((p) => [p.page_id, { version: p.version, lifecycle: p.lifecycle }]))
  for (const a of prev.absent) {
    previousById.set(a.page_id, { version: a.last_seen_version, lifecycle: a.lifecycle })
  }

  const added = []
  const unchanged = []
  const versionChanged = []
  const lifecycleChanged = []

  for (const [pageId, page] of currentById) {
    const before = previousById.get(pageId)
    if (before === undefined) {
      added.push(pageId)
      continue
    }
    let changed = false
    if (before.version !== page.version) {
      versionChanged.push({ page_id: pageId, from: before.version, to: page.version })
      changed = true
    }
    if (before.lifecycle !== page.lifecycle) {
      lifecycleChanged.push({ page_id: pageId, from: before.lifecycle, to: page.lifecycle })
      changed = true
    }
    if (!changed) unchanged.push(pageId)
  }

  const absent = []
  for (const pageId of [...previousById.keys()].sort()) {
    if (currentById.has(pageId)) continue
    absent.push(await probeAbsent({
      pageId,
      lastSeenVersion: previousById.get(pageId).version,
      baseUrl,
      authorization,
      fetchImpl
    }))
  }

  const sortById = (a, b) => (a.page_id < b.page_id ? -1 : a.page_id > b.page_id ? 1 : 0)
  const delta = {
    previous_digest: previous.discovery_digest,
    added: added.sort(),
    unchanged: unchanged.sort(),
    version_changed: versionChanged.sort(sortById),
    lifecycle_changed: lifecycleChanged.sort(sortById),
    absent: absent.map((a) => a.page_id).sort()
  }
  // CURRENT SOURCE STATE only, so the digest stays an identity of the source.
  // `absent` belongs here: each entry is a fact this run directly observed (a 404
  // or a status actually returned), not a memory of an older scan. `delta` does
  // NOT belong here: which predecessor was compared, and what that comparison
  // found, is lineage. Keeping `delta.previous_digest` inside the digested body
  // chained identity to run history — an unchanged source acquired a new
  // discovery_digest on every rerun, without a single byte of the source having
  // changed. The delta is not dropped, it is reported under `capture`.
  const semantic = {
    ...doc.semantic,
    absent: absent.sort(sortById)
  }

  return {
    schema_version: doc.schema_version,
    discovery_digest: digestOf(semantic),
    semantic,
    // The lineage container: nothing in `capture` enters the digest.
    capture: { ...doc.capture, previous_digest: previous.discovery_digest, delta }
  }
}

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
export class DiscoveryError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'DiscoveryError'
    this.code = code
  }
}

export const SCHEMA_VERSION = '1.0'
export const DEFAULT_PAGE_LIMIT = 100
// Hard backstop against a cursor walk that never terminates. Exceeding it is a
// failure, never a silent truncation.
export const MAX_PAGINATION_REQUESTS = 200

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

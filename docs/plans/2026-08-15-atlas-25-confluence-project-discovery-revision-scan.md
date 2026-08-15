# ATLAS-25 — Confluence Project Discovery and Revision Scan Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ATLAS-65 pilot's fixed, hand-declared Confluence Page-ID list with registry-driven, cursor-paginated, revision- and lifecycle-aware project discovery that reruns deterministically and reports an incremental delta against a previous scan.

**Architecture:** A new, self-contained `src/atlas25/discovery.mjs` module plus a `scripts/atlas25/discover.mjs` CLI. It **reuses** the existing writer registry (`src/registry/resolve.mjs`) for all project routing and the existing `requireAuth` from `src/atlas65/confluence-source.mjs` for credentials — no routing or credential logic is duplicated. It does **not** touch the ATLAS-65 fetch/import/snapshot/serve pipeline, which keeps its fixed source set as accepted pilot behavior. Discovery reads two Confluence v2 endpoints: `GET /wiki/api/v2/pages/{root}/descendants` (cursor-paginated subtree walk) and `GET /wiki/api/v2/pages/{id}` (per-page revision + lifecycle detail). No page bodies are requested at discovery time (DEC-04: raw content is never pulled into the discovery path).

**Tech Stack:** Node.js ≥22 ESM (`.mjs`), zero runtime dependencies, `node:test` + `node:assert/strict`, `node:crypto` for the determinism digest. Existing gates: `npm run check`, `npm run secret-scan`.

---

## BASELINE (verified 2026-08-15, before any edit)

| Item | Observed |
|---|---|
| Canonical repo | `DYAI2025/project-atlas-foundation` |
| Default branch | `main` (`git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/main`) |
| `origin/main` SHA | `99035de5c318084abd6ae7f02c132e0840b8fc56` — **matches the expected baseline** |
| Local clone | `/Users/benjaminpoersch/Projects/project-atlas-foundation` |
| Local HEAD at inspection | `69d804ba1b10533a9a764667242bc9f975416a5c` on `feat/ATLAS-65-real-source-gbrain-browser-graph` — **NOT main**; the executor must branch from `origin/main`, see Task 0 |
| Working tree | Clean except one untracked file: `docs/plans/2026-08-14-atlas-sprint-2-jira-preparation.md` (unrelated to ATLAS-25; leave it untracked and out of the commit) |
| Open PRs | none (`gh pr list --state open` → `[]`) |
| Open branch affecting ATLAS-25 | none (no `*ATLAS-25*` branch exists locally or on origin) |
| Jira ATLAS-25 | Story, status "Zu erledigen", labels `confluence`, `ingestion`, no comments. Description: "Registrierte Projekte inkrementell lesen. Akzeptanzkriterien: Cursor-Pagination, Revision IDs, Delete/Archive states und idempotent rerun getestet." — identical to the briefing |
| Live Confluence credentials | `ATLAS65_CONFLUENCE_EMAIL` / `ATLAS65_CONFLUENCE_API_TOKEN` **not set** in the inspecting shell. Live acceptance is gated — see Task 9 |

**Scope verdict: NO scope split required.** The complete Jira story fits one bounded vertical slice: one module, one CLI, one test file, one runbook. It stays inside discovery + revision scan and deliberately does **not** wire discovery into projection/import — no ATLAS-25 acceptance criterion requires that.

---

## Verified Confluence Cloud REST v2 contract

Confirmed against `developer.atlassian.com/cloud/confluence/rest/v2/` on 2026-08-15. Everything the implementation depends on is listed here; do not assume any field not in this table.

**`GET /wiki/api/v2/pages/{id}/descendants`**
- Query params: `limit`, `depth`, `cursor`. `depth` omitted ⇒ all descendant levels.
- Response: `{ "results": [ { "id", "status", "title", "type", "parentId", "depth", "childPosition" } ], "_links": { "next", "base" } }`
- `_links.next` is a **site-relative path** carrying the next `cursor`. Absent/empty ⇒ last page.
- **`results` entries carry NO `version` object.** Revision IDs must come from the detail endpoint.

**`GET /wiki/api/v2/pages/{id}`**
- Response includes `id`, `status`, `title`, `parentId`, `parentType`, `spaceId`, `version` (`version.number`, `version.createdAt`, `version.message`, `version.minorEdit`, `version.authorId`), and `body` only when `body-format` is requested.
- We request it **without** `body-format`, so no page body is ever fetched by discovery.

**Page `status` values** in circulation: `current`, `archived`, `trashed`, `deleted`, `historical`, `draft`. The implementation uses a **closed allowlist** (`current`/`archived`/`trashed`/`deleted`) and fails closed on any other value rather than guessing a lifecycle.

**Not verified, therefore not used:** the `descendants` endpoint has no documented `status` filter, so archived/deleted pages are never *assumed* to be in or out of the walk. Lifecycle is only ever read from a `status` field the API actually returned, or from an observed HTTP 404.

---

## Documented deterministic discovery rule

> **The scope of project P is: the page whose ID is P's registered `root_page_id`, plus every descendant of that page, at any depth, whose `type` is exactly `page`.**
>
> - The root is fetched by ID via the detail endpoint (the `descendants` endpoint does not return the root itself).
> - `depth` is omitted so the full subtree is walked.
> - Descendants whose `type` is not `page` (blogpost, whiteboard, database, folder, …) are **counted and reported** as `non_page_descendants`, never silently dropped.
> - Project scope is enforced **only** by the registered `root_page_id`. Titles, semantic similarity and body content are never consulted.
> - The registry `confluence_space_key` is carried into the output as provenance. It is **not** verified against the API: the v2 page detail returns a numeric `spaceId`, not a space key, and resolving keys would require a second endpoint outside this slice. Documented as a known limitation.

## Documented lifecycle model

| Lifecycle | Evidence required | Never inferred from |
|---|---|---|
| `active` | detail/descendant `status === "current"` | presence alone |
| `archived` | `status === "archived"` | absence from the walk |
| `deleted` | `status === "trashed"` or `status === "deleted"` | absence from the walk |
| `removed_from_scope` | page was in the previous scan, is absent from the current subtree walk, and a direct read returns `status === "current"` | anything else |
| `absent` | page was in the previous scan and a direct read returns **HTTP 404** | anything else |

Any other `status` string ⇒ `E_DISCOVERY_LIFECYCLE`, fail closed. No page is ever reported as deleted without an API-returned status or an observed 404.

## Determinism / idempotence model

The output document is split into two parts:

- **`semantic`** — project, source, discovery rule, sorted page list (each with `page_id`, `title`, `version`, `parent_id`, `depth`, `lifecycle`, `source_status`, `confluence_url`), sorted absent list, sorted delta. Contains **no** wall-clock value.
- **`capture`** — `captured_at`, `pagination_requests`, `previous_digest`. Metadata only.

`discovery_digest` = `sha256(JSON.stringify(semantic))`. Two runs against unchanged source state produce byte-identical `semantic` and identical `discovery_digest` while `capture.captured_at` differs. Semantic equality is defined as digest equality.

---

## AC mapping

| Briefing / Jira AC | Where it is satisfied | Proven by |
|---|---|---|
| A — registry-driven project selection, fail closed on unknown/inactive/ambiguous | Task 5 CLI: `resolveProject(loadRegistry(), 'project_id', …)` reused verbatim from `src/registry/resolve.mjs`; no new routing code | Task 5 Step 1, Task 6 |
| B — discovery from the registered root, no enumerated Page-ID list | Task 4 `discoverProject()` + the documented rule above | Task 4 Steps 1–4 |
| C — cursor pagination: one page, multi page, traversal, no silent truncation, non-progressing guard | Task 1 `paginate()` / `resolveNextUrl()` | Task 1 Steps 1–8 |
| D — revision provenance: `project_id`, `page_id`, version, source/root identity, lifecycle; fail closed on missing | Task 2 `assertPageDetailShape()` + Task 4 output shape | Task 2 Steps 1–4, Task 4 Step 3 |
| E — delete/archive states, no fabrication | Task 3 `lifecycleFor()` + Task 5 absent-probe | Task 3 Steps 1–4, Task 5 Steps 5–7 |
| F — determinism/idempotence, timestamps not identity | Task 4 `semantic`/`capture` split + `discovery_digest` | Task 4 Steps 5–7 |
| G — negative paths: bad scope, HTTP failure, malformed metadata, pagination failure, ambiguity | Tasks 1–3 + Task 6 CLI negative tests | Task 6 Steps 1–6 |
| Jira: "inkrementell lesen" | Task 5 `--previous` delta (`added` / `version_changed` / `unchanged` / `lifecycle_changed` / `absent`) | Task 5 Steps 1–4 |
| Live source acceptance | Task 9, conditional on credentials | Task 9 |

## Explicit out of scope

ATLAS-16, ATLAS-30 embeddings, ATLAS-33 inferred relations, ATLAS-54 Postgres/RLS, ATLAS-39/40/41/42 UI, production Compose/VPS deploy, canonical final entity IDs, Obsidian export, knowledge proposal/publish workflow, Jira/Confluence mutations, merge, any refactor of the ATLAS-65 pipeline, and any general-purpose Confluence SDK.

## Notable risks

1. **Live subtree size.** The ATLAS root has 19 numbered children plus a blueprint page (per `docs/evidence/atlas-12-page-tree-snapshot.json`); a full-depth walk plus one detail request per page is ~21+ requests. Mitigated by `limit=100` and a hard `MAX_PAGINATION_REQUESTS` cap that fails closed rather than looping.
2. **`_links.next` shape.** Documented as a string; a site could return an absolute URL. `resolveNextUrl()` handles both and rejects any link that leaves the configured origin (SSRF guard).
3. **Credential env naming.** This slice reuses the ATLAS-65-prefixed `ATLAS65_CONFLUENCE_*` variables rather than renaming them, to avoid breaking the ATLAS-65 pipeline. Record as a Minor finding, do not fix here.
4. **Unknown `status` values.** A Confluence release adding a status would fail discovery closed. That is the intended trade — report it, do not widen the allowlist speculatively.

---

## Task 0: Branch from the verified baseline

**Files:** none (git only)

**Step 1: Confirm the baseline has not moved**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin --prune
git rev-parse origin/main
```

Expected output, exactly:

```
99035de5c318084abd6ae7f02c132e0840b8fc56
```

If it differs: **STOP**. Report the new SHA and what changed. Do not implement against a different baseline.

**Step 2: Confirm no competing ATLAS-25 work**

```bash
git branch -a --list '*ATLAS-25*'
gh pr list --repo DYAI2025/project-atlas-foundation --state open --json number,title,headRefName
```

Expected: empty output, then `[]`.

**Step 3: Create the branch from origin/main**

```bash
git checkout -b feat/ATLAS-25-confluence-project-discovery-revision-scan origin/main
git rev-parse HEAD
git status --porcelain
```

Expected: HEAD is `99035de5c318084abd6ae7f02c132e0840b8fc56`; `git status --porcelain` shows only
`?? docs/plans/2026-08-14-atlas-sprint-2-jira-preparation.md` and `?? docs/plans/2026-08-15-atlas-25-confluence-project-discovery-revision-scan.md`.

**Step 4: Commit this plan**

```bash
git add docs/plans/2026-08-15-atlas-25-confluence-project-discovery-revision-scan.md
git commit -m "docs: ATLAS-25 implementation plan for Confluence project discovery and revision scan"
```

---

## Task 1: Cursor pagination primitives

Everything in this task is pure and network-free except `paginate`, which takes an injected `fetchImpl`.

**Files:**
- Create: `src/atlas25/discovery.mjs`
- Create: `test/atlas25-discovery.test.mjs`

**Step 1: Write the failing tests for `resolveNextUrl`**

Create `test/atlas25-discovery.test.mjs`:

> **Deviation D-1 (recorded 2026-08-15, during execution).** The first draft of this task
> was defective in two ways, both found by running it. (a) The fixture `'ht!tp://%%%'` was
> asserted to be unparseable, but WHATWG URL parsing does not throw on it: `!` is not a legal
> scheme character, so the string is treated as a *relative reference* and resolves to
> `https://example.invalid/ht!tp://%%%`. That made the "not a resolvable URL" branch
> unreachable for exactly the junk Confluence could plausibly return, and would have let a
> garbage `next` value be promoted into a same-origin URL that the walk then fetches.
> `resolveNextUrl` is therefore **hardened**: a next link must be either rooted at `/`
> (Confluence's actual `_links.next` shape) or a parseable absolute URL. Bare relative
> strings are rejected instead of resolved. A protocol-relative `//host/path` case was added
> to pin down that it is still caught by the origin check. (b) The Step-1 import list named
> `paginate`, which does not exist until Step 7; a missing named export is an ESM *link-time*
> failure that kills the whole module, so Step 4 could never report "6 passing". The import
> list is now split across Step 1 and Step 5.

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { DiscoveryError, resolveNextUrl } from '../src/atlas25/discovery.mjs'

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

for (const [name, link] of [
  ['an empty next link', ''],
  ['a non-string next link', 42],
  // Bare relative junk: WHATWG parsing does NOT throw on this (see Deviation D-1),
  // it silently resolves against the base. It must be rejected for not being
  // rooted at "/", never resolved into a same-origin URL we would then fetch.
  ['a bare relative next link', 'ht!tp://%%%'],
  ['a relative next link that is not rooted at /', 'descendants?cursor=abc'],
  // These genuinely throw in the URL parser, exercising the parse guard itself.
  ['an unparseable absolute next link', 'http://'],
  ['a next link with an unterminated host', 'http://[']
]) {
  test(`resolveNextUrl fails closed on ${name}`, () => {
    assert.throws(
      () => resolveNextUrl(BASE, link),
      (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION'
    )
  })
}
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL — `Cannot find module .../src/atlas25/discovery.mjs`.

**Step 3: Write the minimal implementation**

Create `src/atlas25/discovery.mjs`:

```js
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
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const SCHEMA_VERSION = '1.0'
export const DEFAULT_PAGE_LIMIT = 100
// Hard backstop against a cursor walk that never terminates. Exceeding it is a
// failure, never a silent truncation.
export const MAX_PAGINATION_REQUESTS = 200

export function resolveNextUrl(baseUrl, nextLink) {
  const fail = (what) => {
    throw new DiscoveryError('E_DISCOVERY_PAGINATION', `next cursor link ${what}`)
  }
  if (typeof nextLink !== 'string' || nextLink.length === 0) fail('is missing or not a string')

  let base
  try {
    base = new URL(baseUrl)
  } catch {
    throw new DiscoveryError('E_DISCOVERY_PAGINATION', `configured base url is not a URL: ${JSON.stringify(baseUrl)}`)
  }

  // Confluence returns _links.next as a site-relative path ("/wiki/api/v2/...").
  // Only a rooted path may be resolved against the base; anything else has to be
  // an absolute URL already. Resolving a BARE relative string would be unsafe:
  // WHATWG parsing does not throw on junk like "ht!tp://%%%" (an illegal scheme
  // character just makes it a relative reference), so it would be silently
  // promoted into a same-origin URL that the cursor walk then fetches.
  let url
  try {
    url = nextLink.startsWith('/') ? new URL(nextLink, base) : new URL(nextLink)
  } catch {
    return fail(`is not a resolvable URL: ${JSON.stringify(nextLink)}`)
  }

  // Also covers protocol-relative "//other.host/path", which parses fine but
  // resolves to a foreign origin.
  if (url.origin !== base.origin) {
    fail(`leaves the configured Confluence origin (${url.origin} != ${base.origin})`)
  }
  return url.toString()
}
```

**Step 4: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 10 tests (`# tests 10`, `# pass 10`, `# fail 0`).

**Step 5: Write the failing tests for `paginate`**

First widen the import at the top of `test/atlas25-discovery.test.mjs` to:

```js
import {
  DiscoveryError,
  resolveNextUrl,
  paginate,
  MAX_PAGINATION_REQUESTS
} from '../src/atlas25/discovery.mjs'
```

Then append:

```js
// --- cursor pagination ------------------------------------------------------

// Builds a fetchImpl serving a fixed list of pages of results, keyed by url.
function pagedFetch(pages) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const body = pages.get(url)
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }
  impl.calls = calls
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
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => {
      const n = Number(new URL(url).searchParams.get('cursor') ?? 0) + 1
      return { results: [{ id: `9000000${n}` }], _links: { next: `/wiki/api/v2/pages/900000001/descendants?limit=100&cursor=${n}` } }
    }
  })
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl, maxRequests: 5 }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_PAGINATION' && /exceeded 5 requests/.test(e.message)
  )
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
  const fetchImpl = async () => { throw new Error('socket hang up') }
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /network failure/.test(e.message)
  )
})

test('paginate fails closed when a response body is not JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
  await assert.rejects(
    paginate({ startUrl: START, baseUrl: BASE, authorization: AUTH, fetchImpl }),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_UNREADABLE' && /not JSON/.test(e.message)
  )
})
```

**Step 6: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL. Because a missing named export is an ESM **link-time** error, the whole module
fails to load and the run reports `# tests 1 / # fail 1` with
`SyntaxError: The requested module '../src/atlas25/discovery.mjs' does not provide an export named 'paginate'`.
It does **not** report 9 passing + 8 failing — that is expected, not a defect.

**Step 7: Implement `getJson` and `paginate`**

Append to `src/atlas25/discovery.mjs`:

```js
// Reads one JSON document. `allow404` turns a 404 into `null` so the caller can
// treat "Confluence no longer exposes this page" as evidence instead of an
// error; every other non-2xx stays a hard failure.
export async function getJson(url, { authorization, fetchImpl = fetch, allow404 = false } = {}) {
  let res
  try {
    res = await fetchImpl(url, { headers: { authorization, accept: 'application/json' } })
  } catch (e) {
    throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: network failure (${e.message})`)
  }
  if (allow404 && res.status === 404) return null
  if (!res.ok) throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new DiscoveryError('E_DISCOVERY_UNREADABLE', `${url}: response is not JSON`)
  }
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
  let url = startUrl
  let requests = 0

  while (url !== null) {
    if (requests >= maxRequests) {
      throw new DiscoveryError(
        'E_DISCOVERY_PAGINATION',
        `cursor walk exceeded ${maxRequests} requests — refusing a possibly non-terminating pagination sequence`
      )
    }
    // A cursor that hands back a URL we already fetched is not progressing.
    // Continuing would loop forever or duplicate results; both are worse than
    // failing loudly.
    if (visited.has(url)) {
      throw new DiscoveryError('E_DISCOVERY_PAGINATION', `cursor walk did not progress: ${url} was requested twice`)
    }
    visited.add(url)
    requests += 1

    const body = await getJson(url, { authorization, fetchImpl })
    if (body === null || typeof body !== 'object' || !Array.isArray(body.results)) {
      throw new DiscoveryError(
        'E_DISCOVERY_PAGINATION',
        `${url}: response has no "results" array — refusing a possibly truncated walk`
      )
    }
    results.push(...body.results)

    const next = body._links?.next
    url = next === undefined || next === null || next === '' ? null : resolveNextUrl(baseUrl, next)
  }

  return { results, requests }
}
```

**Step 8: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 18 tests (`# tests 18`, `# pass 18`, `# fail 0`).

**Step 9: Commit**

```bash
git add src/atlas25/discovery.mjs test/atlas25-discovery.test.mjs
git commit -m "feat(ATLAS-25): cursor pagination primitives with non-progressing and truncation guards"
```

---

## Task 2: Page shape validation and revision provenance

**Files:**
- Modify: `src/atlas25/discovery.mjs`
- Modify: `test/atlas25-discovery.test.mjs`

**Step 1: Write the failing tests**

Append to `test/atlas25-discovery.test.mjs` (extend the import at the top of the file with `assertDescendantShape` and `assertPageDetailShape`):

```js
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
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL — `assertDescendantShape is not a function` (14 tests still pass).

**Step 3: Implement the validators**

Append to `src/atlas25/discovery.mjs`:

```js
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
```

**Step 4: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 31 tests, `# fail 0`. (Cumulative counts from here on include Deviation D-1's
four extra Task-1 tests — Task 1 ends at 18. If the actual count differs but `# fail` is 0,
report the actual number rather than adjusting the suite to hit the stated one.)

**Step 5: Commit**

```bash
git add src/atlas25/discovery.mjs test/atlas25-discovery.test.mjs
git commit -m "feat(ATLAS-25): fail-closed page shape validation with mandatory revision provenance"
```

---

## Task 3: Lifecycle mapping

**Files:**
- Modify: `src/atlas25/discovery.mjs`
- Modify: `test/atlas25-discovery.test.mjs`

**Step 1: Write the failing tests**

Append to `test/atlas25-discovery.test.mjs` (add `lifecycleFor`, `LIFECYCLES`, `STATUS_TO_LIFECYCLE` to the import):

```js
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
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL — `lifecycleFor is not a function`.

**Step 3: Implement the lifecycle mapping**

Append to `src/atlas25/discovery.mjs`:

```js
// Closed allowlist. A status Confluence starts returning that is not listed here
// must fail the scan, not be silently normalized into "active".
export const STATUS_TO_LIFECYCLE = Object.freeze({
  current: 'active',
  archived: 'archived',
  trashed: 'deleted',
  deleted: 'deleted'
})

// "absent" and "removed_from_scope" are never derived from a status field; they
// are only assigned by the previous-scan probe (see scanAbsent).
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
```

**Step 4: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 39 tests, `# fail 0`.

**Step 5: Commit**

```bash
git add src/atlas25/discovery.mjs test/atlas25-discovery.test.mjs
git commit -m "feat(ATLAS-25): closed-allowlist lifecycle mapping for archive and delete states"
```

---

## Task 4: `discoverProject` — orchestration, determinism, digest

**Files:**
- Modify: `src/atlas25/discovery.mjs`
- Modify: `test/atlas25-discovery.test.mjs`

**Step 1: Write the failing tests**

Append to `test/atlas25-discovery.test.mjs` (add `discoverProject`, `SCHEMA_VERSION` to the import):

```js
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
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL — `discoverProject is not a function`.

**Step 3: Implement `discoverProject`**

Add to the top of `src/atlas25/discovery.mjs`, below the class declaration:

```js
import { createHash } from 'node:crypto'
// Credentials are NOT re-implemented here. requireAuth is the single existing
// credential contract (ATLAS65_CONFLUENCE_* env vars) and keeps its own
// E_SOURCE_AUTH_MISSING code so the runbook stays consistent across pipelines.
import { requireAuth } from '../atlas65/confluence-source.mjs'
export { requireAuth }
```

Append to `src/atlas25/discovery.mjs`:

```js
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
  const { baseUrl, authorization } = auth
  const rootId = String(project.root_page_id)

  // 1) The root itself. The descendants endpoint never returns it.
  const rootRaw = await getJson(pageDetailUrl(baseUrl, rootId), { authorization, fetchImpl })
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

  const depthById = new Map()
  for (const d of pageDescendants) {
    if (d.page_id === rootId) {
      throw new DiscoveryError(
        'E_DISCOVERY_SCOPE',
        `descendant ${d.page_id} is the registered root — a page cannot be its own descendant`
      )
    }
    if (depthById.has(d.page_id)) {
      throw new DiscoveryError(
        'E_DISCOVERY_SCOPE',
        `page ${d.page_id} appeared twice in the cursor walk — refusing an ambiguous scope`
      )
    }
    depthById.set(d.page_id, d.depth)
  }

  // 3) One detail read per page: the only place a revision comes from.
  const pages = [buildPageRecord({ detail: rootDetail, depth: 0, baseUrl, spaceKey: project.confluence_space_key })]
  for (const pageId of [...depthById.keys()].sort()) {
    const raw = await getJson(pageDetailUrl(baseUrl, pageId), { authorization, fetchImpl })
    const d = assertPageDetailShape(raw, pageId)
    pages.push(buildPageRecord({ detail: d, depth: depthById.get(pageId), baseUrl, spaceKey: project.confluence_space_key }))
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
    absent: [],
    delta: null
  }

  return {
    schema_version: SCHEMA_VERSION,
    discovery_digest: digestOf(semantic),
    semantic,
    capture: {
      captured_at: capturedAt,
      pagination_requests: walk.requests,
      previous_digest: null
    }
  }
}
```

**Step 4: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 46 tests, `# fail 0`.

**Step 5: Commit**

```bash
git add src/atlas25/discovery.mjs test/atlas25-discovery.test.mjs
git commit -m "feat(ATLAS-25): registry-rooted deterministic project discovery with revision capture"
```

---

## Task 5: Incremental delta and the absent-page probe

**Files:**
- Modify: `src/atlas25/discovery.mjs`
- Modify: `test/atlas25-discovery.test.mjs`

**Step 1: Write the failing tests**

Append to `test/atlas25-discovery.test.mjs` (add `applyPrevious` to the import):

```js
// --- incremental delta ------------------------------------------------------

// A previous scan that saw four pages: the root, 900000002 (v6), 900000003 (v2)
// and 900000005 (v1, since removed from the subtree).
const PREVIOUS = {
  schema_version: '1.0',
  discovery_digest: 'previous-digest',
  semantic: {
    schema_version: '1.0',
    project_id: 'PLUMBLINE',
    source: { source_kind: 'confluence', source_id: '900000001', space_key: 'PRODUKTMAN', base_url: BASE },
    discovery: { rule: 'x', page_count: 4, non_page_descendants: 0 },
    pages: [
      { page_id: '900000001', title: 'Root', version: 12, parent_id: null, depth: 0, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
      { page_id: '900000002', title: 'Page 2', version: 6, parent_id: '900000001', depth: 1, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
      { page_id: '900000003', title: 'Old', version: 2, parent_id: '900000002', depth: 2, lifecycle: 'active', source_status: 'current', confluence_url: 'u' },
      { page_id: '900000005', title: 'Gone', version: 1, parent_id: '900000001', depth: 1, lifecycle: 'active', source_status: 'current', confluence_url: 'u' }
    ],
    absent: [],
    delta: null
  },
  capture: { captured_at: 'then', pagination_requests: 1, previous_digest: null }
}

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
  assert.deepEqual(doc.semantic.delta, {
    previous_digest: 'previous-digest',
    added: [],
    unchanged: ['900000001'],
    version_changed: [{ page_id: '900000002', from: 6, to: 7 }],
    lifecycle_changed: [{ page_id: '900000003', from: 'active', to: 'archived' }],
    absent: ['900000005']
  })
  assert.equal(doc.capture.previous_digest, 'previous-digest')
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
  const same = applyPrevious(doc, null, {})
  assert.equal(same.semantic.delta, null)
  assert.deepEqual(same.semantic.absent, [])
  assert.equal(same.discovery_digest, doc.discovery_digest)
})

test('applyPrevious fails closed when the previous scan belongs to a different project', async () => {
  const foreign = { ...PREVIOUS, semantic: { ...PREVIOUS.semantic, project_id: 'ATLAS' } }
  await assert.rejects(
    discoverWithPrevious(foreign),
    (e) => e instanceof DiscoveryError && e.code === 'E_DISCOVERY_SCOPE' && /project/.test(e.message)
  )
})

test('applyPrevious fails closed when the previous scan used a different root', async () => {
  const foreign = {
    ...PREVIOUS,
    semantic: { ...PREVIOUS.semantic, source: { ...PREVIOUS.semantic.source, source_id: '900000099' } }
  }
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
  assert.deepEqual(withDelta.semantic.delta.added, [])
  assert.deepEqual(withDelta.semantic.delta.version_changed, [])
  assert.deepEqual(withDelta.semantic.delta.lifecycle_changed, [])
  assert.deepEqual(withDelta.semantic.delta.absent, [])
  assert.deepEqual(withDelta.semantic.delta.unchanged, ['900000001', '900000002', '900000003'])
  assert.equal(withDelta.semantic.delta.previous_digest, first.discovery_digest)
})
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: FAIL — `applyPrevious is not a function`.

**Step 3: Implement `applyPrevious`**

Append to `src/atlas25/discovery.mjs`:

```js
function assertPreviousShape(previous, project) {
  const s = previous?.semantic
  if (
    previous === null || typeof previous !== 'object' || Array.isArray(previous) ||
    s === null || typeof s !== 'object' || Array.isArray(s) ||
    !Array.isArray(s.pages) || typeof previous.discovery_digest !== 'string' ||
    s.source === null || typeof s.source !== 'object'
  ) {
    throw new DiscoveryError('E_PREVIOUS_INVALID', 'previous scan document is structurally invalid')
  }
  for (const p of s.pages) {
    if (!isNonEmptyString(p?.page_id) || !Number.isInteger(p?.version) || !isNonEmptyString(p?.lifecycle)) {
      throw new DiscoveryError('E_PREVIOUS_INVALID', 'previous scan contains a page without id, version or lifecycle')
    }
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
  const raw = await getJson(pageDetailUrl(baseUrl, pageId), { authorization, fetchImpl, allow404: true })
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
  const { baseUrl, authorization } = requireAuth(env)

  const currentById = new Map(doc.semantic.pages.map((p) => [p.page_id, p]))
  const previousById = new Map(prev.pages.map((p) => [p.page_id, p]))

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
  const semantic = {
    ...doc.semantic,
    absent: absent.sort(sortById),
    delta: {
      previous_digest: previous.discovery_digest,
      added: added.sort(),
      unchanged: unchanged.sort(),
      version_changed: versionChanged.sort(sortById),
      lifecycle_changed: lifecycleChanged.sort(sortById),
      absent: absent.map((a) => a.page_id).sort()
    }
  }

  return {
    schema_version: doc.schema_version,
    discovery_digest: digestOf(semantic),
    semantic,
    capture: { ...doc.capture, previous_digest: previous.discovery_digest }
  }
}
```

> **Note on `{ ...doc.semantic }`:** this is the one place a spread is used. `doc.semantic` was built with explicit field order in `discoverProject`, and the two overridden keys (`absent`, `delta`) are its last two keys, so the spread preserves the canonical order. Do not reorder the fields in `discoverProject` without revisiting this.

**Step 4: Run the tests to verify they pass**

Run: `node --test test/atlas25-discovery.test.mjs`
Expected: PASS, 55 tests, `# fail 0`.

**Step 5: Commit**

```bash
git add src/atlas25/discovery.mjs test/atlas25-discovery.test.mjs
git commit -m "feat(ATLAS-25): incremental delta with evidence-only absent/archived/deleted classification"
```

---

## Task 6: CLI

**Files:**
- Create: `scripts/atlas25/discover.mjs`
- Modify: `package.json`
- Create: `test/atlas25-discover-cli.test.mjs`

**Step 1: Write the failing CLI tests**

Create `test/atlas25-discover-cli.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'scripts/atlas25/discover.mjs')
// No inherited environment: no real credential can ever reach these tests, and a
// loopback base URL means no test can ever reach real Confluence.
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME }
const offline = {
  ...cleanEnv,
  ATLAS65_CONFLUENCE_BASE_URL: 'https://127.0.0.1:9',
  ATLAS65_CONFLUENCE_EMAIL: 'u@example.com',
  ATLAS65_CONFLUENCE_API_TOKEN: 't'
}

const run = (args, env = cleanEnv) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })

test('CLI: missing --project is a usage error (exit 2)', () => {
  const r = run([])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /usage/)
})

test('CLI: unknown project is denied before any network use (exit 1)', () => {
  const r = run(['--project', 'NOPE'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: a project name that only differs in case is denied — no fuzzy routing', () => {
  const r = run(['--project', 'atlas'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: a Jira key passed as a project id is denied — project_id is the only selector', () => {
  const r = run(['--project', 'PLUM'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: missing credentials fail closed with E_SOURCE_AUTH_MISSING (exit 1)', () => {
  const r = run(['--project', 'ATLAS'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SOURCE_AUTH_MISSING/)
})

test('CLI: an unreachable Confluence host fails closed with E_DISCOVERY_UNREADABLE (exit 1)', () => {
  const r = run(['--project', 'ATLAS'], offline)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_DISCOVERY_UNREADABLE/)
})

test('CLI: an ambiguous registry is a technical error (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas25-cli-'))
  const registryPath = join(dir, 'registry.json')
  const real = JSON.parse(readFileSync(join(repoRoot, 'config/project-registry.json'), 'utf8'))
  real.projects.push({ ...real.projects[0] }) // duplicate project_id
  writeFileSync(registryPath, JSON.stringify(real))
  const r = run(['--project', 'ATLAS'], { ...offline, ATLAS_REGISTRY_PATH: registryPath })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_REGISTRY_AMBIGUOUS|E_REGISTRY_INVALID/)
})

test('CLI: an unreadable --previous file fails closed (exit 2) before any network use', () => {
  const r = run(
    ['--project', 'ATLAS', '--previous', join(tmpdir(), 'atlas25-does-not-exist.json')],
    offline
  )
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_PREVIOUS_UNREADABLE/)
})

test('CLI: a --previous file that is not JSON fails closed (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas25-cli-'))
  const p = join(dir, 'previous.json')
  writeFileSync(p, 'not json')
  const r = run(['--project', 'ATLAS', '--previous', p], offline)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_PREVIOUS_UNREADABLE/)
})

test('CLI: an unknown option is a usage error (exit 2)', () => {
  const r = run(['--project', 'ATLAS', '--fuzzy'], offline)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /usage|unknown option/)
})

test('CLI: no stdout or stderr output contains a credential value', () => {
  const r = run(['--project', 'ATLAS'], offline)
  const all = `${r.stdout}${r.stderr}`
  assert.equal(all.includes('u@example.com'), false)
  assert.equal(all.includes('Basic '), false)
  assert.equal(/authorization/i.test(all), false)
})
```

**Step 2: Run the tests to verify they fail**

Run: `node --test test/atlas25-discover-cli.test.mjs`
Expected: FAIL — `Cannot find module .../scripts/atlas25/discover.mjs`.

**Step 3: Implement the CLI**

Create `scripts/atlas25/discover.mjs`:

```js
#!/usr/bin/env node
// ATLAS-25: registry-driven Confluence project discovery and revision scan.
//
// Order is deliberate and fail-closed at every step: project routing through the
// writer registry FIRST (deny by default), previous-scan file SECOND, credentials
// THIRD, network LAST. Output is written atomically — either a complete scan
// exists afterwards, or nothing changed.
//
// Exit codes: 0 = scan written, 1 = fachlicher deny / source failure,
//             2 = technical error (usage, registry, unreadable previous scan).
//
// Uses process.exitCode + natural termination (no process.exit) so stdout/stderr
// always flush on pipes and redirects.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { discoverProject, applyPrevious, DiscoveryError } from '../../src/atlas25/discovery.mjs'
import { SourceError } from '../../src/atlas65/confluence-source.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const FAILED = Symbol('atlas25-discover failed')
const USAGE = 'usage: discover.mjs --project <project_id> [--previous <path>] [--out <path>]'

function fail(message, code = 1) {
  process.stderr.write(`atlas25-discover: ${message}\n`)
  process.exitCode = code
  return FAILED
}

function parseArgs(argv) {
  const opts = { project: null, previous: null, out: null }
  const known = { '--project': 'project', '--previous': 'previous', '--out': 'out' }
  for (let i = 0; i < argv.length; i += 1) {
    // Object.hasOwn, never `in`: "__proto__" must not resolve as an option.
    if (!Object.hasOwn(known, argv[i])) throw new Error(`unknown option ${JSON.stringify(argv[i])}. ${USAGE}`)
    const value = argv[i + 1]
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new Error(`option ${argv[i]} requires a value. ${USAGE}`)
    }
    opts[known[argv[i]]] = value
    i += 1
  }
  if (opts.project === null) throw new Error(USAGE)
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    return fail(e.message, 2)
  }

  // 1) Registry routing — the single source of project scope (DEC-09).
  let project
  try {
    const override = process.env.ATLAS_REGISTRY_PATH
    project = resolveProject(override ? loadRegistry(override) : loadRegistry(), 'project_id', opts.project)
  } catch (e) {
    return fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
  }
  if (project === null) {
    return fail(`E_UNKNOWN_PROJECT: no project matches the supplied selector ${JSON.stringify(opts.project)}`)
  }
  if (project.status !== 'active') {
    return fail(`E_DISCOVERY_SCOPE: project ${project.project_id} has status ${JSON.stringify(project.status)}, not "active"`)
  }

  // 2) Previous scan — read and parsed before any network use.
  let previous = null
  if (opts.previous !== null) {
    try {
      previous = JSON.parse(readFileSync(opts.previous, 'utf8'))
    } catch {
      return fail(`E_PREVIOUS_UNREADABLE: cannot read or parse ${opts.previous}`, 2)
    }
  }

  const out = opts.out ?? join(repoRoot, `out/atlas25/${project.project_id}/discovery.json`)

  // 3) Credentials + network.
  try {
    let doc = await discoverProject({
      env: process.env,
      project,
      capturedAt: new Date().toISOString()
    })
    doc = await applyPrevious(doc, previous, { env: process.env, project })

    mkdirSync(dirname(out), { recursive: true })
    const tmp = `${out}.tmp`
    writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`)
    renameSync(tmp, out)

    const s = doc.semantic
    process.stdout.write(
      `atlas25-discover: ${s.project_id} root ${s.source.source_id} — ` +
      `${s.pages.length} pages, ${s.discovery.non_page_descendants} non-page descendants, ` +
      `${doc.capture.pagination_requests} cursor request(s), digest ${doc.discovery_digest}\n`
    )
    const byLifecycle = new Map()
    for (const p of s.pages) byLifecycle.set(p.lifecycle, (byLifecycle.get(p.lifecycle) ?? 0) + 1)
    for (const [lifecycle, count] of [...byLifecycle].sort()) {
      process.stdout.write(`  lifecycle ${lifecycle}: ${count}\n`)
    }
    if (s.delta !== null) {
      process.stdout.write(
        `  delta vs ${s.delta.previous_digest}: +${s.delta.added.length} added, ` +
        `${s.delta.version_changed.length} revised, ${s.delta.lifecycle_changed.length} lifecycle-changed, ` +
        `${s.delta.absent.length} absent, ${s.delta.unchanged.length} unchanged\n`
      )
    }
    process.stdout.write(`  written: ${out}\n`)
  } catch (e) {
    if (e instanceof DiscoveryError || e instanceof SourceError) return fail(`${e.code}: ${e.message}`)
    return fail(`E_INTERNAL: ${e.message}`, 2)
  }
}

await main()
```

**Step 4: Add the npm script**

Modify `package.json` — add one line to `scripts`, immediately after `"atlas65:e2e"`:

```json
    "atlas25:discover": "node scripts/atlas25/discover.mjs --project ATLAS"
```

**Step 5: Run the CLI tests to verify they pass**

Run: `node --test test/atlas25-discover-cli.test.mjs`
Expected: PASS, 11 tests.

**Step 6: Verify the ATLAS-65 pipeline is untouched**

```bash
node --test test/atlas65-confluence-source.test.mjs test/atlas65-projection.test.mjs test/atlas65-snapshot.test.mjs test/atlas65-import.test.mjs test/atlas65-gbrain-cli.test.mjs test/atlas65-serve.test.mjs test/registry-resolve.test.mjs
git diff --name-only origin/main -- src/atlas65 config/atlas65-source-set.json scripts/atlas65
```

Expected: all suites pass; the `git diff --name-only` prints **nothing** — ATLAS-25 does not modify a single ATLAS-65 file.

**Step 7: Commit**

```bash
git add scripts/atlas25/discover.mjs test/atlas25-discover-cli.test.mjs package.json
git commit -m "feat(ATLAS-25): fail-closed discovery CLI with registry-first routing and atomic output"
```

---

## Task 7: Runbook documentation

**Files:**
- Create: `docs/atlas-25-discovery.md`

**Step 1: Write the runbook**

Create `docs/atlas-25-discovery.md` containing, in this order:

1. **What this is** — one paragraph: registry-driven, cursor-paginated, revision- and lifecycle-aware discovery of a registered project's Confluence subtree. Point at this plan for the design.
2. **Relationship to ATLAS-65** — explicit: ATLAS-65's `config/atlas65-source-set.json` fixed five-page set is unchanged, accepted pilot behavior; ATLAS-25 is a parallel read path and does not feed the projection/import pipeline in this slice.
3. **The deterministic discovery rule** — copy the "Documented deterministic discovery rule" block from this plan verbatim, including the space-key limitation.
4. **The lifecycle model** — copy the lifecycle table from this plan verbatim, including the "never inferred from" column.
5. **Determinism** — the `semantic`/`capture` split and `discovery_digest`; semantic equality is digest equality; `captured_at` is never identity.
6. **Prerequisites** — Node ≥22; `ATLAS65_CONFLUENCE_EMAIL` / `ATLAS65_CONFLUENCE_API_TOKEN` (and optional `ATLAS65_CONFLUENCE_BASE_URL`) as environment variables only, never committed, never written into the repo. Note that the `ATLAS65_` prefix is reused deliberately so the ATLAS-65 pipeline keeps working.
7. **Commands**:
   ```
   npm run atlas25:discover
   node scripts/atlas25/discover.mjs --project EASYTREE
   node scripts/atlas25/discover.mjs --project ATLAS --previous out/atlas25/ATLAS/discovery.json --out out/atlas25/ATLAS/discovery-2.json
   ```
   Outputs land in `out/atlas25/<PROJECT_ID>/discovery.json` (`out/` is gitignored).
8. **Confluence endpoints used** — copy the "Verified Confluence Cloud REST v2 contract" section, including the note that `descendants` carries no `version` and that discovery never requests `body-format`.
9. **Failure modes table** — every code, its stage and trigger:

   | Code | Exit | Trigger |
   |---|---|---|
   | `E_REGISTRY_UNREADABLE` / `E_REGISTRY_INVALID` / `E_REGISTRY_AMBIGUOUS` | 2 | writer registry unreadable or failing validation |
   | `E_UNKNOWN_PROJECT` | 1 | selector matches no registry project (exact match only) |
   | `E_DISCOVERY_SCOPE` | 1 | registry project not `active`; previous scan for another project or root; duplicate or root-colliding descendant |
   | `E_PREVIOUS_UNREADABLE` | 2 | `--previous` file missing or unparseable |
   | `E_PREVIOUS_INVALID` | 1 | previous scan document is structurally invalid |
   | `E_SOURCE_AUTH_MISSING` | 1 | credentials not set (shared contract with ATLAS-65) |
   | `E_DISCOVERY_UNREADABLE` | 1 | network failure, non-2xx HTTP, or non-JSON response |
   | `E_DISCOVERY_PAGINATION` | 1 | missing/invalid `_links.next`, next link leaving the configured origin, repeated cursor URL, request cap exceeded, response without a `results` array |
   | `E_DISCOVERY_METADATA` | 1 | page missing id/title/status/`version.number`, or answering with the wrong id |
   | `E_DISCOVERY_LIFECYCLE` | 1 | Confluence returned a status outside the closed allowlist |
   | `E_INTERNAL` | 2 | unexpected, uncoded failure |

10. **Known limitations** — (a) space key is provenance only, not verified against the API; (b) `historical` and `draft` statuses are deliberately unmapped and fail closed; (c) one detail request per page, so wall-clock scales linearly with subtree size; (d) `MAX_PAGINATION_REQUESTS = 200` is a hard cap that fails rather than truncates; (e) discovery output is not wired into the ATLAS-65 projection in this slice.

**Step 2: Verify the docs claims match the code**

```bash
grep -c "E_DISCOVERY_PAGINATION\|E_DISCOVERY_METADATA\|E_DISCOVERY_LIFECYCLE\|E_DISCOVERY_SCOPE\|E_DISCOVERY_UNREADABLE\|E_PREVIOUS_INVALID" src/atlas25/discovery.mjs
grep -oE "E_[A-Z_]+" src/atlas25/discovery.mjs scripts/atlas25/discover.mjs | sed 's/.*://' | sort -u
```

Expected: the second command's set of codes is exactly the set documented in the failure-modes table (plus `E_SOURCE_AUTH_MISSING` and `E_REGISTRY_*` which come from the reused modules). Reconcile any difference by fixing the **table**, not by inventing a code.

**Step 3: Commit**

```bash
git add docs/atlas-25-discovery.md
git commit -m "docs(ATLAS-25): discovery runbook, scope rule, lifecycle model and failure modes"
```

---

## Task 8: Full gates

**Files:** none (verification only)

**Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. Record the exact `# pass` / `# fail` / `# tests` counts from the TAP summary. `# fail` must be `0`.

**Step 2: Run the repository check gate**

Run: `npm run check`
Expected: exit 0, ending with `VALIDATION PASSED`.

If `validate-current-repository.mjs` reports a finding caused by an ATLAS-25 file, fix the ATLAS-25 file. Do **not** loosen the validator.

**Step 3: Run the secret scan**

Run: `npm run secret-scan`
Expected: exit 0, clean. Record the exact final line.

**Step 4: Confirm no ATLAS-65 regression**

```bash
git diff --stat origin/main
```

Expected changed paths, and nothing else:

```
config/... (none)
docs/atlas-25-discovery.md
docs/plans/2026-08-15-atlas-25-confluence-project-discovery-revision-scan.md
package.json
scripts/atlas25/discover.mjs
src/atlas25/discovery.mjs
test/atlas25-discover-cli.test.mjs
test/atlas25-discovery.test.mjs
```

(plus `docs/evidence/atlas-25/**` after Task 9, if live evidence was produced.)

If any `src/atlas65/**`, `scripts/atlas65/**`, `config/atlas65-source-set.json`, `contracts/**` or `src/registry/**` path appears: **STOP** and remove the change. ATLAS-25 must not modify ATLAS-65 or the registry.

---

## Task 9: Live source acceptance (conditional)

**Files:**
- Create (only on success): `docs/evidence/atlas-25/<PROJECT_ID>-discovery-evidence.json`

**SECURITY — binding for this whole task.** Do not search any other repository, directory or credential store for tokens. Do not create, copy or move any credential file. Do not print, echo, log or commit an email address, an API token, any prefix or length of a token, an `Authorization` header, or the contents of any credential file. Do not commit raw Confluence page bodies (discovery never fetches them, so there are none — keep it that way).

**Step 1: Check whether credentials are already present in the environment**

```bash
node -e 'const e=process.env;console.log("email_set:",Boolean(e.ATLAS65_CONFLUENCE_EMAIL),"token_set:",Boolean(e.ATLAS65_CONFLUENCE_API_TOKEN))'
```

This prints two booleans and nothing else.

- If either is `false`: **STOP this task.** Report `BLOCKED_FOR_LIVE_EVIDENCE` in the final status, state plainly that the automated fixture gates all passed but the live-source portion was not executed, and do not work around the credential gate in any way. Skip to Task 10.
- If both are `true`: continue.

**Step 2: Run a bounded read-only discovery for each registered V1 project**

```bash
node scripts/atlas25/discover.mjs --project ATLAS     --out out/atlas25/ATLAS/discovery.json
node scripts/atlas25/discover.mjs --project EASYTREE  --out out/atlas25/EASYTREE/discovery.json
node scripts/atlas25/discover.mjs --project PLUMBLINE --out out/atlas25/PLUMBLINE/discovery.json
```

Every command is read-only: discovery issues only `GET` requests. Record each exit code and the summary stdout lines.

Sanity check against known reality: the ATLAS run should report the root `14778372` plus at least the 19 numbered children and the blueprint page recorded in `docs/evidence/atlas-12-page-tree-snapshot.json` — i.e. **at least 21 pages** and **more than one cursor request** at `limit=100` only if the subtree is larger than 100. If it reports exactly one page, discovery is broken; investigate before recording anything.

**Step 3: Prove idempotence against the live source**

```bash
node scripts/atlas25/discover.mjs --project ATLAS --out out/atlas25/ATLAS/discovery-run2.json
node -e '
const a=JSON.parse(require("fs").readFileSync("out/atlas25/ATLAS/discovery.json","utf8"));
const b=JSON.parse(require("fs").readFileSync("out/atlas25/ATLAS/discovery-run2.json","utf8"));
console.log("digest_equal:", a.discovery_digest===b.discovery_digest);
console.log("semantic_equal:", JSON.stringify(a.semantic)===JSON.stringify(b.semantic));
console.log("captured_at_differs:", a.capture.captured_at!==b.capture.captured_at);
'
```

Expected: `digest_equal: true`, `semantic_equal: true`, `captured_at_differs: true`.

(If the source genuinely changed between the two runs, the digests differ legitimately — re-run and say so explicitly rather than reporting a false pass.)

**Step 4: Prove the incremental delta against the live source**

```bash
node scripts/atlas25/discover.mjs --project ATLAS \
  --previous out/atlas25/ATLAS/discovery.json \
  --out out/atlas25/ATLAS/discovery-delta.json
```

Expected: exit 0, and the delta line reports `+0 added, 0 revised, 0 lifecycle-changed, 0 absent` with `unchanged` equal to the page count.

**Step 5: Write the sanitized evidence file**

For each project, write `docs/evidence/atlas-25/<PROJECT_ID>-discovery-evidence.json` containing **only** non-secret fields:

```json
{
  "schema_version": "1.0",
  "jira_issue": "ATLAS-25",
  "evidence_type": "live_source_acceptance",
  "canonical": false,
  "not_runtime_input": true,
  "source_of_truth": "Confluence",
  "notice": "Sanitized ATLAS-25 live discovery evidence. Non-canonical, never runtime or routing input. Contains no page bodies, no credentials and no personal data.",
  "project_id": "<PROJECT_ID>",
  "space_key": "PRODUKTMAN",
  "root_page_id": "<root>",
  "observed_at": "<capture.captured_at>",
  "discovery_digest": "<digest>",
  "page_count": 0,
  "non_page_descendants": 0,
  "pagination_requests": 0,
  "lifecycle_counts": { "active": 0, "archived": 0, "deleted": 0 },
  "pages": [{ "page_id": "…", "version": 0, "parent_id": "…", "depth": 0, "lifecycle": "active" }],
  "idempotent_rerun": { "digest_equal": true, "semantic_equal": true, "captured_at_differs": true }
}
```

**Deliberately omitted: `title`, `confluence_url`, `base_url`, and every body-derived field.** Titles are not secrets but they are content; page IDs, versions, parentage, depth and lifecycle are sufficient evidence for this AC. If a reviewer later needs titles, that is a separate, explicit decision.

**Step 6: Verify the evidence contains nothing sensitive**

```bash
grep -riE 'token|authorization|@|password|secret|Basic ' docs/evidence/atlas-25/ || echo "CLEAN: no credential-shaped string in the evidence"
npm run secret-scan
```

Expected: `CLEAN: …`, then a clean secret scan.

**Step 7: Commit**

```bash
git add docs/evidence/atlas-25
git commit -m "test(ATLAS-25): sanitized live Confluence discovery acceptance evidence"
```

---

## Task 10: Review, push, PR

**Files:** none (git + GitHub)

**Step 1: Re-run every gate one final time**

```bash
npm run check
npm run secret-scan
```

Expected: both exit 0. Record the counts and the final lines verbatim — these go into the PR body.

**Step 2: Inspect the complete diff**

```bash
git diff origin/main --stat
git diff origin/main
```

Read the whole diff. Confirm: no ATLAS-65 file, no registry file, no contract file, no `config/` file changed; no credential, token, email address or raw page body anywhere; no unrelated cleanup.

**Step 3: Verify the untracked unrelated plan file was not swept in**

```bash
git status --porcelain
```

Expected: `?? docs/plans/2026-08-14-atlas-sprint-2-jira-preparation.md` is still untracked. It is not part of ATLAS-25.

**Step 4: Push the branch**

```bash
git push -u origin feat/ATLAS-25-confluence-project-discovery-revision-scan
git rev-parse HEAD
```

Record the HEAD SHA — this is the PR head SHA.

**Step 5: Open the PR (do NOT merge)**

```bash
gh pr create --repo DYAI2025/project-atlas-foundation \
  --base main \
  --head feat/ATLAS-25-confluence-project-discovery-revision-scan \
  --title "ATLAS-25: Confluence project discovery and revision scan" \
  --body-file /dev/stdin <<'BODY'
## Jira
ATLAS-25 — Confluence Project Discovery und Revision Scan implementieren.

## Scope
Registry-driven, cursor-paginated, revision- and lifecycle-aware discovery of a
registered project's Confluence subtree, with an incremental delta against a
previous scan. Baseline: main @ 99035de5c318084abd6ae7f02c132e0840b8fc56.

## AC mapping
- **Cursor pagination** — `paginate()` walks `_links.next`; tests cover one page,
  multi page, real cursor traversal, non-progressing cursor, request-cap exceeded,
  missing `results` array, mid-walk HTTP failure. No silent truncation anywhere.
- **Revision IDs** — every page's `version.number` comes from
  `GET /wiki/api/v2/pages/{id}`; a page without an integer `version.number` fails
  the scan (`E_DISCOVERY_METADATA`). No revision is ever invented.
- **Delete/archive states** — closed allowlist `current|archived|trashed|deleted`;
  anything else fails closed. Pages that vanish from the subtree are re-read
  directly and classified only from an API status or an observed HTTP 404
  (`absent`), never assumed deleted.
- **Idempotent rerun** — output is split into `semantic` (no wall clock) and
  `capture` (timestamps); `discovery_digest = sha256(semantic)`. Tested: two runs
  with different `captured_at` produce identical digests, and reordered API
  responses produce identical digests.

## Architecture / boundaries
- Project routing reuses `src/registry/resolve.mjs` verbatim — no duplicated
  routing logic, no title/semantic inference (DEC-09).
- Credentials reuse `requireAuth` from `src/atlas65/confluence-source.mjs` and its
  existing `ATLAS65_CONFLUENCE_*` contract.
- Discovery never requests `body-format`, so no raw Confluence content enters this
  path (DEC-04).
- **ATLAS-65 is untouched**: `git diff --name-only origin/main -- src/atlas65 scripts/atlas65 config/atlas65-source-set.json` is empty. Its fixed source set remains accepted pilot behavior.
- GBrain remains a derived projection; this slice writes nothing to it.

## Tests and commands
- `npm test` → <counts>
- `npm run check` → exit 0, VALIDATION PASSED
- `npm run secret-scan` → exit 0, clean
- ATLAS-65 regression suites re-run green.

## Negative-path evidence
Unknown project, case-variant project name, Jira key used as project id,
non-active project, ambiguous registry, missing credentials, unreachable host,
malformed page metadata, missing revision, unknown lifecycle status, repeated
cursor, request-cap exceeded, cross-origin `next` link, unreadable/invalid
previous scan. Each has a named test asserting the exact error code and exit code.

## Live evidence
<either: sanitized evidence in docs/evidence/atlas-25/ for ATLAS, EASYTREE,
PLUMBLINE — page IDs, versions, parentage, depth, lifecycle, counts and the
idempotence result, no titles, no URLs, no bodies, no credentials;
or: BLOCKED_FOR_LIVE_EVIDENCE — credentials were not present in the environment
and the gate was not worked around.>

## Known limitations
- `confluence_space_key` is carried as provenance only; the v2 detail endpoint
  returns a numeric `spaceId`, so the key is not verified against the API.
- `historical` and `draft` statuses are deliberately unmapped and fail closed.
- One detail request per page; wall clock scales linearly with subtree size.
- Discovery output is not yet wired into the ATLAS-65 projection/import pipeline.
- The `ATLAS65_` credential prefix is reused rather than renamed, to avoid
  breaking the ATLAS-65 pipeline.

## Explicit out of scope
ATLAS-16, ATLAS-30, ATLAS-33, ATLAS-54, ATLAS-39/40/41/42, production
Compose/VPS deployment, canonical final entity IDs, Obsidian export, knowledge
proposal/publish workflow, any Jira or Confluence mutation, any unrelated cleanup.

## Authorization
**PO / G2 merge authorization is still required. This PR must not be merged by the
implementation agent.** No Jira or Confluence state was modified. No G2
authorization artifact was created or edited.
BODY
```

**Step 6: Record the PR facts**

```bash
gh pr view --repo DYAI2025/project-atlas-foundation --json number,url,headRefOid
```

Record the PR number, URL and exact head SHA for the final report.

**Do not merge.**

---

## Final report format

Report back using exactly the sections the briefing requires: `## BASELINE`,
`## PLAN`, `## IMPLEMENTATION`, `## FILES CHANGED`, `## TESTS`,
`## LIVE SOURCE EVIDENCE`, `## NEGATIVE PATHS`, `## SECURITY`, `## COMMIT / PR`,
`## FINDINGS / DRIFT`, `## FINAL STATUS`.

`## FINAL STATUS` is exactly one of:
`READY FOR PO REVIEW` (all gates green **and** live evidence recorded),
`BLOCKED_FOR_LIVE_EVIDENCE` (all fixture gates green, credentials absent),
`SCOPE_SPLIT_REQUIRED`, or `BLOCKED`.

Never `DONE`.

Known findings to carry into `## FINDINGS / DRIFT` regardless of outcome:

- **Minor** — the credential env vars keep the `ATLAS65_` prefix although they are
  now shared by two pipelines. Renaming them is a separate, coordinated change.
- **Minor** — `docs/plans/2026-08-14-atlas-sprint-2-jira-preparation.md` is
  untracked on the local clone and unrelated to ATLAS-25; left untouched.
- **Minor** — the local clone was checked out on
  `feat/ATLAS-65-real-source-gbrain-browser-graph` at session start, not `main`;
  the ATLAS-25 branch was cut from `origin/main`.

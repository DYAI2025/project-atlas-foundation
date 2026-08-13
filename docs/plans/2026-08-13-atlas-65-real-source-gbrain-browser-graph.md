# ATLAS-65 — Real ATLAS Source → GBrain → Browser Graph: Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prove the first real end-to-end vertical slice: real canonical ATLAS Confluence pages → project-scoped projection → real local pinned GBrain (PGLite) persistence → `gbrain-read/v1` graph snapshot → minimal local browser graph with focus, neighbours, and Page-ID/version provenance.

**Architecture:** Repo-owned Node scripts fetch a fixed, hierarchy-verified set of 5 real Confluence pages (fail-closed on auth/metadata/hierarchy), project them into a dedicated local instance of the pinned GBrain v0.42.73.2 (PGLite engine, isolated via `GBRAIN_HOME`, no embedding provider), then a *separate readback-only* script reads pages+links back out of the persisted brain and materialises the existing `gbrain-read/v1` snapshot plus a provenance sidecar. A tiny validate-then-serve HTTP server delivers exactly the validated snapshot bytes to a vanilla-JS/SVG viewer. Every stage reuses the existing registry resolver and contract checker; nothing loosens the contract.

**Tech Stack:** Node 24 (`node:test`, global `fetch`, `node:http`), existing `src/registry/resolve.mjs` + `src/gbrain-read-contract/validate.mjs`/`cli.mjs`, pinned GBrain `v0.42.73.2` @ `15b9863d13635d173562a54f55a1d388bfcf546b` run under Bun ≥ 1.3.10 (PGLite persistence), vanilla HTML/SVG viewer (no framework, no CDN).

---

## Verified preflight facts (2026-08-13, do not re-derive blindly — re-verify in Task 0)

| Fact | Value | How verified |
|---|---|---|
| `origin/main` | `9bb477250ac24b7962dec947c4b2918a238f3e6b` (= expected; PR #17 merge) | `git fetch && git rev-parse origin/main` |
| Working tree | clean; local branch was `docs/ATLAS-14-arch-doc-parity` | `git status --porcelain` |
| ATLAS-14 gate | **PASSED 13.08.2026** per Confluence page 22478849 ("GATE BESTANDEN"); ATLAS-65 is the only authorized new implementation topic | live page read |
| Jira ATLAS-65 | Status "Zu erledigen"; PGLite local persistence explicitly allowed ("z. B. PGLite … zulässig"); pin v0.42.73.2 / `15b9863d…` | live Jira read |
| Registry | `ATLAS` → space `PRODUKTMAN`, `root_page_id` `14778372` | `config/project-registry.json` |
| Contract | `gbrain-read/v1`: concat-derived IDs, code-unit-sorted nodes/edges, `origin: "explicit"` only, `additionalProperties: false` (NO revision field → provenance sidecar, never schema change) | schema + `validate.mjs` read |
| Real hierarchy | Root `14778372` ("ATLAS Single Source of Truth") has depth-1 children incl. `14680066` (02), `15073290` (04), `15171611` (14); `22478849` (Sprint-2 plan) is child of `15171611` | live descendants read |
| GBrain pin | Public repo `github.com/garrytan/gbrain`, commit `15b9863d…` = tag content `v0.42.73.2`, `bin: src/cli.ts`, `engines: {"bun": ">=1.3.10"}` | clone + checkout of exact commit |
| GBrain init w/o keys | `gbrain init --pglite --no-embedding` succeeds with zero env keys, zero network; non-TTY init **without** `--no-embedding` exits 1 | gbrain source `src/commands/init.ts` |
| GBrain isolation | `GBRAIN_HOME=<abs dir>` relocates config (`<dir>/.gbrain/config.json`) AND PGLite data (`<dir>/.gbrain/brain.pglite/`) | gbrain `src/core/config.ts:1210` |
| GBrain write/readback | `gbrain put <slug>` (stdin→`content`), `gbrain link <from> <to> --link-type … --link-source …` (both pages must pre-exist), JSON readback via `gbrain call get_page/list_pages/get_links '<json>'` | gbrain `src/core/operations.ts` |
| GBrain hazards | stray `DATABASE_URL`/`GBRAIN_DATABASE_URL` silently retargets to Postgres; PGLite is single-writer (serialize calls); `GBRAIN_SKIP_STARTUP_HOOKS=1` kills the detached update-check spawn | gbrain `src/core/config.ts:588`, `pglite-lock.ts` |
| Local Bun | 1.2.20 installed — **too old**, needs `bun upgrade` to ≥ 1.3.10 | `bun --version` |
| Confluence auth | NO API token anywhere on this machine (env, keychain, shell rc) → execution prerequisite | env/keychain/rc sweep |
| Repo validator | checks named files only, no directory scan; package.json only pinned for `secret-scan` script → new files/scripts safe | `scripts/validate-current-repository.mjs` |
| Test harness | `node:test` + `assert/strict` + `spawnSync` CLI harness + Ajv 2020; synthetic fixtures use `9xxxxxxxx` refs (PLUMBLINE convention) | existing tests |

**Chosen real source set (5 nodes, 4 verified `parent_of` edges):**

| Page ID | Title | Verified relation |
|---|---|---|
| `14778372` | ATLAS Single Source of Truth | root (= registry `root_page_id`) |
| `14680066` | 02 – Source of Truth, Governance and Decision Rights | child of `14778372` |
| `15073290` | 04 – Target Architecture and System Context | child of `14778372` |
| `15171611` | 14 – Delivery Model, Program Increment and Sprint Plan | child of `14778372` |
| `22478849` | Sprint 2 – Visible Real Semantic Atlas – Sprint Plan | child of `15171611` |

**Expected snapshot IDs** (deterministic, ascending code-unit order — the builder must reproduce exactly this):

Nodes (`node_id`):
```
ATLAS:confluence:14778372:14680066
ATLAS:confluence:14778372:14778372
ATLAS:confluence:14778372:15073290
ATLAS:confluence:14778372:15171611
ATLAS:confluence:14778372:22478849
```
Edges (`edge_id`):
```
ATLAS:confluence:14778372:parent_of:14778372:14680066
ATLAS:confluence:14778372:parent_of:14778372:15073290
ATLAS:confluence:14778372:parent_of:14778372:15171611
ATLAS:confluence:14778372:parent_of:15171611:22478849
```

---

## Binding constraints (from ATLAS-65 + governance — the executor MUST honor these)

1. **No merge. No Jira `Done`. No Confluence writes. No VPS/production mutation. No scope expansion.** End state = pushed branch + open PR + evidence package for PO review.
2. **Never substitute the pin.** GBrain commit comes ONLY from `third_party/upstreams.lock.json`; scripts read it from there, never hardcode.
3. **No synthetic success path.** Unit tests may use clearly-synthetic `9xxxxxxxx` fixtures (existing repo convention) for logic/negative paths, but ALL acceptance evidence (persistence, snapshot, browser) comes from the live real-source run.
4. **No inferred/invented edges.** Only `parent_of` edges whose parentage was live-verified at fetch time and re-read from persisted links at snapshot time.
5. **Do not loosen `gbrain-read/v1`.** Revision/version lives in a provenance *sidecar*; the snapshot schema is untouched. The viewer's graph model is exactly the validated snapshot bytes.
6. **Fail closed everywhere.** Missing auth, unexpected source metadata, hierarchy drift, unknown project selector, empty/absent brain, invalid snapshot → explicit non-zero exit with a stable `E_*` code; never partial success, never fixture fallback.
7. **Secrets:** Confluence credentials only via env (`ATLAS65_CONFLUENCE_EMAIL`, `ATLAS65_CONFLUENCE_API_TOKEN`, optional `ATLAS65_CONFLUENCE_BASE_URL`). Never in code, fixtures, evidence, commits, or logs. Evidence copies strip auth and page bodies (bodies → sha256).
8. **STOP CONDITIONS** (return blocker + evidence instead of improvising): cannot authenticate to Confluence; revision/provenance not establishable; pinned GBrain cannot do local persistence/readback as planned (e.g. `bun upgrade` still < 1.3.10, PGLite init fails on this machine); repo reality contradicts this plan's verified facts; slice would require out-of-scope items; material ambiguity.

---

### Task 0: Preflight gate + branch (no repo changes yet)

**Files:** none (verification only)

**Step 1: Verify repo state and create branch**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git status --porcelain          # expect: empty
git fetch origin main
git rev-parse origin/main       # expect: 9bb477250ac24b7962dec947c4b2918a238f3e6b
```
If SHA differs: inspect `git log --oneline <expected>..origin/main`, understand the delta, STOP if it touches contracts/registry/scripts this plan builds on. Never reset or discard newer work.

```bash
git switch -c feat/ATLAS-65-real-source-gbrain-browser-graph origin/main
```

**Step 2: Baseline gates green**

```bash
npm ci
npm run check         # expect exit 0 (211 tests, validator 91 checks)
npm run secret-scan   # expect exit 0
```
Record exact counts for the evidence report. If baseline is red → STOP (condition 4).

**Step 3: Bun runtime gate**

```bash
bun upgrade
bun --version         # expect >= 1.3.10; record exact version
```
If still < 1.3.10 → STOP (condition 3).

**Step 4: Confluence access gate + capture source versions**

Prerequisite: user-provided token (create at https://id.atlassian.com/manage-profile/security/api-tokens). Export:
```bash
export ATLAS65_CONFLUENCE_EMAIL='<atlassian account email>'
export ATLAS65_CONFLUENCE_API_TOKEN='<token>'
```
Verify (repeat for all five page IDs; record title + version.number for SOURCE EVIDENCE):
```bash
for id in 14778372 14680066 15073290 15171611 22478849; do
  curl -sS -u "$ATLAS65_CONFLUENCE_EMAIL:$ATLAS65_CONFLUENCE_API_TOKEN" \
    "https://dyai2026.atlassian.net/wiki/api/v2/pages/$id" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s);console.log([p.id,p.version&&p.version.number,p.parentId??'null',p.title].join('\t'))})"
done
```
Expected: five tab-separated lines; `14778372` has title `ATLAS Single Source of Truth`; parent IDs match the source-set table above. Any HTTP error / missing `version.number` / parent mismatch → STOP (condition 1/2) — do not improvise, do not pick different pages without re-verifying hierarchy the same way.

> Note: if the v2 response shape differs from `{id, title, parentId, version:{number}}`, record the actual shape and adapt `assertPageShape` in Task 3 to the *observed real* shape — never fabricate fields.

---

### Task 1: Scaffold — .gitignore, source-set config, npm scripts

**Files:**
- Modify: `.gitignore`
- Create: `config/atlas65-source-set.json`
- Modify: `package.json` (scripts only)

**Step 1: .gitignore additions** (append):
```
out/
third_party/gbrain-checkout/
```

**Step 2: Create `config/atlas65-source-set.json`**

```json
{
  "schema_version": "1.0",
  "description": "ATLAS-65 pilot: deterministic real source set under the registered ATLAS Confluence root. Edges may only ever be derived from live-verified parentage of exactly these pages.",
  "project_selector": { "selector_kind": "project_id", "selector_value": "ATLAS" },
  "pages": [
    { "page_id": "14778372", "expected_parent_id": null },
    { "page_id": "14680066", "expected_parent_id": "14778372" },
    { "page_id": "15073290", "expected_parent_id": "14778372" },
    { "page_id": "15171611", "expected_parent_id": "14778372" },
    { "page_id": "22478849", "expected_parent_id": "15171611" }
  ]
}
```

**Step 3: Add npm scripts** (do not touch existing ones; validator pins only `secret-scan`):

```json
"atlas65:setup": "node scripts/atlas65/setup-gbrain.mjs",
"atlas65:fetch": "node scripts/atlas65/fetch-source.mjs --project ATLAS",
"atlas65:import": "node scripts/atlas65/import-to-gbrain.mjs --project ATLAS",
"atlas65:snapshot": "node scripts/atlas65/generate-snapshot.mjs --project ATLAS",
"atlas65:serve": "node scripts/atlas65/serve.mjs",
"atlas65:e2e": "node scripts/atlas65/e2e.mjs --project ATLAS"
```

**Step 4: Verify nothing breaks**

```bash
npm run check         # expect exit 0, unchanged counts
```

**Step 5: Commit**

```bash
git add .gitignore config/atlas65-source-set.json package.json docs/plans/2026-08-13-atlas-65-real-source-gbrain-browser-graph.md
git commit -m "feat(ATLAS-65): scaffold pilot source set, scripts, ignore rules"
```

---

### Task 2: Confluence source module (TDD, offline)

**Files:**
- Create: `src/atlas65/confluence-source.mjs`
- Test: `test/atlas65-confluence-source.test.mjs`

**Step 1: Write the failing tests** — `test/atlas65-confluence-source.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SourceError,
  requireAuth,
  pageUrl,
  assertPageShape,
  verifySourceSet,
  fetchSourceSet
} from '../src/atlas65/confluence-source.mjs'

// Synthetic 9xxxxxxxx refs per repo convention — logic tests only; the real-source
// acceptance evidence comes exclusively from the live E2E run.
const SET = {
  schema_version: '1.0',
  project_selector: { selector_kind: 'project_id', selector_value: 'PLUMBLINE' },
  pages: [
    { page_id: '900000001', expected_parent_id: null },
    { page_id: '900000002', expected_parent_id: '900000001' },
    { page_id: '900000003', expected_parent_id: '900000002' }
  ]
}
const PROJECT = { project_id: 'PLUMBLINE', root_page_id: '900000001', confluence_space_key: 'PRODUKTMAN' }
const raw = (id, parent, version = 3) => ({
  id, title: `Page ${id}`, parentId: parent,
  version: { number: version },
  body: { storage: { value: `<p>body of ${id}</p>` } }
})

test('requireAuth fails closed without credentials', () => {
  assert.throws(() => requireAuth({}), (e) => e instanceof SourceError && e.code === 'E_SOURCE_AUTH_MISSING')
})

test('requireAuth returns base url + auth header parts', () => {
  const a = requireAuth({ ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' })
  assert.equal(a.baseUrl, 'https://dyai2026.atlassian.net')
  assert.equal(pageUrl(a.baseUrl, '900000001'),
    'https://dyai2026.atlassian.net/wiki/api/v2/pages/900000001?body-format=storage')
})

test('assertPageShape accepts a complete page and normalizes parentId', () => {
  const p = assertPageShape(raw('900000002', '900000001'), '900000002')
  assert.deepEqual(
    { id: p.id, title: p.title, version: p.version, parentId: p.parentId },
    { id: '900000002', title: 'Page 900000002', version: 3, parentId: '900000001' }
  )
  assert.equal(assertPageShape(raw('900000001', undefined), '900000001').parentId, null)
})

for (const [name, mutate] of [
  ['missing version', (r) => { delete r.version }],
  ['non-numeric version', (r) => { r.version = { number: 'x' } }],
  ['missing title', (r) => { r.title = '' }],
  ['id mismatch', (r) => { r.id = '900000009' }],
  ['missing body', (r) => { delete r.body }]
]) {
  test(`assertPageShape fails closed on ${name}`, () => {
    const r = raw('900000002', '900000001'); mutate(r)
    assert.throws(() => assertPageShape(r, '900000002'),
      (e) => e instanceof SourceError && e.code === 'E_SOURCE_METADATA')
  })
}

test('verifySourceSet accepts live-verified parentage', () => {
  const pages = [raw('900000001', undefined), raw('900000002', '900000001'), raw('900000003', '900000002')]
    .map((r) => assertPageShape(r, r.id))
  verifySourceSet(pages, SET, PROJECT) // must not throw
})

for (const [name, pages, set, project] of [
  ['root not registry root', ['900000001', null], SET, { ...PROJECT, root_page_id: '900000099' }],
  ['live parent differs from expected', null, SET, PROJECT],
  ['parent outside set', null, {
    ...SET,
    pages: [{ page_id: '900000001', expected_parent_id: null }, { page_id: '900000003', expected_parent_id: '900000005' }]
  }, PROJECT]
]) {
  test(`verifySourceSet fails closed: ${name}`, () => {
    const live = [
      assertPageShape(raw('900000001', undefined), '900000001'),
      assertPageShape(raw('900000002', '900000009'), '900000002'), // drifted parent
      assertPageShape(raw('900000003', '900000002'), '900000003')
    ]
    const useSet = set ?? SET
    const usePages = name === 'root not registry root'
      ? [assertPageShape(raw('900000001', undefined), '900000001')]
      : live.filter((p) => useSet.pages.some((s) => s.page_id === p.id))
    assert.throws(() => verifySourceSet(usePages, useSet, project),
      (e) => e instanceof SourceError && (e.code === 'E_SOURCE_HIERARCHY'))
  })
}

test('fetchSourceSet builds a deterministic capture from live pages', async () => {
  const responses = new Map([
    ['900000001', raw('900000001', undefined, 5)],
    ['900000002', raw('900000002', '900000001', 2)],
    ['900000003', raw('900000003', '900000002', 9)]
  ])
  const fetchImpl = async (url) => {
    const id = url.match(/pages\/(\d+)/)[1]
    return { ok: true, status: 200, json: async () => responses.get(id) }
  }
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  const a = await fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: '2026-08-13T00:00:00.000Z', fetchImpl })
  const b = await fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: '2026-08-13T00:00:00.000Z', fetchImpl })
  assert.equal(JSON.stringify(a), JSON.stringify(b)) // byte-identical
  assert.equal(a.project_id, 'PLUMBLINE')
  assert.deepEqual(a.source, { source_kind: 'confluence', source_id: '900000001' })
  assert.deepEqual(a.pages.map((p) => p.page_id), ['900000001', '900000002', '900000003']) // sorted
  assert.equal(a.pages[1].version, 2)
  assert.equal(a.pages[1].parent_id, '900000001')
  assert.match(a.pages[1].confluence_url, /^https:\/\/dyai2026\.atlassian\.net\/wiki\/spaces\/PRODUKTMAN\/pages\/900000002$/)
})

test('fetchSourceSet fails closed on HTTP error — no partial capture', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) })
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  await assert.rejects(
    fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_UNREADABLE'
  )
})
```

**Step 2: Run — expect FAIL** (module missing):
```bash
node --test test/atlas65-confluence-source.test.mjs
```

**Step 3: Implement `src/atlas65/confluence-source.mjs`**

```js
// ATLAS-65 real-source reader. Fail-closed by design: no synthetic fallback, no
// partial capture. Every page must expose id, title, version.number and (except
// the root) a parentId that matches the declared source set — otherwise the whole
// fetch fails with one precise SourceError.
export class SourceError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const DEFAULT_BASE_URL = 'https://dyai2026.atlassian.net'

export function requireAuth(env) {
  const baseUrl = (env.ATLAS65_CONFLUENCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const email = env.ATLAS65_CONFLUENCE_EMAIL
  const token = env.ATLAS65_CONFLUENCE_API_TOKEN
  if (!email || !token) {
    throw new SourceError(
      'E_SOURCE_AUTH_MISSING',
      'Confluence credentials missing: set ATLAS65_CONFLUENCE_EMAIL and ATLAS65_CONFLUENCE_API_TOKEN'
    )
  }
  return { baseUrl, authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` }
}

export function pageUrl(baseUrl, pageId) {
  return `${baseUrl}/wiki/api/v2/pages/${pageId}?body-format=storage`
}

export function assertPageShape(raw, expectedId) {
  const fail = (what) => {
    throw new SourceError('E_SOURCE_METADATA', `page ${expectedId}: ${what}`)
  }
  if (raw === null || typeof raw !== 'object') fail('response is not an object')
  if (String(raw.id) !== String(expectedId)) fail(`response id ${JSON.stringify(raw.id)} does not match requested id`)
  if (typeof raw.title !== 'string' || raw.title.length === 0) fail('title missing or empty')
  if (typeof raw.version?.number !== 'number' || !Number.isInteger(raw.version.number)) {
    fail('version.number missing — revision provenance cannot be established')
  }
  if (typeof raw.body?.storage?.value !== 'string') fail('body.storage.value missing')
  const parentId = raw.parentId === undefined || raw.parentId === null ? null : String(raw.parentId)
  return {
    id: String(raw.id),
    title: raw.title,
    version: raw.version.number,
    parentId,
    body: raw.body.storage.value
  }
}

export function verifySourceSet(pages, sourceSet, project) {
  const fail = (what) => {
    throw new SourceError('E_SOURCE_HIERARCHY', what)
  }
  const byId = new Map(pages.map((p) => [p.id, p]))
  const declared = sourceSet.pages
  if (byId.size !== declared.length) fail('fetched page count differs from declared source set')
  const roots = declared.filter((d) => d.expected_parent_id === null)
  if (roots.length !== 1) fail('source set must declare exactly one root')
  if (roots[0].page_id !== project.root_page_id) {
    fail(`declared root ${roots[0].page_id} is not the registered project root ${project.root_page_id}`)
  }
  for (const d of declared) {
    const live = byId.get(d.page_id)
    if (!live) fail(`declared page ${d.page_id} was not fetched`)
    if (d.expected_parent_id === null) continue
    if (!byId.has(d.expected_parent_id)) fail(`page ${d.page_id}: expected parent ${d.expected_parent_id} not in source set`)
    if (live.parentId !== d.expected_parent_id) {
      fail(`page ${d.page_id}: live parent ${JSON.stringify(live.parentId)} != declared ${d.expected_parent_id} — hierarchy drifted, refusing to materialize an unverified edge`)
    }
  }
}

export async function fetchSourceSet({ env, sourceSet, project, capturedAt, fetchImpl = fetch }) {
  const auth = requireAuth(env)
  const pages = []
  for (const d of sourceSet.pages) {
    let res
    try {
      res = await fetchImpl(pageUrl(auth.baseUrl, d.page_id), {
        headers: { authorization: auth.authorization, accept: 'application/json' }
      })
    } catch (e) {
      throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: network failure (${e.message})`)
    }
    if (!res.ok) throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: HTTP ${res.status}`)
    let raw
    try {
      raw = await res.json()
    } catch {
      throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: response is not JSON`)
    }
    pages.push(assertPageShape(raw, d.page_id))
  }
  verifySourceSet(pages, sourceSet, project)
  const sorted = [...pages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schema_version: '1.0',
    project_id: project.project_id,
    source: { source_kind: 'confluence', source_id: project.root_page_id },
    captured_at: capturedAt,
    pages: sorted.map((p) => ({
      page_id: p.id,
      title: p.title,
      version: p.version,
      parent_id: p.parentId,
      confluence_url: `${auth.baseUrl}/wiki/spaces/${project.confluence_space_key}/pages/${p.id}`,
      body_storage: p.body
    }))
  }
}
```

**Step 4: Run — expect PASS**
```bash
node --test test/atlas65-confluence-source.test.mjs
```

**Step 5: Commit**
```bash
git add src/atlas65/confluence-source.mjs test/atlas65-confluence-source.test.mjs
git commit -m "feat(ATLAS-65): fail-closed Confluence source reader with hierarchy verification"
```

---

### Task 3: fetch CLI (`scripts/atlas65/fetch-source.mjs`)

**Files:**
- Create: `scripts/atlas65/fetch-source.mjs`
- Test: extend `test/atlas65-confluence-source.test.mjs` (CLI-level negative tests, offline)

**Step 1: Failing CLI tests** (append to the test file):

```js
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const FETCH_CLI = join(repoRoot, 'scripts/atlas65/fetch-source.mjs')
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME }

test('fetch CLI: unknown project selector is denied before any network use', () => {
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'NOPE'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no project matches|E_UNKNOWN_PROJECT/)
})

test('fetch CLI: missing credentials fail closed with E_SOURCE_AUTH_MISSING', () => {
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'ATLAS'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SOURCE_AUTH_MISSING/)
})
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `scripts/atlas65/fetch-source.mjs`**

```js
#!/usr/bin/env node
// ATLAS-65 stage 1: read the declared real source set from canonical Confluence.
// Routing is resolved through the writer registry FIRST (deny by default),
// credentials are checked second, network runs last. Output is written atomically:
// either a complete verified capture exists afterwards, or nothing changed.
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { fetchSourceSet, SourceError } from '../../src/atlas65/confluence-source.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const OUT = join(repoRoot, 'out/atlas65/source-capture.json')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-fetch: ${message}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
const pIdx = args.indexOf('--project')
if (pIdx === -1 || !args[pIdx + 1]) fail('usage: fetch-source.mjs --project <project_id>', 2)
const selector = args[pIdx + 1]

let project
try {
  project = resolveProject(loadRegistry(), 'project_id', selector)
} catch (e) {
  fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
}
if (project === null) fail(`E_UNKNOWN_PROJECT: no project matches the supplied selector ${JSON.stringify(selector)}`)

const sourceSet = JSON.parse(readFileSync(join(repoRoot, 'config/atlas65-source-set.json'), 'utf8'))
if (sourceSet.project_selector.selector_value !== project.project_id) {
  fail(`E_SOURCE_SCOPE: source set is declared for ${sourceSet.project_selector.selector_value}, not ${project.project_id}`)
}

try {
  const capture = await fetchSourceSet({
    env: process.env,
    sourceSet,
    project,
    capturedAt: new Date().toISOString()
  })
  mkdirSync(dirname(OUT), { recursive: true })
  const tmp = `${OUT}.tmp`
  writeFileSync(tmp, `${JSON.stringify(capture, null, 2)}\n`)
  renameSync(tmp, OUT)
  process.stdout.write(`atlas65-fetch: captured ${capture.pages.length} pages (root ${capture.source.source_id}) -> ${OUT}\n`)
  for (const p of capture.pages) {
    process.stdout.write(`  page ${p.page_id} v${p.version} parent=${p.parent_id ?? '-'} "${p.title}"\n`)
  }
} catch (e) {
  if (e instanceof SourceError) fail(`${e.code}: ${e.message}`)
  fail(`E_INTERNAL: ${e.message}`, 2)
}
```

**Step 4: Run tests — expect PASS.** Also live smoke (needs token from Task 0):
```bash
npm run atlas65:fetch
# expect: "captured 5 pages (root 14778372)" + five "page <id> v<N> ..." lines
```

**Step 5: Commit**
```bash
git add scripts/atlas65/fetch-source.mjs test/atlas65-confluence-source.test.mjs
git commit -m "feat(ATLAS-65): registry-routed, atomic real-source fetch CLI"
```

---

### Task 4: Projection module (TDD, offline)

**Files:**
- Create: `src/atlas65/projection.mjs`
- Test: `test/atlas65-projection.test.mjs`

**Step 1: Failing tests** — `test/atlas65-projection.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProjection, ProjectionError } from '../src/atlas65/projection.mjs'

const capture = () => ({
  schema_version: '1.0',
  project_id: 'PLUMBLINE',
  source: { source_kind: 'confluence', source_id: '900000001' },
  captured_at: '2026-08-13T00:00:00.000Z',
  pages: [
    { page_id: '900000001', title: 'Root', version: 5, parent_id: null, confluence_url: 'https://x/1', body_storage: '<p>r</p>' },
    { page_id: '900000002', title: 'Child', version: 2, parent_id: '900000001', confluence_url: 'https://x/2', body_storage: '<p>c</p>' }
  ]
})

test('projection is deterministic (byte-identical on identical capture)', () => {
  assert.equal(JSON.stringify(buildProjection(capture())), JSON.stringify(buildProjection(capture())))
})

test('projection maps pages to slugs + provenance frontmatter and hierarchy links only', () => {
  const p = buildProjection(capture())
  assert.equal(p.gbrain_source_id, 'confluence-900000001')
  assert.deepEqual(p.pages.map((x) => x.slug), ['pages/900000001', 'pages/900000002'])
  const fm = p.pages[1].content
  assert.match(fm, /^---\n/)
  assert.match(fm, /confluence_page_id: "900000002"/)
  assert.match(fm, /confluence_version: 2/)
  assert.match(fm, /captured_at: "2026-08-13T00:00:00.000Z"/)
  assert.match(fm, /<p>c<\/p>/)
  assert.deepEqual(p.links, [{
    from_slug: 'pages/900000001',
    to_slug: 'pages/900000002',
    link_type: 'parent_of',
    link_source: 'confluence-hierarchy'
  }])
})

test('no relation is ever invented: parentless pages produce zero links', () => {
  const c = capture()
  c.pages[1].parent_id = null
  assert.deepEqual(buildProjection(c).links, [])
})

test('the declared root is the scope boundary: a live root parent above it is never an edge and never a failure', () => {
  // Review round 1 finding: the root page may legitimately live under the space
  // homepage; its parent lies ABOVE the pilot scope and must neither materialize
  // an edge nor hard-fail the good path.
  const c = capture()
  c.pages[0].parent_id = '900000777' // outside the capture, on the ROOT row
  const p = buildProjection(c)
  assert.deepEqual(p.links.map((l) => [l.from_slug, l.to_slug]), [['pages/900000001', 'pages/900000002']])
})

test('a NON-root page with a parent outside the capture fails closed instead of inventing an edge', () => {
  const c = capture()
  c.pages[1].parent_id = '900000099'
  assert.throws(() => buildProjection(c), (e) => e instanceof ProjectionError && e.code === 'E_PROJECTION_PARENT_UNKNOWN')
})
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `src/atlas65/projection.mjs`**

```js
// Capture -> GBrain write plan. Pure and deterministic: identical capture yields
// byte-identical pages and links. Provenance (page id, version, URL, capture time)
// travels INSIDE each page's frontmatter so a later readback can rebuild both the
// graph snapshot and the provenance sidecar from persisted state alone.
export class ProjectionError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const GBRAIN_SOURCE_ID_PATTERN = /^[a-z0-9-]{1,32}$/

function frontmatterValue(value) {
  return typeof value === 'number' ? String(value) : JSON.stringify(String(value))
}

export function pageContent(page, capture) {
  const fields = [
    ['type', 'source_page'],
    ['title', page.title],
    ['atlas_project_id', capture.project_id],
    ['confluence_page_id', page.page_id],
    ['confluence_version', page.version],
    ...(page.parent_id === null ? [] : [['confluence_parent_id', page.parent_id]]),
    ['confluence_url', page.confluence_url],
    ['captured_at', capture.captured_at]
  ]
  const fm = fields.map(([k, v]) => `${k}: ${frontmatterValue(v)}`).join('\n')
  return `---\n${fm}\n---\n\n${page.body_storage}\n`
}

export function buildProjection(capture) {
  const gbrainSourceId = `confluence-${capture.source.source_id}`
  if (!GBRAIN_SOURCE_ID_PATTERN.test(gbrainSourceId)) {
    throw new ProjectionError('E_PROJECTION_SOURCE_ID', `derived gbrain source id ${JSON.stringify(gbrainSourceId)} is not a valid gbrain source id`)
  }
  const ids = new Set(capture.pages.map((p) => p.page_id))
  const pages = [...capture.pages]
    .sort((a, b) => (a.page_id < b.page_id ? -1 : 1))
    .map((p) => ({ slug: `pages/${p.page_id}`, content: pageContent(p, capture) }))
  const links = []
  for (const p of capture.pages) {
    if (p.parent_id === null) continue
    // The declared root is the pilot's scope boundary. Its own live parent (for
    // example the space homepage) lies ABOVE that boundary: it is recorded in the
    // capture as provenance but is never materialized as an edge and never a
    // failure. Only NON-root pages must resolve their parent inside the capture.
    if (p.page_id === capture.source.source_id) continue
    if (!ids.has(p.parent_id)) {
      throw new ProjectionError('E_PROJECTION_PARENT_UNKNOWN', `page ${p.page_id} declares parent ${p.parent_id} which is not part of the verified capture`)
    }
    links.push({
      from_slug: `pages/${p.parent_id}`,
      to_slug: `pages/${p.page_id}`,
      link_type: 'parent_of',
      link_source: 'confluence-hierarchy'
    })
  }
  links.sort((a, b) => (`${a.from_slug}>${a.to_slug}` < `${b.from_slug}>${b.to_slug}` ? -1 : 1))
  return { gbrain_source_id: gbrainSourceId, pages, links }
}
```

**Step 4: Run — expect PASS. Step 5: Commit**
```bash
git add src/atlas65/projection.mjs test/atlas65-projection.test.mjs
git commit -m "feat(ATLAS-65): deterministic capture-to-gbrain projection with provenance frontmatter"
```

---

### Task 5: GBrain runner + setup script

**Files:**
- Create: `src/atlas65/gbrain-cli.mjs`
- Create: `scripts/atlas65/setup-gbrain.mjs`
- Test: `test/atlas65-gbrain-cli.test.mjs`

**Step 1: Failing tests** — `test/atlas65-gbrain-cli.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { gbrainEnv, gbrainArgs, parseBunVersion, bunVersionSatisfies } from '../src/atlas65/gbrain-cli.mjs'

test('gbrainEnv is an allowlist: DATABASE_URL can never leak into gbrain', () => {
  const env = gbrainEnv({
    brainHome: '/abs/brain',
    sourceId: 'confluence-900000001',
    processEnv: { PATH: '/usr/bin', HOME: '/Users/x', DATABASE_URL: 'postgres://evil', GBRAIN_DATABASE_URL: 'postgres://evil2' }
  })
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.GBRAIN_DATABASE_URL, undefined)
  assert.equal(env.GBRAIN_HOME, '/abs/brain')
  assert.equal(env.GBRAIN_SOURCE, 'confluence-900000001')
  assert.equal(env.GBRAIN_SKIP_STARTUP_HOOKS, '1')
})

test('gbrainArgs runs the pinned checkout CLI through bun', () => {
  assert.deepEqual(gbrainArgs(['put', 'pages/900000001']), ['run', 'src/cli.ts', 'put', 'pages/900000001'])
})

test('bun version gate', () => {
  assert.deepEqual(parseBunVersion('1.3.10'), [1, 3, 10])
  assert.equal(bunVersionSatisfies('1.3.10'), true)
  assert.equal(bunVersionSatisfies('1.4.0'), true)
  assert.equal(bunVersionSatisfies('1.2.20'), false)
})
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `src/atlas65/gbrain-cli.mjs`**

```js
// Serialized runner for the pinned GBrain CLI. Env is an explicit allowlist so a
// stray DATABASE_URL / GBRAIN_DATABASE_URL can never silently retarget the pilot
// brain to Postgres (gbrain config precedence honors those first). PGLite is
// single-writer, so every call is spawnSync — never parallel.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export class GbrainError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export const BUN_MIN = [1, 3, 10]

export function parseBunVersion(text) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  if (!m) throw new GbrainError('E_GBRAIN_RUNTIME_VERSION', `cannot parse bun version from ${JSON.stringify(text)}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function bunVersionSatisfies(text) {
  const [a, b, c] = parseBunVersion(text)
  const [x, y, z] = BUN_MIN
  return a !== x ? a > x : b !== y ? b > y : c >= z
}

export function bunBinary(processEnv = process.env) {
  const candidate = processEnv.ATLAS65_BUN_BIN || join(processEnv.HOME ?? '', '.bun/bin/bun')
  if (!existsSync(candidate)) {
    throw new GbrainError('E_GBRAIN_RUNTIME_MISSING', `bun binary not found at ${candidate} (set ATLAS65_BUN_BIN to override)`)
  }
  return candidate
}

export function gbrainEnv({ brainHome, sourceId, processEnv = process.env }) {
  const env = {
    PATH: processEnv.PATH,
    HOME: processEnv.HOME,
    GBRAIN_HOME: brainHome,
    GBRAIN_SKIP_STARTUP_HOOKS: '1'
  }
  if (sourceId) env.GBRAIN_SOURCE = sourceId
  return env
}

export function gbrainArgs(args) {
  return ['run', 'src/cli.ts', ...args]
}

export function runGbrain({ checkoutDir, brainHome, sourceId, args, input, allowFailure = false }) {
  const res = spawnSync(bunBinary(), gbrainArgs(args), {
    cwd: checkoutDir,
    env: gbrainEnv({ brainHome, sourceId }),
    input,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })
  if (res.error) throw new GbrainError('E_GBRAIN_SPAWN', res.error.message)
  if (res.status !== 0 && !allowFailure) {
    throw new GbrainError('E_GBRAIN_CLI', `gbrain ${args[0]} exited ${res.status}: ${res.stderr.slice(0, 2000)}`)
  }
  return res
}

export function callOp({ checkoutDir, brainHome, sourceId, op, payload }) {
  const res = runGbrain({ checkoutDir, brainHome, sourceId, args: ['call', op, JSON.stringify(payload)] })
  try {
    return JSON.parse(res.stdout)
  } catch {
    throw new GbrainError('E_GBRAIN_CLI', `gbrain call ${op}: output is not JSON`)
  }
}
```

**Step 4: Run tests — expect PASS.**

**Step 5: Implement `scripts/atlas65/setup-gbrain.mjs`** (pin single-sourced from the lock; fail-closed SHA verify; idempotent):

```js
#!/usr/bin/env node
// ATLAS-65: obtain and initialize the EXACT pinned GBrain locally.
// The pin comes only from third_party/upstreams.lock.json — never hardcoded.
// Checkout lives in third_party/gbrain-checkout/ (gitignored, never vendored).
// The pilot brain lives in out/atlas65/gbrain-home/ (gitignored), isolated via
// GBRAIN_HOME, initialized with --pglite --no-embedding (zero keys, zero network).
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runGbrain, bunBinary, bunVersionSatisfies, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
export const CHECKOUT = join(repoRoot, 'third_party/gbrain-checkout')
export const BRAIN_HOME = join(repoRoot, 'out/atlas65/gbrain-home')

function fail(message, code = 1) {
  process.stderr.write(`atlas65-setup: ${message}\n`)
  process.exit(code)
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts })
  if (res.error || res.status !== 0) {
    fail(`${cmd} ${args.join(' ')} failed: ${res.error?.message ?? res.stderr}`)
  }
  return res.stdout.trim()
}

const lock = JSON.parse(readFileSync(join(repoRoot, 'third_party/upstreams.lock.json'), 'utf8'))
const gbrain = lock.upstreams.find((u) => u.id === 'gbrain')
if (!gbrain?.source_commit || !gbrain?.source_url) fail('E_PIN: gbrain entry missing in upstreams.lock.json', 2)

// 1) Bun runtime gate
let bun
try {
  bun = bunBinary()
} catch (e) {
  fail(`${e.code}: ${e.message} — install bun (https://bun.sh) then re-run`)
}
const bunVersion = sh(bun, ['--version'])
if (!bunVersionSatisfies(bunVersion)) {
  fail(`E_GBRAIN_RUNTIME_VERSION: bun ${bunVersion} < required 1.3.10 — run: bun upgrade`)
}

// 2) Pinned checkout (clone once, verify SHA always)
if (!existsSync(join(CHECKOUT, '.git'))) {
  sh('git', ['clone', '--quiet', gbrain.source_url, CHECKOUT])
  sh('git', ['-C', CHECKOUT, '-c', 'advice.detachedHead=false', 'checkout', '--quiet', gbrain.source_commit])
}
const head = sh('git', ['-C', CHECKOUT, 'rev-parse', 'HEAD'])
if (head !== gbrain.source_commit) {
  fail(`E_PIN_MISMATCH: checkout HEAD ${head} != pinned ${gbrain.source_commit} — refusing to run an unpinned gbrain`)
}

// 3) Dependencies (postinstall is best-effort upstream and never fails the install)
if (!existsSync(join(CHECKOUT, 'node_modules'))) {
  sh(bun, ['install'], { cwd: CHECKOUT })
}

// 4) Brain init (idempotent; PGLite; embedding deliberately disabled for the pilot)
mkdirSync(BRAIN_HOME, { recursive: true })
const configPath = join(BRAIN_HOME, '.gbrain/config.json')
if (!existsSync(configPath)) {
  const res = runGbrain({
    checkoutDir: CHECKOUT,
    brainHome: BRAIN_HOME,
    args: ['init', '--pglite', '--no-embedding', '--json']
  })
  let parsed
  try {
    parsed = JSON.parse(res.stdout)
  } catch {
    fail(`E_GBRAIN_INIT: init output is not JSON: ${res.stdout.slice(0, 500)}`)
  }
  if (parsed.status !== 'success' || parsed.engine !== 'pglite') {
    fail(`E_GBRAIN_INIT: unexpected init result ${JSON.stringify(parsed)}`)
  }
}
if (!existsSync(configPath)) fail('E_GBRAIN_INIT: config.json missing after init')

process.stdout.write(
  `atlas65-setup: OK\n` +
  `  gbrain pin      ${gbrain.version} @ ${head}\n` +
  `  bun             ${bunVersion}\n` +
  `  checkout        ${CHECKOUT}\n` +
  `  brain (PGLite)  ${BRAIN_HOME}/.gbrain/brain.pglite\n`
)
```

> Note: `try { fail() } finally` style is deliberately absent — `fail()` exits. Keep the `export const CHECKOUT/BRAIN_HOME` lines: import/snapshot scripts import them so the paths exist in exactly one place. (Importing this script from another module would execute it; therefore Tasks 6–7 import paths from a tiny shared module instead — see Step 6.)

**Step 6: Extract shared paths** — because `setup-gbrain.mjs` runs on import, move the constants into `src/atlas65/paths.mjs` and import from both sides:

```js
// src/atlas65/paths.mjs
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
export const GBRAIN_CHECKOUT = join(repoRoot, 'third_party/gbrain-checkout')
export const BRAIN_HOME = join(repoRoot, 'out/atlas65/gbrain-home')
export const OUT_DIR = join(repoRoot, 'out/atlas65')
export const CAPTURE_PATH = join(OUT_DIR, 'source-capture.json')
export const RECEIPT_PATH = join(OUT_DIR, 'import-receipt.json')
export const SNAPSHOT_PATH = join(OUT_DIR, 'graph-snapshot.json')
export const PROVENANCE_PATH = join(OUT_DIR, 'provenance.json')
export const REQUEST_PATH = join(OUT_DIR, 'read-request.json')
export const CONTRACT_RESPONSE_PATH = join(OUT_DIR, 'contract-response.json')
```
Refactor `setup-gbrain.mjs` to import `GBRAIN_CHECKOUT`/`BRAIN_HOME` from it (drop its own exports).

**Step 7: Manual smoke of the full runtime path** (first real gbrain execution — treat failure as STOP condition 3):

```bash
node scripts/atlas65/setup-gbrain.mjs
# expect: "atlas65-setup: OK", pin v0.42.73.2 @ 15b9863d…, bun >= 1.3.10
```

**Step 8: Run all tests + commit**
```bash
node --test test/atlas65-gbrain-cli.test.mjs
git add src/atlas65/gbrain-cli.mjs src/atlas65/paths.mjs scripts/atlas65/setup-gbrain.mjs test/atlas65-gbrain-cli.test.mjs
git commit -m "feat(ATLAS-65): pinned gbrain setup with SHA gate and allowlisted runner env"
```

---

### Task 6: Import script (real persistence write path)

**Files:**
- Create: `scripts/atlas65/import-to-gbrain.mjs`
- Test: `test/atlas65-import.test.mjs` (offline negatives only)

**Step 1: Failing tests** — `test/atlas65-import.test.mjs`:

```js
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
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `scripts/atlas65/import-to-gbrain.mjs`**

```js
#!/usr/bin/env node
// ATLAS-65 stage 2: project the verified capture into the pinned local GBrain.
// This is the ONLY writer. Scope is fail-closed: registry-resolved project must
// match the capture's project AND registered root. Pages are written before
// links (gbrain refuses links whose endpoints do not exist). Every gbrain call
// is serialized (PGLite single-writer).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { buildProjection, ProjectionError } from '../../src/atlas65/projection.mjs'
import { runGbrain, callOp, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'
import { GBRAIN_CHECKOUT, BRAIN_HOME, CAPTURE_PATH, RECEIPT_PATH, OUT_DIR, repoRoot } from '../../src/atlas65/paths.mjs'
import { spawnSync } from 'node:child_process'

function fail(message, code = 1) {
  process.stderr.write(`atlas65-import: ${message}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
const argValue = (flag) => {
  const i = args.indexOf(flag)
  return i === -1 ? null : args[i + 1] ?? null
}
const selector = argValue('--project')
if (!selector) fail('usage: import-to-gbrain.mjs --project <project_id> [--capture <path>]', 2)
const capturePath = argValue('--capture') ?? CAPTURE_PATH

let project
try {
  project = resolveProject(loadRegistry(), 'project_id', selector)
} catch (e) {
  fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
}
if (project === null) fail(`E_UNKNOWN_PROJECT: no project matches ${JSON.stringify(selector)}`)

let capture
try {
  capture = JSON.parse(readFileSync(capturePath, 'utf8'))
} catch {
  fail(`E_CAPTURE_UNREADABLE: cannot read capture at ${capturePath} — run atlas65:fetch first; there is no fixture fallback`)
}
if (capture.project_id !== project.project_id || capture.source?.source_id !== project.root_page_id) {
  fail(`E_SCOPE: capture is scoped to ${capture.project_id}/${capture.source?.source_id}, resolved project is ${project.project_id}/${project.root_page_id}`)
}
if (!existsSync(join(BRAIN_HOME, '.gbrain/config.json'))) {
  fail('E_PERSISTENCE_UNAVAILABLE: pilot brain not initialized — run atlas65:setup first')
}

let projection
try {
  projection = buildProjection(capture)
} catch (e) {
  fail(`${e instanceof ProjectionError ? e.code : 'E_INTERNAL'}: ${e.message}`)
}

const gb = { checkoutDir: GBRAIN_CHECKOUT, brainHome: BRAIN_HOME, sourceId: projection.gbrain_source_id }

try {
  // 1) source registration (idempotent)
  const sources = callOp({ ...gb, op: 'sources_list', payload: {} })
  const ids = JSON.stringify(sources)
  if (!ids.includes(`"${projection.gbrain_source_id}"`)) {
    callOp({ ...gb, op: 'sources_add', payload: { id: projection.gbrain_source_id, name: `ATLAS-65 Confluence ${capture.source.source_id}` } })
  }

  // 2) pages first
  const pageResults = []
  for (const page of projection.pages) {
    const res = runGbrain({ ...gb, args: ['put', page.slug], input: page.content })
    let parsed = null
    try { parsed = JSON.parse(res.stdout) } catch { /* older formats print text; exit 0 is the gate */ }
    pageResults.push({ slug: page.slug, status: parsed?.status ?? 'ok', chunks: parsed?.chunks ?? null })
  }

  // 3) links second (both endpoints now exist)
  const linkResults = []
  for (const link of projection.links) {
    runGbrain({ ...gb, args: ['link', link.from_slug, link.to_slug, '--link-type', link.link_type, '--link-source', link.link_source] })
    linkResults.push({ ...link, status: 'ok' })
  }

  const head = spawnSync('git', ['-C', GBRAIN_CHECKOUT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  mkdirSync(OUT_DIR, { recursive: true })
  const receipt = {
    schema_version: '1.0',
    imported_at: new Date().toISOString(),
    project_id: project.project_id,
    gbrain_checkout_commit: head,
    brain_home: BRAIN_HOME,
    gbrain_source_id: projection.gbrain_source_id,
    pages: pageResults,
    links: linkResults
  }
  writeFileSync(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
  process.stdout.write(`atlas65-import: wrote ${pageResults.length} pages, ${linkResults.length} links into pinned gbrain (${head.slice(0, 12)}) -> ${RECEIPT_PATH}\n`)
} catch (e) {
  if (e instanceof GbrainError) fail(`${e.code}: ${e.message}`)
  fail(`E_INTERNAL: ${e.message}`, 2)
}
```

**Step 4: Run tests — expect PASS. Then live run (needs Task 0 token + Tasks 3/5 artifacts):**
```bash
npm run atlas65:fetch && npm run atlas65:import
# expect: "wrote 5 pages, 4 links into pinned gbrain (15b9863d1363) -> …/import-receipt.json"
ls out/atlas65/gbrain-home/.gbrain/brain.pglite   # expect: PGLite data directory exists, non-empty
```

**Step 5: Commit**
```bash
git add scripts/atlas65/import-to-gbrain.mjs test/atlas65-import.test.mjs
git commit -m "feat(ATLAS-65): scope-gated real import into pinned local gbrain persistence"
```

---

### Task 7: Snapshot module + readback-only generator (TDD)

**Files:**
- Create: `src/atlas65/snapshot.mjs`
- Create: `scripts/atlas65/generate-snapshot.mjs`
- Test: `test/atlas65-snapshot.test.mjs`

**Step 1: Failing tests** — `test/atlas65-snapshot.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSnapshotFromReadback, SnapshotError } from '../src/atlas65/snapshot.mjs'
import { validateSnapshot, validateScope } from '../src/gbrain-read-contract/validate.mjs'
import { loadRegistry, resolveProject } from '../src/registry/resolve.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const project = resolveProject(loadRegistry(), 'project_id', 'PLUMBLINE')

const readback = () => ({
  pages: [
    {
      slug: 'pages/900000001', title: 'Synthetic root',
      frontmatter: { confluence_page_id: '900000001', confluence_version: 5, confluence_url: 'https://x/1', captured_at: 'T' }
    },
    {
      slug: 'pages/900000002', title: 'Synthetic child A',
      frontmatter: { confluence_page_id: '900000002', confluence_version: 2, confluence_url: 'https://x/2', captured_at: 'T' }
    }
  ],
  links: [
    { from_slug: 'pages/900000001', to_slug: 'pages/900000002', link_type: 'parent_of', link_source: 'confluence-hierarchy' }
  ]
})

test('builder produces a contract-valid, scope-valid snapshot from persisted readback', () => {
  const { snapshot, provenance } = buildSnapshotFromReadback({ project, readback: readback() })
  assert.deepEqual(validateSnapshot(snapshot), [])
  assert.deepEqual(validateScope(project, snapshot), [])
  assert.equal(snapshot.id_scheme, 'projection-local/v1')
  assert.equal(snapshot.canonical_entity_ids, false)
  assert.deepEqual(snapshot.nodes.map((n) => n.node_id), [
    'PLUMBLINE:confluence:7503873:900000001',
    'PLUMBLINE:confluence:7503873:900000002'
  ])
  assert.deepEqual(snapshot.edges.map((e) => e.edge_id), [
    'PLUMBLINE:confluence:7503873:parent_of:900000001:900000002'
  ])
  assert.deepEqual(provenance.pages.map((p) => [p.page_id, p.version]), [['900000001', 5], ['900000002', 2]])
})

test('builder is deterministic (byte-identical)', () => {
  const a = buildSnapshotFromReadback({ project, readback: readback() })
  const b = buildSnapshotFromReadback({ project, readback: readback() })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('foreign link provenance is excluded — only verified hierarchy edges materialize', () => {
  const r = readback()
  r.links.push({ from_slug: 'pages/900000001', to_slug: 'pages/900000002', link_type: 'mentions', link_source: 'markdown' })
  const { snapshot } = buildSnapshotFromReadback({ project, readback: r })
  assert.equal(snapshot.edges.length, 1)
})

test('a hierarchy link with an endpoint outside the persisted page set fails closed', () => {
  const r = readback()
  r.links.push({ from_slug: 'pages/900000001', to_slug: 'pages/900000009', link_type: 'parent_of', link_source: 'confluence-hierarchy' })
  assert.throws(() => buildSnapshotFromReadback({ project, readback: r }),
    (e) => e instanceof SnapshotError && e.code === 'E_READBACK_DANGLING')
})

test('empty persisted state fails closed — no fixture substitution', () => {
  assert.throws(() => buildSnapshotFromReadback({ project, readback: { pages: [], links: [] } }),
    (e) => e instanceof SnapshotError && e.code === 'E_PERSISTENCE_EMPTY')
})

test('page whose frontmatter lost its provenance fails closed', () => {
  const r = readback()
  delete r.pages[1].frontmatter.confluence_version
  assert.throws(() => buildSnapshotFromReadback({ project, readback: r }),
    (e) => e instanceof SnapshotError && e.code === 'E_READBACK_PROVENANCE')
})

test('structural guard: the readback path can never re-import (no fetch, no confluence module)', () => {
  for (const file of ['src/atlas65/snapshot.mjs', 'scripts/atlas65/generate-snapshot.mjs']) {
    const src = readFileSync(join(repoRoot, file), 'utf8')
    assert.ok(!src.includes('confluence-source'), `${file} must not import the source reader`)
    assert.ok(!/\bfetch\s*\(/.test(src), `${file} must not perform network fetches`)
  }
})
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `src/atlas65/snapshot.mjs`**

```js
// Persisted-readback -> gbrain-read/v1 snapshot + provenance sidecar.
// Pure and deterministic. Consumes ONLY what came back out of the persisted
// brain; it cannot fetch and it cannot import (enforced by a structural test).
// Only live-verified hierarchy links (link_type=parent_of AND
// link_source=confluence-hierarchy) become edges; anything else the brain may
// have auto-derived is deliberately excluded rather than presented as a
// source-backed relation. The sidecar is display metadata keyed by source_ref —
// it is NOT a second graph model and NOT part of the gbrain-read/v1 contract.
import { composeNodeId, composeEdgeId, validateSnapshot, validateScope, sortErrors } from '../gbrain-read-contract/validate.mjs'

export class SnapshotError extends Error {
  constructor(code, message, errors = []) {
    super(message)
    this.code = code
    this.errors = errors
  }
}

const SOURCE_KIND = 'confluence'
const EDGE_LINK_TYPE = 'parent_of'
const EDGE_LINK_SOURCE = 'confluence-hierarchy'
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function buildSnapshotFromReadback({ project, readback }) {
  if (!Array.isArray(readback.pages) || readback.pages.length === 0) {
    throw new SnapshotError('E_PERSISTENCE_EMPTY', 'persisted gbrain state contains no pilot pages — run atlas65:import; there is no fixture substitution')
  }
  const refBySlug = new Map()
  const provenancePages = []
  for (const page of readback.pages) {
    const fm = page.frontmatter ?? {}
    const ref = fm.confluence_page_id
    if (typeof ref !== 'string' || !page.slug?.endsWith(`/${ref}`) ||
        typeof fm.confluence_version !== 'number' ||
        typeof fm.confluence_url !== 'string' || typeof fm.captured_at !== 'string') {
      throw new SnapshotError('E_READBACK_PROVENANCE', `persisted page ${page.slug}: provenance frontmatter incomplete or inconsistent`)
    }
    if (typeof page.title !== 'string' || page.title.length === 0) {
      throw new SnapshotError('E_READBACK_PROVENANCE', `persisted page ${page.slug}: title missing`)
    }
    refBySlug.set(page.slug, ref)
    provenancePages.push({
      page_id: ref,
      title: page.title,
      version: fm.confluence_version,
      confluence_url: fm.confluence_url,
      captured_at: fm.captured_at,
      gbrain_slug: page.slug
    })
  }

  const nodes = readback.pages
    .map((page) => ({
      node_id: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, refBySlug.get(page.slug)),
      source_ref: refBySlug.get(page.slug),
      label: page.title
    }))
    .sort((a, b) => byCodeUnit(a.node_id, b.node_id))

  const edges = []
  const seen = new Set()
  for (const link of readback.links ?? []) {
    if (link.link_type !== EDGE_LINK_TYPE || link.link_source !== EDGE_LINK_SOURCE) continue
    const fromRef = refBySlug.get(link.from_slug)
    const toRef = refBySlug.get(link.to_slug)
    if (fromRef === undefined || toRef === undefined) {
      throw new SnapshotError('E_READBACK_DANGLING', `persisted hierarchy link ${link.from_slug} -> ${link.to_slug} references a page outside the persisted pilot set`)
    }
    const edge_id = composeEdgeId(project.project_id, SOURCE_KIND, project.root_page_id, EDGE_LINK_TYPE, fromRef, toRef)
    if (seen.has(edge_id)) continue
    seen.add(edge_id)
    edges.push({
      edge_id,
      from: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, fromRef),
      to: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, toRef),
      relation_type: EDGE_LINK_TYPE,
      origin: 'explicit'
    })
  }
  edges.sort((a, b) => byCodeUnit(a.edge_id, b.edge_id))

  const snapshot = {
    contract_version: '1.0.0',
    project_id: project.project_id,
    id_scheme: 'projection-local/v1',
    canonical_entity_ids: false,
    source: { source_kind: SOURCE_KIND, source_id: project.root_page_id },
    nodes,
    edges
  }
  const provenance = {
    schema_version: '1.0',
    generated_from: 'gbrain-readback',
    project_id: project.project_id,
    source: { source_kind: SOURCE_KIND, source_id: project.root_page_id },
    pages: provenancePages.sort((a, b) => byCodeUnit(a.page_id, b.page_id))
  }
  return { snapshot, provenance }
}

export function validateOrThrow(snapshot, project) {
  const errors = sortErrors([...validateSnapshot(snapshot), ...validateScope(project, snapshot)])
  if (errors.length > 0) {
    throw new SnapshotError('E_SNAPSHOT_INVALID', `generated snapshot violates gbrain-read/v1 (${errors.length} findings)`, errors)
  }
}
```

**Step 4: Implement `scripts/atlas65/generate-snapshot.mjs`**

```js
#!/usr/bin/env node
// ATLAS-65 stage 3: READBACK ONLY. Reopens the persisted pinned-gbrain state in a
// fresh process and materializes the gbrain-read/v1 snapshot + provenance sidecar
// from it. It cannot fetch Confluence and cannot import (structural test enforces
// this): if the brain is missing or empty this stage fails — it never rebuilds.
// Defense in depth: after the in-process validation, the existing contract CLI
// (src/gbrain-read-contract/cli.mjs) must also accept request+snapshot (exit 0).
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadRegistry, resolveProject, RegistryError } from '../../src/registry/resolve.mjs'
import { buildSnapshotFromReadback, validateOrThrow, SnapshotError } from '../../src/atlas65/snapshot.mjs'
import { callOp, GbrainError } from '../../src/atlas65/gbrain-cli.mjs'
import {
  GBRAIN_CHECKOUT, BRAIN_HOME, OUT_DIR,
  SNAPSHOT_PATH, PROVENANCE_PATH, REQUEST_PATH, CONTRACT_RESPONSE_PATH, repoRoot
} from '../../src/atlas65/paths.mjs'

function fail(message, code = 1) {
  process.stderr.write(`atlas65-snapshot: ${message}\n`)
  process.exit(code)
}

const args = process.argv.slice(2)
const pIdx = args.indexOf('--project')
if (pIdx === -1 || !args[pIdx + 1]) fail('usage: generate-snapshot.mjs --project <project_id>', 2)
const selector = args[pIdx + 1]

let project
try {
  project = resolveProject(loadRegistry(), 'project_id', selector)
} catch (e) {
  fail(`${e instanceof RegistryError ? e.code : 'E_INTERNAL'}: ${e.message}`, 2)
}
if (project === null) fail(`E_UNKNOWN_PROJECT: no project matches ${JSON.stringify(selector)}`)

if (!existsSync(join(BRAIN_HOME, '.gbrain/config.json')) || !existsSync(join(BRAIN_HOME, '.gbrain/brain.pglite'))) {
  fail('E_PERSISTENCE_UNAVAILABLE: no persisted pilot brain found — this stage reads persisted state only and never re-imports')
}

const gbrainSourceId = `confluence-${project.root_page_id}`
const gb = { checkoutDir: GBRAIN_CHECKOUT, brainHome: BRAIN_HOME, sourceId: gbrainSourceId }

let readback
try {
  const listed = callOp({ ...gb, op: 'list_pages', payload: { limit: 500 } })
  const pageRows = (Array.isArray(listed) ? listed : listed.pages ?? []).filter((p) => (p.slug ?? '').startsWith('pages/'))
  const pages = []
  const links = []
  const linkKeys = new Set()
  for (const row of pageRows) {
    const page = callOp({ ...gb, op: 'get_page', payload: { slug: row.slug } })
    pages.push({ slug: page.slug ?? row.slug, title: page.title, frontmatter: page.frontmatter ?? {} })
    const linkResult = callOp({ ...gb, op: 'get_links', payload: { slug: row.slug } })
    for (const l of (Array.isArray(linkResult) ? linkResult : linkResult.links ?? [])) {
      const entry = {
        from_slug: l.from_slug ?? l.from, to_slug: l.to_slug ?? l.to,
        link_type: l.link_type, link_source: l.link_source
      }
      const key = JSON.stringify(entry)
      if (!linkKeys.has(key)) { linkKeys.add(key); links.push(entry) }
    }
  }
  readback = { pages, links }
} catch (e) {
  if (e instanceof GbrainError) fail(`${e.code}: ${e.message}`)
  fail(`E_INTERNAL: ${e.message}`, 2)
}

try {
  const { snapshot, provenance } = buildSnapshotFromReadback({ project, readback })
  validateOrThrow(snapshot, project)

  mkdirSync(OUT_DIR, { recursive: true })
  const request = {
    contract_version: '1.0.0',
    request_id: 'atlas65-local-e2e',
    project: { selector_kind: 'project_id', selector_value: project.project_id },
    operation: 'read_graph'
  }
  writeFileSync(REQUEST_PATH, `${JSON.stringify(request, null, 2)}\n`)
  const tmpSnapshot = `${SNAPSHOT_PATH}.tmp`
  writeFileSync(tmpSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`)

  const check = spawnSync(process.execPath, [join(repoRoot, 'src/gbrain-read-contract/cli.mjs'), REQUEST_PATH, tmpSnapshot], { encoding: 'utf8' })
  writeFileSync(CONTRACT_RESPONSE_PATH, check.stdout)
  if (check.status !== 0) fail(`E_SNAPSHOT_INVALID: contract CLI rejected the generated snapshot (exit ${check.status}) — see ${CONTRACT_RESPONSE_PATH}`)

  renameSync(tmpSnapshot, SNAPSHOT_PATH)
  writeFileSync(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`)
  process.stdout.write(`atlas65-snapshot: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges from persisted state -> ${SNAPSHOT_PATH}\n`)
} catch (e) {
  if (e instanceof SnapshotError) {
    fail(`${e.code}: ${e.message}${e.errors.length ? `\n${JSON.stringify(e.errors, null, 2)}` : ''}`)
  }
  fail(`E_INTERNAL: ${e.message}`, 2)
}
```

> Readback shape caution: `call get_page` / `call list_pages` / `call get_links` result field names must be confirmed against the *actual* pinned CLI output during the first live run (Step 6). The defensive `?? `-fallbacks above cover the two known shapes; if reality differs, adapt the extraction — never the contract, never the builder's fail-closed rules. The `get_links` rows expose `from_slug/to_slug/link_type/link_source` (verified in gbrain source `pglite-engine.ts getLinks`).

**Step 5: Run tests — expect PASS:**
```bash
node --test test/atlas65-snapshot.test.mjs
```

**Step 6: Live readback proof (fresh process, no reimport):**
```bash
npm run atlas65:snapshot
# expect: "atlas65-snapshot: 5 nodes, 4 edges from persisted state -> …/graph-snapshot.json"
node src/gbrain-read-contract/cli.mjs out/atlas65/read-request.json out/atlas65/graph-snapshot.json
# expect: {"contract_version":"1.0.0","valid":true,"project_id":"ATLAS","errors":[]} + exit 0
```

**Step 7: Commit**
```bash
git add src/atlas65/snapshot.mjs scripts/atlas65/generate-snapshot.mjs test/atlas65-snapshot.test.mjs
git commit -m "feat(ATLAS-65): readback-only gbrain-read/v1 snapshot generator with provenance sidecar"
```

---

### Task 8: Validate-then-serve server + minimal viewer

**Files:**
- Create: `scripts/atlas65/serve.mjs`
- Create: `viewer/atlas65/index.html`
- Test: `test/atlas65-serve.test.mjs`

**Step 1: Failing tests** — `test/atlas65-serve.test.mjs`:

```js
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
    schema_version: '1.0', generated_from: 'gbrain-readback', project_id: 'PLUMBLINE',
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
```

**Step 2: Run — expect FAIL.**

**Step 3: Implement `scripts/atlas65/serve.mjs`**

```js
#!/usr/bin/env node
// ATLAS-65 stage 4: validate-then-serve. The browser can only ever receive the
// exact bytes of a snapshot that the existing gbrain-read/v1 contract CLI has
// just accepted: validation runs at startup (invalid -> refuse to start) AND on
// every /graph-snapshot.json request (invalid -> 503). Localhost only.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { OUT_DIR, repoRoot } from '../../src/atlas65/paths.mjs'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i === -1 ? fallback : args[i + 1]
}
const dir = argValue('--dir', OUT_DIR)
const port = Number(argValue('--port', '4365'))
const CONTRACT_CLI = join(repoRoot, 'src/gbrain-read-contract/cli.mjs')
const VIEWER = join(repoRoot, 'viewer/atlas65/index.html')

function validate() {
  const request = join(dir, 'read-request.json')
  const snapshot = join(dir, 'graph-snapshot.json')
  if (!existsSync(request) || !existsSync(snapshot)) return { ok: false, why: 'snapshot or request missing' }
  const res = spawnSync(process.execPath, [CONTRACT_CLI, request, snapshot], { encoding: 'utf8' })
  return res.status === 0 ? { ok: true } : { ok: false, why: `contract CLI exit ${res.status}` }
}

const startup = validate()
if (!startup.ok) {
  process.stderr.write(`atlas65-serve: E_SNAPSHOT_INVALID: refusing to serve (${startup.why})\n`)
  process.exit(1)
}

const server = createServer((req, res) => {
  const url = req.url?.split('?')[0]
  if (url === '/' ) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(readFileSync(VIEWER))
    return
  }
  if (url === '/graph-snapshot.json') {
    const check = validate()
    if (!check.ok) {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'E_SNAPSHOT_INVALID', detail: check.why }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(readFileSync(join(dir, 'graph-snapshot.json')))
    return
  }
  if (url === '/provenance.json') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(readFileSync(join(dir, 'provenance.json')))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`atlas65-serve: listening on http://127.0.0.1:${port}/ (dir ${dir})\n`)
})
```

**Step 4: Implement `viewer/atlas65/index.html`** — complete file:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ATLAS-65 — Real Semantic Atlas (pilot)</title>
<style>
  :root { --bg:#10141a; --panel:#1a2028; --line:#3a4250; --text:#e8ecf1; --dim:#8a93a0; --accent:#5aa9e6; --focus:#ffd166; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui, sans-serif; display:flex; height:100vh; }
  #graph { flex:1; }
  #panel { width:340px; background:var(--panel); border-left:1px solid var(--line); padding:16px; overflow-y:auto; }
  h1 { font-size:15px; margin:0 0 4px; }
  .dim { color:var(--dim); font-size:12px; }
  .err { background:#5c1f24; color:#ffd7d7; padding:12px; margin:16px; border-radius:6px; font-weight:600; }
  line.edge { stroke:var(--line); stroke-width:1.5; }
  line.edge.hl { stroke:var(--accent); stroke-width:2.5; }
  circle.node { fill:#2d3644; stroke:var(--accent); stroke-width:1.5; cursor:pointer; }
  circle.node.focus { stroke:var(--focus); stroke-width:3; fill:#3a4658; }
  circle.node.neighbour { stroke:var(--accent); stroke-width:3; }
  circle.node.dimmed { opacity:.3; }
  text.label { fill:var(--text); font-size:11px; text-anchor:middle; pointer-events:none; }
  text.label.dimmed { opacity:.3; }
  dt { color:var(--dim); font-size:11px; text-transform:uppercase; margin-top:10px; }
  dd { margin:2px 0 0; word-break:break-all; }
  .nb { display:block; color:var(--accent); cursor:pointer; text-decoration:underline; }
  a { color:var(--accent); }
  footer { margin-top:24px; font-size:11px; color:var(--dim); border-top:1px solid var(--line); padding-top:8px; }
</style>
</head>
<body>
<svg id="graph" xmlns="http://www.w3.org/2000/svg"></svg>
<aside id="panel">
  <h1>ATLAS-65 — Real Semantic Atlas (pilot)</h1>
  <div class="dim" id="meta">loading…</div>
  <div id="detail"><p class="dim">Click a node to focus it.</p></div>
  <footer id="foot"></footer>
</aside>
<script>
(async function () {
  const panel = document.getElementById('detail')
  const meta = document.getElementById('meta')
  const foot = document.getElementById('foot')
  const svg = document.getElementById('graph')

  let snapshot, provenance
  try {
    const s = await fetch('/graph-snapshot.json')
    if (!s.ok) throw new Error('snapshot endpoint returned ' + s.status)
    snapshot = await s.json()
    const p = await fetch('/provenance.json')
    provenance = p.ok ? await p.json() : { pages: [] }
  } catch (e) {
    document.body.innerHTML = '<div class="err">Snapshot invalid or unavailable — refusing to render (' + e.message + ')</div>'
    return
  }

  meta.textContent = snapshot.nodes.length + ' nodes / ' + snapshot.edges.length + ' edges — project ' + snapshot.project_id + ', confluence root ' + snapshot.source.source_id
  foot.textContent = 'id_scheme ' + snapshot.id_scheme + ' — projection-local identifiers, NOT canonical entity IDs (canonical_entity_ids=' + snapshot.canonical_entity_ids + ')'

  const W = svg.clientWidth || 800, H = svg.clientHeight || 600
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 90
  const pos = new Map()
  snapshot.nodes.forEach((n, i) => {
    const a = (2 * Math.PI * i) / snapshot.nodes.length - Math.PI / 2
    pos.set(n.node_id, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  })

  const NS = 'http://www.w3.org/2000/svg'
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
    return e
  }
  const edgeEls = snapshot.edges.map((e) => {
    const a = pos.get(e.from), b = pos.get(e.to)
    const line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'edge' })
    svg.appendChild(line)
    return { e, line }
  })
  const nodeEls = snapshot.nodes.map((n) => {
    const p = pos.get(n.node_id)
    const c = el('circle', { cx: p.x, cy: p.y, r: 22, class: 'node' })
    const t = el('text', { x: p.x, y: p.y + 40, class: 'label' })
    t.textContent = n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label
    svg.appendChild(c); svg.appendChild(t)
    c.addEventListener('click', () => focus(n.node_id))
    return { n, c, t }
  })

  function neighboursOf(id) {
    const out = new Set()
    for (const e of snapshot.edges) {
      if (e.from === id) out.add(e.to)
      if (e.to === id) out.add(e.from)
    }
    return out
  }

  function focus(id) {
    const nbs = neighboursOf(id)
    for (const { n, c, t } of nodeEls) {
      c.setAttribute('class', 'node' + (n.node_id === id ? ' focus' : nbs.has(n.node_id) ? ' neighbour' : ' dimmed'))
      t.setAttribute('class', 'label' + (n.node_id === id || nbs.has(n.node_id) ? '' : ' dimmed'))
    }
    for (const { e, line } of edgeEls) {
      line.setAttribute('class', 'edge' + (e.from === id || e.to === id ? ' hl' : ''))
    }
    const node = snapshot.nodes.find((n) => n.node_id === id)
    const prov = (provenance.pages || []).find((p) => p.page_id === node.source_ref)
    const nbNodes = snapshot.nodes.filter((n) => nbs.has(n.node_id))
    panel.innerHTML = ''
    const dl = document.createElement('dl')
    const row = (k, v, html) => {
      const dt = document.createElement('dt'); dt.textContent = k
      const dd = document.createElement('dd')
      if (html) dd.appendChild(html); else dd.textContent = v
      dl.appendChild(dt); dl.appendChild(dd)
    }
    row('Label', node.label)
    row('Confluence Page ID (source_ref)', node.source_ref)
    if (prov) {
      row('Revision / version', 'v' + prov.version)
      row('Captured at', prov.captured_at)
      const a = document.createElement('a'); a.href = prov.confluence_url; a.target = '_blank'; a.rel = 'noreferrer'
      a.textContent = prov.confluence_url
      row('Source', null, a)
    } else {
      row('Provenance', 'unavailable in sidecar — not fabricated')
    }
    row('node_id (projection-local)', node.node_id)
    const nbWrap = document.createElement('div')
    if (nbNodes.length === 0) nbWrap.textContent = 'none'
    for (const nb of nbNodes) {
      const s = document.createElement('span'); s.className = 'nb'; s.textContent = nb.label
      s.addEventListener('click', () => focus(nb.node_id)); nbWrap.appendChild(s)
    }
    row('Direct neighbours (' + nbNodes.length + ')', null, nbWrap)
    panel.appendChild(dl)
  }
})()
</script>
</body>
</html>
```

**Step 5: Run tests — expect PASS:**
```bash
node --test test/atlas65-serve.test.mjs
```

**Step 6: Live browser check** (uses the real snapshot from Task 7):
```bash
npm run atlas65:serve
# open http://127.0.0.1:4365/
```
Verify by hand (and via browser automation screenshot if available): 5 real nodes render with titles; clicking "ATLAS Single Source of Truth" highlights 3 neighbours; panel shows Page-ID 14778372, `v<N>`, captured_at, Confluence link; footer states projection-local IDs.

**Step 7: Commit**
```bash
git add scripts/atlas65/serve.mjs viewer/atlas65/index.html test/atlas65-serve.test.mjs
git commit -m "feat(ATLAS-65): validate-then-serve server and minimal provenance-aware graph viewer"
```

---

### Task 9: E2E orchestrator + evidence copy

**Files:**
- Create: `scripts/atlas65/e2e.mjs`

**Step 1: Implement `scripts/atlas65/e2e.mjs`**

```js
#!/usr/bin/env node
// ATLAS-65 deterministic local E2E: setup -> fetch -> import -> READBACK-IN-A-
// STRIPPED-PROCESS -> assertions -> evidence copy.
// Stage separation is the persistence proof: generate-snapshot runs as a child
// process whose env deliberately lacks the Confluence credentials, so it is
// physically incapable of re-fetching; it can only read persisted gbrain state.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import {
  repoRoot, CAPTURE_PATH, RECEIPT_PATH, SNAPSHOT_PATH, PROVENANCE_PATH, CONTRACT_RESPONSE_PATH
} from '../../src/atlas65/paths.mjs'

const args = process.argv.slice(2)
const pIdx = args.indexOf('--project')
const selector = pIdx === -1 ? null : args[pIdx + 1]
if (!selector) {
  process.stderr.write('usage: e2e.mjs --project <project_id>\n')
  process.exit(2)
}

function stage(name, script, extraArgs, env) {
  process.stdout.write(`\n=== atlas65-e2e: ${name} ===\n`)
  const res = spawnSync(process.execPath, [join(repoRoot, script), ...extraArgs], {
    stdio: 'inherit',
    env
  })
  if (res.status !== 0) {
    process.stderr.write(`atlas65-e2e: stage "${name}" failed (exit ${res.status})\n`)
    process.exit(1)
  }
}

stage('setup (pinned gbrain + PGLite brain)', 'scripts/atlas65/setup-gbrain.mjs', [], process.env)
stage('fetch (real Confluence source)', 'scripts/atlas65/fetch-source.mjs', ['--project', selector], process.env)
stage('import (write persistence)', 'scripts/atlas65/import-to-gbrain.mjs', ['--project', selector], process.env)

// Readback in a credential-stripped environment: re-import is impossible here.
const stripped = { PATH: process.env.PATH, HOME: process.env.HOME }
stage('snapshot (readback WITHOUT source credentials)', 'scripts/atlas65/generate-snapshot.mjs', ['--project', selector], stripped)

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'))
if (snapshot.nodes.length < 2 || snapshot.edges.length < 1) {
  process.stderr.write(`atlas65-e2e: E_GRAPH_TOO_SMALL: ${snapshot.nodes.length} nodes / ${snapshot.edges.length} edges — the source set carries no defensible relation; select a different real source set, never invent an edge\n`)
  process.exit(1)
}

// Evidence copy (committed): capture WITHOUT page bodies (bodies -> sha256).
const evidenceDir = join(repoRoot, 'docs/evidence/atlas-65')
mkdirSync(evidenceDir, { recursive: true })
const capture = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8'))
const evidenceCapture = {
  ...capture,
  pages: capture.pages.map(({ body_storage, ...rest }) => ({
    ...rest,
    body_storage_sha256: createHash('sha256').update(body_storage).digest('hex'),
    body_storage_length: body_storage.length
  }))
}
writeFileSync(join(evidenceDir, 'source-capture-evidence.json'), `${JSON.stringify(evidenceCapture, null, 2)}\n`)
copyFileSync(RECEIPT_PATH, join(evidenceDir, 'import-receipt.json'))
copyFileSync(SNAPSHOT_PATH, join(evidenceDir, 'graph-snapshot.json'))
copyFileSync(PROVENANCE_PATH, join(evidenceDir, 'provenance.json'))
copyFileSync(CONTRACT_RESPONSE_PATH, join(evidenceDir, 'contract-response.json'))

process.stdout.write(
  `\natlas65-e2e: SUCCESS\n` +
  `  nodes ${snapshot.nodes.length} / edges ${snapshot.edges.length} (project ${snapshot.project_id}, root ${snapshot.source.source_id})\n` +
  `  pages: ${capture.pages.map((p) => `${p.page_id}@v${p.version}`).join(', ')}\n` +
  `  evidence -> ${evidenceDir}\n` +
  `  view: npm run atlas65:serve  ->  http://127.0.0.1:4365/\n`
)
```

**Step 2: Full live run**

```bash
npm run atlas65:e2e
# expect: four stage banners, then "atlas65-e2e: SUCCESS … nodes 5 / edges 4"
```

**Step 3: Independent persistence re-proof (B without A):** run readback alone in a fresh shell — no fetch, no import — and diff against the previous output:
```bash
cp out/atlas65/graph-snapshot.json /tmp/atlas65-snap-run1.json
npm run atlas65:snapshot
diff /tmp/atlas65-snap-run1.json out/atlas65/graph-snapshot.json && echo IDENTICAL
# expect: IDENTICAL (captured_at lives in persisted frontmatter, so bytes match)
```

**Step 4: Commit (including evidence artifacts produced by the run)**
```bash
git add scripts/atlas65/e2e.mjs docs/evidence/atlas-65/
git commit -m "feat(ATLAS-65): deterministic local E2E with credential-stripped readback and committed evidence"
```

---

### Task 10: Runbook doc + full gates

**Files:**
- Create: `docs/atlas-65-local-e2e.md`

**Step 1: Write the runbook** — short, factual: prerequisites (bun ≥ 1.3.10 via `bun upgrade`; Atlassian API token → `ATLAS65_CONFLUENCE_EMAIL`/`ATLAS65_CONFLUENCE_API_TOKEN`; never commit them), the six npm commands with expected outputs, the negative-path behaviors (each `E_*` code and what triggers it), the pilot boundary paragraph (PGLite pilot per Sprint-2 plan; projection-local IDs, `canonical_entity_ids=false`; GBrain is a derived projection, not the canonical write store; no claims about the production Postgres/RLS/VPS architecture).

**Step 2: Run ALL gates and record exact results:**
```bash
npm run check        # expect exit 0; test count grows from 211 by the new ATLAS-65 tests; validator stays 91 checks
npm run secret-scan  # expect exit 0
node --test test/atlas65-confluence-source.test.mjs test/atlas65-projection.test.mjs test/atlas65-gbrain-cli.test.mjs test/atlas65-import.test.mjs test/atlas65-snapshot.test.mjs test/atlas65-serve.test.mjs
npm run atlas65:e2e  # expect SUCCESS line
```
All four commands: record exact command, exit code, summary for the evidence report. Do not report anything not actually executed.

**Step 3: Commit**
```bash
git add docs/atlas-65-local-e2e.md
git commit -m "docs(ATLAS-65): local E2E runbook with pilot boundary and failure-path reference"
```

---

### Task 11: Push, PR, evidence package (NO merge)

**Step 1: Push and open PR**
```bash
git push -u origin feat/ATLAS-65-real-source-gbrain-browser-graph
gh pr create --base main --title "ATLAS-65: real ATLAS source -> pinned GBrain persistence -> gbrain-read/v1 -> browser graph" --body "<summary + evidence digest + explicit 'no merge before PO/G2' note>"
```
Record: branch, head SHA, PR number/URL. Wait for PR CI (`ci`/`check` + `secret-scan`) on the exact head SHA; record run IDs and conclusions (use `~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation <headSHA>`).

**Step 2: Produce the evidence report** exactly per the ATLAS-65 "EVIDENCE TO RETURN" structure: START STATE, SOURCE EVIDENCE (5 pages × ID/title/version + verified parent relations), IMPLEMENTATION (files + purposes + pin + persistence mechanism "PGLite dataDir `out/atlas65/gbrain-home/.gbrain/brain.pglite` via pinned gbrain CLI"), PERSISTENCE PROOF (import log, brain dir listing, credential-stripped readback, diff-identical re-generation), GRAPH PROOF (5/4, `projection-local/v1`, root `14778372`, contract-response `valid:true`), BROWSER PROOF (serve command, URL, focus/neighbour/provenance observations, screenshot if browser automation available — never fabricated), TEST EVIDENCE (exact commands/exit codes), NEGATIVE-PATH EVIDENCE (the four mandated categories → test names + observed exits), GIT EVIDENCE (branch/SHA/PR).

**Step 3: End.** Do NOT merge, do NOT transition Jira, do NOT touch Confluence. WAITING FOR PO REVIEW.

---

## Explicit negative-path coverage map (traceability)

| Mandated negative path | Where proven |
|---|---|
| Invalid/unreadable source, no synthetic fallback | `E_SOURCE_AUTH_MISSING` / `E_SOURCE_UNREADABLE` / `E_SOURCE_METADATA` / `E_SOURCE_HIERARCHY` tests (Tasks 2–3); atomic capture write |
| Wrong/ambiguous project or routing, fail closed | `E_UNKNOWN_PROJECT` CLI tests (fetch + import), `E_SCOPE` capture/project mismatch test (Task 6); registry resolver reused unchanged |
| Empty/unavailable persisted GBrain state | `E_PERSISTENCE_UNAVAILABLE` (generate-snapshot without brain), `E_PERSISTENCE_EMPTY` builder test (Task 7) |
| Invalid generated snapshot | `validateOrThrow` + contract-CLI gate in generator (Task 7); serve startup exit 1 + runtime 503 tests (Task 8); viewer error banner |
| Missing source relation → no invented edge | projection zero-links test (Task 4), foreign-provenance exclusion + dangling fail-closed tests (Task 7), `E_GRAPH_TOO_SMALL` e2e guard (Task 9) |
| GBrain pin/runtime incompatibility | `E_PIN_MISMATCH`, bun version gate (Task 5) → STOP, never a substitute store |

## Deviation log (recorded during execution — plan vs. shipped)

| # | Where | Deviation | Why |
|---|---|---|---|
| D1 | `test/atlas65-confluence-source.test.mjs` | Plan's loop-based `verifySourceSet` negatives replaced by 3 explicit tests (+ branch-precise message asserts in review round 1) | The loop's root-mismatch fixture fed 1 page against a 3-page set and would have passed via the count-mismatch branch — a wrong-reason pass. |
| D2 | `scripts/atlas65/fetch-source.mjs` | Review round 1: `process.exitCode` + natural termination instead of `process.exit()`; coded `E_SOURCE_SET_UNREADABLE` for config errors; scope gate also asserts `selector_kind === 'project_id'`; test-only `ATLAS65_SOURCE_SET_PATH` override (mirrors `ATLAS_REGISTRY_PATH` idiom) | Repo idiom (see `src/gbrain-read-contract/cli.mjs` header), fail-closed consistency, offline testability of the scope branch. |
| D3 | Task 4 `buildProjection` (amended above, pre-implementation) | Declared root is the scope boundary: its live parent is captured as provenance but never an edge and never a failure; non-root out-of-set parents still fail closed | Root may legitimately live under the space homepage; the original plan would have hard-failed the good-path live run with `E_PROJECTION_PARENT_UNKNOWN`. Found by review round 1 (Important 1, sharpened). Skip-key trust: every production call of `buildProjection` sits behind the import CLI's `E_SCOPE` gate, which pins `capture.source.source_id` to the registry's `root_page_id` before the capture is used. |

| D4 | `scripts/atlas65/setup-gbrain.mjs` | Init success envelope is parsed from the LAST stdout line only | Real pinned gbrain `init --pglite --no-embedding --json` emits 4 stdout lines (2 human preamble, 1 progress JSON, then the success envelope last; migrations log to stderr) — verified live. Parse/shape failures still fail closed (`E_GBRAIN_INIT`). |
| D5 | `package.json` `scripts.test` | `node --test` → `node --test 'test/**/*.test.mjs'` | Bare discovery ignores .gitignore and sweeps `third_party/gbrain-checkout/test/*.test.ts` (bun-targeted) once the checkout exists, exploding the suite locally. CI unaffected (no checkout there). Directory form `node --test test/` errors on node 24.16.0; the quoted glob works. |

## Anti-drift checklist (re-read before each task)

Jira = ATLAS-65 only. Every file must serve the real-source→GBrain→browser slice. No embeddings, no semantic/inferred edges, no premium UI, no VPS, no RLS, no framework, no new npm deps, no contract changes, no registry changes, no Jira/Confluence mutation. Smallest implementation wins.

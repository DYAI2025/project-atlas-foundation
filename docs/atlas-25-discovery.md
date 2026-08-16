# ATLAS-25 — Confluence project discovery and revision scan (runbook)

## What this is

Registry-driven, cursor-paginated, revision- and lifecycle-aware discovery of a
registered project's Confluence subtree. Given a `project_id`, it resolves the
project through the writer registry, walks the registered root page and its
descendants, captures each page's revision (`version.number`) and lifecycle
state, and writes a deterministic scan document. Given a previous scan it also
reports an incremental delta and carries forward every absence it has directly
observed, so an arbitrarily long chain of reruns stays coherent. The design, the
verified REST contract and the
task-by-task derivation live in
`docs/plans/2026-08-15-atlas-25-confluence-project-discovery-revision-scan.md`.

## Relationship to ATLAS-65

ATLAS-65's fixed five-page source set (`config/atlas65-source-set.json`) is
**unchanged** and remains accepted pilot behavior. ATLAS-25 is a **parallel read
path**: it does not modify `src/atlas65/**`, `scripts/atlas65/**` or the source
set, and in this slice its output is **not** fed into the ATLAS-65
projection/import pipeline. The only ATLAS-65 code it reuses is `requireAuth`
from `src/atlas65/confluence-source.mjs` (the shared credential contract).

`requireAuth` **supplies** a base URL but does not constrain one — it accepts any
string and only strips trailing slashes. ATLAS-25 therefore validates that base
itself (see *Configured base URL* below). The check is ATLAS-25-local by design:
tightening `requireAuth` would silently change what the ATLAS-65 pipeline
accepts, outside this ticket's scope.

Confluence remains the canonical source; gbrain remains a derived projection.
This slice writes nothing to gbrain.

## The deterministic discovery rule

> **The scope of project P is: the page whose ID is P's registered
> `root_page_id`, plus every descendant of that page, at any depth, whose `type`
> is exactly `page`.**
>
> - The root is fetched by ID via the detail endpoint (the `descendants`
>   endpoint does not return the root itself).
> - `depth` is omitted so the full subtree is walked.
> - Descendants whose `type` is not `page` (blogpost, whiteboard, database,
>   folder, …) are **counted and reported** as `non_page_descendants`, never
>   silently dropped.
> - Project scope is enforced **only** by the registered `root_page_id`. Titles,
>   semantic similarity and body content are never consulted (DEC-09).
> - The registry `confluence_space_key` is carried into the output as
>   provenance. It is **not** verified against the API: the v2 page detail
>   returns a numeric `spaceId`, not a space key, and resolving keys would
>   require a second endpoint outside this slice. Documented as a known
>   limitation.

## The lifecycle model

| Lifecycle | Evidence required | Never inferred from |
|---|---|---|
| `active` | detail/descendant `status === "current"` | presence alone |
| `archived` | `status === "archived"` | absence from the walk |
| `deleted` | `status === "trashed"` or `status === "deleted"` | absence from the walk |
| `removed_from_scope` | page was previously observed (as a page or as an absent entry), is absent from the current subtree walk, and a direct read returns `status === "current"` | anything else |
| `absent` | page was previously observed and a direct read returns **HTTP 404** | anything else |

Any other `status` string ⇒ `E_DISCOVERY_LIFECYCLE`, fail closed. No page is ever
reported as deleted without an API-returned status or an observed 404.
`historical` and `draft` are deliberately unmapped. A page does not become
"deleted" by staying gone: a persistent 404 is re-observed as `absent` on every
run, however many runs that takes.

## Determinism — current source state vs lineage

The scan document is split in two, and the split is the identity contract:

- **`semantic`** — the **current source state**: project, source, discovery rule,
  sorted page list (each with `page_id`, `title`, `version`, `parent_id`,
  `depth`, `lifecycle`, `source_status`, `confluence_url`) and the sorted
  `absent` list of directly observed absences. Contains **no** wall-clock value
  and **no** reference to any previous scan.
- **`capture`** — the **lineage**: `captured_at`, `pagination_requests`,
  `previous_digest` (which predecessor this run was compared against) and
  `delta` (what that comparison found). Metadata and comparison provenance only.

`discovery_digest = sha256(JSON.stringify(semantic))` — an **unkeyed** SHA-256
content digest. It proves integrity and gives the source state a stable identity;
it is not a MAC or a signature and proves nothing about who produced a document.

Two runs against unchanged source state produce a byte-identical `semantic` and
an identical `discovery_digest` while `capture.captured_at` differs. **Semantic
equality is digest equality**; `captured_at` is never identity. Page order is
sorted by `page_id`, so the order in which Confluence returns cursor pages does
not change the digest.

`delta` lives under `capture`, not inside `semantic`, deliberately: a predecessor
reference is lineage, and lineage inside the digested body chains the source-state
identity to run history. With `delta.previous_digest` in the digest input, an
unchanged source acquired a **new** `discovery_digest` on every chained rerun —
run 3's identity depended on run 2's, run 2's on run 1's, forever. The delta is
still reported in full; it is just no longer part of what the source *is*.

## Incremental state closure (chained reruns)

`--previous` is not a one-shot comparison. The output of run *n* is the input of
run *n+1*, so both of these must hold across an arbitrarily long chain:

1. **Identity is source-only.** An unchanged current source state keeps one
   `discovery_digest` no matter which predecessor it is compared against. Two runs
   over the same state compared against *different* predecessors produce different
   `capture.delta` values and the *same* `discovery_digest`.
2. **An observed absence is carried, not forgotten.** Previously observed state is
   `semantic.pages` **and** `semantic.absent`. A page that disappeared is stored
   under `absent`, so a comparison built from `pages` alone dropped it on the next
   run — it left the scan with no error and no evidence. Each absent entry is
   re-probed by direct read every run, and its `last_seen_version` carries forward
   unchanged, so a persistent 404 reproduces a byte-identical record: absence is a
   fixed point, not a decaying one.

Reappearance is therefore deterministic: a page that was `absent` and is found in
the subtree again is reported under `delta.lifecycle_changed` as
`absent → active`, **not** under `delta.added`. Its absence episode is preserved
as lineage rather than being erased into a first sighting.

Consequently `semantic.absent` entries are validated on read exactly like page
entries (id, integer `last_seen_version`, `evidence`, lifecycle inside the closed
model, no id repeated across `pages` and `absent`). Before this closure nothing
read the list back, so nothing checked it.

## Cross-read consistency

Each non-root page is observed **twice**: once in the `descendants` cursor walk
and once in its own detail read. Those are separate requests, so Confluence can
move, archive or trash a page in between. The full descendant observation
(`parent_id`, `depth`, `status`) is therefore kept, and after the detail read:

- the detail `id` must match the requested id (as before);
- the detail `parent_id` must equal the `parentId` observed in the walk;
- the detail `status` must equal the `status` observed in the walk.

A disagreement is `E_DISCOVERY_METADATA` with an explicit *source metadata
changed during the scan* message — never a page record assembled from two
different source states.

Two things are deliberately **not** required:

1. The registered root's `parent_id` may be non-`null`. The root is a scope
   boundary, not a tree root, and its own parent legitimately lies above it.
2. A page's parent need not itself be a `type=page` in the result set.
   Confluence permits folder/whiteboard intermediaries; the scope rule stays
   "every `type=page` descendant", and a non-page parent is neither invented as
   a page nor treated as a failure.

## Previous-scan integrity

`--previous` drives the delta and its digest is carried forward as provenance in
`capture.previous_digest`, so the document's **integrity is checked** before any
field of it is believed. (Integrity, not authorship: the digest is unkeyed, so it
detects an edited or truncated body, not who wrote one.) A previous scan is
accepted only when **all** of the following hold, otherwise `E_PREVIOUS_INVALID`:

- `schema_version` is `1.1` in both the envelope and the `semantic` body;
- `semantic.pages` and `semantic.absent` are both present as arrays;
- every page has an id, an integer `version`, and a `lifecycle` inside the
  closed lifecycle model above;
- every absent entry has an id, an integer `last_seen_version`, a non-empty
  `evidence` string, and a `lifecycle` inside the same closed model;
- no `page_id` appears twice **across `pages` and `absent` together**
  (duplicates would collapse silently into the comparison map and drop a page
  from the delta with nothing failing; an id that is both in scope and absent is
  ambiguous previously-observed state);
- `sha256(JSON.stringify(previous.semantic))` equals `previous.discovery_digest`
  exactly — an edited body, a stale digest or a forged digest is rejected.

`1.1` supersedes `1.0`: the digested `semantic` body no longer contains `delta`
and now requires `absent`, so the digest covers a different field set than it did
under `1.0`. A `1.0` document is rejected rather than compared as though the two
identities meant the same thing.

The digest, duplicate, cross-read, absent-carry-forward, identity-vs-lineage and
base-URL mechanisms each carry a counterexample test that loads a copy of the
shipped module with exactly that mechanism removed — or, for the identity
separation and the pre-repair root read, with the pre-repair mechanism restored —
and shows the defect is then observable.

## Prerequisites

- Node.js ≥ 22 (repo `engines`), zero runtime dependencies.
- Credentials as **environment variables only** — never committed, never written
  into the repo:
  - `ATLAS65_CONFLUENCE_EMAIL`
  - `ATLAS65_CONFLUENCE_API_TOKEN`
  - `ATLAS65_CONFLUENCE_BASE_URL` (optional; unset **or empty** falls back to the
    ATLAS-65 default `https://dyai2026.atlassian.net`. When set it must satisfy
    the base-URL contract below.)

The `ATLAS65_` prefix is reused deliberately so the ATLAS-65 pipeline keeps
working with one credential contract. Renaming it is a separate, coordinated
change.

## Configured base URL — the credential boundary

Every ATLAS-25 request carries an `Authorization: Basic …` header, so the
configured base URL decides **who receives the credential**. It is validated
once, before the first request is issued, and the run aborts with
`E_DISCOVERY_CONFIG` if any of the following does not hold:

| Rule | Rejected example |
|---|---|
| must parse as a URL | `ht!tp://%%%` |
| must not carry userinfo | `https://user:token@host` |
| must use `https` | `http://host` |
| must not carry a query string | `https://host?x=1` |
| must not carry a fragment | `https://host#f` |
| must be an **origin**, i.e. no path | `https://host/wiki` |

The base is an **origin boundary**, and a non-root path is **rejected, not
normalized away**: silently dropping a configured path would fetch from somewhere
other than where the operator wrote it. `https://host/` is accepted —
`requireAuth` strips the trailing slash and the result is the origin. The
normalized value used everywhere afterwards is `new URL(base).origin`, so there
is exactly one spelling.

Validation happens **before** `fetchImpl` is invoked even once. That ordering is
the whole point: the root page detail read is the first credentialed request, and
it used to be issued straight from the unvalidated base string.

Beyond that, **every** URL this module fetches is re-checked against the
validated base by `resolveFetchableUrl` before the request goes out — not only
the paginated ones. A URL assembled by string concatenation is not evidence of a
target, so it is re-parsed and held to the same scheme / origin / no-userinfo
rules. That covers:

- the root page detail read,
- the descendants start URL,
- every server-supplied cursor URL,
- every non-root page detail read,
- every `probeAbsent` direct read.

Rejection messages are diagnostic without reproducing credentials: they name
`ATLAS65_CONFLUENCE_BASE_URL` and the failed rule, quote at most `scheme://host`,
and never echo userinfo, query, fragment or an unparseable raw value.

The two layers are not redundant. The per-request check cannot answer for a
hostile base — a URL built from `http://attacker.invalid` is same-scheme and
same-origin *with that base* by construction — which is exactly what the
counterexample tests demonstrate.

## Commands

```
npm run atlas25:discover
node scripts/atlas25/discover.mjs --project EASYTREE
node scripts/atlas25/discover.mjs --project ATLAS --previous out/atlas25/ATLAS/discovery.json --out out/atlas25/ATLAS/discovery-2.json
```

Outputs land in `out/atlas25/<PROJECT_ID>/discovery.json` (`out/` is gitignored).
Writes are atomic: a temp file is renamed into place, so either a complete scan
exists afterwards or nothing changed.

All requests are `GET`. Discovery never writes to Confluence.

## Confluence endpoints used

Confirmed against `developer.atlassian.com/cloud/confluence/rest/v2/` on
2026-08-15. Nothing outside this table is relied on.

**`GET /wiki/api/v2/pages/{id}/descendants`**
- Query params: `limit`, `depth`, `cursor`. `depth` omitted ⇒ all descendant levels.
- Response: `{ "results": [ { "id", "status", "title", "type", "parentId", "depth", "childPosition" } ], "_links": { "next", "base" } }`
- `_links.next` is a **site-relative path** carrying the next `cursor`. Absent ⇒ last page.
- **`results` entries carry NO `version` object.** Revision IDs come from the detail endpoint only.

**`GET /wiki/api/v2/pages/{id}`**
- Response includes `id`, `status`, `title`, `parentId`, `parentType`, `spaceId`,
  `version` (`version.number`, …), and `body` **only when `body-format` is
  requested**.
- Discovery requests it **without** `body-format`, so **no page body is ever
  fetched** by this path (DEC-04).

The `descendants` endpoint has no documented `status` filter, so archived or
deleted pages are never *assumed* to be in or out of the walk. Lifecycle is only
ever read from a `status` field the API actually returned, or from an observed
HTTP 404.

## Failure modes

Every failure is explicit and diagnostic. There is no partial result and no
synthetic fallback.

| Code | Exit | Trigger |
|---|---|---|
| `E_REGISTRY_UNREADABLE` / `E_REGISTRY_INVALID` / `E_REGISTRY_AMBIGUOUS` | 2 | writer registry unreadable or failing validation (from `src/registry/resolve.mjs`) |
| `E_UNKNOWN_PROJECT` | 1 | selector matches no registry project (exact match only — no case folding, no Jira keys) |
| `E_DISCOVERY_SCOPE` | 1 | registry project not `active`; previous scan for another project or root; duplicate or root-colliding descendant |
| `E_PREVIOUS_UNREADABLE` | 2 | `--previous` file missing or unparseable |
| `E_PREVIOUS_INVALID` | 1 | previous scan document is structurally invalid (including a missing `pages` or `absent` array), declares an unsupported `schema_version`, lists a `page_id` twice across `pages` and `absent`, carries a page or absent entry with a lifecycle outside the closed model, carries an absent entry without id/`last_seen_version`/`evidence`, or has a `discovery_digest` that does not match a digest recomputed from its own `semantic` body |
| `E_SOURCE_AUTH_MISSING` | 1 | credentials not set (shared contract with ATLAS-65) |
| `E_DISCOVERY_AUTH_MISSING` | 1 | an internal caller reached the HTTP layer without an authorization header — a local config defect, raised before any request |
| `E_DISCOVERY_CONFIG` | 1 | the configured base URL fails the base-URL contract (unparseable, userinfo, non-`https`, query, fragment, or a non-root path) — raised before any request; or a URL this module built or a caller supplied (start URL, root/page detail URL, absent-probe URL) fails the same-scheme / same-origin / no-userinfo gate |
| `E_DISCOVERY_UNREADABLE` | 1 | network failure, non-2xx HTTP, non-JSON response, or a literal `null` body |
| `E_DISCOVERY_PAGINATION` | 1 | missing/invalid `_links.next`, `_links` not an object, next link leaving the configured origin/scheme or carrying userinfo, repeated cursor URL, request cap exceeded, response without a `results` array |
| `E_DISCOVERY_METADATA` | 1 | page missing id/title/status/`version.number`, answering with the wrong id, or a detail read whose `parent_id`/`status` contradicts the descendants observation for the same page |
| `E_DISCOVERY_LIFECYCLE` | 1 | Confluence returned a status outside the closed allowlist |
| `E_INTERNAL` | 2 | unexpected, uncoded failure |

`E_DISCOVERY_AUTH_MISSING` and `E_DISCOVERY_CONFIG` were added by the Task-1
code-quality review (deviation D-2 in the plan) and are documented here rather
than dropped. `E_DISCOVERY_CONFIG` was **widened** by the pre-live credential
boundary repair: it now also covers the configured base URL itself, checked
before the first request rather than only when a URL is resolved against it.

## Known limitations

1. `confluence_space_key` is carried as provenance only; the v2 detail endpoint
   returns a numeric `spaceId`, so the key is not verified against the API.
2. `historical` and `draft` statuses are deliberately unmapped and fail closed.
   A Confluence release adding a status fails the scan rather than guessing.
3. One detail request per page, so wall-clock scales linearly with subtree size.
4. `MAX_PAGINATION_REQUESTS = 200` is a hard cap that **fails** rather than
   truncates.
5. There is no request timeout or `AbortSignal`, so a hung socket stalls the walk
   (the cap bounds requests, not time). This is repo-wide, not ATLAS-25-specific.
6. Discovery output is not wired into the ATLAS-65 projection/import pipeline in
   this slice.

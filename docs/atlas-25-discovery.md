# ATLAS-25 — Confluence project discovery and revision scan (runbook)

## What this is

Registry-driven, cursor-paginated, revision- and lifecycle-aware discovery of a
registered project's Confluence subtree. Given a `project_id`, it resolves the
project through the writer registry, walks the registered root page and its
descendants, captures each page's revision (`version.number`) and lifecycle
state, and writes a deterministic scan document. Given a previous scan it also
reports an incremental delta. The design, the verified REST contract and the
task-by-task derivation live in
`docs/plans/2026-08-15-atlas-25-confluence-project-discovery-revision-scan.md`.

## Relationship to ATLAS-65

ATLAS-65's fixed five-page source set (`config/atlas65-source-set.json`) is
**unchanged** and remains accepted pilot behavior. ATLAS-25 is a **parallel read
path**: it does not modify `src/atlas65/**`, `scripts/atlas65/**` or the source
set, and in this slice its output is **not** fed into the ATLAS-65
projection/import pipeline. The only ATLAS-65 code it reuses is `requireAuth`
from `src/atlas65/confluence-source.mjs` (the shared credential contract).

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
| `removed_from_scope` | page was in the previous scan, is absent from the current subtree walk, and a direct read returns `status === "current"` | anything else |
| `absent` | page was in the previous scan and a direct read returns **HTTP 404** | anything else |

Any other `status` string ⇒ `E_DISCOVERY_LIFECYCLE`, fail closed. No page is ever
reported as deleted without an API-returned status or an observed 404.
`historical` and `draft` are deliberately unmapped.

## Determinism

The scan document is split in two:

- **`semantic`** — project, source, discovery rule, sorted page list (each with
  `page_id`, `title`, `version`, `parent_id`, `depth`, `lifecycle`,
  `source_status`, `confluence_url`), sorted `absent` list, `delta`. Contains
  **no** wall-clock value.
- **`capture`** — `captured_at`, `pagination_requests`, `previous_digest`.
  Metadata only.

`discovery_digest = sha256(JSON.stringify(semantic))`. Two runs against unchanged
source state produce a byte-identical `semantic` and an identical
`discovery_digest` while `capture.captured_at` differs. **Semantic equality is
digest equality**; `captured_at` is never identity. Page order is sorted by
`page_id`, so the order in which Confluence returns cursor pages does not change
the digest.

## Prerequisites

- Node.js ≥ 22 (repo `engines`), zero runtime dependencies.
- Credentials as **environment variables only** — never committed, never written
  into the repo:
  - `ATLAS65_CONFLUENCE_EMAIL`
  - `ATLAS65_CONFLUENCE_API_TOKEN`
  - `ATLAS65_CONFLUENCE_BASE_URL` (optional; defaults to the ATLAS-65 default)

The `ATLAS65_` prefix is reused deliberately so the ATLAS-65 pipeline keeps
working with one credential contract. Renaming it is a separate, coordinated
change.

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
| `E_PREVIOUS_INVALID` | 1 | previous scan document is structurally invalid |
| `E_SOURCE_AUTH_MISSING` | 1 | credentials not set (shared contract with ATLAS-65) |
| `E_DISCOVERY_AUTH_MISSING` | 1 | an internal caller reached the HTTP layer without an authorization header — a local config defect, raised before any request |
| `E_DISCOVERY_CONFIG` | 1 | configured base URL is not a URL, or a caller-supplied start URL fails the URL gate |
| `E_DISCOVERY_UNREADABLE` | 1 | network failure, non-2xx HTTP, non-JSON response, or a literal `null` body |
| `E_DISCOVERY_PAGINATION` | 1 | missing/invalid `_links.next`, `_links` not an object, next link leaving the configured origin/scheme or carrying userinfo, repeated cursor URL, request cap exceeded, response without a `results` array |
| `E_DISCOVERY_METADATA` | 1 | page missing id/title/status/`version.number`, or answering with the wrong id |
| `E_DISCOVERY_LIFECYCLE` | 1 | Confluence returned a status outside the closed allowlist |
| `E_INTERNAL` | 2 | unexpected, uncoded failure |

`E_DISCOVERY_AUTH_MISSING` and `E_DISCOVERY_CONFIG` were added by the Task-1
code-quality review (deviation D-2 in the plan) and are documented here rather
than dropped.

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

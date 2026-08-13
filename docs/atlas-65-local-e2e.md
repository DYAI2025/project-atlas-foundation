# ATLAS-65 — Local End-to-End Runbook

## What this is

The ATLAS-65 pilot pipeline: a fixed set of five real ATLAS Confluence pages
(declared in `config/atlas65-source-set.json`, hierarchy-verified at fetch time)
is projected into a dedicated local instance of the pinned GBrain v0.42.73.2
(`15b9863d13635d173562a54f55a1d388bfcf546b`, per `third_party/upstreams.lock.json`)
running on the PGLite engine, read back from persisted state only, materialized
as a `gbrain-read/v1` snapshot plus provenance sidecar, and served to a local
vanilla-JS/SVG browser viewer. Every stage is fail-closed with a stable `E_*`
error code; there is no fixture fallback on any production path. Full design and
deviation log: `docs/plans/2026-08-13-atlas-65-real-source-gbrain-browser-graph.md`.

## Pilot boundary (binding)

This is a local PGLite pilot per the Sprint-2 plan. Snapshot identifiers use the
`projection-local/v1` scheme with `canonical_entity_ids=false` — they are
explicitly NOT canonical entity IDs. GBrain is a derived, rebuildable projection
and never the canonical ATLAS write store. Nothing in this pipeline makes or
supports any claim about the production Postgres/RLS/VPS architecture:
ATLAS-16 (VPS audit), ATLAS-54 (canonical data model and RLS contracts), and
Confluence Page 05 (canonical entity IDs / lifecycle) remain open production
prerequisites.

## Prerequisites

- Node `>=22` (per `package.json` engines), `npm ci` done.
- Bun `>= 1.3.10` (the pinned GBrain's engine requirement): `bun upgrade`.
  Default binary path is `~/.bun/bin/bun`; override with `ATLAS65_BUN_BIN`.
- Atlassian API token, exported as environment variables only —
  `ATLAS65_CONFLUENCE_EMAIL` and `ATLAS65_CONFLUENCE_API_TOKEN`
  (optional `ATLAS65_CONFLUENCE_BASE_URL`, default `https://dyai2026.atlassian.net`).
  Credentials are never committed and never written to any file inside the repo.
- Network access for the first `atlas65:setup` run (clone of the pinned GBrain
  commit + `bun install`) and for every `atlas65:fetch` (live Confluence read).

## Commands (pipeline order)

All stages are project-scoped through the writer registry (`--project ATLAS` is
baked into the npm scripts). Outputs land in `out/atlas65/` (gitignored).

1. `npm run atlas65:setup` — clones GBrain at the pinned commit into
   `third_party/gbrain-checkout/` (gitignored; SHA verified on every run),
   installs its dependencies, and initializes the isolated pilot brain at
   `out/atlas65/gbrain-home/.gbrain/brain.pglite` (`--pglite --no-embedding`;
   no keys, no network for the init itself). Idempotent.
2. `npm run atlas65:fetch` — reads the five declared pages live from Confluence,
   verifies metadata and parent hierarchy against the declared source set, and
   atomically writes `out/atlas65/source-capture.json` (all-or-nothing).
3. `npm run atlas65:import` — the only writer. Re-validates the capture and its
   scope, then writes pages first, hierarchy links second into the pinned brain;
   writes `out/atlas65/import-receipt.json`.
4. `npm run atlas65:snapshot` — readback only (cannot fetch, cannot import):
   reopens the persisted brain in a fresh process and materializes
   `out/atlas65/graph-snapshot.json` + `provenance.json`; the existing
   `gbrain-read/v1` contract CLI must accept the result
   (`out/atlas65/contract-response.json`), else nothing is published.
5. `npm run atlas65:serve` — validate-then-serve on `http://127.0.0.1:4365/`
   (localhost only): every `/graph-snapshot.json` response body is the exact
   byte buffer the contract CLI just accepted; invalid state yields 503, a
   torn artifact triple refuses startup.
6. `npm run atlas65:e2e` — the one-shot deterministic path: setup → fetch →
   import → snapshot in a credential-stripped child environment (the readback
   stage is physically unable to re-fetch) → contract/size/membership asserts →
   copies committed evidence to `docs/evidence/atlas-65/` (capture with page
   bodies replaced by sha256+length, import receipt, snapshot, provenance,
   contract response). Evidence is only written on SUCCESS.

## Failure modes

Each code is emitted on stderr with a non-zero exit; the pipeline never
continues past a failed stage.

| Code | Stage | Trigger |
|---|---|---|
| `E_PIN` | setup | `third_party/upstreams.lock.json` unreadable, gbrain entry missing, or clone/checkout/HEAD-resolve of the pinned commit fails |
| `E_PIN_MISMATCH` | setup | checkout HEAD differs from the pinned commit — delete `third_party/gbrain-checkout` and re-run setup |
| `E_GBRAIN_RUNTIME_MISSING` | setup, any gbrain call | bun binary not found (set `ATLAS65_BUN_BIN` to override) |
| `E_GBRAIN_RUNTIME_VERSION` | setup | `bun --version` fails, is unparseable, or is `< 1.3.10` — run `bun upgrade` |
| `E_GBRAIN_INSTALL` | setup | `bun install` in the checkout fails |
| `E_GBRAIN_TORN_STATE` | setup | `config.json` exists without the `brain.pglite` data dir (or vice versa after init) — delete `out/atlas65/gbrain-home` and re-run setup |
| `E_GBRAIN_INIT` | setup | `gbrain init` emits no JSON success envelope, an unexpected result, or leaves no config behind |
| `E_REGISTRY_UNREADABLE` / `E_REGISTRY_INVALID` / `E_REGISTRY_AMBIGUOUS` | fetch, import, snapshot | writer registry (`config/project-registry.json`) cannot be read or fails validation |
| `E_UNKNOWN_PROJECT` | fetch, import, snapshot | the supplied project selector matches no registry project |
| `E_SOURCE_SET_UNREADABLE` | fetch | `config/atlas65-source-set.json` unreadable/unparseable or missing its `project_selector` object |
| `E_SOURCE_SCOPE` | fetch | source set `selector_kind` is not `project_id`, or its `selector_value` differs from the resolved project |
| `E_SOURCE_AUTH_MISSING` | fetch | `ATLAS65_CONFLUENCE_EMAIL` or `ATLAS65_CONFLUENCE_API_TOKEN` not set |
| `E_SOURCE_UNREADABLE` | fetch | network failure, non-2xx HTTP status, or non-JSON response for a declared page |
| `E_SOURCE_METADATA` | fetch | a page response is missing id/title/`version.number`/`body.storage.value`, or answers with the wrong id |
| `E_SOURCE_HIERARCHY` | fetch | live hierarchy differs from the declared source set (count mismatch, wrong or missing root, undeclared or drifted parent) |
| `E_CAPTURE_UNREADABLE` | import | `out/atlas65/source-capture.json` missing or unparseable — run `atlas65:fetch` first; there is no fixture fallback |
| `E_SCOPE` | import | capture `project_id`/`source_id` does not match the registry-resolved project and root |
| `E_CAPTURE_INVALID` | import | capture fails structural re-validation (schema version, page fields) |
| `E_PERSISTENCE_UNAVAILABLE` | import, snapshot | pilot brain not initialized (import: config missing; snapshot: config or PGLite data dir missing) — run `atlas65:setup` first |
| `E_PROJECTION_SOURCE_ID` | import | derived gbrain source id is not a valid gbrain source id |
| `E_PROJECTION_PARENT_UNKNOWN` | import | a non-root page declares a parent outside the verified capture |
| `E_GBRAIN_SPAWN` / `E_GBRAIN_CLI` | import, snapshot | gbrain CLI could not be spawned / exited non-zero, returned non-JSON, or returned an unrecognized `sources_list`/`list_pages`/`get_links` shape (never silently treated as empty) |
| `E_READBACK_TRUNCATED` | snapshot | `list_pages` returned the full limit (500) — possibly truncated readback refused |
| `E_PERSISTENCE_EMPTY` | snapshot | persisted brain contains no pilot pages — run `atlas65:import`; no fixture substitution |
| `E_READBACK_PROVENANCE` | snapshot | a persisted page's provenance frontmatter is incomplete or inconsistent, or its title is missing |
| `E_READBACK_DANGLING` | snapshot | a persisted hierarchy link references a page outside the persisted pilot set |
| `E_SNAPSHOT_INVALID` | snapshot, serve | generated snapshot violates `gbrain-read/v1` or the contract CLI rejects it; on serve: startup refusal (torn/missing artifact triple or invalid bytes) and per-request 503 |
| `E_SERVE_IO` | serve | per-request I/O error → HTTP 500; the server stays alive |
| `E_CONTRACT_EVIDENCE` | e2e | persisted contract response unreadable or does not report `valid === true` |
| `E_GRAPH_TOO_SMALL` | e2e | fewer than 2 nodes or 1 edge — the source set carries no defensible relation; never invent an edge |
| `E_MEMBERSHIP_MISMATCH` | e2e | snapshot node set (by `source_ref`) does not equal this run's captured page set |
| `E_INTERNAL` | any | unexpected, uncoded failure (exit 2) |

## Known properties

- **Additive-only import.** Re-runs never delete pages that were removed
  upstream; re-importing the same capture is idempotent. The e2e's membership
  assert (`E_MEMBERSHIP_MISMATCH`) catches such drift before it can reach the
  committed evidence.
- **Single-writer PGLite.** Every gbrain call is serialized inside the scripts;
  do not run pipeline stages (or two e2e runs) concurrently against the same
  brain.
- **Brain reset.** `rm -rf out/atlas65/gbrain-home` and re-run
  `npm run atlas65:setup`. The pinned checkout is reset separately
  (`rm -rf third_party/gbrain-checkout` + setup) — for example after
  `E_PIN_MISMATCH`.

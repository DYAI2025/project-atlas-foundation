# project-atlas-foundation

Canonical implementation repository for **Project ATLAS** (ATLAS-owned control plane and governance layer; see ADR-0001).

- Jira: ATLAS (Board 304) · Confluence Space: PRODUKTMAN · Root Page: 14778372
- Owner: benjamin.poersch
- Visibility: private (Approval Boundary §12)

Bootstrap commit under `BOOTSTRAP_EXCEPTION_ATLAS_13`: minimal README, `.gitignore`, and import provenance only — no functional implementation. All foundation content arrived via pull request (PR #1 on `feat/ATLAS-13-sprint-1-foundation`, merged to `main` 2026-08-07 together with PR #3 and PR #2).

## Local contract checker (ATLAS-22, Slice 1)

Deterministic validator for the versioned local adapter contract
(`contracts/local-adapter/v1/`). The CLI itself has zero dependencies, no
network access, no secrets. The test suite uses exactly one pinned dev
dependency (`ajv@8.20.0`, MIT) for real JSON Schema Draft 2020-12
validation of the response contract — setup is `git clone`, `npm ci`
(tests only), Node.js ≥ 22.

```bash
npm ci            # dev dependency for tests only (ajv)
npm test          # canonical: node --test — runs the full current test suite
npm run check     # canonical local gate: full test suite + repository-consistency validator (same checks as CI job `check`)
node src/local-contract/cli.mjs fixtures/local-contract/valid-request.json           # exit 0
node src/local-contract/cli.mjs fixtures/local-contract/invalid-missing-field.json   # exit 1
```

Exit codes: `0` contract satisfied · `1` contract violated · `2` technical
(usage / unreadable file / invalid JSON). Output is always the versioned
machine-readable response `{contract_version, valid, errors[]}` on stdout,
byte-identical across runs and process locales.

## gbrain-read / graph-projection contract checker (ATLAS-22, Slice 2)

Deterministic, fail-closed checker for the versioned gbrain-read contract
(`contracts/gbrain-read/v1/`). It validates a request plus a **standalone**
graph-snapshot document and resolves project scope through the canonical writer
registry. It performs **no read**: it never contacts Confluence or gbrain and
never generates a snapshot. Zero dependencies, no network, no secrets.

```bash
node src/gbrain-read-contract/cli.mjs fixtures/gbrain-read/valid-request.json \
                                      fixtures/gbrain-read/valid-graph-snapshot.json   # exit 0
node src/gbrain-read-contract/cli.mjs fixtures/gbrain-read/valid-request.json \
                                      fixtures/gbrain-read/invalid-cross-project-snapshot.json  # exit 1
```

Exit codes: `0` contract satisfied · `1` contract or scope violation (an
unresolved project is a denial, not a technical error) · `2` technical
(usage / unreadable file / invalid JSON / registry). Output is the versioned
machine-readable verdict `{contract_version, valid, project_id, errors[]}` on
stdout, byte-identical across runs and process locales. The verdict is not the
graph: the snapshot is never embedded, echoed or summarized in it.

Snapshot identifiers are **projection-local** (`id_scheme: "projection-local/v1"`,
`canonical_entity_ids: false`) and are explicitly **not** the final canonical
entity identifiers. `relation_type` is syntactically constrained but deliberately
not an enum — the canonical relation-type catalog is an open point.

`fixtures/gbrain-read/**` are synthetic contract examples only: the project ids
and Confluence roots are registry identities, every `source_ref` is a synthetic
placeholder, and no page tree is reproduced. Confluence stays the source of truth;
these files are never project data.

Related repositories:

- `DYAI2025/gbrain-atlas` — legacy prototype, read-only reference, pinned at `aea0fb0b934780a205db92066786b265de0de22a`. No history migrated.
- `DYAI2025/Gbrain-vps` — non-canonical artifact snapshot (deprecated).

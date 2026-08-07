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

Related repositories:

- `DYAI2025/gbrain-atlas` — legacy prototype, read-only reference, pinned at `aea0fb0b934780a205db92066786b265de0de22a`. No history migrated.
- `DYAI2025/Gbrain-vps` — non-canonical artifact snapshot (deprecated).

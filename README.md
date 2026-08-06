# project-atlas-foundation

Canonical implementation repository for **Project ATLAS** (ATLAS-owned control plane and governance layer; see ADR-0001).

- Jira: ATLAS (Board 304) · Confluence Space: PRODUKTMAN · Root Page: 14778372
- Owner: benjamin.poersch
- Visibility: private (Approval Boundary §12)

Bootstrap commit under `BOOTSTRAP_EXCEPTION_ATLAS_13`: minimal README, `.gitignore`, and import provenance only — no functional implementation. All foundation content arrives via pull request on `feat/ATLAS-13-sprint-1-foundation`.

## Local contract checker (ATLAS-22, Slice 1)

Deterministic validator for the versioned local adapter contract
(`contracts/local-adapter/v1/`). No dependencies, no network, no secrets —
setup is `git clone` plus Node.js ≥ 22.

```bash
npm test          # canonical: node --test  (10 tests)
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

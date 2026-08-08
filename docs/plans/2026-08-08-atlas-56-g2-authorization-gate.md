# ATLAS-56: G2 Authorization Gate — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans / subagent-driven execution task-by-task.

**Goal:** Make the G2 solo-owner merge gate fail closed: an integration may only proceed when a machine-verifiable, PR-specific, pre-existing PO authorization artifact is found and verified — never inferred from READY states, chat context, or expected next steps.

**Root cause (from fresh intake):** `.claude/skills/atlas-gated-pr/SKILL.md` step 11 + guardrail accept PO authorization "in the session order or a direct user instruction" — pure chat state. No artifact requirement, no PR/SHA binding, no timing check, no script verifies anything. Audit comment 5222291930 on PR #8 claimed an authorization that did not exist; append-only correction 5222416143. Jira ATLAS-56 AC 1–3 require: artifact before merge, no READY inference, artifact reference in audit comments.

**Architecture:** One new zero-dependency ESM script with a pure, network-free evaluation function (testable against fixtures) plus a thin `gh api` CLI wrapper. Skill and policy docs bind the process to the script. Repository validator enforces that the gate cannot be silently removed. Historic artifacts (comments, reports) remain untouched.

**Tech stack:** Node >= 22 ESM, `node:test` + `assert/strict`, `gh` CLI at runtime only (never in tests), validator pattern `check(name, condition)` in `scripts/validate-current-repository.mjs`.

---

## Authorization artifact specification (normative)

A G2 PO authorization artifact is a GitHub **issue comment on the PR itself** that satisfies ALL of:

1. **Author is the PO:** `author.login === "DYAI2025"` (per policy: the repository owner account is the PO identity; documented in `docs/policies/pr-rules.md`).
2. **Machine-readable block** in the body (line-anchored, all three lines required):
   ```
   G2-AUTHORIZATION
   PR: #<number>
   HEAD: <40-hex-lowercase-sha>
   ```
   Free text before/after the block is allowed.
3. **Exact PR match:** `<number>` equals the PR under evaluation.
4. **Exact head match:** `<sha>` equals the current head SHA of that PR (full 40 hex chars).
5. **Pre-existing:** the artifact's *effective timestamp* is strictly BEFORE the gate evaluation time. Effective timestamp = `updated_at` when present, else `created_at` — an artifact edited after the gate time never validates (defends against post-hoc edit injection).
6. **Never inferable:** comments containing only `READY FOR MERGE` / `READY FOR PO AUTHORIZATION`, prose claims like "PO authorized", or audit comments (`PO INTEGRATION AUTHORIZATION` header) are NOT artifacts, regardless of author.

Any ambiguity, parse failure, missing field, fetch error, or bad input → **NOT AUTHORIZED** (fail closed), with machine-printed reasons.

## Files

- Create: `scripts/g2-authorization-gate.mjs`
- Create: `test/g2-authorization-gate.test.mjs`
- Modify: `.claude/skills/atlas-gated-pr/SKILL.md` (step 11 + guardrail)
- Modify: `docs/policies/pr-rules.md` (artifact requirement + schema)
- Modify: `scripts/validate-current-repository.mjs` (REQUIRED_FILES + content invariants)
- Create (this file): `docs/plans/2026-08-08-atlas-56-g2-authorization-gate.md`

### Task 1: Failing tests for the evaluation core

`test/g2-authorization-gate.test.mjs`, conventions: `node:test`, `assert/strict`, section comments `// --- ... (ATLAS-56) ---`, import `{ evaluateAuthorization, parseAuthorizationArtifact, PO_LOGIN } from '../scripts/g2-authorization-gate.mjs'`.

Fixture helper `comment({login, body, created, updated})` mirroring the GitHub issues-comment JSON shape (`user.login`, `body`, `created_at`, `updated_at`, `id`, `html_url`).

`evaluateAuthorization(comments, { prNumber, headSha, gateTime })` → `{ authorized: boolean, artifact: {id, url}|null, reasons: string[] }`.

Test cases (gateTime `2026-08-08T12:00:00Z`, prNumber 9, headSha 40-hex `a`-padded fixture):
1. **Positive:** PO comment with valid block, correct PR/HEAD, created+updated before gateTime → `authorized: true`, artifact id set, reasons empty.
2. **Negativ 1:** body `READY FOR MERGE` (no block) → blocked, reason mentions missing artifact.
3. **Negativ 2:** body `READY FOR PO AUTHORIZATION` → blocked.
4. **Negativ 3:** audit-style prose claiming granted authorization — use the real PR #8 wording ("granted by the Product Owner in the session order … after the PO code review (READY FOR MERGE)") WITHOUT block → blocked.
5. **Negativ 4:** valid block but `PR: #8` while evaluating PR 9 → blocked, reason names PR mismatch.
6. **Negativ 5:** valid block, correct PR, different HEAD sha → blocked, reason names head mismatch.
7. **Negativ 6a:** valid block, `created_at` after gateTime → blocked (no retroactive validation).
8. **Negativ 6b (edit injection):** `created_at` before gateTime, `updated_at` after gateTime → blocked.
9. **Wrong author:** valid block from login `someone-else` → blocked, reason names author.
10. **Empty comment list** → blocked, reasons non-empty.
11. **Multiple comments, one valid** → authorized, artifact = the valid one's id.
12. `parseAuthorizationArtifact`: valid block parses `{pr, head}`; missing HEAD line → null; malformed sha (39 chars / uppercase) → null.

Run: `npm test` → expect new file RED with `ERR_MODULE_NOT_FOUND`.

### Task 2: Implement `scripts/g2-authorization-gate.mjs` (minimal, fail closed)

- `export const PO_LOGIN = 'DYAI2025'` (comment: PO identity = repo owner per docs/policies/pr-rules.md).
- `export function parseAuthorizationArtifact(body)` — line-anchored regexes: `/^G2-AUTHORIZATION\s*$/m`, `/^PR:\s*#(\d+)\s*$/m`, `/^HEAD:\s*([0-9a-f]{40})\s*$/m`; all three required else `null`.
- `export function evaluateAuthorization(comments, { prNumber, headSha, gateTime })` — validates inputs (array, positive int, 40-hex sha, valid date; else not authorized with reason); scans comments, collects reasons per rejection (author, no block, PR mismatch, head mismatch, timestamp), effective timestamp = `updated_at ?? created_at`; returns first fully valid artifact.
- CLI (guarded `if (import.meta.url === pathToFileURL(process.argv[1]).href)`): args `<pr-number> <head-sha>`; `gateTime = new Date()`; spawn `gh api repos/DYAI2025/project-atlas-foundation/issues/<pr>/comments --paginate`; on ANY error exit 1. Print verdict: on success `G2 AUTHORIZATION VERIFIED — artifact comment <id> <url>`; on failure `G2 AUTHORIZATION MISSING — merge stays blocked` + reasons; exit 0 only when authorized.

Run: `npm test` → all green (existing 69 + new).

### Task 3: Harden `.claude/skills/atlas-gated-pr/SKILL.md`

Step 11 becomes (in substance): BEFORE the audit comment — run `node scripts/g2-authorization-gate.mjs <pr> <exact-head-sha>`; exit 0 required to proceed; audit comment MUST reference the verified artifact (`Authorization artifact: comment <id>`); exit != 0 → PR stays open in `READY FOR PO AUTHORIZATION`, ask the PO for the artifact, never proceed.
Guardrail becomes: authorization exists ONLY as a verifiable artifact per the schema in `docs/policies/pr-rules.md`; NEVER inferred from `READY FOR MERGE`, `READY FOR PO AUTHORIZATION`, an expected next step, chat context, or anticipated consent; audit comments may only claim authorizations whose artifact was actually read and verified.

### Task 4: `docs/policies/pr-rules.md` — artifact policy

Append a "G2-Autorisierungsartefakt (ATLAS-56)" section: schema (three-line block), location (PR issue comment), author = PO account `DYAI2025`, pre-existence rule incl. edit rule, no-inference rule, gate command, audit-comment reference duty. Append-only; existing text unchanged except necessary cross-reference.

### Task 5: Validator invariants (`scripts/validate-current-repository.mjs`)

- REQUIRED_FILES += `scripts/g2-authorization-gate.mjs`, `test/g2-authorization-gate.test.mjs`.
- New checks: SKILL.md references `g2-authorization-gate.mjs` AND contains `G2-AUTHORIZATION`; pr-rules.md contains `G2-AUTHORIZATION`; gate script contains the fail-closed marker strings (`G2 AUTHORIZATION MISSING`).

Run: `npm run check` → all tests + validator PASSED.

### Task 6: Verification battery

1. `npm test` (full), `npm run check` (unpiped, exit code checked directly).
2. Explicit failure-path execution: `node scripts/g2-authorization-gate.mjs 9 <head-sha>` against the REAL open PR (once it exists) → must print MISSING and exit 1 (no artifact exists) — this is the live Negativ-Selbsttest. Also `node scripts/g2-authorization-gate.mjs` (bad args) → exit 1.
3. Fresh checkout of the exact branch head into a temp dir → `npm ci --ignore-scripts && npm run check` green.
4. Double-run determinism not applicable (no generated files).

### Task 7: Reviews (before PR is declared review-ready)

1. Spec-compliance review (Jira AC 1–3 + Testpflicht Positiv/Negativ 1–6/Regression mapping).
2. Code-quality review.
3. Adversarial review of the authorization model — attack vectors: READY-state smuggling, foreign-PR artifact reuse, stale head SHA, post-gate artifact, post-gate edit injection, chat-text-as-proof, audit comment without source, marker inside code block/quote (does line-anchor accept quoted `> G2-AUTHORIZATION`? decide + test), case tricks, sha case-sensitivity, `--paginate` omission hiding artifacts (or including too many), non-PO author with same display name.
4. Fix confirmed findings; re-run battery.

### Task 8: PR

Branch `fix/ATLAS-56-g2-authorization-gate`, focused commits (plan / tests red / implementation green / docs+validator), push, `gh pr create` scoped to ATLAS-56, CI green on PR head. THEN STOP: run the gate against the own PR, show it blocks (no artifact exists), report `WAITING FOR PRODUCT OWNER MERGE REVIEW`. No merge, no Jira Fertig, no ATLAS-22.

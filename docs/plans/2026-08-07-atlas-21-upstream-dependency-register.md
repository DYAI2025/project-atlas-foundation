# ATLAS-21 Upstream Dependency Register Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deterministically generate a human-readable `DEPENDENCIES.md` from `third_party/upstreams.lock.json` and automatically prove the underlying supply-chain invariants (40-hex commit pins, 64-hex archive checksums, documented licenses, approval-gated ⇒ disabled, lock→document parity, byte-identical regeneration).

**Architecture:** One zero-dependency ESM script (`scripts/gen-dependencies.mjs`) exports a pure `render(lock)` function and, when run as main, writes `DEPENDENCIES.md` at the repo root (paths resolved relative to the script, never CWD). One focused test file (`test/upstreams.test.mjs`) guards the lock invariants and asserts that the committed document is byte-identical to `render(lock)` — drift, invented data, and non-determinism all fail the same parity assertion. The lock file is the single authoritative source and is never modified.

**Tech Stack:** Node.js 22 built-ins only (`node:test`, `node:assert/strict`, `node:fs`, `node:crypto`, `node:child_process`). No new dependencies, no network, no timestamps in generated output. Repo style: ESM, single quotes, no semicolons, 2-space indent.

**Slice boundary (Jira ATLAS-21, Sprint plan Rev. 2 Phase 3):**
- In scope: `scripts/gen-dependencies.mjs`, generated `DEPENDENCIES.md`, `test/upstreams.test.mjs`. No `package.json` change needed (regeneration = `node scripts/gen-dependencies.mjs`; "falls zwingend nötig" is not met).
- Out of scope (hard): changing any lock value or lock semantics, downloading repositories, re-hashing archives, network access, adapters (ATLAS-22), CI security gates (ATLAS-23), SBOM/NOTICE (ATLAS-24), VPS changes, refactoring existing architecture, touching `scripts/validate-current-repository.mjs` (no invariant there covers this slice), touching `actions-probe.yml` (open PO decision).
- Delivery per repo skill `.claude/skills/atlas-gated-pr/SKILL.md`, but **STOP after PR + head-CI**: no merge, no Jira `Fertig`, no next ticket. G2 is not standing permission.

**Anti-drift checklist — recite before EVERY commit:**
1. Jira-Key: ATLAS-21. 2. Slice: upstream dependency register (generator + doc + tests). 3. Files in this commit ⊆ {docs/plans/2026-08-07-atlas-21-upstream-dependency-register.md, test/upstreams.test.mjs, scripts/gen-dependencies.mjs, DEPENDENCIES.md}. 4. Acceptance criterion served (name it). 5. Test command: `npm test` (focused: `node --test test/upstreams.test.mjs`). 6. Nothing from the out-of-scope list is touched.

---

### Task 0: Baseline verify, Jira In-Arbeit, branch, commit plan

**Files:**
- Commit: `docs/plans/2026-08-07-atlas-21-upstream-dependency-register.md` (this file, already written)

**Step 1: Fresh baseline (atlas-gated-pr step 1) — any deviation is a hard STOP**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin && git checkout main && git pull --ff-only
git rev-parse HEAD        # expected: dd42544e79e0611ab9084b4c4d94d5a199a127cd
git status --short        # expected: only ?? docs/plans/2026-08-07-atlas-21-... (this plan)
gh pr list --state open   # expected: empty
ls package-lock.json      # expected: exists (npm ci depends on it)
```

If HEAD differs, other files are dirty, or PRs are open: STOP and report — do not improvise.

**Step 2: Transition ATLAS-21 → In Arbeit (established convention, cf. ATLAS-23 on 2026-08-07)**

Atlassian MCP: `transitionJiraIssue` cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`, issue `ATLAS-21`, transition id `21`. Read-after-write: `getJiraIssue` must show status `In Arbeit`. No other Jira mutation in this slice; `Fertig` is forbidden.

**Step 3: Branch and commit the plan**

```bash
git checkout -b feat/ATLAS-21-upstream-dependency-register
git add docs/plans/2026-08-07-atlas-21-upstream-dependency-register.md
git commit -m "docs(ATLAS-21): implementation plan for the upstream dependency register slice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Lock supply-chain invariant guards (expected green — they validate committed data)

These tests guard existing lock data; a red phase would require corrupting the lock, which is out of scope. Their failure paths are exercised implicitly: any future lock edit violating an invariant fails them. The genuine red→green cycle is Task 2→3.

**Files:**
- Create: `test/upstreams.test.mjs`

**Step 1: Write the test file (invariants only, self-contained)**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')

const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))

// --- lock supply-chain invariants (ATLAS-21) ----------------------------------

test('lock has the expected shape and at least one upstream', () => {
  assert.equal(lock.schema_version, '1.0')
  assert.ok(Array.isArray(lock.upstreams) && lock.upstreams.length >= 1)
})

test('every upstream id is unique', () => {
  const ids = lock.upstreams.map((u) => u.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every upstream pins a full 40-hex commit SHA', () => {
  for (const u of lock.upstreams) {
    assert.match(u.source_commit, /^[0-9a-f]{40}$/, u.id)
  }
})

test('every upstream carries a 64-hex archive SHA-256', () => {
  for (const u of lock.upstreams) {
    assert.match(u.archive_sha256, /^[0-9a-f]{64}$/, u.id)
  }
})

test('every upstream documents a license', () => {
  for (const u of lock.upstreams) {
    assert.ok(typeof u.license === 'string' && u.license.trim().length > 0, u.id)
  }
})

test('approval_required upstreams are never enabled', () => {
  for (const u of lock.upstreams) {
    assert.equal(typeof u.enabled, 'boolean', u.id)
    assert.equal(typeof u.approval_required, 'boolean', u.id)
    if (u.approval_required) assert.equal(u.enabled, false, u.id)
  }
})
```

**Step 2: Run focused tests, verify all pass against the committed lock**

Run: `node --test test/upstreams.test.mjs`
Expected: 6 pass, 0 fail (lock currently satisfies every invariant — 5 upstreams, 2 of them `approval_required` and both `enabled: false`).

**Step 3: Anti-drift checklist, then commit**

```bash
git add test/upstreams.test.mjs
git commit -m "test(ATLAS-21): supply-chain invariant guards for upstreams.lock.json

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Parity + determinism tests (RED)

**Files:**
- Modify: `test/upstreams.test.mjs` (extend imports, append tests)

**Step 1: Extend the imports at the top of the file**

Replace the existing import block with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '../scripts/gen-dependencies.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')
const DOC_PATH = join(repoRoot, 'DEPENDENCIES.md')
const SCRIPT = join(repoRoot, 'scripts/gen-dependencies.mjs')

const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
const doc = await readFile(DOC_PATH, 'utf8')
```

**Step 2: Append the parity and determinism tests at the end of the file**

```js
// --- lock → document parity ---------------------------------------------------

test('committed DEPENDENCIES.md is exactly the rendered lock (no drift, no invented data)', () => {
  assert.equal(doc, render(lock))
})

test('every lock entry appears as exactly one table row with version, SHA, license, checksum', () => {
  for (const u of lock.upstreams) {
    const rows = doc.split('\n').filter((line) => line.startsWith(`| ${u.id} |`))
    assert.equal(rows.length, 1, `${u.id} must appear exactly once as a table row`)
    for (const value of [u.version, u.source_commit, u.license, u.archive_sha256]) {
      assert.ok(rows[0].includes(String(value)), `${u.id} row missing ${value}`)
    }
  }
})

test('DEPENDENCIES.md documents the upgrade policy and the authoritative source', () => {
  assert.ok(doc.includes('## Upgrade-Policy'))
  assert.ok(doc.includes('third_party/upstreams.lock.json'))
})

// --- determinism ---------------------------------------------------------------

test('render is deterministic in-process', () => {
  assert.equal(render(lock), render(lock))
})

test('repeated generator runs produce byte-identical output, independent of CWD', () => {
  const hash = () => createHash('sha256').update(readFileSync(DOC_PATH)).digest('hex')
  const before = hash()
  for (const cwd of [repoRoot, tmpdir()]) {
    const res = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: 'utf8' })
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /DEPENDENCIES\.md written: \d+ upstreams/)
    assert.equal(hash(), before, `run from ${cwd} changed DEPENDENCIES.md`)
  }
})
```

Note: the double-run test rewrites the working-tree `DEPENDENCIES.md` in place — that is the point. If the script were non-deterministic or the committed doc stale, the hash comparison and the parity test both fail.

**Step 3: Run focused tests, verify RED**

Run: `node --test test/upstreams.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../scripts/gen-dependencies.mjs` (the whole file errors at load). Record this output as red evidence. Do NOT commit yet — the suite must never be committed red.

---

### Task 3: Generator implementation + generated document (GREEN)

**Files:**
- Create: `scripts/gen-dependencies.mjs`
- Create (generated, committed): `DEPENDENCIES.md`

**Step 1: Write the generator**

```js
// Deterministic dependency register: third_party/upstreams.lock.json → DEPENDENCIES.md
// Zero dependencies, no network, no timestamps. Run: node scripts/gen-dependencies.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const LOCK_PATH = join(repoRoot, 'third_party/upstreams.lock.json')
const DOC_PATH = join(repoRoot, 'DEPENDENCIES.md')

export function render(lock) {
  const rows = lock.upstreams.map(
    (u) =>
      `| ${u.id} | ${u.version} | \`${u.source_commit}\` | ${u.license} | \`${u.archive_sha256}\` | ${u.integration_status} | ${u.enabled ? 'yes' : 'no'} | ${u.approval_required ? 'yes' : 'no'} |`
  )
  return `# Dependencies (ATLAS-21)

> Generiert aus \`third_party/upstreams.lock.json\` durch \`scripts/gen-dependencies.mjs\`.
> Nicht von Hand editieren — Lock-Datei ändern und neu generieren:
> \`node scripts/gen-dependencies.mjs\`. Die Lock-Datei ist die autoritative Quelle;
> Rollen, Quell-URLs und Integrationshinweise stehen dort.

project_id: ATLAS

| Upstream | Version | Commit SHA | Lizenz | Archiv SHA-256 | Integrationsstatus | Enabled | Approval nötig |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}

## Upgrade-Policy

1. Upstream-Pins werden nur per Pull Request aktualisiert, nie direkt auf main.
2. Ein Pin-Update nennt: neuen Commit-SHA, Diff-Zusammenfassung, Lizenz-Recheck,
   neuen Archiv-SHA-256 und das Ergebnis der Adapter-Regressionstests (ATLAS-22).
3. gbrain-evals wird vor Nutzung auf den gepinnten gbrain-Commit gepatcht
   (Abhängigkeit auf \`master\` ist verboten).
4. approval_required-Upstreams (Obsidian-Plugins) bleiben disabled, bis eine
   dokumentierte Owner-Entscheidung vorliegt (Approval Boundary §5/§6).
5. Sicherheitskritische Upgrades dürfen Phasen überspringen, brauchen aber
   dieselbe Evidenz.
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
  await writeFile(DOC_PATH, render(lock))
  console.log(`DEPENDENCIES.md written: ${lock.upstreams.length} upstreams`)
}
```

Every table value is copied verbatim from the lock (booleans rendered `yes`/`no`); nothing is invented, reordered, or reformatted. Lock array order is preserved.

**Step 2: Generate**

Run: `node scripts/gen-dependencies.mjs`
Expected: `DEPENDENCIES.md written: 5 upstreams`; `DEPENDENCIES.md` exists at repo root.

**Step 3: Run focused tests, verify GREEN**

Run: `node --test test/upstreams.test.mjs`
Expected: 11 pass, 0 fail.

**Step 4: Full local gate**

Run: `npm run check`
Expected: all tests pass (existing suites + new file, discovered automatically by `node --test`) and `VALIDATION PASSED`, exit 0.

**Step 5: Independent double-run byte comparison (belt-and-braces beside the test)**

```bash
shasum -a 256 DEPENDENCIES.md && node scripts/gen-dependencies.mjs && shasum -a 256 DEPENDENCIES.md
git status --short   # DEPENDENCIES.md must not appear as modified after regeneration once committed
```

Expected: identical hashes.

**Step 6: Anti-drift checklist, then commit**

```bash
git add scripts/gen-dependencies.mjs DEPENDENCIES.md test/upstreams.test.mjs
git commit -m "feat(ATLAS-21): deterministic DEPENDENCIES.md generator with parity and determinism tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Fresh checkout verification

**Step 1: Clone the branch head into the scratchpad and run everything**

```bash
HEAD_SHA=$(git -C /Users/benjaminpoersch/Projects/project-atlas-foundation rev-parse HEAD)
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/atlas21-fresh-XXXXXX")
git clone --branch feat/ATLAS-21-upstream-dependency-register \
  /Users/benjaminpoersch/Projects/project-atlas-foundation "$SCRATCH/repo"
cd "$SCRATCH/repo"
git rev-parse HEAD                      # must equal $HEAD_SHA
npm ci --ignore-scripts
node scripts/gen-dependencies.mjs       # regenerate in the fresh clone
git diff --exit-code -- DEPENDENCIES.md # byte-identical to the committed doc, exit 0
npm run check                           # exit 0
```

Expected: every command exit 0. `git diff --exit-code` is the strongest reproducibility proof: a fresh machine regenerates the committed bytes exactly. Record outputs as evidence. Any failure → fix on the branch, repeat Tasks 3–4.

---

### Task 5: Adversarial review (pre-push) and fixes

**Step 1: Run the saved `adversarial-review` workflow (`~/.claude/workflows/adversarial-review.js`) over the branch diff (`git diff main...HEAD`) with exactly these six lenses:**

1. Determinismus — hidden time/locale/ordering/platform dependence in generator or tests (e.g. object key order, `\n` vs `\r\n`, trailing newline).
2. Lock→Dokument-Parität — any lock field the tests claim to prove but don't; any doc content not derivable from the lock.
3. Erfundene Daten — any value in `DEPENDENCIES.md` or tests not literally present in the lock (invented licenses, paraphrased statuses).
4. Lizenz-/SHA-Validierung — regex weaknesses (uppercase hex, length off-by-one, partial match without anchors).
5. Scope Drift — any touched file outside the slice list; any lock modification; any validator/CI change.
6. Versteckte Netzwerkabhängigkeit — anything in generator/tests that could touch the network (it must be `node:fs`/`node:crypto`/`node:child_process` only).

**Step 2: Triage findings.** Confirmed findings → fix on the branch → re-run Task 3 Steps 3–5 and Task 4. Rejected findings → record with reasoning. Nothing is pushed with an open confirmed finding.

---

### Task 6: Push, PR, head-CI — then STOP

**Step 1: Final anti-drift checklist, then push**

```bash
git push -u origin feat/ATLAS-21-upstream-dependency-register
```

**Step 2: Open the PR against main (merge-commit convention; no merge in this slice)**

```bash
gh pr create --base main --title "feat(ATLAS-21): reproducible upstream dependency register" --body "$(cat <<'EOF'
Implements the ATLAS-21 slice: deterministic generation of DEPENDENCIES.md from
third_party/upstreams.lock.json plus automated supply-chain invariant tests.

**Slice boundary:** generator, generated doc, focused tests, this plan. The lock
file is untouched (single authoritative source). No package.json change needed.

**Changes:**
- scripts/gen-dependencies.mjs — pure render(lock) + CWD-independent CLI
- DEPENDENCIES.md — generated register (SHAs, licenses, checksums, upgrade policy)
- test/upstreams.test.mjs — lock invariants, lock→doc byte parity, determinism
- docs/plans/2026-08-07-atlas-21-upstream-dependency-register.md — this plan

**Evidence:** red run (ERR_MODULE_NOT_FOUND) → green run (11/11), npm run check
exit 0, double-run byte-identical (sha256), fresh checkout: npm ci + regenerate +
git diff --exit-code + npm run check all exit 0. Adversarial review (6 lenses)
findings and resolutions listed in the final report.

**Out of scope honored:** no lock value changed, no downloads, no re-hashing, no
network in generator/tests, no adapters (ATLAS-22), no CI gates (ATLAS-23), no
SBOM/NOTICE (ATLAS-24), no VPS, no refactoring.

**Remaining gates:** PO code review, merge decision, Jira evidence + status
(BLK-ATLAS-13-01 still open — PR policy is disciplinary).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3: CI on the exact head**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation $(git rev-parse HEAD)
```

Expected: exit 0 (workflow `ci`, context `check`, success on this exact SHA). Never rerun/dispatch manually to force green.

**Step 4: STOP. Report to the Product Owner:**

branch + exact head SHA · changed files · red/green evidence (verbatim outputs) · test results (focused + `npm run check`) · fresh-checkout result · adversarial-review findings and fixes · PR URL · known constraints (BLK-ATLAS-13-01 open — no technical branch protection; archive re-verification against the original `/mnt/data` files impossible on this machine per Sprint plan Rev. 2; Jira evidence comment + any transition beyond `In Arbeit` deferred to PO) · explicit confirmation that every out-of-scope item was honored.

No merge. No Jira `Fertig`. No further ticket.

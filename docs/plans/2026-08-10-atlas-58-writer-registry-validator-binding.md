# ARCHIVAL NOTE — ATLAS-58 Plan-File Governance Closeout (2026-08-11)

**Read this note before the plan below it. The note is current; the plan below is history.**

| Field | Value |
|---|---|
| Archival status | **ARCHIVED** — historical execution evidence, retained unaltered |
| Classification | `derived_noncanonical` |
| Original execution status | **EXECUTED** — implemented in full as the ATLAS-58 code increment |
| Date of execution | 2026-08-10 |
| Date of archival | 2026-08-11 |
| Jira authority | **ATLAS-58** |
| Canonical Confluence authority | **Page 19628033** — *ATLAS-58 – Canonical Implementation Plan – Writer-Registry Validator Binding* (space `PRODUKTMAN`) |
| Implementation outcome | **PR #13 — MERGED**; accepted head `6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243`; merge commit `96730338240a2153a396b4d0f8c1b688b70a7d69` |
| Archival decision artifact | **Jira ATLAS-58 comment `12727`** — *PO Post-Merge Reconciliation, 2026-08-11* (author `benjamin.poersch`) |

## What this document is, and is not

This archived plan is **historical execution evidence, NOT an active authorization**. It records what was
planned and executed on 2026-08-10. It does not authorize any action today, and no current or future work
derives permission from it.

**Later canonical Jira and Confluence state overrides any conflicting statement in the plan below.** Where
the plan and the canonical sources disagree, ATLAS-58 and Page 19628033 win — without exception, and
without the plan text being edited to match.

**Directives in the body below are historical, not active.** The plan opens with a
`> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans …` line and continues in the
imperative ("Insert exactly one line", "Create the branch", "Commit"). Those instructions were addressed to
the 2026-08-10 implementation session and were discharged there. They are **not** to be executed again. The
plan's start-state table likewise describes the repository at `2a3f3e0d…`, which is no longer current.

## Why this plan required a later, separate archival

The plan's own text prohibited committing it during implementation. Verbatim, from its storage note:

> The canonical PO contract forbids committing this derived plan. It therefore lives ONLY in the session
> scratchpad.

Its fidelity self-check (§15, row 8) correspondingly records: *"Plan lives only in the session scratchpad
… Not committed; no branch created."*

The 2026-08-10 implementation session honoured that prohibition in full — the plan was never committed and
no branch was created for it.

**This later archival is authorized only by the separate canonical Plan-File-Hygiene reconciliation and by
this PO-governed Governance Closeout docs PR.** The citable decision artifact is **Jira ATLAS-58 comment
`12727`** (PO post-merge reconciliation, 2026-08-11), which records the code increment as accepted, keeps
ATLAS-58 `In Arbeit`, names this plan as an executed plan "enthält ausdrückliches Commit-Verbot im
ursprünglichen Plantext", and requires "ein **separater PO-gesteuerter Governance-Closeout-Docs-PR** …, der
diese ausgeführten Pläne mit Archival Notes unter `docs/plans/` archiviert". The operative authorization for
the archival itself is the PO's `G2-AUTHORIZATION` artifact on that docs PR, per the *Plan-file hygiene*
guardrail in `.claude/skills/atlas-gated-pr/SKILL.md` and `docs/policies/pr-rules.md`.

The executing agent did **not** supersede, waive, or reinterpret the original prohibition on its own
authority, and the original plan did **not** authorize its own archival. The archival boundary is external
to this document.

## Preservation statement

Everything below the horizontal rule is the original plan, **byte-for-byte unaltered**. No statement was
rewritten, corrected, softened, or removed — including statements that time has overtaken: the baseline SHA
`2a3f3e0d…`, "0 open PRs" at intake, and the then-pending delivery gates in §12, which have since been
executed. (The plan's `60 → 64` validator projection was *fulfilled*, not invalidated — the validator
reports 64 checks on current `main`.) History is append-only: obsolescence is annotated here, never edited
into the source.

---

# ATLAS-58 — Writer-Registry Validator Binding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Classification: derived_noncanonical**

**Canonical authority: Jira ATLAS-58 + Confluence Page 19628033**

**This plan may elaborate implementation mechanics but may not widen or override the canonical scope.**

**Storage note (deliberate deviation from the `writing-plans` skill default):** the skill's
default is `docs/plans/YYYY-MM-DD-<name>.md` inside the repository. The canonical PO contract
forbids committing this derived plan. It therefore lives ONLY in the session scratchpad. The
skill's storage default is overridden by the canonical contract.

**Goal:** Make `scripts/validate-current-repository.mjs` treat `config/project-registry.json`
as a mandatory repository artifact and fail closed on its minimum high-level V1 structure.

**Architecture:** One bounded edit to the existing zero-dependency repository validator: one
new `REQUIRED_FILES` entry plus one guarded read followed by three high-level `check(...)`
calls, using the file's existing `check()` helper and comment-numbered section style. The deep
Writer-Registry contract stays exclusively in `src/registry/resolve.mjs` and
`test/registry-resolve.test.mjs`; the validator asserts only repository-level presence and
minimum shape.

**Tech Stack:** Node.js 22+ (CI pins 22; local verification ran on v24.16.0), ESM, `node:test`,
`node:fs/promises`. No new dependency. No CI change.

---

## 1. Verified Start State

All facts below were read fresh in this planning session on 2026-08-10. Nothing is carried over
from prior-session memory.

| Item | Verified value | How verified |
|---|---|---|
| `origin/main` SHA | `2a3f3e0d6476491f85747dbe1103262e5b150f30` | `git fetch origin --prune` + `git rev-parse origin/main` |
| Local `HEAD` | `2a3f3e0d6476491f85747dbe1103262e5b150f30` | `git rev-parse HEAD` |
| Local branch | `main`, `## main...origin/main` (0 ahead / 0 behind) | `git status --porcelain=v1 -b` |
| Worktree | clean — `git status --porcelain` returned 0 lines | `git status --porcelain \| wc -l` |
| Open PRs | **0** | `gh pr list --state open --json ...` → `[]` |
| PR history | #1–#12, all `MERGED`; newest is #12 (ATLAS-57) | `gh pr list --state all` |
| ATLAS-58 branch | none — `git branch -a --list '*58*'` empty | git |
| ATLAS-58 commit | none — `git log --all --grep='ATLAS-58'` empty | git |
| ATLAS-58 already implemented? | **No** — `grep -rn "project-registry" scripts/` returns nothing | grep |
| Validator check count | **60**, exit 0, `VALIDATION PASSED` | `node scripts/validate-current-repository.mjs` |
| Focused registry suite | **41 pass / 0 fail** | `node --test test/registry-resolve.test.mjs` |
| Full suite (`npm test`) | **137 pass / 0 fail** | `npm test` |
| Known warnings | exactly **2** AJV `strictTypes` warnings from `test/local-contract.test.mjs` | `npm test 2>&1 \| grep -i strict` |
| Node / npm used locally | v24.16.0 / 11.13.0 | `node --version`, `npm --version` |
| CI Node | `22` | `.github/workflows/ci.yml:18` |

### External-source capabilities

| Source | Result |
|---|---|
| Jira ATLAS-58 | **READ OK** — `getJiraIssue`, cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`. Status `Zu erledigen`, resolution `null`, priority `Medium`, type `Bug`, id `12491`, labels `registry`, `review-pr-11`, `validator`, 0 comments, updated `2026-08-10T14:02:32.434+0200`. |
| Confluence 19628033 | **READ OK** — `ATLAS-58 – Canonical Implementation Plan – Writer-Registry Validator Binding`, space `PRODUKTMAN`, status `current`, author `benjamin.poersch`. |
| Confluence 15171611 / 15171585 / 15237147 / 15040514 | Not re-read individually; cited transitively by Page 19628033's "Kanonische Quellen" section, which was read in full. Recorded in §14. |

**Neither Jira nor Confluence contradicts the PO contract in the task prompt.** Both canonical
sources independently state main = `2a3f3e0d…`, 0 open PRs at intake, 60 validator checks, 41
registry tests, `60 → 64`, and the identical AC set. **No CONTRACT DRIFT.**

### Relevant file observations

- `scripts/validate-current-repository.mjs` — 285 lines, zero dependencies, ESM with top-level
  `await`, sections numbered `// 1)` … `// 12)`. `REQUIRED_FILES` at lines 23–46 (22 entries).
  Epilogue at lines 278–285.
- `config/project-registry.json` — 34 lines; root `schema_version: "1.0"`, `project_id: "ATLAS"`,
  `description`, `projects[3]` = ATLAS / EASYTREE / PLUMBLINE.
- `src/registry/resolve.mjs` — 195 lines; owns the full closed V1 contract.
- `test/registry-resolve.test.mjs` — 319 lines, 41 tests; isolates via `mkdtempSync` +
  `ATLAS_REGISTRY_PATH`.
- **No test anywhere references `validate-current-repository`** —
  `grep -rln "validate-current-repository" test/ src/` returns nothing. The validator has no
  test harness; its failure behavior is exercised only by running the script.

---

## 2. Canonical Contract Mapping

| Task | ATLAS-58 AC | Page 19628033 requirement | Observable proof |
|---|---|---|---|
| Task 1 — add `config/project-registry.json` to `REQUIRED_FILES` | AC1 | Scope §1; AC1 | `✓ file exists: config/project-registry.json` in validator output; renamed file → `✗ file exists: …` |
| Task 2 — guarded JSON read + parse check | AC2 (exists, parses), AC3 (no stack trace) | Scope §2, §5; AC2 | Malformed registry → `VALIDATION FAILED`, exit 1, zero `at …` frames |
| Task 3 — root `project_id === "ATLAS"` check | AC2 | Scope §3; AC3 | Root mutated → `✗ writer registry root project_id is ATLAS — found: WRONG` |
| Task 4 — order-independent exact V1 project-id set | AC2 | Scope §4; AC4 | Missing/extra project → `✗ … exactly the three V1 projects — found: …`; reordering stays green |
| Task 5 — full gate | AC5, AC6, AC7 | AC6, AC7; Verifikation | `41/41`, `npm run check` exit 0, validator check count `64` |
| No deep invariants copied | AC4 | Architekturgrenze; AC8 | Diff contains no `jira_key`, `root_page_id`, `allowed_writers`, `approval_workflow`, `status`, `PRODUKTMAN`, duplicate/selector logic |
| AJV warnings untouched | — | AC9 | Both `strictTypes` warnings still printed, unchanged |
| PR head gates | AC8 | Delivery-/Merge-Gates | §12 — later session |
| Merge/G2/closeout | AC9 | DoD | §12 — later session, PO-gated |

---

## 3. Repository Analysis

### Actual control flow

`scripts/validate-current-repository.mjs` is a flat top-level-await ESM script:

1. Lines 6–7 — `failures` and `ok` accumulators.
2. Lines 9–16 — `exists(path)` helper: `access()` wrapped in try/catch, returns boolean, never throws.
3. Lines 18–21 — `check(name, condition, detail)`: pushes to `ok` or to `failures`.
4. Lines 23–46 — `REQUIRED_FILES` (22 entries).
5. Lines 48–50 — the existence loop: `for (const f of REQUIRED_FILES) check(\`file exists: ${f}\`, await exists(f))`.
6. Lines 52–276 — content invariants in numbered sections `// 1)` … `// 12)`.
7. Lines 278–285 — epilogue: if `failures.length > 0` → print `VALIDATION FAILED` + `✗` lines to
   **stderr**, `process.exit(1)`; else print `VALIDATION PASSED` + `✓` lines to **stdout**.

**Critical finding — the existence loop does not gate the rest of the script.** It only records
failures; execution continues unconditionally into the section reads. Every later
`await readFile(...)` at lines 53, 85, 86, 104, 121, 133, 141, 152, 191, 196, 201, 208 is
unguarded. A missing required file therefore crashes the script *before* the epilogue runs.

Empirically confirmed in an isolated probe: an unguarded top-level
`await readFile('config/project-registry.json', 'utf8')` against a missing file produces

```
Error: ENOENT: no such file or directory, open 'config/project-registry.json'
    at async open (node:internal/fs/promises:640:25)
    …
Node.js v24.16.0
exit=1
```

The exit code is coincidentally 1, but `VALIDATION FAILED` is **never printed** and a full stack
trace **is** printed. That violates AC3 on two counts. **Therefore the registry read must be
guarded.** This is not defensive stylistic preference — it is the AC.

This pre-existing fragility for the *other* twelve unguarded reads is **out of scope** for
ATLAS-58 and must not be "fixed along the way" (see §10 and §14/M4).

### Exact insertion points

1. **`REQUIRED_FILES`** — insert `'config/project-registry.json',` immediately after
   `'architecture/approval-boundary.md',` (currently line 30), before
   `'docs/repository-assessment.md'`. This keeps the array's existing loose top-level-directory
   grouping (`architecture/` → `config/` → `docs/`).
2. **New section `// 13)`** — appended after the ATLAS-57 block (currently ending line 276) and
   immediately before `if (failures.length > 0) {` (currently line 278).

### Why this does not duplicate Registry domain validation

`src/registry/resolve.mjs` owns a closed contract of ~15 invariants: `schema_version`, exact
`description` wording, allowed root fields, required/forbidden project fields, non-empty-string
typing, `confluence_space_key === 'PRODUKTMAN'`, `status`, `approval_workflow`,
`allowed_writers`, uniqueness of `project_id`/`jira_key`/`root_page_id`, and the decided
`jira_key`/`root_page_id` tuple per project. `test/registry-resolve.test.mjs` exercises every one
of those across 41 tests.

The validator adds exactly **three** high-level assertions plus **one** existence entry, and each
answers a repository-level question ("is the mandatory artifact present and minimally
well-formed?"), never a routing question ("does EASYTREE map to EYT / 5505026?"). The two
overlapping predicates — root `project_id` and the V1 project-id set — are the two the canonical
plan explicitly assigns to the validator (Scope §3, §4). Everything on the AC4 do-not-duplicate
list stays absent from the diff.

---

## 4. Implementation Strategy

Smallest robust change; no abstraction, no dependency, no refactor.

- Reuse the existing `check(name, condition, detail)` helper — no new helper.
- One `try/catch` around a single `JSON.parse(await readFile(...))`, storing the error **message**
  (not the Error object) so the detail string stays flat and printable.
- Use optional chaining (`registry?.project_id`) so all three checks evaluate safely when the read
  failed, producing three independent, self-describing findings instead of one opaque failure.
- Use `.toSorted()` for order independence — already used at `src/registry/resolve.mjs:116`, so it
  is established repo style and proven available on the CI Node version.
- Compare via `JSON.stringify(sortedIds) === JSON.stringify(['ATLAS','EASYTREE','PLUMBLINE'])` —
  the same comparison idiom already used at `scripts/validate-current-repository.mjs:167` and
  `:173`. The literal is written pre-sorted (ATLAS < EASYTREE < PLUMBLINE) so both sides are
  canonical. This rejects a missing project, an extra project, and a duplicated project.
- Do **not** import `src/registry/resolve.mjs` into the validator. Importing `loadRegistry` would
  drag the entire deep contract into the repository gate — a direct AC4 violation — and would
  throw `RegistryError` rather than produce a `check()` finding.
- Do **not** add a schema, AJV validation, a new test file, or a general validation framework.

### Verified patch

The following patch was applied and measured in a disposable copy during planning (see §5/§7).
It is the recommended implementation verbatim.

```diff
--- a/scripts/validate-current-repository.mjs
+++ b/scripts/validate-current-repository.mjs
@@ -28,6 +28,7 @@
   'architecture-decision.json',
   'architecture/adr/ADR-0001-canonical-store-and-gbrain-projection.md',
   'architecture/approval-boundary.md',
+  'config/project-registry.json',
   'docs/repository-assessment.md',
   'docs/governance/repository-roles.md',
   'docs/governance/blockers.md',
@@ -275,6 +276,40 @@
     prRulesFlat.includes('unterscheiden können')
 )

+// 13) ATLAS-58: the writer registry is a mandatory repository artifact. High-level
+//     repository binding only — existence (REQUIRED_FILES), parseability, the root
+//     project_id and the exact V1 project-id set. The deep registry contract
+//     (jira_key/root_page_id mappings, space, writers, workflow, status, duplicates,
+//     routing) stays owned by src/registry/resolve.mjs and
+//     test/registry-resolve.test.mjs and is deliberately NOT duplicated here.
+//     The read is guarded so a missing or malformed registry is a validator finding,
+//     never an uncaught ENOENT/SyntaxError.
+let registry = null
+let registryReadError = ''
+try {
+  registry = JSON.parse(await readFile('config/project-registry.json', 'utf8'))
+} catch (error) {
+  registryReadError = error.message
+}
+check(
+  'writer registry parses as a JSON object',
+  registry !== null && typeof registry === 'object' && !Array.isArray(registry),
+  registryReadError || 'registry root must be a JSON object'
+)
+check(
+  'writer registry root project_id is ATLAS',
+  registry?.project_id === 'ATLAS',
+  `found: ${registry?.project_id ?? 'none'}`
+)
+const registryProjectIds = Array.isArray(registry?.projects)
+  ? registry.projects.map((p) => p?.project_id).toSorted()
+  : []
+check(
+  'writer registry contains exactly the three V1 projects',
+  JSON.stringify(registryProjectIds) === JSON.stringify(['ATLAS', 'EASYTREE', 'PLUMBLINE']),
+  `found: ${registryProjectIds.join(',') || 'none'}`
+)
+
 if (failures.length > 0) {
   console.error('VALIDATION FAILED')
   for (const f of failures) console.error(' ✗', f)
```

Edge behavior of this design, by construction:

- `JSON.parse('null')` succeeds and yields `null` → check 1 fails on `registry !== null`.
- A JSON array root → check 1 fails on `!Array.isArray(registry)`.
- A project entry without `project_id` → `undefined` enters the id list → stringify yields `null`
  → check 3 fails. Fail-closed.

---

## 5. Red Proof

**Isolation mechanism (mandatory): a disposable archive copy. Never mutate the real worktree.**

`git archive` reads the committed tree without touching `.git`, the index, or the worktree —
strictly safer than `git worktree add` or `git stash` for this purpose.

```bash
SCRATCH="$(mktemp -d -t atlas58)"        # or the session scratchpad
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation archive HEAD | tar -x -C "$SCRATCH"
cd "$SCRATCH"
node scripts/validate-current-repository.mjs | grep -c '✓'   # expect: 60
```

Then, **before any edit to the validator**, mutate the registry inside `$SCRATCH` only:

| # | Mutation | Command | Expected PRE-FIX result |
|---|---|---|---|
| A | Registry missing | `mv config/project-registry.json config/project-registry.json.bak` | exit **0**, `VALIDATION PASSED`, **60** checks |
| B | Invalid JSON | `printf '{ not json' > config/project-registry.json` | exit **0**, `VALIDATION PASSED`, **60** checks |
| C | Wrong root `project_id` | set `project_id` to `"WRONG"` | exit **0**, `VALIDATION PASSED`, **60** checks |
| D | Expected project missing | remove the `PLUMBLINE` entry | exit **0**, `VALIDATION PASSED`, **60** checks |

**These four results were already measured during planning against
`2a3f3e0d6476491f85747dbe1103262e5b150f30`. All four returned `exit=0 VALIDATION PASSED
checks=60 stacktrace=0`.** A fifth case (extra `ROGUE` project) also returned exit 0 / PASSED /
60. This is the RED evidence: the current validator is blind to all of them.

The implementation session must re-run this in its own fresh copy and record the raw output as
the ticket's red evidence — do not cite this plan's numbers as the run.

Restore `config/project-registry.json` in the scratch copy after each case. Discard `$SCRATCH`
entirely when done. **Nothing from the scratch copy is ever copied back into the repository.**

---

## 6. Implementation Steps

Each step is one action. Frequent commits are not appropriate here — this is a single atomic
validator edit — so there is exactly one commit, at Task 5.

### Task 0: Branch from synced main

**Files:** none.

**Step 1:** Verify the baseline fresh (skill `atlas-gated-pr` step 1 + idempotency pre-check):

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin --prune
git rev-parse origin/main        # expect 2a3f3e0d6476491f85747dbe1103262e5b150f30
git status --porcelain           # expect empty
gh pr list --state open          # expect empty
grep -rn "project-registry" scripts/   # expect no output — if it HAS output, STOP: already implemented
```

**Step 2:** Create the branch:

```bash
git switch -c fix/ATLAS-58-registry-validator-binding origin/main
```

**Stop gate:** any deviation from the four expected values above → STOP, report, do not branch.

---

### Task 1: Add the registry to `REQUIRED_FILES`

**Files:** Modify `scripts/validate-current-repository.mjs:30` (insert after `'architecture/approval-boundary.md',`)

**Reason / AC:** AC1; Page 19628033 Scope §1.

**Step 1:** Insert exactly one line:

```js
  'config/project-registry.json',
```

**Step 2:** Verify the mutation itself landed before trusting any validator output
(global rule: grep for the NEW content first):

```bash
grep -n "config/project-registry.json" scripts/validate-current-repository.mjs
```
Expected: one hit, inside the `REQUIRED_FILES` array.

**Step 3:** Run the validator:

```bash
node scripts/validate-current-repository.mjs | grep -c '✓'
```
Expected: **61**. Exit 0, `VALIDATION PASSED`.

---

### Task 2: Add the guarded registry read and the parse check

**Files:** Modify `scripts/validate-current-repository.mjs` — new section `// 13)` inserted
immediately before `if (failures.length > 0) {`.

**Reason / AC:** AC2 (exists, parses) and AC3 (no uncaught stack trace); Page 19628033 Scope §2, §5.

**Step 1:** Insert the section comment, the guarded read, and the first `check` — the first 20
lines of the §4 patch (through the `'writer registry parses as a JSON object'` check).

**Step 2:** Verify and run:

```bash
grep -n "writer registry parses" scripts/validate-current-repository.mjs
node scripts/validate-current-repository.mjs | grep -c '✓'
```
Expected: **62**. Exit 0.

---

### Task 3: Add the root `project_id` check

**Files:** Modify `scripts/validate-current-repository.mjs` — inside section `// 13)`.

**Reason / AC:** AC2; Page 19628033 Scope §3.

**Step 1:** Append the `'writer registry root project_id is ATLAS'` check from the §4 patch.

**Step 2:** Run:

```bash
node scripts/validate-current-repository.mjs | grep -c '✓'
```
Expected: **63**. Exit 0.

---

### Task 4: Add the order-independent V1 project-id-set check

**Files:** Modify `scripts/validate-current-repository.mjs` — inside section `// 13)`.

**Reason / AC:** AC2; Page 19628033 Scope §4.

**Step 1:** Append `registryProjectIds` and the
`'writer registry contains exactly the three V1 projects'` check from the §4 patch.

**Step 2:** Run:

```bash
node scripts/validate-current-repository.mjs | grep -c '✓'
```
Expected: **64**. Exit 0, `VALIDATION PASSED`.

**Step 3:** Confirm the diff touches exactly one file and contains none of the forbidden tokens:

```bash
git status --porcelain          # expect exactly: " M scripts/validate-current-repository.mjs"
git diff -- scripts/validate-current-repository.mjs | grep -nE "jira_key|root_page_id|allowed_writers|approval_workflow|PRODUKTMAN|schema_version|resolveProject|loadRegistry"
```
Expected: **no output** from the grep. Any hit → AC4 violation → revert that hunk.

---

### Task 5: Full local gate and single commit

**Files:** none new.

**Reason / AC:** AC5, AC6, AC7.

**Step 1:** Focused suite (must be untouched):

```bash
node --test test/registry-resolve.test.mjs
```
Expected: `tests 41 / pass 41 / fail 0`.

**Step 2:** Full gate:

```bash
npm ci --ignore-scripts && npm run check
```
Expected: exit **0**; `tests 137 / pass 137 / fail 0`; `VALIDATION PASSED`; the two AJV
`strictTypes` warnings still present and unchanged.

**Step 3:** Commit (single, atomic):

```bash
git add scripts/validate-current-repository.mjs
git commit -m "fix(ATLAS-58): bind config/project-registry.json into the repository validator

The writer registry is the canonical routing artifact but was absent from
REQUIRED_FILES and had no existence or structure check, so npm run check
stayed green with the registry missing, malformed, mis-rooted, or carrying
the wrong V1 project set.

Adds the file to REQUIRED_FILES plus three high-level, fail-closed checks:
guarded JSON parse, root project_id === ATLAS, and the order-independent
exact V1 project-id set. Validator checks 60 -> 64.

The deep registry contract (mappings, space, writers, workflow, status,
duplicates, routing) stays owned by src/registry/resolve.mjs and
test/registry-resolve.test.mjs and is not duplicated here."
```

**Step 4:** Verify the commit contains exactly one file:

```bash
git show --stat --oneline HEAD
```
Expected: `1 file changed`, `scripts/validate-current-repository.mjs`.

---

## 7. Negative-Path Proof (POST-FIX)

Run in a **fresh disposable copy of the branch head**, never in the implementation worktree:

```bash
SCRATCH="$(mktemp -d -t atlas58green)"
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation archive HEAD | tar -x -C "$SCRATCH"
cd "$SCRATCH"
```

For each case: mutate, run `node scripts/validate-current-repository.mjs`, capture exit code,
stdout, stderr; then restore the registry before the next case.

Assertions for every failing case: **exit 1**, `VALIDATION FAILED` on stderr, and **zero** lines
matching `^\s+at ` or `^Node.js v` (no uncaught stack trace).

| # | Mutation | Expected exit | Expected findings |
|---|---|---|---|
| GREEN | none | 0 | `VALIDATION PASSED`, **64** checks |
| N1 | registry renamed away | 1 | 4 findings: `file exists: config/project-registry.json`; `writer registry parses as a JSON object — ENOENT: no such file or directory, open 'config/project-registry.json'`; `… root project_id is ATLAS — found: none`; `… exactly the three V1 projects — found: none` |
| N2 | `{ not json` | 1 | 3 findings, first: `writer registry parses as a JSON object — Expected property name or '}' in JSON at position 2 (line 1 column 3)` |
| N3 | root `project_id: "WRONG"` | 1 | 1 finding: `writer registry root project_id is ATLAS — found: WRONG` |
| N4 | `PLUMBLINE` removed | 1 | 1 finding: `writer registry contains exactly the three V1 projects — found: ATLAS,EASYTREE` |
| N5 | extra `ROGUE` project added | 1 | 1 finding: `writer registry contains exactly the three V1 projects — found: ATLAS,EASYTREE,PLUMBLINE,ROGUE` |
| N6 | `projects` array reversed | **0** | `VALIDATION PASSED`, **64** checks — order independence must NOT fail |

**Every row in this table was measured during planning against the §4 patch in a disposable copy
and matched exactly, including `stack=0` on every failing case.** The implementation session must
still re-run them on its own branch head and record that run as the ticket evidence.

Note N1 yields four findings, not one: this is intended and is the visible proof that the
`REQUIRED_FILES` entry (AC1) and the guarded structure checks (AC2) are independent bindings.

Discard `$SCRATCH` afterwards.

---

## 8. Regression Tests

| Command | Expected |
|---|---|
| `node --test test/registry-resolve.test.mjs` | `tests 41`, `pass 41`, `fail 0` — unchanged (AC5) |
| `node scripts/validate-current-repository.mjs` | exit 0, `VALIDATION PASSED`, **64** `✓` lines (AC7) |
| `npm ci --ignore-scripts && npm run check` | exit **0**; `tests 137 / pass 137 / fail 0`; `VALIDATION PASSED` (AC6) |

**Warnings are preserved visibly.** Two AJV `strictTypes` warnings are emitted by
`test/local-contract.test.mjs` on the current baseline:

```
strict mode: missing type "array" for keyword "maxItems" at "atlas:contracts/local-adapter/v1/response.schema.json#/then/properties/errors" (strictTypes)
strict mode: missing type "array" for keyword "minItems" at "atlas:contracts/local-adapter/v1/response.schema.json#/else/properties/errors" (strictTypes)
```

They must still appear, byte-identical, after the change. They are **not** failures and must
**not** be repaired in this slice (Page 19628033 AC9). If their text or count changes, that is a
material change and a STOP condition.

Test count stays 137 — this slice adds no test. That is deliberate: the repository validator has
no existing test harness, and the canonical plan's minimal design (`60 → 64`) budgets no new test
infrastructure. Negative paths are proven by the isolated procedure in §7.

---

## 9. Expected Validator Accounting: 60 → 64

Baseline is **60** `✓` lines (measured, not inferred). The four new checks:

| # | Source | Check name | AC |
|---|---|---|---|
| 61 | `REQUIRED_FILES` loop (lines 48–50) | `file exists: config/project-registry.json` | AC1 |
| 62 | new section `// 13)` | `writer registry parses as a JSON object` | AC2 |
| 63 | new section `// 13)` | `writer registry root project_id is ATLAS` | AC2 |
| 64 | new section `// 13)` | `writer registry contains exactly the three V1 projects` | AC2 |

`60 + 1 + 3 = 64`. The first comes free from the existing loop by adding one array entry; the
other three are the only new `check()` calls. **Measured: 64.**

The count must not be inflated. Splitting check 64 into "no missing project" + "no extra project",
or adding `schema_version`, `description`, space-key, or writer checks, would both break the
`60 → 64` contract and violate AC4.

---

## 10. Scope Preservation

**Exactly one file may change:**

- `scripts/validate-current-repository.mjs`

**Must remain byte-unchanged:**

- `config/project-registry.json` — the registry data is correct; this slice validates it, never edits it
- `src/registry/resolve.mjs`
- `src/registry/cli.mjs`
- `test/registry-resolve.test.mjs`
- `package.json` (no dependency, no script change)
- `.github/workflows/ci.yml`
- `docs/policies/pr-rules.md`
- `.claude/skills/atlas-gated-pr/SKILL.md`
- `architecture/approval-boundary.md`
- every other repository file

**Actions that must NOT happen in the implementation session:**

- guarding the other twelve unguarded `readFile` calls (real fragility, but ATLAS-58 does not authorize it)
- repairing the two AJV `strictTypes` warnings
- adding `test/validate-current-repository.test.mjs` or any new test file
- adding AJV/schema validation for the registry
- importing `src/registry/resolve.mjs` into the validator
- any ATLAS-59/60/61/62/63 or ATLAS-23 work
- any Jira/Confluence mutation, merge, or G2 artifact

If any of these appears necessary: **STOP**, evidence the cause, request PO reconciliation of
Page 19628033. Do not self-expand scope.

---

## 11. Review Plan

The later spec-compliance reviewer (fresh, read-only) must confirm:

1. **Scope fit** — `git show --stat` shows exactly one changed file, `scripts/validate-current-repository.mjs`; no new files; no deletions.
2. **No duplicate domain validation** — the diff contains no `jira_key`, `root_page_id`, `allowed_writers`, `approval_workflow`, `status`, `confluence_space_key`, `PRODUKTMAN`, `schema_version`, `description`, duplicate/ambiguity, or selector/routing logic; no import of `src/registry/resolve.mjs`.
3. **Fail-closed behavior** — all three checks are false when the read fails; nothing short-circuits into a silent pass; no `catch` swallows a failure without recording a finding.
4. **Malformed-JSON handling** — the read is inside `try/catch`; the caught value is used as a detail message; no uncaught `ENOENT`/`SyntaxError` reaches the top level; `VALIDATION FAILED` is still printed.
5. **Order independence** — the id set is compared after `.toSorted()` against a pre-sorted literal; reversing `projects` keeps the validator green (§7 N6); a duplicated id still fails.
6. **Check accounting** — exactly 64 `✓` lines; the four new checks are the four in §9.
7. **No adjacent-ticket work** — no AJV fix, no other-read hardening, no CI/package/policy/skill edits, no ATLAS-59+ content.
8. **Evidence honesty** — the PR body's red/green numbers come from runs actually executed on this branch head, not copied from this plan.

---

## 12. Later Delivery Gates — DESCRIBE ONLY, DO NOT EXECUTE IN THE PLANNING SESSION

Per `.claude/skills/atlas-gated-pr/SKILL.md` and Page 19628033 "Delivery- und Merge-Gates":

1. Branch `fix/ATLAS-58-registry-validator-binding` from freshly synced `main`, clean worktree, no lingering untracked plan files.
2. Local implementation validation: red proof (§5), implementation (§6), green + negative proof (§7), `npm ci --ignore-scripts && npm run check` exit 0.
3. Read-only spec-compliance review (§11); confirmed findings fixed on the branch, then re-verify.
4. Commit, push, open PR with exact scope: purpose, slice boundary, changes, red/green evidence, out-of-scope list, remaining gates.
5. `ci/check` success on the **exact PR head** — workflow `ci`, context `check`, `head_sha` equal to the PR head. Use `~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation <sha>` (exit 0 required). Never rerun or dispatch to force green.
6. Adversarial multi-lens review; no open Blocker/Important findings.
7. Fresh checkout at the exact head; `npm ci --ignore-scripts && npm run check` exit 0.
8. Pre-G2 readback; then **STOP at `READY FOR PO AUTHORIZATION`**.
9. **Human G2 artifact — created exclusively by the human PO.** The executing agent never creates, edits, or infers it. `node scripts/g2-authorization-gate.mjs <pr> <exact-head-sha>` must exit 0 before the audit comment.
10. Merge commit (`gh pr merge --merge`), read-after-write, local `main` fast-forwarded.
11. Main-CI verification on the merge SHA.
12. Jira/Confluence closeout with read-after-write and the idempotency pre-check; enumerate all affected pages upfront via CQL against space `PRODUKTMAN`.

`READY FOR PO AUTHORIZATION` is **not** merge permission. Merge, Jira `Fertig`, and Confluence
closeout are separate PO gates (AC9).

---

## 13. Rollback

The slice is a single-file, single-commit change with no data, schema, dependency, CI, or external
mutation. Rollback is correspondingly trivial:

- **Pre-commit:** `git checkout -- scripts/validate-current-repository.mjs` — full restore to the 60-check baseline.
- **Post-commit, pre-merge:** `git reset --hard origin/main` on the branch, or close the PR and delete the branch. `main` is untouched throughout.
- **Post-merge:** `git revert -m 1 <merge-sha>` via a new PR. Reverting restores the validator to 60 checks and re-opens ATLAS-58; no data migration, no external-system compensation, no dependency rollback is required.
- **Scratch copies:** `rm -rf "$SCRATCH"`. They are outside the repository and never contribute to any commit.

---

## 14. Assumptions / MISSING

No silent assumptions. Everything unverified is listed here.

**Verified in this session (not assumptions):** main SHA, worktree cleanliness, 0 open PRs, absence
of ATLAS-58 work, 60 checks, 41 registry tests, 137 total tests, the 2 AJV warnings, the RED
behavior of all five defect cases, the uncaught-ENOENT behavior, the patched 64-check GREEN result,
and all six POST-FIX negative-path outcomes.

- **M1 — Confluence pages 15171585 (DEC-05), 15237147 (DEC-09), 15040514 (Repository Assessment), 15171611 (Delivery/D4) were not individually re-read.** Page 19628033 cites them as its canonical sources and was read in full; this plan derives nothing from them beyond that citation. If the PO requires independent confirmation of DEC-05's V1 project list, that is a separate read.
- **M2 — `npm ci --ignore-scripts` was NOT executed during planning.** It mutates `node_modules` and requires network; the planning session is read-only. The full-suite baseline (137/137) was measured with the pre-existing `node_modules`. AC6 must be established by the implementation session.
- **M3 — Local Node is v24.16.0; CI pins Node 22.** All planning measurements are from v24.16.0. `.toSorted()` and optional chaining are available on both, and `src/registry/resolve.mjs:116` already uses `.toSorted()` in code that passes CI on Node 22. Residual risk: the exact `SyntaxError` message text in the N2 finding is engine-version-dependent and may differ on Node 22. **The negative-path assertions must therefore match on `VALIDATION FAILED` + exit 1 + absence of a stack trace, not on the verbatim parser message.**
- **M4 — The other twelve unguarded `readFile` calls remain a real, unaddressed fragility.** Verified present; deliberately out of scope. Recommend the PO consider a separate ticket. Not a blocker for ATLAS-58 and must not be fixed in this slice.
- **M5 — The exact insertion position within `REQUIRED_FILES` is a style judgment**, not a canonical requirement. Any position satisfies AC1; the proposed position preserves the array's directory grouping.
- **M6 — Planning-time prototyping disclosure.** The §4 patch was applied and measured in a disposable `git archive` copy under the session scratchpad, so §7's expected results are measured facts rather than predictions. The canonical repository was never modified: `git status --porcelain` returned 0 lines and `HEAD` remained `2a3f3e0d…` on branch `main` after all planning activity. No branch, no commit, no push, no repository file edit occurred. Nothing from the scratch copy is carried into the implementation.
- **M7 — Jira ATLAS-58 has 0 comments** and no linked PR. There is no additional PO instruction beyond the ticket description and Page 19628033.
- **M8 — `docs/plans/2026-08-10-bugfix-slice-review-findings.md` does not exist** at `2a3f3e0d…` (confirmed: not in the tree). No requirement in this plan derives from it. Both Jira and Page 19628033 explicitly state it is not execution-authorizing.

---

## 15. Plan Fidelity Self-Check

| # | Criterion | Verdict | Basis |
|---|---|---|---|
| 1 | Contract fidelity | **PASS** | Every task maps to a numbered AC and a Page-19628033 section (§2). Jira and Confluence were read fresh and agree with the prompt contract; no drift. |
| 2 | No requirement invention | **PASS** | Nothing added beyond the canonical five scope items. The historical `docs/plans/2026-08-10-…` file is treated as non-authoritative (M8). No PR text converted into a requirement. |
| 3 | Write-target discipline | **PASS** | Exactly one production file: `scripts/validate-current-repository.mjs`. Empirically confirmed — the prototype copy differs from the repo in that one file only. |
| 4 | Out-of-scope preservation | **PASS** | §10 lists forbidden files and actions; the AJV warnings, the twelve unguarded reads, ATLAS-59+, ATLAS-23, CI, dependencies, and policy/skill files are all explicitly excluded. |
| 5 | Testability | **PASS** | Every task carries an exact command and an exact expected number. All red and green results were measured, not predicted. |
| 6 | State freshness | **PASS** | `git fetch` executed; SHA, worktree, PR list, Jira, and Confluence all read fresh this session. No reliance on prior-session memory. |
| 7 | Explicit stop points | **PASS** | Stop gates at Task 0 (baseline deviation / already-implemented), Task 4 Step 3 (AC4 token grep), §10 (scope expansion), §8 (warning drift), §12 step 8 (`READY FOR PO AUTHORIZATION`). |
| 8 | Plan storage hygiene | **PASS** | Plan lives only in the session scratchpad; the skill's in-repo default was explicitly overridden and the override disclosed. Not committed; no branch created. |
| 9 | Right-sized depth | **PASS** | One bounded edit, existing `check()` helper, existing comparison idiom, no dependency, no schema framework, no new test infrastructure, no resolver import. Four checks, not more. |
| 10 | Correct execution mode | **PASS** | Planning session performed reads plus isolated scratch verification only. No repository mutation, no branch, no commit, no PR, no Jira/Confluence write, no G2 artifact. Execution handoff deliberately NOT taken (PLAN_REQUIRED_STOP). |

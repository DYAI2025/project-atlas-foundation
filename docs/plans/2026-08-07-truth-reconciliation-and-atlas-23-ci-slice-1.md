> **ARCHIVAL NOTE (2026-08-09, retroactive):** Historical plan of the executed
> 2026-08-07 truth-reconciliation and CI-slice-1 session (PRs #4 and #5 merged). The
> self-description "stays untracked unless the PO asks to commit it" and the
> do-not-commit scope entries described the execution session; archival happened via
> the PO-merged PR #6, this note was added retroactively in PR #10. Original content
> unchanged below.

# Truth Reconciliation (ATLAS-55) + ATLAS-23 CI Slice 1 — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Phase A: reconcile all stale current-state claims in the canonical repository after the ATLAS-55 runner recovery and the Sprint-1 Integration Wave (PRs #1/#3/#2 merged). Phase B: establish the first real automated quality gate (`check` context: `npm ci --ignore-scripts` + full `node --test` suite + foundation validator) as ATLAS-23 Slice 1. Then STOP — no further sprint slice.

**Architecture:** Two strictly sequential phases, each ending in its own small PR with adversarial review, G2 solo-owner exception (PO-authorized for exactly these two PRs), merge commit, read-after-write, and green main-CI. Phase A is docs/evidence-only (no feature code). Phase B migrates `foundation-consistency.yml` → canonical `ci.yml` with job/context `check`, updates the validator's required-files list accordingly, and adds `npm run check`. Every external fact is re-verified fresh before use; any material deviation is a hard STOP.

**Tech Stack:** `gh` CLI (GitHub), `git`, Node.js ≥ 22, `node --test`, npm, Atlassian MCP tools (`mcp__claude_ai_Atlassian__*` or `mcp__claude_ai_Atlassian_Rovo__*` — load via ToolSearch), GitHub Actions (SHA-pinned `actions/checkout` + `actions/setup-node`).

**Working directory:** local clone `/Users/benjaminpoersch/Projects/project-atlas-foundation` (canonical repo `DYAI2025/project-atlas-foundation`, private, default branch `main`).

---

## Verified baseline (planning time 2026-08-07 — RE-VERIFY at execution time, Task 1)

| Object | Expected | Verified at planning |
|---|---|---|
| `origin/main` | `e1a532a9626704a07a27b2891d8db29b2a615da4` (merge of PR #2) | ✅ via `gh api .../commits/main` |
| PR #1 | MERGED, merge commit `32610ac26f1eac91fdee358a0e5fc49a1dc2ec7a` | ✅ |
| PR #3 | MERGED, merge commit `02a9727fada57b59fb7917d000231df0956e7bf7` | ✅ |
| PR #2 | MERGED, merge commit `e1a532a9626704a07a27b2891d8db29b2a615da4` | ✅ |
| Open PRs | 0 | ✅ |
| Run `31175543815` | workflow `foundation-consistency`, event `push`, branch `main`, head `e1a532a…`, `success` | ✅ via `gh api .../actions/runs/31175543815` |
| `npm test` local | 57 pass, 0 fail (`node --test`) | ✅ run locally |
| `node scripts/validate-current-repository.mjs` | `VALIDATION PASSED` (42 checks) | ✅ per blockers.md; re-run at execution |
| `.github/workflows/` | `foundation-consistency.yml` (validator only, **no** `npm test`, **no** `permissions:` block) + `actions-probe.yml` | ✅ read |
| `package.json` scripts | only `"test": "node --test"` — no `check` script | ✅ read |
| Local clone | in sync with origin/main; ONE untracked file `docs/plans/2026-08-07-sprint-1-integration-wave.md` | ✅ `git status` |
| Jira (expected, from last run) | ATLAS-12/13/22 = In Arbeit, ATLAS-23 = Zu erledigen, ATLAS-55 = Fertig | ⚠ NOT yet verified — Task 0 |

**Known reference data (from project memory, re-verify on use):**
- Jira cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`; ATLAS transitions: `11` = Zu erledigen, `21` = In Arbeit, `31` = Fertig. Jira board 304, Sprint 370.
- ATLAS-55 Erfolgsweg evidence lives in Jira comment `12347` (6 successful hosted-runner runs). Per-PR G2 audit comments: PR #1 → `5216362872`, PR #3 → `5216433381`, PR #2 → `5216663238`.
- Confluence page for ATLAS-23 documentation: `15040514` (space PRODUKTMAN). Owner order allows direct update with mandatory read-after-write.
- Known wrong-direction Jira links (report-only, do NOT touch): issue links `10666`/`10667` claim "ATLAS-13/23 blocks ATLAS-55" — semantically reversed.

## Global STOP rules (apply to every task)

1. Any material deviation from the verified baseline (wrong main SHA, unexpected open PR, Jira state differing from the expected table, failed re-verification) → **STOP, report, do not continue.**
2. Phase B starts ONLY after the Phase A merge is complete and main-CI is green. If Phase A fails anywhere → STOP; ATLAS-23 is not started.
3. Never invent a root cause for the 2026-08-06 runner failures. The only permitted classification is `UNKNOWN_PLATFORM_OR_POLICY`.
4. Never delete or rewrite historical evidence (old failure runs, support case body, historical report sections). History stays history; only *current-state* claims are corrected.
5. BLK-ATLAS-13-01 (branch protection) stays **OPEN** everywhere. It must never be merged/confused with BLK-ATLAS-13-02/ATLAS-55.
6. No Jira ticket transitions to `Fertig` in this session. ATLAS-23 goes at most to `In Arbeit`.
7. Every mutation (Jira, Confluence, GitHub merge) gets an immediate read-after-write verification.
8. After Phase B: STOP. No Slice 2, no gitleaks, no osv-scanner, no license check, no ATLAS-24, no ATLAS-12/22 rest-scope.
9. Out of scope, do NOT commit: the untracked local file `docs/plans/2026-08-07-sprint-1-integration-wave.md` (leave untracked; mention in final report as PO decision candidate). Do not touch `actions-probe.yml` (historical diagnostic; flag as future cleanup candidate in the final report).
10. `.gitignore` note: this plan file itself (`docs/plans/2026-08-07-truth-reconciliation-and-atlas-23-ci-slice-1.md`) stays untracked unless the PO asks to commit it.

## Validator invariants (MUST survive every Phase A edit)

`scripts/validate-current-repository.mjs` (read it before editing anything) enforces, among 42 checks:

- `reports/release-decision.json`: parses as JSON; contains NO `/mnt/data`, NO `migration decision` (case-insensitive), NO `github-handoff`; `foundation_maturity` and `merge_readiness` are strings; `repository.canonical === "DYAI2025/project-atlas-foundation"`; `repository.push_verified === true`; raw text contains `BLK-ATLAS-13-01`.
- `reports/validation-report.md`: contains headings `## Historical imported validation` AND `## Current canonical repository validation`; no `github-handoff`.
- `docs/plans/2026-08-06-atlas-sprint-1-foundation.md`: heading regex `^## ATLAS-(\d+) — (.*)$` must yield exactly delivery tickets 11,12,13,15,21,22,23,24 and exactly one enabler heading containing `Sprint Enabler` for ATLAS-55 → **never add/modify `## ATLAS-N — …` headings**; `confluence_space_key` values stay `PRODUKTMAN`; strings `5505026` and `7503873` stay present.
- `README.md`: no `github-handoff`.
- Required file `.github/workflows/foundation-consistency.yml` exists — **this is why Phase B must update the validator in the same commit that renames the workflow.**

---

# PHASE 0 — CAPABILITY PROBE + JIRA STATE GATE

### Task 0.1: Load Atlassian tools and probe capabilities

**Step 1:** ToolSearch (ONE call): `select:mcp__claude_ai_Atlassian__atlassianUserInfo,mcp__claude_ai_Atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql,mcp__claude_ai_Atlassian__getJiraIssue,mcp__claude_ai_Atlassian__addCommentToJiraIssue,mcp__claude_ai_Atlassian__getTransitionsForJiraIssue,mcp__claude_ai_Atlassian__transitionJiraIssue,mcp__claude_ai_Atlassian__getConfluencePage,mcp__claude_ai_Atlassian__updateConfluencePage`
(If the `claude_ai_Atlassian` server errors, fall back to the `claude_ai_Atlassian_Rovo__*` variants of the same tools.)

**Step 2:** Probe Jira/Confluence read: `atlassianUserInfo`, `getAccessibleAtlassianResources` (expect cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`), `getJiraIssue` for ATLAS-23, `getTransitionsForJiraIssue` for ATLAS-23, `getConfluencePage` 15040514 (read title + version number — do NOT write yet). Confluence *write* capability is treated as verified at its first real write (Task B.10) with read-after-write; no junk-write probe.

**Step 3:** Probe GitHub: run
```bash
gh auth status
gh api repos/DYAI2025/project-atlas-foundation --jq '{private:.private,default_branch:.default_branch,permissions:.permissions}'
```
Expected: authenticated; `permissions.push` and `permissions.admin` true (merge capability). Actions API access is proven by Task 1's run lookup.

**Step 4:** Record a capability table (Jira search/read/comment/transitions, Confluence read [+write deferred-verified], GitHub repo/commit/branch/PR/reviews/actions/merge) for the final report. Any hard capability failure → STOP.

### Task 0.2: Jira state gate

**Step 1:** `searchJiraIssuesUsingJql` with JQL: `project = ATLAS AND key in (ATLAS-12, ATLAS-13, ATLAS-22, ATLAS-23, ATLAS-55)` — fields: status, sprint. Also read Sprint 370 content: JQL `sprint = 370 ORDER BY key` (fields: key, status, issuetype).

**Step 2:** Compare against expected: ATLAS-12 = In Arbeit, ATLAS-13 = In Arbeit, ATLAS-22 = In Arbeit, ATLAS-23 = Zu erledigen, ATLAS-55 = Fertig. **Material deviation → STOP and report** (per PO order). Record the full sprint state for the final report.

---

# PHASE A — REPOSITORY TRUTH RECONCILIATION

### Task A.1: Fresh GitHub + local baseline verification

**Step 1:**
```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin && git checkout main && git pull --ff-only origin main
git rev-parse HEAD
```
Expected: HEAD `e1a532a9626704a07a27b2891d8db29b2a615da4`. Different SHA → STOP (main moved; report).

**Step 2:**
```bash
gh pr list -R DYAI2025/project-atlas-foundation --state open --json number   # expected: []
gh pr list -R DYAI2025/project-atlas-foundation --state merged --json number,mergeCommit --limit 5
gh api repos/DYAI2025/project-atlas-foundation/actions/runs/31175543815 --jq '{id,status,conclusion,head_sha,name,event,head_branch}'
```
Expected: 0 open PRs; merge commits `32610ac…` (#1), `02a9727…` (#3), `e1a532a…` (#2); run `31175543815` = `completed`/`success`, `foundation-consistency`, `push`, `main`, head `e1a532a…`.

**Step 3:** Reproduce local validation baseline:
```bash
npm ci --ignore-scripts
npm test 2>&1 | tail -8
node scripts/validate-current-repository.mjs | head -3
```
Expected: `pass 57`, `fail 0`; `VALIDATION PASSED`. Record the actual pass count (do not assume 57 — if it differs, use the measured number in all evidence below).

**Step 4:** Enumerate successful hosted runs for the recovery evidence (needed in Task A.3):
```bash
gh run list -R DYAI2025/project-atlas-foundation --workflow foundation-consistency --limit 15 \
  --json databaseId,conclusion,headSha,event,createdAt
```
Keep the list of `success` runs (IDs + head SHAs + dates). Only cite run IDs you verified in this output.

### Task A.2: Create the reconciliation branch

**Step 1:**
```bash
git checkout -b docs/ATLAS-55-runner-recovery-reconciliation
```

### Task A.3: Fix `docs/governance/blockers.md` (BLK-ATLAS-13-02 → CLOSED, BLK-ATLAS-13-01 untouched)

**Files:** Modify: `docs/governance/blockers.md`

**Step 1:** Read the file. In the `## BLK-ATLAS-13-02` section, keep the ENTIRE historical body (Teilbefund 1/2, Versuche, Klassifikation, Owner-Aktionen, Interim-Evidenz) unchanged, then:

a) Change the heading to mark resolution (heading text stays recognizable):
```markdown
## BLK-ATLAS-13-02 — GitHub Actions: Hosted-Runner akquiriert keine Jobs (Jira: ATLAS-55) — RESOLVED 2026-08-07
```

b) Replace ONLY the final stale status bullet
`- **Status:** OPEN — verhindert weiterhin den CI-Ausführungsnachweis für PR #1 …`
with a recovery + status block (fill run IDs from Task A.1 Step 4; keep the annotation quote exact):

```markdown
- **Recovery (2026-08-07):** Seit 2026-08-07 akquirieren GitHub-hosted Runner
  wieder Jobs für dieses Repository. Erfolgreiche `foundation-consistency`-Runs
  liegen auf allen drei Sprint-PR-Heads und auf `main` vor (final: Run
  31175543815, `push` auf `main`, Head `e1a532a9626704a07a27b2891d8db29b2a615da4`,
  `success`; vollständige Liste der Erfolgs-Runs in Jira ATLAS-55, Kommentar 12347).
  ATLAS-55 wurde über den im Sprintplan definierten Erfolgsweg auf `Fertig`
  gesetzt. Die historischen Fehlläufe vom 2026-08-06 (oben) bleiben unverändert
  dokumentierte Fakten.
- **Root Cause:** `UNKNOWN_PLATFORM_OR_POLICY` — der Grund der ursprünglichen
  Akquisitionsfehler wurde von GitHub nie benannt und bleibt unbekannt. Es wird
  ausdrücklich KEIN kausaler Claim (Billing/Policy/Plattform) erhoben.
- **Status:** CLOSED / RESOLVED (operational) — 2026-08-07. Kein offener
  Runner-Blocker mehr. Unabhängig davon bleibt BLK-ATLAS-13-01 (Branch
  Protection) OFFEN und ist ein separater Blocker.
```

**Step 2:** Verify the `## BLK-ATLAS-13-01` section is byte-identical to before (its `Status: OPEN (Interim akzeptiert) …` line stays). `git diff docs/governance/blockers.md` must show changes ONLY inside the 13-02 section.

### Task A.4: Fix `docs/plans/2026-08-06-atlas-sprint-1-foundation.md` (ATLAS-55 enabler section)

**Files:** Modify: `docs/plans/2026-08-06-atlas-sprint-1-foundation.md`

**Constraint:** Do NOT touch any `## ATLAS-N — …` heading (validator regex). Edit only body text inside the ATLAS-55 section.

**Step 1:** In section `## ATLAS-55 — Sprint Enabler / Delivery Blocker (kein Delivery-Outcome)`:
- Prefix the two present-tense paragraphs with a date marker: `**Befund:**` → `**Befund (Stand 2026-08-06, historisch):**` and `**Wirkung auf Delivery:**` → `**Wirkung auf Delivery (Stand 2026-08-06, historisch):**`.
- Append at the end of the section (before the next `---`):

```markdown
**Abschluss (2026-08-07):** Der Erfolgsweg ist eingetreten. Hosted Runner
akquirieren seit 2026-08-07 Jobs; `foundation-consistency` lief erfolgreich auf
den PR-Heads von PR #1/#3/#2 und auf `main` (final: Run 31175543815 auf
`e1a532a`). ATLAS-55 steht auf `Fertig` (Evidenz: Jira-Kommentar 12347).
Root Cause der ursprünglichen Fehlläufe bleibt `UNKNOWN_PLATFORM_OR_POLICY`
(unbekannt, kein kausaler Claim). Die PRs #1/#3/#2 sind per Merge-Commit auf
`main` integriert (Integration Wave 2026-08-07); die oben beschriebene
Merge-Blockade besteht nicht mehr. BLK-ATLAS-13-01 (Branch Protection) bleibt
davon unberührt OFFEN.
```

**Step 2:** Run `node scripts/validate-current-repository.mjs` — expected `VALIDATION PASSED` (heading checks intact).

### Task A.5: Regenerate `reports/release-decision.json` current state

**Files:** Modify: `reports/release-decision.json`

**Step 1:** Replace the file content with the following (regeneration, not patching — no contradictory leftovers). Set `generated_at` to the actual execution UTC timestamp. Keep `status: NOT_READY` (no release candidate — real release gates still missing):

```json
{
  "schema_version": "1.1",
  "generated_at": "<EXECUTION-UTC-ISO8601>",
  "status": "NOT_READY",
  "subject": "Project ATLAS canonical foundation repository DYAI2025/project-atlas-foundation",
  "repository": {
    "canonical": "DYAI2025/project-atlas-foundation",
    "visibility": "private",
    "default_branch": "main",
    "bootstrap_commit": "3b60912",
    "bootstrap_exception": "BOOTSTRAP_EXCEPTION_ATLAS_13",
    "integrated_main": "e1a532a9626704a07a27b2891d8db29b2a615da4",
    "merged_pull_requests": [
      { "pr": "PR #1 (ATLAS-13 Sprint-1-Foundation)", "merge_commit": "32610ac26f1eac91fdee358a0e5fc49a1dc2ec7a" },
      { "pr": "PR #3 (ATLAS-12 writer registry, Slice 1)", "merge_commit": "02a9727fada57b59fb7917d000231df0956e7bf7" },
      { "pr": "PR #2 (ATLAS-22 local adapter contract, Slice 1)", "merge_commit": "e1a532a9626704a07a27b2891d8db29b2a615da4" }
    ],
    "open_pull_requests": 0,
    "push_verified": true,
    "legacy_reference": "DYAI2025/gbrain-atlas pinned at aea0fb0b934780a205db92066786b265de0de22a (read-only)",
    "deprecated_snapshot": "DYAI2025/Gbrain-vps (private, non-canonical)"
  },
  "foundation_maturity": "Sprint-1 foundation slices are integrated on main. The full Node test suite (node --test) passes locally and in fresh checkouts; the repository-consistency validator passes locally AND on GitHub-hosted CI (workflow foundation-consistency, latest main run 31175543815, success). Hosted CI does not yet execute the test suite itself (validator only) — closing that gap is ATLAS-23. Not runtime_verified: no VPS/PostgreSQL/gbrain runtime verification has happened.",
  "merge_readiness": "INTEGRATED — all three Sprint-1 PRs (#1, #3, #2) were merged to main via merge commits on 2026-08-07 under the PO-authorized G2 solo-owner exception (per-PR audit comments 5216362872, 5216433381, 5216663238). 0 open PRs. Hosted-runner acquisition is operational again (BLK-ATLAS-13-02 closed 2026-08-07; original root cause UNKNOWN_PLATFORM_OR_POLICY). Future PRs still merge under documented PR policy without technical branch protection (BLK-ATLAS-13-01, open).",
  "blocking_issues": [
    "ATLAS-14 architecture approval",
    "ATLAS-16 VPS audit",
    "Canonical data model and RLS contracts (ATLAS-54) incomplete",
    "Production runtime adapter missing",
    "BLK-ATLAS-13-01: technical branch protection unavailable on the current plan (open; documented interim per Owner decision 2026-08-06); required before productive agent write (DEC-10)",
    "ATLAS-23 CI/security gates incomplete: hosted CI runs the consistency validator only; full test suite in CI, secret scanning, vulnerability scanning, license compliance, and required-checks wiring are missing",
    "ATLAS-12 / ATLAS-22 tickets remain In Arbeit: Slice 1 integrated, remaining ticket scope open"
  ],
  "limitations": [
    "No VPS, Docker, PostgreSQL, Bun, or gbrain runtime verification.",
    "No SBOM or vulnerability scan in the canonical repository yet (ATLAS-23/ATLAS-24).",
    "Historical dry-run validation results are imported evidence and make no claim about the current repository state.",
    "Test-suite execution evidence on hosted CI does not exist yet (local + fresh-checkout evidence only); the hosted CI evidence to date covers the consistency validator."
  ],
  "decision_reason": "The canonical repository is integrated on main with green hosted CI (consistency validator) and a locally green full test suite. It is NOT a release candidate: architecture approval, VPS audit, data-model/RLS contracts, runtime adapter, technical branch protection, and the ATLAS-23/24 CI+security gates are outstanding. All 14 release gates must be evidenced before any productive agent publish.",
  "next_actions": [
    "ATLAS-23 Slice 1: canonical ci.yml with check context (clean install + full test suite + consistency validator) on every PR and main.",
    "Later ATLAS-23 slices: secret scanning, vulnerability scanning, license compliance, required-checks wiring (needs BLK-ATLAS-13-01 resolution).",
    "Resolve BLK-ATLAS-13-01 (Pro upgrade or org move) before the release gate.",
    "Complete ATLAS-14, ATLAS-16, and the canonical data/RLS contracts before any runtime implementation."
  ]
}
```

**Step 2:** `node scripts/validate-current-repository.mjs` → `VALIDATION PASSED`. Also `python3 -c "import json;json.load(open('reports/release-decision.json'))"` (or `node -e`) to prove valid JSON.

### Task A.6: Regenerate the current section of `reports/validation-report.md`

**Files:** Modify: `reports/validation-report.md`

**Step 1:** Keep `## Historical imported validation` (and its intro block) byte-identical. Replace everything from `## Current canonical repository validation` to the end of the file with (fill measured test count and run IDs from Task A.1):

```markdown
## Current canonical repository validation

Stand: 2026-08-07 (nach Sprint-1 Integration Wave), Repository
`DYAI2025/project-atlas-foundation`, `main` =
`e1a532a9626704a07a27b2891d8db29b2a615da4`.

| Prüfung | Ergebnis |
|---|---|
| Privates Repository (`gh repo view`: PRIVATE, default `main`) | ✅ |
| Integration: PR #1/#3/#2 per Merge-Commit auf `main` (`32610ac`, `02a9727`, `e1a532a`), 0 offene PRs | ✅ |
| G2-Solo-Owner-Exception je PR dokumentiert (Audit-Kommentare 5216362872, 5216433381, 5216663238) | ✅ |
| Hosted CI operational: `foundation-consistency` `success` auf allen drei PR-Heads und auf `main` (final Run 31175543815) — BLK-ATLAS-13-02 geschlossen 2026-08-07, Root Cause der historischen Fehlläufe `UNKNOWN_PLATFORM_OR_POLICY` | ✅ |
| Vollständige Node-Test-Suite (`npm test`, `node --test`): 57 pass / 0 fail — lokal und im Fresh Checkout (2026-08-07). Hosted CI führt die Test-Suite noch NICHT aus (nur Validator) → offen unter ATLAS-23 | ✅ lokal |
| Repository-Konsistenz (`scripts/validate-current-repository.mjs`, 42 Checks): `VALIDATION PASSED` — lokal UND auf Hosted CI | ✅ |
| Unabhängiges menschliches Review | ❌ nicht vorhanden — je PR durch die PO-autorisierte G2-Solo-Owner-Exception ersetzt (ersetzt ausschließlich das unabhängige menschliche Approval, nicht CI/Tests/Findings/DoD) |
| Branch Protection | ⛔ BLK-ATLAS-13-01 OFFEN (GitHub Free, privates Repo; Interim per Owner-Entscheidung 06.08.2026) |

## Honest maturity

Ursprungspaket: `tested` für isolierte Foundation-Primitives (historisch,
siehe oben). Kanonisches Repository: `integrated + consistency-validated`
auf `main`; Test-Suite-Evidenz lokal/Fresh-Checkout, Validator-Evidenz
lokal + Hosted CI. Nicht `runtime_verified`. Kein Release-Kandidat —
offene Gates siehe `reports/release-decision.json` (`NOT_READY`).
```

**Step 2:** `node scripts/validate-current-repository.mjs` → `VALIDATION PASSED` (both section headings present).

### Task A.7: Fix `README.md`

**Files:** Modify: `README.md`

**Step 1:** Replace the static test-count line:
```
npm test          # canonical: node --test  (16 tests)
```
with (no static count — robust against suite growth):
```
npm test          # canonical: node --test — runs the full current test suite
```

**Step 2:** Fix the stale bootstrap sentence. Replace
`All foundation content arrives via pull request on `feat/ATLAS-13-sprint-1-foundation`.`
with:
`All foundation content arrived via pull request (PR #1 on feat/ATLAS-13-sprint-1-foundation, merged to main 2026-08-07 together with PR #3 and PR #2).`

**Step 3:** `grep -n "16 tests" README.md` → no matches.

### Task A.8: Mark the support case document as resolved (historical evidence)

**Files:** Modify: `docs/support/github-actions-runner-acquisition-case.md`

**Step 1:** Directly under the title line, insert (body below stays byte-identical — it is API-backed history):

```markdown
> **Status: RESOLVED (operational) — 2026-08-07.** Hosted-Runner-Akquisition
> funktioniert seit 2026-08-07 wieder (erfolgreiche Runs auf allen Sprint-PR-Heads
> und `main`, final Run 31175543815). Der ursprüngliche Grund wurde von GitHub nie
> benannt und bleibt `UNKNOWN_PLATFORM_OR_POLICY`. Der Support-Case wurde nicht
> mehr eröffnet. Alles Folgende ist historische Evidenz vom 2026-08-06/07.
```

### Task A.9: Repo-wide stale-claim sweep (must be empty)

**Step 1:**
```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
grep -rn -iE "runner acquisition|HOSTED_RUNNER_ACQUISITION_FAILURE|ATLAS-55|BLK-ATLAS-13-02|not acquired|16 tests|merge.?readiness|CI.{0,20}block" \
  --include="*.md" --include="*.json" . | grep -v node_modules | grep -v package-lock | grep -v "docs/plans/2026-08-07"
```

**Step 2:** Review EVERY hit manually. Each remaining occurrence must be either (a) inside an explicitly marked historical section/document, or (b) a correct current-state statement (e.g. "BLK-ATLAS-13-02 closed"). Any hit that still presents ATLAS-55 as an open runner blocker, PR #1 as unmerged, CI as blocked, or CI evidence as local-only → fix it (same reconciliation semantics), re-run this task.

### Task A.10: Full local validation of Phase A

**Step 1:**
```bash
npm ci --ignore-scripts && npm test 2>&1 | tail -6 && node scripts/validate-current-repository.mjs | head -3
```
Expected: `pass 57` (or measured count) / `fail 0`; `VALIDATION PASSED`.

**Step 2:** Fresh checkout validation:
```bash
FRESH=$(mktemp -d)/atlas-fresh-a
git clone --branch docs/ATLAS-55-runner-recovery-reconciliation \
  /Users/benjaminpoersch/Projects/project-atlas-foundation "$FRESH" 2>/dev/null \
  || git clone https://github.com/DYAI2025/project-atlas-foundation "$FRESH"
cd "$FRESH" && git checkout docs/ATLAS-55-runner-recovery-reconciliation 2>/dev/null || true
npm ci --ignore-scripts && npm test 2>&1 | tail -4 && node scripts/validate-current-repository.mjs | head -1
```
(Run the fresh clone AFTER the branch is pushed in Task A.11 if cloning from GitHub; a local clone of the pushed branch state is acceptable as long as it contains the exact commit.) Expected: same green results.

### Task A.11: Commit, push, open PR A

**Step 1:**
```bash
git add docs/governance/blockers.md docs/plans/2026-08-06-atlas-sprint-1-foundation.md \
  reports/release-decision.json reports/validation-report.md README.md \
  docs/support/github-actions-runner-acquisition-case.md
git status --short   # ONLY the six files above staged; integration-wave plan + this plan stay untracked
git commit -m "docs(ATLAS-55): reconcile runner recovery evidence"
git push -u origin docs/ATLAS-55-runner-recovery-reconciliation
```

**Step 2:** Open the PR (docs/evidence only, no feature code):
```bash
gh pr create -R DYAI2025/project-atlas-foundation \
  --title "docs(ATLAS-55): reconcile runner recovery evidence" \
  --body "$(cat <<'EOF'
## Purpose
Repository truth reconciliation after ATLAS-55 runner recovery and the Sprint-1 Integration Wave (2026-08-07). Docs/evidence/governance only — no feature code.

## Corrections (current-state claims only; history preserved)
- BLK-ATLAS-13-02 / ATLAS-55: CLOSED/RESOLVED operationally (recovery 2026-08-07, root cause remains UNKNOWN_PLATFORM_OR_POLICY — no causal claim).
- BLK-ATLAS-13-01 (branch protection): remains OPEN, untouched.
- release-decision.json / validation-report.md: current-state sections regenerated — repository integrated on main (PRs #1/#3/#2 merged), hosted CI operational, local + hosted CI evidence separated honestly (test suite evidence is local-only until ATLAS-23), still NOT a release candidate.
- README: removed stale static test count ("16 tests") and stale bootstrap-branch claim.
- Support case doc: marked RESOLVED as historical evidence.

## Evidence
- main: e1a532a9626704a07a27b2891d8db29b2a615da4; PRs #1 (32610ac), #3 (02a9727), #2 (e1a532a) merged; 0 open PRs.
- CI: foundation-consistency run 31175543815 success on main.
- Local: npm ci --ignore-scripts, npm test (full suite green), validator VALIDATION PASSED; fresh checkout green.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task A.12: CI green on PR A

**Step 1:** Wait for the automatically triggered `foundation-consistency` run on the exact PR head:
```bash
HEAD=$(gh pr view <PR-A-number> -R DYAI2025/project-atlas-foundation --json headRefOid -q .headRefOid)
gh run list -R DYAI2025/project-atlas-foundation --commit "$HEAD" --json databaseId,conclusion,status,name
```
Expected: `foundation-consistency` → `completed`/`success` on exactly `$HEAD`. No manual runner experiments, no workflow_dispatch, no reruns unless the run itself failed for a real reason (then STOP and report — do not experiment).

### Task A.13: Adversarial read-only review of PR A

**Step 1:** Dispatch a fresh subagent (read-only; superpowers:requesting-code-review pattern) with the PR diff and this explicit checklist:
- Historical facts accidentally overwritten or deleted? (failure runs, annotations, old counts, historical sections)
- Any invented root cause? (only `UNKNOWN_PLATFORM_OR_POLICY` is allowed)
- BLK-ATLAS-13-01 accidentally closed, weakened, or conflated with 13-02?
- Release readiness overstated? (must remain NOT_READY, no release candidate)
- Test-suite CI evidence overstated? (hosted CI runs validator only until ATLAS-23 — local/hosted evidence must be separated)
- Contradiction between repo claims and Jira/GitHub reality?
- Validator invariants intact (see "Validator invariants" section above)?

**Step 2:** Findings → fix on the branch, re-run Task A.9 + A.10, push, wait for green CI on the new head, re-review. Loop until no findings.

### Task A.14: G2 gate, merge, read-after-write

**Step 1:** Verify the solo-owner precondition FRESH:
```bash
gh api repos/DYAI2025/project-atlas-foundation/collaborators --jq 'length'
```
Expected: `1`. If >1 real collaborators → STOP (G2 exception not applicable; request human review).

**Step 2:** Post the audit comment on the PR (BEFORE merging):
```bash
gh pr comment <PR-A-number> -R DYAI2025/project-atlas-foundation --body "$(cat <<'EOF'
PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION

- Precondition verified fresh: repository has exactly 1 real collaborator (solo owner).
- The G2 exception replaces ONLY the independent human approval. It does NOT replace: CI (green foundation-consistency run on the exact PR head), tests (local + fresh checkout green), adversarial review (findings closed), or DoD.
- Evidence: PR head <HEAD-SHA>, CI run <RUN-ID> success, adversarial review completed with 0 open findings.
- Scope: docs/evidence reconciliation only (ATLAS-55 recovery); PO-authorized for exactly this PR.
EOF
)"
```

**Step 3:** Merge with a merge commit; read-after-write:
```bash
gh pr merge <PR-A-number> -R DYAI2025/project-atlas-foundation --merge
gh pr view <PR-A-number> -R DYAI2025/project-atlas-foundation --json state,mergeCommit
git fetch origin && git checkout main && git pull --ff-only origin main && git rev-parse HEAD
```
Expected: state MERGED; local main == remote main == the new merge commit.

**Step 4:** Verify main-CI green on the new main head:
```bash
gh run list -R DYAI2025/project-atlas-foundation --commit "$(git rev-parse HEAD)" --json databaseId,conclusion,status,name
```
Expected: `foundation-consistency` `success`. **Phase A complete. If anything above failed → STOP; do NOT start Phase B.**

---

# PHASE B — ATLAS-23 CI FOUNDATION SLICE 1

### Task B.1: Jira ATLAS-23 fresh read + transition to In Arbeit

**Step 1:** `getJiraIssue` ATLAS-23 (fresh — do not reuse Task 0.2 data) and `getTransitionsForJiraIssue` ATLAS-23. Expected status `Zu erledigen` with an available transition to `In Arbeit` (expected id `21` — use the id actually returned).

**Step 2:** `transitionJiraIssue` ATLAS-23 → In Arbeit. Read-after-write: `getJiraIssue` ATLAS-23 → status `In Arbeit`. If the transition is not available → STOP and report.

### Task B.2: Reproduce the current CI gap (red baseline)

**Step 1:** On updated `main`:
```bash
git checkout -b feat/ATLAS-23-ci-baseline-slice-1
cat .github/workflows/foundation-consistency.yml
npm ci --ignore-scripts && npm test 2>&1 | tail -4 && node scripts/validate-current-repository.mjs | head -1
```
Confirm: workflow runs ONLY the validator (no `npm ci`, no `npm test`, no `permissions:` block). Record as "previous CI gap" for the final report.

### Task B.3: Add `npm run check` (test-first)

**Files:** Modify: `package.json`

**Step 1 (red):** `npm run check` → expected: `npm error Missing script: "check"`.

**Step 2:** Add the script (tests + foundation consistency — ONLY implemented checks, no fake lint/format/type/security gates):
```json
"scripts": {
  "test": "node --test",
  "check": "npm test && node scripts/validate-current-repository.mjs"
}
```

**Step 3 (green):** `npm run check` → full suite green (`fail 0`) AND `VALIDATION PASSED`, exit code 0 (`echo $?`).

### Task B.4: Migrate validator required-files to `ci.yml` (red)

**Files:** Modify: `scripts/validate-current-repository.mjs` (line ~42)

**Step 1:** In `REQUIRED_FILES`, replace `'.github/workflows/foundation-consistency.yml'` with `'.github/workflows/ci.yml'`.

**Step 2 (red):** `node scripts/validate-current-repository.mjs` → expected `VALIDATION FAILED` with `✗ file exists: .github/workflows/ci.yml`. This is the failing test proving the validator now demands the canonical workflow.

### Task B.5: Create `ci.yml`, remove `foundation-consistency.yml` (green)

**Files:** Create: `.github/workflows/ci.yml` · Delete: `.github/workflows/foundation-consistency.yml`

**Step 1:** Write `.github/workflows/ci.yml` exactly (action SHAs are the SAME already-proven pins from the existing workflow — verified working in this repo; do NOT invent new SHAs):

```yaml
name: ci

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: '22'
      - run: npm ci --ignore-scripts
      - run: npm test
      - run: node scripts/validate-current-repository.mjs
```

Design notes: job id = check context = `check` (stable context for future `secret-scan`/`vuln-scan` siblings). Three separate run steps (not `npm run check`) for step-level failure attribution in CI; `npm run check` remains the canonical LOCAL command. `foundation-consistency.yml` is fully subsumed (same validator step, same triggers) → removed, no permanent duplicate CI. `actions-probe.yml` stays untouched (historical diagnostic, fires only on changes to its own file).

**Step 2:**
```bash
git rm .github/workflows/foundation-consistency.yml
```

**Step 3 (green):** `node scripts/validate-current-repository.mjs` → `VALIDATION PASSED`. Then `npm run check` → green.

### Task B.6: README one-liner for the canonical check command

**Files:** Modify: `README.md`

**Step 1:** In the setup code block, after the `npm test` line, add:
```
npm run check     # canonical local gate: full test suite + repository-consistency validator (same checks as CI job `check`)
```
No static test count anywhere.

### Task B.7: Local + fresh-checkout validation of Phase B

**Step 1:** `npm ci --ignore-scripts && npm run check` → green (record actual pass count; do not hardcode it anywhere).

**Step 2:** Commit and push (needed for a true fresh checkout):
```bash
git add .github/workflows/ci.yml package.json scripts/validate-current-repository.mjs README.md
git status --short   # exactly these 4 changes + the deletion; nothing else
git commit -m "feat(ATLAS-23): CI quality baseline slice 1 — check context (clean install + full test suite + foundation consistency)"
git push -u origin feat/ATLAS-23-ci-baseline-slice-1
```

**Step 3:** Fresh checkout:
```bash
FRESH=$(mktemp -d)/atlas-fresh-b
git clone https://github.com/DYAI2025/project-atlas-foundation "$FRESH"
cd "$FRESH" && git checkout feat/ATLAS-23-ci-baseline-slice-1
npm ci --ignore-scripts && npm run check
```
Expected: green, exit 0.

### Task B.8: Open PR B, verify `check` context

**Step 1:**
```bash
gh pr create -R DYAI2025/project-atlas-foundation \
  --title "ATLAS-23: CI quality baseline — Slice 1 (check context)" \
  --body "$(cat <<'EOF'
## Delivery value
Until now hosted CI only proved repository consistency (validator); the full Node test suite ran only locally. This slice establishes the first real automated quality gate on every PR and on main.

## Slice boundary (exactly this, no more)
GitHub Actions job/context `check` on pull_request + push(main):
1. checkout (SHA-pinned) · 2. Node 22 (SHA-pinned setup-node) · 3. `npm ci --ignore-scripts` · 4. `npm test` (full current suite) · 5. `node scripts/validate-current-repository.mjs` · minimal permissions (`contents: read`).

## Changes
- `.github/workflows/ci.yml` — canonical workflow, job `check` (subsumes foundation-consistency's validator function).
- `.github/workflows/foundation-consistency.yml` — removed (no permanent duplicate CI).
- `scripts/validate-current-repository.mjs` — required-files entry migrated to `ci.yml`.
- `package.json` — canonical local gate `npm run check` (tests + validator; only implemented checks).
- `README.md` — documents `npm run check`.

## Evidence
- Local: `npm run check` green (full suite, 0 fail; VALIDATION PASSED).
- Fresh checkout: `npm ci --ignore-scripts && npm run check` green.
- CI: `check` run on this PR head (see checks).

## Out of scope (later ATLAS-23/24 slices)
ESLint, Prettier, type-check, gitleaks/secret-scan, osv-scanner/vuln-scan, license compliance, SBOM, branch protection & required-checks wiring, deployment.

## Remaining ATLAS-23 gates (ticket stays In Arbeit)
format, lint, type-check, secret-scan context, vuln-scan context, license compliance, required-checks wiring (blocked by BLK-ATLAS-13-01, open).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 2:** Wait for CI on the exact PR head:
```bash
HEAD=$(gh pr view <PR-B-number> -R DYAI2025/project-atlas-foundation --json headRefOid -q .headRefOid)
gh run list -R DYAI2025/project-atlas-foundation --commit "$HEAD" --json databaseId,conclusion,name,workflowName
gh pr checks <PR-B-number> -R DYAI2025/project-atlas-foundation
```
Expected: workflow `ci`, job/context `check` → `success` on exactly `$HEAD`; `foundation-consistency` does NOT run on this PR (deleted on the branch). Inspect the run's jobs to confirm all five steps executed:
```bash
gh api repos/DYAI2025/project-atlas-foundation/actions/runs/<RUN-ID>/jobs --jq '.jobs[] | {name, conclusion, steps: [.steps[] | {name, conclusion}]}'
```

### Task B.9: Adversarial review of PR B

**Step 1:** Fresh read-only subagent with the diff and checklist:
- Are the action SHAs exactly the pins already proven in this repo (no guessed/major-tag refs)?
- Does `check` really run install + FULL test suite + validator (no silent narrowing)?
- Any fake gates named (lint/format/type/security) that are not implemented?
- Is old CI fully subsumed (validator still runs) and duplicate CI really gone?
- `permissions: contents: read` present and sufficient; nothing broader?
- Validator required-files migration correct; no other validator behavior changed?
- README/package.json claims match reality (no static test counts)?
- Scope creep beyond Slice 1?

**Step 2:** Findings → fix, re-run B.7 (local + fresh checkout), push, green CI on new head, re-review. Loop until clean.

### Task B.10: G2 gate, merge, main-CI, Jira + Confluence evidence

**Step 1:** Re-verify solo owner: `gh api repos/DYAI2025/project-atlas-foundation/collaborators --jq 'length'` → `1`, else STOP.

**Step 2:** Audit comment on PR B before merge — same `PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION` template as Task A.14 Step 2, with: exact head SHA, `check` run ID success, fresh-checkout evidence, findings closed, mergeability `MERGEABLE/CLEAN` (`gh pr view --json mergeable,mergeStateStatus`), scope "exactly this ATLAS-23 Slice-1 PR".

**Step 3:** Merge (merge commit) + read-after-write, exactly as Task A.14 Step 3.

**Step 4:** Verify main-CI: new `ci` workflow push run on the new main head → job `check` `success`:
```bash
gh run list -R DYAI2025/project-atlas-foundation --commit "$(git rev-parse HEAD)" --json databaseId,conclusion,name,workflowName
```
Record the final main SHA and run ID.

**Step 5:** Jira comment on ATLAS-23 (then read-after-write; ticket stays `In Arbeit` — do NOT transition to Fertig):

> **ATLAS-23 Slice 1 delivered — CI quality baseline (`check`).**
> Branch `feat/ATLAS-23-ci-baseline-slice-1`, commit `<commit-sha>`, merge commit `<merge-sha>` (PR #<n>).
> Files: `.github/workflows/ci.yml` (new canonical, job/context `check`: checkout SHA-pinned, Node 22, `npm ci --ignore-scripts`, `npm test`, validator, `permissions: contents: read`), `foundation-consistency.yml` removed (subsumed), validator required-files migrated, `package.json` `npm run check`, README.
> Evidence: local `npm run check` green (full suite <N> pass / 0 fail + VALIDATION PASSED); fresh checkout green; PR CI run `<run-id>` `check` success on head `<head-sha>`; main CI run `<run-id>` success on `<main-sha>`.
> **Remaining ATLAS-23 gates (ticket bleibt In Arbeit):** Format, Lint, Type-Check, Secret-Scanning (`secret-scan`), Vulnerability-Scan (`vuln-scan`), License-Compliance, technische Required-Checks-Verknüpfung (blockiert durch BLK-ATLAS-13-01, weiterhin OPEN).

**Step 6:** Confluence page `15040514`: fresh `getConfluencePage` (title + current version). If the page content is obviously the wrong topic for ATLAS-23 documentation → STOP and report instead of writing. Otherwise add/update a clearly delimited section `ATLAS-23 Slice 1 — CI Quality Baseline` documenting ONLY the actually existing gate (`check`: clean install + full test suite + consistency validator, on every PR and main, minimal permissions, SHA-pinned actions) and explicitly listing the NOT-yet-active gates (secret-scan, vuln-scan, lint/format/type, license, required-checks) as future slices. `updateConfluencePage`, then read-after-write (`getConfluencePage` → version incremented, section present).

### Task B.11: Final report + STOP

**Step 1:** Deliver the 30-point PO final report: 1 capability status · 2 Jira sprint state before · 3 main before (`e1a532a…`) · 4 stale claims found (list from A.3–A.9) · 5 Phase-A files · 6 Phase-A tests · 7 Phase-A PR · 8 Phase-A CI · 9 Phase-A review · 10 Phase-A merge · 11 main after Phase A · 12 remaining repo contradictions = 0 or list · 13 ATLAS-23 prior status · 14 ATLAS-23 transition · 15 Slice-1 files · 16 previous CI gap · 17 new `check` context · 18 local tests · 19 fresh checkout · 20 PR CI · 21 adversarial review · 22 PR merge · 23 final main SHA · 24 final main CI · 25 Jira ATLAS-23 final (In Arbeit) · 26 Confluence read-after-write · 27 open ATLAS-23 gates · 28 BLK-ATLAS-13-01 still OPEN confirmed · 29 no ATLAS-23 Done · 30 no Slice 2 started. Plus: untracked `docs/plans/2026-08-07-sprint-1-integration-wave.md` and `actions-probe.yml` cleanup as PO decision candidates; Jira links 10666/10667 still semantically reversed (report-only).

**Step 2:** STOP. No further sprint slice. The PO decides next.

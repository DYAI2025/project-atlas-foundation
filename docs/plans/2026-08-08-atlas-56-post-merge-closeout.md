> **ARCHIVAL NOTE (2026-08-09):** Historical record of the executed 2026-08-08 closeout
> session (verdict: ATLAS-56 CLOSED + VERIFIED). Statements of current state — the
> "untracked, must survive, must NOT be committed" constants comment, the architecture
> line "Zero commits, zero pushes, zero code edits", and the out-of-scope entries
> "Commit the runway plan (or this plan)" and "Any git commit/push, any code or config
> change in the repo" — described the execution session; this archival supersedes them,
> authorized via the G2 artifact of the archiving PR. Known correction: the Task 8 CQL `space = ATLAS` silently returns
> 0 hits — the Confluence space key is `PRODUKTMAN` (see
> `.claude/skills/atlas-gated-pr/SKILL.md`, step 14). Original content unchanged below.

# ATLAS-56 Post-Merge Closeout Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close out ATLAS-56 after the PO-authorized merge of PR #9 — verify fresh main, observe post-merge CI honestly, close the Jira ticket only if every AC passes against real evidence, reconcile Confluence history-preservingly, then STOP and wait for the Product Owner.

**Architecture:** This is a governance/ops closeout, not a code change. Every step is verify → (optionally) mutate → read-after-write. Zero commits, zero pushes, zero code edits. Fail-closed: any mismatch between expected and observed state is a STOP, never a repair.

**Tech Stack:** git, npm, `gh` CLI, `~/.claude/scripts/gh-ci-wait`, Atlassian MCP (`mcp__claude_ai_Atlassian__*`), Bash.

---

## Constants (verified 2026-08-08 from session memory + live git readback)

```
REPO_DIR   = /Users/benjaminpoersch/Projects/project-atlas-foundation   # canonical repo, branch main
REPO       = DYAI2025/project-atlas-foundation
MERGE_SHA  = 37d05148687fb96fd034e197070341460a991f3b   # merge commit of PR #9; Task 0 Step 1 re-pins this from the PO message — never trust a transcription, including this one
PR_HEAD    = 87bbcb08fc00e18378f94f50c2d878ce065de348   # original head of PR #9
ARTIFACT   = 5226700791    # PR-#9 issue comment: human G2 authorization artifact
AUDIT      = 5227041045    # PR-#9 issue comment: PO integration authorization audit
RUNWAY     = docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md  # untracked, must survive, must NOT be committed
CLOUD_ID   = 4504291c-8bc0-48f8-ab9e-9ad5d376ca04      # Jira/Confluence cloudId
JIRA       = ATLAS-56 (Bug, governance). Sprint 1 = id 370 (customfield_10020). Known transitions: 11=Zu erledigen, 21=In Arbeit, 31=Fertig — but Task 6 MUST use a freshly read transition list.
CONFLUENCE = 00=15138817, 02/Governance=14680066, 13=15040514, 14=15171611, 16=15400961, 18=14581771
```

**Direct-edit allowlist (DEC-06):** Confluence pages 00/13/14/16 may be edited directly; page 18 has an accepted edit precedent from the 2026-08-08 reconciliation (v4). Everything else is proposals-only. The PO closeout instruction of 2026-08-08 authorizes the ATLAS-56/PR-#9 reconciliation edits described in Task 8; record in the report which pages were touched under which authorization.

**Global STOP rule:** If any observed value differs from the expected value in a step, STOP the plan, report the exact command, exact output, and the expected value. No repairs, no retries with variations, no inference. Verdict then becomes `ATLAS-56 STILL OPEN — <exact reason>` (or BLOCKED before Jira is reached).

**Known trap (do not fall in):** `scripts/g2-authorization-gate.mjs` blocks merged/closed PRs BY DESIGN (`crossCheckPullRequest`: no retroactive validation). Never re-run the gate against PR #9 post-merge and expect exit 0. "Gate Exit 0" evidence comes from the PO audit comment 5227041045, which must reference artifact 5226700791 — Task 5 verifies that textually.

---

### Task 0: Preconditions and runway-plan safety backup

**Files:**
- Read: `/Users/benjaminpoersch/Projects/project-atlas-foundation/docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md`
- Create: `<session-scratchpad>/runway-plan-backup/2026-08-08-sprint-1-runway-scope-sharpening.md`

**Step 1: Pin the canonical SHAs from the PO message (do not trust any transcription, including this file's Constants block)**

Write the two SHAs into shell variables directly from the PO instruction text:

```bash
MERGE_SHA=37d05148687fb96fd034e197070341460a991f3b
PR_HEAD=87bbcb08fc00e18378f94f50c2d878ce065de348
echo "${#MERGE_SHA} ${#PR_HEAD}"
```

Expected output: `40 40`. Anything else → STOP.

**Step 2: Confirm current worktree state**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation status --short --branch
```

Expected output (exactly two lines):

```
## main...origin/main
?? docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md
```

Any tracked modification, staged file, or additional untracked file (other than this plan file itself, `?? docs/plans/2026-08-08-atlas-56-post-merge-closeout.md`) → STOP and report.

**Step 3: Back up the runway plan to the session scratchpad (copy, not move, not stash, not commit)**

```bash
SCRATCH=<your session scratchpad dir>/runway-plan-backup
mkdir -p "$SCRATCH"
cp /Users/benjaminpoersch/Projects/project-atlas-foundation/docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md "$SCRATCH/"
shasum -a 256 \
  /Users/benjaminpoersch/Projects/project-atlas-foundation/docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md \
  "$SCRATCH/2026-08-08-sprint-1-runway-scope-sharpening.md"
```

Expected: both SHA-256 hashes identical. Record the hash — Task 10 re-checks it. Hashes differ → STOP.

---

### Task 1: Fetch and fresh-main verification

**Files:** none modified.

**Step 1: Fetch**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation fetch origin
echo "FETCH_EXIT=$?"
```

Expected: `FETCH_EXIT=0`.

**Step 2: Ensure we are on main**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation checkout main
```

Expected: `Already on 'main'` (local main was already at the merge commit at plan-writing time). If checkout switches branches, re-run Task 0 Step 2 afterwards.

**Step 3: Verify HEAD, origin/main, and divergence**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation rev-parse HEAD origin/main
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation rev-list --left-right --count main...origin/main
```

Expected:
- Line 1 and 2 both exactly `$MERGE_SHA` (`37d05148687fb96fd034e197070341460a991f3b`).
- Count line exactly `0	0` (ahead 0 / behind 0).

If HEAD ≠ MERGE_SHA but origin/main = MERGE_SHA and the worktree is clean apart from the two untracked plans: `git -C ... merge --ff-only origin/main`, then re-run this step. If origin/main ≠ MERGE_SHA (someone pushed after the PO readback) → STOP and report the new SHA; do not proceed.

**Step 4: Confirm the runway plan survived**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation status --short
shasum -a 256 /Users/benjaminpoersch/Projects/project-atlas-foundation/docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md
```

Expected: runway plan still listed as `??`, hash identical to Task 0 Step 3. Otherwise → STOP, restore from `$SCRATCH` backup, report.

---

### Task 2: Fresh-main reproduction (no repairs allowed)

**Files:** none modified (node_modules recreated by `npm ci`).

Run each command separately; capture the exit code on its own line, never through a pipe (`cmd | grep` exit-code trap).

**Step 1: Clean install**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && npm ci --ignore-scripts
echo "NPM_CI_EXIT=$?"
```

Expected: `NPM_CI_EXIT=0`. Nonzero → STOP / BLOCKED, quote the error verbatim.

**Step 2: Validator**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && npm run check
echo "CHECK_EXIT=$?"
```

Expected: `CHECK_EXIT=0`. Record the validator check count printed (last known: 49 checks — record the ACTUAL number; a different count with exit 0 is not a failure, but goes into the report). Nonzero → STOP / BLOCKED with full failure path output.

**Step 3: Tests**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && npm test
echo "TEST_EXIT=$?"
```

Expected: `TEST_EXIT=0`. Record actual pass/total count (last known: 99/99 — record ACTUAL). Any failing test → STOP / BLOCKED, quote the failing test names and output verbatim, do NOT fix anything.

---

### Task 3: Post-merge CI observation (honest, never invented)

**Step 1: Bounded CI wait via the sanctioned script**

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation 37d05148687fb96fd034e197070341460a991f3b 300
echo "CI_WAIT_EXIT=$?"
```

Semantics: 0 = all runs success, 1 = at least one failure, 2 = timeout or no runs.

**Step 2: Enumerate the actual runs**

```bash
gh run list --repo DYAI2025/project-atlas-foundation \
  --commit 37d05148687fb96fd034e197070341460a991f3b \
  --json databaseId,workflowName,status,conclusion,headSha
echo "RUN_LIST_EXIT=$?"
```

Interpretation (record verbatim in the report):
- Runs exist, all `conclusion: success` → record workflow name(s) + run id(s) as POST-MERGE CI evidence.
- Runs exist, any `failure` → STOP / BLOCKED. A red main is a closeout blocker; report it, close nothing.
- Empty list AND `CI_WAIT_EXIT=2` → write exactly: `POST-MERGE CI: NOT OBSERVABLE / NO RUN`. Continue the plan — the Task 2 fresh-main reproduction is the documented complement, but state explicitly in the Jira comment and report that it complements and does not semantically replace CI observation.

---

### Task 4: GitHub evidence readback (PR #9, artifact, audit)

**Step 1: PR #9 state**

```bash
gh pr view 9 --repo DYAI2025/project-atlas-foundation \
  --json state,mergedAt,mergeCommit,headRefOid,baseRefName
```

Expected: `state: "MERGED"`, `mergeCommit.oid == $MERGE_SHA`, `headRefOid == $PR_HEAD`, `baseRefName: "main"`. Any mismatch → STOP.

**Step 2: Human authorization artifact 5226700791**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/comments/5226700791 \
  --jq '{user: .user.login, created_at, updated_at, body}'
```

Expected: `user == "DYAI2025"`; body contains the contiguous three-line block:

```
G2-AUTHORIZATION
PR: #9
HEAD: 87bbcb08fc00e18378f94f50c2d878ce065de348
```

Wrong author, wrong PR number, wrong HEAD, or non-contiguous block → STOP (the artifact would not satisfy the schema ATLAS-56 itself hardened).

**Step 3: PO audit comment 5227041045**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/comments/5227041045 \
  --jq '{user: .user.login, created_at, body}'
```

Expected: audit body references the artifact comment ID `5226700791` and documents gate execution with exit 0 against PR #9 / HEAD `87bbcb08…`. This is the ONLY legitimate source of "Gate Exit 0" evidence post-merge (see Known trap). If the audit does not reference the artifact ID or does not document gate exit 0 → the corresponding AC is OPEN; skip Task 6's mutation path and report the exact gap.

---

### Task 5: Atlassian tenant preflight

**Step 1: Verify identity and tenant before any mutating MCP call**

Call `mcp__claude_ai_Atlassian__atlassianUserInfo` and `mcp__claude_ai_Atlassian__getAccessibleAtlassianResources`.

Expected: the resource list contains cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`. Different tenant → STOP (mcp-tenant-check gate).

---

### Task 6: Jira ATLAS-56 fresh read and per-AC evaluation

**Step 1: Full fresh read**

- `getJiraIssue` `ATLAS-56` on cloudId above — description (AC list), status, resolution, sprint (`customfield_10020`), ALL comments (known so far: intake 12512, PR evidence 12545 — record any new ones).
- `getTransitionsForJiraIssue` `ATLAS-56` — the live transition list. Expected to contain a transition to Fertig (historically id 31), but ONLY the freshly read id may be used later.

**Step 2: Evaluate every AC individually**

Build a table: AC text (quoted from the live description) → PASS / OPEN → the exact evidence item (from: PR #9 merged readback, PR_HEAD, artifact 5226700791, audit 5227041045, MERGE_SHA on main, Task 2 exit codes + counts, Task 3 CI observation, gate-blocks-own-PR self-test from the pre-merge evidence comment 12545). Also check the relevant DoD (as referenced by the ticket/sprint docs) the same way.

**Decision gate:**
- ALL ACs + DoD PASS → proceed to Task 7.
- ANY item OPEN → skip Tasks 7 entirely (no comment, no transition — the ticket stays In Arbeit), still do Tasks 8–10, verdict `ATLAS-56 STILL OPEN — <exact open item>`.

---

### Task 7: Jira evidence comment + transition (only on full PASS)

**Step 1: Compose the evidence comment in a scratch file**

Write to `<scratchpad>/atlas-56-evidence-comment.md`, containing exactly:
- PR #9, original head `87bbcb08fc00e18378f94f50c2d878ce065de348`
- Human authorization artifact: comment `5226700791`
- PO integration authorization audit: comment `5227041045` (which documents gate exit 0)
- Merge commit `37d05148687fb96fd034e197070341460a991f3b`, main readback ahead 0 / behind 0
- Fresh-main reproduction: the three exact commands with their ACTUAL exit codes, actual test count, actual validator count
- Post-merge CI: run id(s) + conclusion, OR the verbatim `POST-MERGE CI: NOT OBSERVABLE / NO RUN` line plus the complement-not-replacement sentence

**Step 2: Re-read the scratch file fully before sending**

Read the whole file. Check: no drafting fragments, no self-corrections, no placeholder text (compose → re-read → send rule; a drafting fragment shipping into Jira is a real past incident). Fix in the file, re-read again, only then send.

**Step 3: Send comment**

`addCommentToJiraIssue` ATLAS-56 with the file content.

**Step 4: READ AFTER WRITE (comment)**

`getJiraIssue` ATLAS-56 comments — the new comment exists, body matches the scratch file. Record its comment id. Mismatch → STOP, report.

**Step 5: Transition to Fertig**

`transitionJiraIssue` ATLAS-56 using the transition id freshly read in Task 6 whose target status is Fertig/Done (expected 31). If the transition screen requires a resolution, set `Fertig` (id 10000 — as used for ATLAS-21).

**Step 6: READ AFTER WRITE (transition)**

`getJiraIssue` ATLAS-56 — status is Fertig, resolution set, AC text unchanged. Record before/after status for the report. Mismatch → STOP, report.

---

### Task 8: Confluence reconciliation (minimal, history-preserving)

**Step 1: Find every stale statement**

- `searchConfluenceUsingCql` with `cql: space = ATLAS AND text ~ "ATLAS-56"`
- `searchConfluenceUsingCql` with `cql: space = ATLAS AND text ~ "87bbcb08"`

**Step 2: Fresh-read the candidate pages**

`getConfluencePage` for 13 (15040514), 14 (15171611), 18 (14581771), 02/Governance (14680066), plus every CQL hit not already in that set. Note: `getConfluencePage` does NOT expose a version number — version verification later runs via the update response (expected prior+1) plus content readback.

**Step 3: Per-page edit inventory BEFORE writing (mandatory drop inventory)**

For each page to be edited, list every line that changes, classified as exactly one of:
- **keep** — untouched
- **mark-in-place** — stale statement stays, gets an appended marker like `— ERLEDIGT/SUPERSEDED 08.08.2026: PR #9 merged, main = 37d05148…` (never deleted, never reworded)
- **append** — new changelog entry / new bullet

**0 drops.** Historical evidence rows are never overwritten or removed. Any edit that would require deleting a line → STOP, put it in the report as a proposal instead.

Content the reconciliation must carry (distributed across the touched pages as fits their structure):
- ATLAS-56 documented as a **governance correction** (not a feature)
- G2 authorization requires a **PR- and HEAD-specific human artifact** (contiguous `G2-AUTHORIZATION` / `PR:` / `HEAD:` block by the PO account)
- The audit comment must **reference the artifact ID**
- **No READY inference** — an agent may never infer authorization from a READY/status label
- PR #9 merge SHA `37d05148687fb96fd034e197070341460a991f3b`
- **BLK-ATLAS-13-01 persists**: enforcement remains procedural; no technical branch protection exists (GitHub Free plan)
- Explicitly **no claim that ATLAS-13 is done**

Stale statements to expect and mark-in-place (from the 2026-08-08 pre-merge state): "PR #9 review-ready / WAITING FOR PO MERGE REVIEW", ATLAS-56 "In Arbeit" status bullets.

**Authorization note:** pages 13/14/16/00 are direct-edit (DEC-06), 18 by accepted precedent. If the Governance page 02 (14680066) contains stale or contradicting governance statements, its correction is covered by the PO closeout instruction of 2026-08-08 — record that authorization explicitly in the report. If 02 needs no correction, do not touch it. Any OTHER page → proposal text in the report only, no edit.

**Step 4: Write, one page at a time**

`updateConfluencePage` per page. Capture the version number from the update response; expected exactly prior-known-version + 1 (13 was v8, 14 v9, 18 v4 after the 08.08 reconciliation; a higher-than-expected prior version means someone edited in between → re-read that page, re-do Step 3 for it, do not blind-overwrite).

**Step 5: READ AFTER WRITE per page**

`getConfluencePage` again — new statements present, marked lines still contain their original text, changelog entry appended. Record page id, old→new version, one-line edit summary for the report.

---

### Task 9: ATLAS-12 readiness statement (read-only)

**Step 1:** `getJiraIssue` `ATLAS-12` — status, sprint, issue links, blockers. NO edit, NO comment, NO transition, NO implementation.

**Step 2:** Derive exactly one sentence for the report: `ATLAS-12 READY TO START` or `ATLAS-12 BLOCKED BY <exact reason>` (e.g. an unresolved blocking link or missing PO decision). Nothing else.

---

### Task 10: Memory, worktree final check, report, STOP

**Step 1: Final worktree check**

```bash
git -C /Users/benjaminpoersch/Projects/project-atlas-foundation status --short --branch
shasum -a 256 /Users/benjaminpoersch/Projects/project-atlas-foundation/docs/plans/2026-08-08-sprint-1-runway-scope-sharpening.md
```

Expected: branch main, in sync, untracked files are exactly the runway plan and this closeout plan, runway hash unchanged vs Task 0.

**Step 2: Write session memory**

New file in the memory dir (`atlas-session-2026-08-08-atlas56-closeout.md`, type `project`): verdict, merge SHA, Jira comment id + transition, Confluence page versions, CI observation wording. Add one index line to `MEMORY.md`.

**Step 3: Emit the report in EXACTLY this structure, then stop the turn**

```
## POST-MERGE MAIN
## FRESH-MAIN REPRODUCTION
## POST-MERGE CI
## ATLAS-56 AC / DoD        ← every AC individually PASS / OPEN
## JIRA UPDATE              ← Vorher / Mutation / Nachher
## CONFLUENCE UPDATE        ← gelesene Seiten, Mutation, Readback (old→new version)
## WORKTREE
## VERDICT                  ← ATLAS-56 CLOSED + VERIFIED  |  ATLAS-56 STILL OPEN — <exakter Grund>
## NEXT ITEM READINESS      ← ATLAS-12 READY TO START  |  ATLAS-12 BLOCKED BY <Grund>
## STOP
WAITING FOR PRODUCT OWNER
```

---

## Out of scope (hard NO — abort any step that drifts here)

- Implement ATLAS-12 (readiness STATEMENT only)
- Start new architecture
- Repair ATLAS-13 / retry branch protection (BLK-ATLAS-13-01 stands)
- Work on ATLAS-24
- Write Sprint-2 code
- Commit the runway plan (or this plan)
- Re-run the G2 gate against merged PR #9 expecting exit 0 (design-blocked)
- Any git commit/push, any code or config change in the repo
- Any work in `~/semantic-gbrain-vps` (deprecated snapshot, read-only)

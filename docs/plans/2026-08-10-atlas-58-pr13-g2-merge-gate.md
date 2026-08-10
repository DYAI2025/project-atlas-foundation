# ARCHIVAL NOTE — ATLAS-58 Plan-File Governance Closeout (2026-08-11)

**Read this note before the plan below it. The note is current; the plan below is history.**

| Field | Value |
|---|---|
| Archival status | **ARCHIVED** — historical execution evidence, retained unaltered |
| Classification | `derived_noncanonical` |
| Original execution status | **EXECUTED** — the G2 merge-gate session for PR #13 ran to its own defined stop point |
| Date of execution | 2026-08-10 |
| Date of archival | 2026-08-11 |
| Jira authority | **ATLAS-58** |
| Canonical Confluence authority | **Page 19628033** — *ATLAS-58 – Canonical Implementation Plan – Writer-Registry Validator Binding* (space `PRODUKTMAN`) |
| Merge outcome | **PR #13 — MERGED**; accepted head `6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243`; merge commit `96730338240a2153a396b4d0f8c1b688b70a7d69` |
| Archival decision artifact | **Jira ATLAS-58 comment `12727`** — *PO Post-Merge Reconciliation, 2026-08-11* (author `benjamin.poersch`) |

## What this document is, and is not

This archived plan is **historical execution evidence, NOT an active authorization**. It is the session
plan for the G2 verification-and-merge run of PR #13 on 2026-08-10. It authorizes nothing today.

**It is not, and never was, a merge authorization.** Under the *G2 solo-owner exception*
(`docs/policies/pr-rules.md`, §G2-Autorisierungsartefakt), merge authorization exists only as a PO-authored
`G2-AUTHORIZATION` comment on the PR itself, verified by `scripts/g2-authorization-gate.mjs`. This plan
merely describes how that artifact was to be verified. Archiving it now confers no authorization
retroactively, for PR #13 or for anything else.

**Later canonical Jira and Confluence state overrides any conflicting statement in the plan below.**

**Directives in the body below are historical, not active.** The plan opens with a
`> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans …` line and prescribes live
mutations (post the audit comment, `gh pr merge --merge`). Those were discharged on 2026-08-10 against a
repository state that no longer exists — `origin/main` was `2a3f3e0d…` and PR #13 was `OPEN`. **Re-running
any step is neither authorized nor meaningful.** In particular, the plan's merge and comment steps must
never be re-executed.

## Why this plan required a later, separate archival

The plan explicitly excluded committing or archiving itself from the G2/merge run. Verbatim, from its
plan-file-location note:

> **Archival is explicitly out of scope for this run.**

and from its out-of-scope list:

> committing or archiving this plan file

Consistently, its closing report contract (Task 14, Step 2) required the run to declare *"separate
docs/plans plan-file archival Governance Closeout: PENDING"* — the run itself recorded this archival as
outstanding work belonging to a later, separate operation.

**This archival is that separate post-merge governance operation.** The citable decision artifact is
**Jira ATLAS-58 comment `12727`** (PO post-merge reconciliation, 2026-08-11), which names this plan as an
executed plan that was "während der Ausführung ausdrücklich nicht zu archivieren/committen" and requires
"ein **separater PO-gesteuerter Governance-Closeout-Docs-PR** …, der diese ausgeführten Pläne mit Archival
Notes unter `docs/plans/` archiviert". The operative authorization for the archival itself is the PO's
`G2-AUTHORIZATION` artifact on that docs PR, per the *Plan-file hygiene* guardrail in
`.claude/skills/atlas-gated-pr/SKILL.md` and `docs/policies/pr-rules.md`.

It is **not** retroactive merge authorization for PR #13, whose own G2 gate was satisfied separately at
merge time and is not revisited, re-derived, or extended by this archival.

The executing agent did **not** supersede, waive, or reinterpret the original exclusion on its own
authority, and the original plan did **not** authorize its own archival.

## Preservation statement

Everything below the horizontal rule is the original plan, **byte-for-byte unaltered**. No statement was
rewritten, corrected, softened, or removed — including statements now obsolete (`BASE_MAIN` `2a3f3e0d…`,
PR #13 as an open PR, and the pre-merge STOP conditions). History is append-only: obsolescence is annotated
here, never edited into the source.

---

# ATLAS-58 / PR #13 — G2 Merge Gate Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **REQUIRED REPO SKILL:** `.claude/skills/atlas-gated-pr/SKILL.md` (steps 11–13) is binding and overrides
> anything in this plan that contradicts it. `docs/policies/pr-rules.md` §"G2-Autorisierungsartefakt" is
> the artifact schema of record.

**Goal:** Freshly re-verify every exact-head G2 precondition for `DYAI2025/project-atlas-foundation` PR #13,
and — only if every gate passes — post the required G2 audit comment, merge with a merge commit, read back
PR + `origin/main`, and verify post-merge main CI on the resulting merge SHA. Then STOP.

**Architecture:** This is a *verification-and-integration* run, not an implementation run. No file in the
repository is edited. Every step is a fresh live read (never trusting the order prompt or this plan), each
step gates the next, and any deviation is a hard STOP with a `BLOCKED` report. Two external mutations are
permitted and only two: (1) one G2 audit comment on PR #13, (2) one merge of PR #13. Both are preceded by
an idempotency pre-check and followed by a read-after-write.

**Tech Stack:** `gh` CLI, `git`, Node 20+ (`node scripts/g2-authorization-gate.mjs`), `~/.claude/scripts/gh-ci-wait`, `jq`.

---

## Constants (verify, never assume)

| Name | Value |
|---|---|
| `REPO` | `DYAI2025/project-atlas-foundation` |
| `REPO_DIR` | `/Users/benjaminpoersch/Projects/project-atlas-foundation` |
| `PR` | `13` |
| `HEAD` | `6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243` |
| `BASE_MAIN` | `2a3f3e0d6476491f85747dbe1103262e5b150f30` |
| `PR_CI_RUN` | `31398614526` (workflow `ci`, conclusion `success`) |
| `HUMAN_ARTIFACT_ID` | `5245030130` (author `DYAI2025`) |
| `CHANGED_FILE` | `scripts/validate-current-repository.mjs` (count: 1) |
| `TICKET` | `ATLAS-58` |

**Shell note:** the session shell resets its cwd between calls. Every command below is written as a single
compound `cd <REPO_DIR> && …` so it is reproducible in isolation.

**Plan-file location deviation (recorded):** `writing-plans` asks for `docs/plans/YYYY-MM-DD-*.md`, but the
binding repo guardrail *plan-file hygiene* forbids lingering untracked files in the working tree and states
active working drafts live in the session scratchpad. This plan therefore lives in the scratchpad under the
`docs/plans`-style filename `2026-08-10-atlas-58-pr13-g2-merge-gate.md`, so the PO-gated archival step is a
straight copy. **Archival is explicitly out of scope for this run.**

---

## Global STOP rules (apply to every task)

Abort immediately, make no further mutation, and report `BLOCKED` (or, after a merge, `MERGED — CLOSEOUT BLOCKED`) if:

1. PR head ≠ `HEAD`. 2. `origin/main` ≠ `BASE_MAIN` (pre-merge). 3. PR not `OPEN` / draft / not mergeable.
4. Changed-file set ≠ exactly `CHANGED_FILE`. 5. Any new review finding or unresolved review thread.
6. Exact-head CI no longer satisfies policy. 7. Human G2 artifact missing/invalid/edited.
8. Collaborator count ≠ 1 (solo-owner condition). 9. `g2-authorization-gate.mjs` exit ≠ 0.
10. Audit-comment readback fails. 11. Repo policy contradicts this plan → policy wins, STOP.
12. Post-merge PR readback inconsistent. 13. `origin/main` lacks the accepted result.
14. Main CI fails. 15. Main CI cannot be tied to the resulting revision.

**Never** rebase, update-branch, force-push, create a commit, re-run/dispatch CI to force green, repair the
gate, edit policy, create or edit the human G2 artifact, or auto-revert.

---

## Task 1: Read the binding policy fresh

**Files (read-only):**
- Read: `/Users/benjaminpoersch/Projects/project-atlas-foundation/.claude/skills/atlas-gated-pr/SKILL.md`
- Read: `/Users/benjaminpoersch/Projects/project-atlas-foundation/docs/policies/pr-rules.md`

**Step 1: Read both files end to end.**

**Step 2: Extract and write down (in the run notes, not a file):**
- the exact required audit-comment header and its mandatory content fields (SKILL step 11),
- the merge method (SKILL step 12 + pr-rules: **merge commit only**, no squash, no rebase),
- the G2 artifact schema (pr-rules lines 23–27) and the "audit comments are never artifacts" rule,
- required CI checks (`check`, `secret-scan`, `vuln-scan`).

**Step 3: Contradiction check.** If any of these contradicts the order prompt → STOP condition 11.

**Expected:** no contradiction. Audit header is
`PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION`; merge method is `gh pr merge --merge`.

---

## Task 2: Fresh live baseline — git + PR state

**Step 1: Sync refs (no working-tree change)**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && git fetch origin --prune
```

**Step 2: Read local + remote SHAs**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
  echo "origin/main: $(git rev-parse origin/main)" && \
  echo "branch:      $(git branch --show-current)" && \
  echo "local HEAD:  $(git rev-parse HEAD)" && \
  git status --short
```

Expected: `origin/main: 2a3f3e0d6476491f85747dbe1103262e5b150f30`, clean working tree.
Any other `origin/main` → STOP condition 2.

**Step 3: Fresh-read PR #13 as structured data**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
gh pr view 13 -R DYAI2025/project-atlas-foundation \
  --json number,state,isDraft,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,commits,files,reviewDecision,url
```

**Step 4: Assert every field explicitly** (do not eyeball — state each verdict):
- `state == "OPEN"`, `isDraft == false`
- `headRefOid == 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243`
- `baseRefName == "main"`
- `mergeable == "MERGEABLE"` and `mergeStateStatus` acceptable (`CLEAN`; `BLOCKED` is acceptable **only**
  if attributable solely to BLK-ATLAS-13-01 absence-of-protection semantics — otherwise STOP)
- `commits` length `== 1`
- `files` length `== 1` and the single path `== scripts/validate-current-repository.mjs`

Any mismatch → STOP (conditions 1/3/4).

**Step 5: Confirm the commit range against main independently of the PR API**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
  git rev-list --count origin/main..6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 && \
  git diff --name-only origin/main 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243
```

Expected: `1` and exactly `scripts/validate-current-repository.mjs`.

---

## Task 3: Review state — no open findings, no unresolved threads

**Step 1: Reviews**

```bash
gh pr view 13 -R DYAI2025/project-atlas-foundation --json reviews,reviewDecision
```

**Step 2: Review threads (resolution state is only on the GraphQL API)**

```bash
gh api graphql -f query='
query {
  repository(owner:"DYAI2025", name:"project-atlas-foundation") {
    pullRequest(number:13) {
      reviewThreads(first:100) {
        nodes { id isResolved isOutdated path line comments(first:5){nodes{databaseId author{login} body}} }
      }
    }
  }
}'
```

Expected: every `isResolved == true`, or zero threads.
Any `isResolved == false` → STOP condition 5.

**Step 3: Scan for review comments newer than the human G2 artifact** that raise a finding — a finding
created after the authorization invalidates the decision basis even if the thread is unresolved-by-absence.

---

## Task 4: Exact-head CI evidence

**Step 1: List all runs for the exact head**

```bash
gh run list -R DYAI2025/project-atlas-foundation \
  --commit 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 \
  --json databaseId,workflowName,name,event,status,conclusion,headSha
```

**Step 2: Assert**
- a run with `databaseId == 31398614526`, `workflowName == "ci"`, `conclusion == "success"`,
  `headSha == 6d484bd5…`
- **no** run for this head with a non-`success` conclusion
- required checks present per pr-rules (`check`, `secret-scan`, `vuln-scan`) — record which are visible

**Step 3: Confirm the head-level check rollup**

```bash
gh pr checks 13 -R DYAI2025/project-atlas-foundation
```

Any failing/pending required check → STOP condition 6. **Never** re-run or dispatch a workflow.

---

## Task 5: Solo-owner condition

**Step 1:**

```bash
gh api repos/DYAI2025/project-atlas-foundation/collaborators --jq 'length'
```

Expected: `1`. Anything else → STOP condition 8 (the G2 solo-owner exception does not apply).

**Step 2:** record the collaborator login as evidence:

```bash
gh api repos/DYAI2025/project-atlas-foundation/collaborators --jq '.[].login'
```

---

## Task 6: Human G2 artifact — manual verification (independent of the gate script)

**Step 1: Fresh-read all issue comments on PR #13**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/13/comments --paginate \
  --jq '.[] | {id, login: .user.login, created_at, updated_at, first_line: (.body | split("\n")[0])}'
```

**Step 2: Read the candidate artifact in full**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/13/comments/5245030130 \
  --jq '{id, login: .user.login, created_at, updated_at, html_url, body}'
```

**Step 3: Assert against `docs/policies/pr-rules.md` lines 23–27**
- three lines, each at line start, **unquoted** (not inside a ``` / ~~~ fence, not `> ` quoted, not inside
  an HTML comment):
  ```
  G2-AUTHORIZATION
  PR: #13
  HEAD: 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243
  ```
- author `DYAI2025` (PO identity per policy)
- the body does **not** start with `PO INTEGRATION AUTHORIZATION` (audit comments are never artifacts)
- `updated_at` strictly before the gate run time (record both timestamps); `updated_at != created_at`
  is a documented deviation to report, not a silent pass — the gate's own rule uses `updated_at`

Missing / malformed / wrong PR / wrong head / wrong author → STOP condition 7.

**Step 4: Do NOT create or edit any authorization artifact.** (SKILL guardrail, absolute.)

---

## Task 7: Executable G2 gate (fail-closed, authoritative)

**Step 1: Run exactly**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
node scripts/g2-authorization-gate.mjs 13 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243; \
echo "EXIT=$?"
```

**Step 2: Expected on success (stdout, exit 0)**

```
G2 AUTHORIZATION VERIFIED — artifact comment 5245030130 https://github.com/DYAI2025/project-atlas-foundation/pull/13#issuecomment-5245030130
```

**Step 3: Capture verbatim** — exact command, `EXIT=`, full stdout/stderr, recognized artifact ID.

**HARD RULE — Step 4:** if `EXIT != 0`, the failure output ends with
`G2 AUTHORIZATION MISSING — merge stays blocked`. Then: **STOP**. Do not merge, do not repair the gate,
do not modify policy, do not create another artifact. Report `BLOCKED` with the exact `✗` reason lines.

**Step 5:** confirm the gate-recognized artifact ID equals the manually verified ID from Task 6.
A mismatch is a deviation → STOP.

---

## Task 8: Fresh-checkout evidence (prerequisite for a truthful audit comment)

**Why:** SKILL step 11 requires the audit comment to name the *fresh-checkout result*. The audit comment
may only claim what was actually observed. If no fresh-checkout result exists for this exact head from the
review session, it must be produced now — otherwise the audit comment cannot be written truthfully.

**Step 1: Idempotency pre-check.** Search PR #13 comments and the run notes for an already-recorded
fresh-checkout result at head `6d484bd5…`. If one exists and names this head, reuse it and skip to Task 9,
recording where it came from.

**Step 2: Otherwise clone at the exact head into the scratchpad (never into `REPO_DIR`)**

```bash
SCRATCH=/private/tmp/claude-501/-Users-benjaminpoersch-semantic-gbrain-vps/0270ebb6-225f-471c-b1f8-94744b2330fb/scratchpad/fresh-atlas58 && \
rm -rf "$SCRATCH" && \
git clone --no-checkout https://github.com/DYAI2025/project-atlas-foundation.git "$SCRATCH" && \
cd "$SCRATCH" && git fetch origin 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 && \
git checkout --detach 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 && git rev-parse HEAD
```

Expected final line: `6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243`.

**Step 3: Run the repository check suite**

```bash
cd /private/tmp/claude-501/-Users-benjaminpoersch-semantic-gbrain-vps/0270ebb6-225f-471c-b1f8-94744b2330fb/scratchpad/fresh-atlas58 && \
npm ci --ignore-scripts && npm run check; echo "EXIT=$?"
```

Expected: `EXIT=0`. Record the test count and the validator invariant count from the output verbatim.
Non-zero → STOP (the accepted increment does not verify at its own head).

---

## Task 9: Final pre-merge readback (immediately before the first write)

**Step 1: Re-run Task 2 Step 1–4 and Task 4 Step 1 verbatim, right now.** No caching of earlier results.

**Step 2: Assert, in one block:**
- head still `6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243`
- `origin/main` still `2a3f3e0d6476491f85747dbe1103262e5b150f30`
- `state == OPEN`, mergeable, one changed file
- CI still green for the head
- Task 6 artifact still valid, `updated_at` unchanged from what Task 6 recorded
- Task 7 gate exited 0
- no new comment/review since Task 3 that invalidates the decision

Any drift → STOP, no write.

---

## Task 10: G2 audit comment (mutation 1 of 2)

**Step 1: Idempotency pre-check**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/13/comments --paginate \
  --jq '.[] | select(.body | startswith("PO INTEGRATION AUTHORIZATION")) | {id, login: .user.login, created_at, body}'
```

- If a valid audit comment for **this PR and this head** already exists → do **not** duplicate. Verify its
  content against Step 2's required fields, record its ID, and go to Task 11.
- If one exists for a *different* head → that is a deviation; report it and STOP (do not overwrite).
- If none exists → proceed to Step 2.

**Step 2: Compose the audit comment (compose → re-read → send).** Write the body to the scratchpad first,
re-read it, and only then send. It must contain every field required by SKILL step 11, and may claim
**only** what Tasks 2–9 actually observed:

```
PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION

Precondition (solo-owner): repos/DYAI2025/project-atlas-foundation/collaborators length = 1 (<login>) — verified fresh.
Head SHA: 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243
CI (PR head): workflow `ci` run 31398614526 — conclusion success on head_sha 6d484bd5…; required checks <list observed>.
Fresh checkout: clone at 6d484bd5…, `npm ci --ignore-scripts && npm run check` exit 0 (<N> tests, <M> validator invariants).
Review findings: <closed/none> — review threads: <all resolved / none open>.
Mergeability: <MERGEABLE / CLEAN as observed>.
Scope: this authorization applies to PR #13 at head 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 ONLY; it does not survive any new commit or base drift.
Base at authorization time: main = 2a3f3e0d6476491f85747dbe1103262e5b150f30.
G2 gate: `node scripts/g2-authorization-gate.mjs 13 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243` → exit 0.
Authorization artifact: comment 5245030130
```

Replace every `<…>` with the observed value. Never leave a placeholder. Never claim a field that was not
observed — omit-and-report instead of inventing.

**Step 3: Post it**

```bash
gh pr comment 13 -R DYAI2025/project-atlas-foundation --body-file <scratchpad-body-file>
```

**Step 4: Read-after-write**

```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/13/comments --paginate \
  --jq '.[] | select(.body | startswith("PO INTEGRATION AUTHORIZATION")) | {id, login: .user.login, created_at, body}'
```

Verify: comment ID present, author, body byte-matches what was composed, it references
`Authorization artifact: comment 5245030130`, names PR #13 and head `6d484bd5…`.
Readback failure → **STOP, do not merge** (condition 10).

**Step 5: Re-run the G2 gate once more** — the audit comment must not have disturbed it (the gate excludes
`^PO INTEGRATION AUTHORIZATION` comments from artifact candidacy, so exit must still be 0 and must still
name artifact `5245030130`).

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
node scripts/g2-authorization-gate.mjs 13 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243; echo "EXIT=$?"
```

---

## Task 11: Merge (mutation 2 of 2)

**Step 1: Idempotency pre-check**

```bash
gh pr view 13 -R DYAI2025/project-atlas-foundation --json state,merged,mergeCommit,headRefOid
```

If `merged == true` already → do not re-merge; switch to verify-only and go to Task 12, reporting the
duplicate execution as a deviation.

**Step 2: Merge with a merge commit — no squash, no rebase** (SKILL step 12 + pr-rules)

```bash
gh pr merge 13 -R DYAI2025/project-atlas-foundation --merge
```

**Step 3: Capture the exact stdout/stderr and exit code.**

---

## Task 12: Immediate post-merge readback

**Step 1: Fresh-read the PR**

```bash
gh pr view 13 -R DYAI2025/project-atlas-foundation \
  --json state,merged,mergedAt,mergeCommit,headRefOid,baseRefName,mergedBy
```

Assert: `state == "MERGED"`, `merged == true`, `headRefOid == 6d484bd5…`, `baseRefName == "main"`.
Record `mergeCommit.oid` as `MERGE_SHA`.

**Step 2: Fetch and read main**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && git fetch origin --prune && \
  echo "origin/main: $(git rev-parse origin/main)"
```

**Step 3: Prove main actually contains the accepted change (not just the SHA)**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation && \
  git merge-base --is-ancestor 6d484bd52d6dd2fb6e8d5b3b56d0092adb30e243 origin/main && echo "ANCESTOR: OK" && \
  git diff --name-only 2a3f3e0d6476491f85747dbe1103262e5b150f30 origin/main && \
  git log --oneline 2a3f3e0d6476491f85747dbe1103262e5b150f30..origin/main
```

Expected: `ANCESTOR: OK`, changed path exactly `scripts/validate-current-repository.mjs`, log showing the
approved commit plus the merge commit.

**Step 4:** if the PR reports merged but main does not contain the expected result →
report `MERGED — CLOSEOUT BLOCKED` and STOP. **Do not auto-revert.**

**Step 5 (local hygiene, non-mutating to remote):** fast-forward local `main` only if the current branch is
`main`; otherwise leave the checkout as-is and record it. Never force, never push.

---

## Task 13: Post-merge main CI on the resulting revision

**Step 1: Wait using the repository-supported mechanism** (never the old PR run as evidence)

```bash
~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation <MERGE_SHA> 900; echo "EXIT=$?"
```

Exit 0 = every run for that SHA completed `success`. Exit 1 = a failure. Exit 2 = timeout/no runs.

**Step 2: Capture run identity explicitly**

```bash
gh run list -R DYAI2025/project-atlas-foundation --commit <MERGE_SHA> \
  --json databaseId,workflowName,name,event,status,conclusion,headSha,headBranch
```

Assert `headSha == <MERGE_SHA>` and `event == "push"` / `headBranch == "main"` — this is what ties the CI
identity to the resulting revision (STOP condition 15 if it cannot be tied).

**Step 3: Read the check job for test + validator evidence**

```bash
gh run view <MAIN_RUN_ID> -R DYAI2025/project-atlas-foundation --log \
  | grep -Ei "tests?|invariant|validator|passing|failed" | tail -40
```

Record: test count, validator invariant count/verdict, any warnings.

**Step 4:** if main CI fails or cannot be verified → report `MERGED — CLOSEOUT BLOCKED` with exact
evidence. **Do not auto-revert.**

---

## Task 14: Report and STOP

**Step 1:** emit the evidence report in exactly the section order the order prompt specifies:
`MERGE GATE VERDICT`, `PRE-MERGE LIVE STATE`, `HUMAN G2 EVIDENCE`, `EXECUTABLE G2 GATE`, `G2 AUDIT`,
`MERGE RESULT`, `MAIN READBACK`, `MAIN CI`, `REMAINING CLOSEOUT`, `FINAL STOP`.

**Step 2:** `REMAINING CLOSEOUT` must state verbatim:
- Jira ATLAS-58 Fertig: PENDING PO CLOSEOUT
- Jira evidence comment: PENDING PO CLOSEOUT
- Confluence accepted-increment reconciliation: PENDING PO CLOSEOUT
- separate docs/plans plan-file archival Governance Closeout: PENDING
- ATLAS-64: BACKLOG / NOT PART OF ATLAS-58
- next issue: NOT STARTED

**Step 3:** on full success, end exactly with:

```
MERGED + MAIN CI VERIFIED — awaiting PO atomic project closeout.
```

**Step 4: STOP.** No Jira mutation, no Confluence mutation, no plan archival, no next ticket, no cleanup
commit. Delete nothing in `REPO_DIR`. The scratchpad clone may be left in place.

---

## Explicitly out of scope for this run

source edits · branch repair · new commits · dependency changes · ATLAS-64 · ATLAS-59+ ·
Jira mutations · Confluence mutations · VPS/runtime work · creating or editing the human G2 artifact ·
automatic rollback · committing or archiving this plan file · starting any next issue.

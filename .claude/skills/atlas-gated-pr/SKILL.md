---
name: atlas-gated-pr
description: Execute the ATLAS gated PR delivery loop for any change to this repository — fresh baseline verify, branch, implement with red-green evidence, review, PR, CI on the exact head, adversarial review, fresh checkout, G2 solo-owner gate, merge commit, read-after-write, main-CI verification. Use whenever a change is to be integrated into main.
---

# ATLAS Gated PR Delivery Loop

Every integration into `main` of `DYAI2025/project-atlas-foundation` follows this loop.
Evidence-first: no step's expected state is assumed — each is verified fresh at execution
time. Any material deviation is a hard STOP (report, don't improvise).

## Loop (in order; each step gates the next)

1. **Baseline verify (fresh):** `git rev-parse HEAD` on synced `main` matches the expected
   SHA; `gh pr list --state open` matches expectations; relevant Jira ticket states read
   fresh. Includes the idempotency pre-check (see guardrails): if the fresh read shows the
   ordered outcome already exists, the order was already executed elsewhere — switch to
   verify-only. Deviation → STOP.
2. **Read the checkers before editing checked files:** `scripts/validate-current-repository.mjs`
   enforces required files AND content invariants (headings, strings, JSON fields). Read it
   first; list which invariants your edit touches.
3. **Branch** from synced `main` with a clean working tree — no uncommitted changes, no
   lingering untracked plan files (plan-file hygiene guardrail): `<type>/<TICKET>-<slug>`.
4. **Implement with red-green evidence** where applicable (failing command output recorded
   before the change, green after). For "regenerate section X but preserve history": produce
   a line inventory of the old section classified keep/move/drop BEFORE writing.
5. **Local validation:** `npm ci --ignore-scripts && npm run check` green (full test suite +
   validator), exit 0.
6. **Review:** spec-compliance review of the diff against the task (fresh reviewer, read-only).
7. **Commit + push + PR** (merge commits only, no squash/rebase; PR body: purpose, slice
   boundary, changes, evidence, out-of-scope, remaining gates).
8. **CI on the exact head:** wait for workflow `ci`, job/context `check`, `success` with
   `head_sha` equal to the PR head (`~/.claude/scripts/gh-ci-wait <owner/repo> <sha>` —
   exit 0 required). Never rerun/dispatch manually to force green.
9. **Adversarial review** (multi-lens, e.g. saved workflow `adversarial-review` with
   domain lenses: history preservation, root-cause invention, blocker conflation,
   overclaim, validator invariants, external-truth contradiction). Confirmed findings →
   fix on the branch → re-run steps 5–9.
10. **Fresh checkout:** clone at the exact head; `npm ci --ignore-scripts && npm run check`
    green, exit 0.
11. **G2 solo-owner gate (see guardrails):** verify fresh
    `gh api repos/<owner>/<repo>/collaborators --jq 'length'` == 1; then verify the PO
    authorization artifact — `node scripts/g2-authorization-gate.mjs <pr> <exact-head-sha>`
    MUST exit 0 (fail closed: any other outcome keeps the PR open in
    `READY FOR PO AUTHORIZATION`; ask the PO for the `G2-AUTHORIZATION` artifact per
    `docs/policies/pr-rules.md`, never proceed without it). Only then post the audit
    comment BEFORE merging:
    `PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION` naming: precondition result,
    exact head SHA, CI run ID, fresh-checkout result, review findings closed, mergeability
    (`MERGEABLE`/`CLEAN`), the per-PR scope of the authorization, and
    `Authorization artifact: comment <id>` — the audit comment may only claim what the
    gate-verified artifact actually shows.
12. **Merge commit** (`gh pr merge --merge`), then **read-after-write:** PR state MERGED,
    merge-commit SHA captured, local `main` fast-forwarded to it.
13. **Main-CI verify:** `check` success on the merge commit (gh-ci-wait exit 0).
14. **External evidence with read-after-write:** Jira comment (branch, commit, merge commit,
    files, local + fresh-checkout + CI run IDs, explicitly remaining gates) and, where
    ordered, Confluence updates — each mutation read back immediately. Compose → re-read →
    send (no drafting artifacts into versioned systems).
    For Confluence reconciliation: enumerate ALL affected pages upfront as a checklist —
    discover the set fresh via CQL (the space key is `PRODUKTMAN`; `space = ATLAS`
    silently returns 0 hits) plus the known status pages — and close out every entry
    explicitly: edited (old→new version, read-after-write) or recorded as
    `no change needed`. A page is never silently skipped (real case 2026-08-08: a
    reconciliation covered two of three status pages and skipped the third).
    `getConfluencePage` exposes no version number — verify versions via the update
    response (expected prior+1) plus content readback.

## Guardrails (binding)

- **G2 is NOT standing permission.** The solo-owner exception replaces ONLY the independent
  human approval and requires a verifiable per-PR PO authorization artifact: a GitHub
  comment on the PR by the PO account matching the `G2-AUTHORIZATION` schema in
  `docs/policies/pr-rules.md`, verified via `scripts/g2-authorization-gate.mjs` (exit 0).
  Authorization is NEVER inferred — not from `READY FOR MERGE`, not from
  `READY FOR PO AUTHORIZATION`, not from an expected next step, chat context, or
  anticipated consent. It never replaces CI, tests, review findings, or DoD.
  No artifact → the PR stays open.
- **The executing agent NEVER creates or edits the authorization artifact itself** —
  artifact creation is exclusively a human PO action. Residual risk (documented): under
  the solo-owner account model the gate cannot technically distinguish the PO-human from
  an agent using the same account; this remains a process obligation until account
  separation or technical enforcement exists. The gate makes authorization
  machine-checkable; it does not technically prevent merges (no branch protection —
  BLK-ATLAS-13-01).
- **Idempotency pre-check — orders can run twice.** The same PO order may execute in a
  parallel session (real case 2026-08-08: the ATLAS-56 closeout order ran twice; the
  second run found the ticket already `Fertig` and Confluence already reconciled).
  Before EVERY external mutation (Jira comment/transition, Confluence edit, PR
  create/merge), fresh-read the target's current state. If the intended end state
  already exists in full, do NOT re-apply: switch to verify-only mode — independently
  verify the observed end state against the order's expected outcome — report the
  duplicate execution as a deviation, and make zero duplicate mutations: no second
  evidence comment, no self-loop transition, no repeated page edit. If the order is
  only partially executed, verify the parts that already exist, apply only the
  genuinely missing mutations (each behind its own fresh read), and report the split
  explicitly.
- **Plan-file hygiene.** Executed implementation/session plans are committed under
  `docs/plans/` — as part of the slice PR or an immediate follow-up docs PR (precedent
  PR #6). Partially executed or superseded plans may be archived the same way ONLY with
  a prepended archival note stating their execution status and marking any decision
  claims that lack a citable artifact (see `docs/policies/pr-rules.md`,
  Entscheidungs-Provenienz). Active working drafts live in the session scratchpad,
  never as lingering untracked files in the working tree (enforced at branch time by
  step 3). A plan whose own text forbids committing it is archived only through a
  PO-gated docs PR whose body names each such prohibition — the PO's G2 artifact on
  that PR is the archival authorization; the executing agent never declares
  supersession on its own authority.
- **No ticket transitions to `Fertig`** without explicit PO order; slices integrated ≠ ticket done.
- **BLK-ATLAS-13-01** (branch protection) is OPEN until an Owner decision closes it — merges
  happen under documented PR policy; never claim technical protection exists.
- **Never invent root causes.** For the 2026-08-06 runner failures the only permitted
  classification is `UNKNOWN_PLATFORM_OR_POLICY`.
- **History is append-only:** historical evidence (failure runs, annotations, dated report
  sections) is never deleted or reworded — current-state corrections annotate, they don't erase.
- **Verify mutations themselves** (grep for the new content) before trusting downstream
  validators — a silently skipped edit can leave a green validator on an unchanged file.
- Approval-boundary items (`architecture/approval-boundary.md`) and `build-manifest.json`
  stop conditions override this skill.

## Output

Report per delivery: branch, commit(s), PR number, CI run IDs (PR head + main), review
findings and their resolution, merge commit, Jira/Confluence evidence IDs, remaining gates.

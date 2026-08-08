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
   fresh. Deviation → STOP.
2. **Read the checkers before editing checked files:** `scripts/validate-current-repository.mjs`
   enforces required files AND content invariants (headings, strings, JSON fields). Read it
   first; list which invariants your edit touches.
3. **Branch** from synced `main`: `<type>/<TICKET>-<slug>`.
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

## Guardrails (binding)

- **G2 is NOT standing permission.** The solo-owner exception replaces ONLY the independent
  human approval and requires a verifiable per-PR PO authorization artifact: a GitHub
  comment on the PR by the PO account matching the `G2-AUTHORIZATION` schema in
  `docs/policies/pr-rules.md`, verified via `scripts/g2-authorization-gate.mjs` (exit 0).
  Authorization is NEVER inferred — not from `READY FOR MERGE`, not from
  `READY FOR PO AUTHORIZATION`, not from an expected next step, chat context, or
  anticipated consent. It never replaces CI, tests, review findings, or DoD.
  No artifact → the PR stays open.
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

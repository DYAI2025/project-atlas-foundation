# Sprint-1 Integration Wave — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Die drei fachlich akzeptierten Sprint-1-PRs (#1 ATLAS-13, #3 ATLAS-12 Slice 1, #2 ATLAS-22 Slice 1) unter der G2-Solo-Owner-Exception kontrolliert per Merge-Commit nach `main` integrieren, WIP auf 0 offene Sprint-PRs reduzieren — ohne ein einziges Ticket auf Done zu setzen und ohne neue Features.

**Architecture:** Reine Integrations-/Governance-Operation, keine Code-Änderung. Drei sequenzielle Merge-Wellen mit jeweils vollständigem Gate (Fresh-Verify → Branch-Sync per normalem main-Merge → lokale Tests → Fresh Checkout → CI auf exaktem Head → Audit-Kommentar → Merge-Commit → Read-after-write → main-CI). Danach Jira-Reconciliation (nur Kommentare/Evidenz, keine Done-Transitionen) und 30-Punkte-Abschlussbericht. Jede Mutation wird unmittelbar nachgelesen (read-after-write). Jedes Gate ist ein harter STOP bei Abweichung.

**Tech Stack:** `gh` CLI (GitHub API), `git`, Node.js ≥22 (lokal: v24.16.0), `node --test`, npm 11.x, Atlassian-MCP-Tools (`mcp__claude_ai_Atlassian__*` bzw. `mcp__claude_ai_Atlassian_Rovo__*`, via ToolSearch laden).

---

## Verifizierter Ausgangszustand (Planungszeitpunkt 2026-08-07)

Alle Werte frisch gegen GitHub verifiziert — zur Ausführungszeit ERNEUT verifizieren (Task 3):

| Objekt | Erwartung | Status bei Planung |
|---|---|---|
| `origin/main` | `421ac70409201c0e3e5c4bb6e706d2fe70e3f0d8` | ✅ bestätigt |
| PR #1 Head (`feat/ATLAS-13-sprint-1-foundation`) | `2c6cd52901a783135e6eeece86aeb23c454ab815` | ✅ bestätigt, MERGEABLE/CLEAN |
| PR #3 Head (`feat/ATLAS-12-writer-registry-slice-1`) | `fd442f95be6eceba289b0ef1b4dfae87408dbebe` | ✅ bestätigt, MERGEABLE/CLEAN |
| PR #2 Head (`feat/ATLAS-22-local-contract-slice-1`) | `70d08503762e9a2de026181513be3127622d4847` | ✅ bestätigt, MERGEABLE/CLEAN |
| CI Run `31163903654` (workflow `foundation-consistency`, Job `92820242425`) | success auf exakt `2c6cd52` | ✅ bestätigt (`head_sha` exakt, `conclusion: success`, Event `pull_request`) |
| `behind 2` von PR #1 | exakt die 2 ATLAS-55-Probecommits | ✅ bestätigt: `c5260db` + `421ac70` (beide `ci(ATLAS-55) … ACTIONS_PROBE`) |

**Planungszeit-Analysen (Ausführung muss sie bestätigen, nicht blind übernehmen):**

- **Workflow-Topologie:** `foundation-consistency.yml` existiert NUR auf dem PR-#1-Branch (`on: pull_request` + `push: branches: [main]`). `main`, PR #3 und PR #2 haben nur `actions-probe.yml` (feuert nur bei Änderung seiner eigenen Datei). **Konsequenz:** PR #3/PR #2 haben aktuell ZU RECHT keine CI-Runs — das ist kein Blocker. Erst nach Merge von PR #1 nach main und Merge von main in die Feature-Branches triggert `foundation-consistency` dort (Event `pull_request`/synchronize).
- **Konfliktprognose:** Die drei PRs berühren disjunkte Dateien. PR #1: `M .gitignore` + nur neue Dateien. PR #3: nur neue Dateien (`config/`, `src/registry/`, `test/registry-resolve.test.mjs`). PR #2: `M README.md` (von PR #1/#3 unberührt) + nur neue Dateien. → Beide Branch-Syncs sollten konfliktfrei sein. Ein Konflikt wäre eine ABWEICHUNG → STOP.
- **Validator:** `scripts/validate-current-repository.mjs` prüft Required-Files + Konsistenz (u. a. `build-manifest.target_branch === 'feat/ATLAS-13-sprint-1-foundation'` — bleibt nach Merge wahr, da Dateiinhalt unverändert). Keine Datei-Allowlist → zusätzliche `src/`-Dateien brechen ihn nicht.
- **Test-Arithmetik Phase 3:** Nach Sync enthält der PR-#2-Branch `test/registry-resolve.test.mjs` (41 Tests, via main aus PR #3) UND `test/local-contract.test.mjs` (16 Tests). `npm test` = `node --test` läuft über BEIDE → erwartet **57 pass / 0 fail** gesamt; die fachliche 16er-Suite zusätzlich gezielt ausführen.
- **BLK-ATLAS-13-01** (GitHub Free, Branch-Protection-API 403 auf privatem Repo) bleibt OFFEN. Verhindert ATLAS-13 Done, verhindert unter G2 aber nicht die Merges.

**Umgebung:**

- Lokaler kanonischer Clone: `/Users/benjaminpoersch/Projects/project-atlas-foundation` (steht bei Planungsende auf `feat/ATLAS-12-writer-registry-slice-1`, clean).
- Fresh Checkouts in Session-Scratchpad oder `mktemp -d` — NIE im kanonischen Clone.
- Jira cloudId (aus Memory, in Task 1 frisch verifizieren): `4504291c-8bc0-48f8-ab9e-9ad5d376ca04`. ATLAS-Transitionen laut Memory: 11=Zu erledigen, 21=In Arbeit, 31=Fertig — vor jeder (nicht geplanten) Transition frisch lesen.
- **Diese Plandatei bleibt UNTRACKED.** Nicht committen — main darf außer den drei Merge-Commits keine neuen Commits erhalten.

## Bindende Verbote (aus PO-Auftrag)

Kein neues Feature · kein neuer Feature-Branch · keine Implementierung ATLAS-11/-15/-21/-23/-24 · kein ATLAS-12 Slice 2 · kein ATLAS-22 Slice 2 · kein Force-Push · kein History-Rewrite · kein Rebase · kein Squash · kein Self-APPROVE · Branch Protection nicht als erfüllt deklarieren · kein Ticket wegen Merge auf Done · keine neuen Runner-Probeexperimente · keine manuelle CI-Rerun-Auslösung, solange GitHub automatisch Runs erzeugt.

## STOP-Gates (bei JEDEM Eintreten: sofort anhalten, Zustand dokumentieren, PO-Bericht, KEINE weitere Mutation)

1. Erwarteter PR-Head unerwartet verändert.
2. CI auf exaktem Head nicht grün.
3. Merge-Konflikt (bei Branch-Sync oder PR-Merge).
4. Fresh-Checkout-Test schlägt fehl.
5. Neue Security-/Governance-Findings.
6. main zeigt nach Merge unerwarteten Zustand.
7. Eine Mutation kann nicht nachgelesen werden (read-after-write scheitert).
8. Jira-Mutation nötig, aber Transition/Capability nicht frisch verifizierbar.
9. Hosted Runner akquiriert überhaupt keinen Job → zusätzlich ATLAS-55 als aktiven Blocker melden.
10. Test-/Contract-Invarianten-Regression → nicht „mal eben" reparieren, Befund an PO.

---

# Phase 0 — Capabilities & Baseline

### Task 1: Capability-Probe

**Files:** keine (nur Lesezugriffe)

**Step 1: Atlassian-MCP-Tools laden**

ToolSearch mit Query:
```
select:mcp__claude_ai_Atlassian__atlassianUserInfo,mcp__claude_ai_Atlassian__getAccessibleAtlassianResources,mcp__claude_ai_Atlassian__getJiraIssue,mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql,mcp__claude_ai_Atlassian__addCommentToJiraIssue,mcp__claude_ai_Atlassian__getTransitionsForJiraIssue,mcp__claude_ai_Atlassian__getJiraIssueRemoteIssueLinks,mcp__claude_ai_Atlassian__getIssueLinkTypes,mcp__claude_ai_Atlassian__getConfluencePage
```
Falls dieser Server nicht authentifiziert: identische Tool-Namen mit Präfix `mcp__claude_ai_Atlassian_Rovo__` versuchen.

**Step 2: Jira-Identität + cloudId verifizieren**

`atlassianUserInfo` aufrufen, dann `getAccessibleAtlassianResources`. Erwartung: cloudId `4504291c-8bc0-48f8-ab9e-9ad5d376ca04` in der Liste. Abweichende cloudId → die tatsächliche verwenden und als Abweichung notieren.

**Step 3: Jira-Read-Probe**

`getJiraIssue` für `ATLAS-13` (nur Basisfelder). Erwartung: Issue lesbar, Status sichtbar.

**Step 4: Confluence-Read-Probe**

`getConfluencePage` für Page-ID `14680066` (Governance). Erwartung: lesbar.

**Step 5: GitHub-Capabilities prüfen**

```bash
gh auth status
gh api repos/DYAI2025/project-atlas-foundation --jq '{full_name,private,default_branch,permissions}'
```
Erwartung: authentifiziert als Owner-Identität mit `admin`- oder `push`-Recht auf `DYAI2025/project-atlas-foundation`, `private: true`, `default_branch: main`.

**Step 6: Capability-Matrix dokumentieren**

Für jede Fähigkeit (Jira Search/Read/Comment/Transitions, Confluence Read/Write, GitHub PR Read/Merge/Actions/Commit/Compare/Reviews) `OK` oder `CAPABILITY_MISSING` festhalten — Grundlage für Berichtspunkt 1.

**Fallback-Regel:** Jira nicht erreichbar → GitHub-Arbeit NUR fortsetzen, weil Jira-Zuordnung aus Branch-Namen eindeutig ist (`feat/ATLAS-13-…`, `feat/ATLAS-12-…`, `feat/ATLAS-22-…`). Keine Jira-Mutation behaupten. `CAPABILITY_MISSING` in Bericht.

### Task 2: Jira-Sprintzustand VOR Integration lesen (nur wenn Jira erreichbar)

**Step 1: Sprint-Issues lesen**

`searchJiraIssuesUsingJql` mit JQL:
```
project = ATLAS AND key in (ATLAS-11, ATLAS-12, ATLAS-13, ATLAS-15, ATLAS-21, ATLAS-22, ATLAS-23, ATLAS-24, ATLAS-55) ORDER BY key
```
Felder: `summary,status,issuelinks`. Status je Issue notieren (Berichtspunkt 2).

**Step 2: Issue-Links 10666/10667 lokalisieren**

In den `issuelinks` der Ergebnisse nach Link-IDs `10666` und `10667` suchen. Richtung (inward/outward, `blocks`/`is blocked by`) exakt notieren. NUR lesen — Bewertung in Task 30.

### Task 3: GitHub-Baseline frisch verifizieren

**Step 1: Zustand lesen**

```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin --prune
git rev-parse origin/main
gh pr list --repo DYAI2025/project-atlas-foundation --state open \
  --json number,headRefName,headRefOid,mergeable,mergeStateStatus,baseRefName
```

**Step 2: Gegen Erwartung prüfen**

- `origin/main` == `421ac70409201c0e3e5c4bb6e706d2fe70e3f0d8`
- PR #1 Head == `2c6cd52901a783135e6eeece86aeb23c454ab815`
- PR #3 Head == `fd442f95be6eceba289b0ef1b4dfae87408dbebe`
- PR #2 Head == `70d08503762e9a2de026181513be3127622d4847`
- genau 3 offene PRs, alle `MERGEABLE`

**Jede Abweichung → STOP-Gate 1.** Neuen Zustand analysieren und dem PO berichten, NICHT blind mergen. (Berichtspunkt 3: main vorher.)

---

# Phase 1 — PR #1 / ATLAS-13 Foundation

### Task 4: Gate-Checks 1–3 (Zustand, Head, Mergeability)

**Step 1:**
```bash
gh pr view 1 --repo DYAI2025/project-atlas-foundation \
  --json state,merged,headRefOid,mergeable,mergeStateStatus,baseRefName
```
Erwartung: `state: OPEN`, `merged: false`, `headRefOid: 2c6cd52901a783135e6eeece86aeb23c454ab815`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN` (oder `BLOCKED` nur wegen fehlendem Review — dann ist `mergeable: MERGEABLE` das maßgebliche Signal; `DIRTY`/`CONFLICTING` → STOP).

### Task 5: Gate-Checks 4, 5, 8 (Content-Reconciliation, PO-Findings 1–5, keine neuen Findings)

**Step 1: Alle PR-Kommentare + Reviews lesen**
```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/1/comments --paginate \
  --jq '.[] | {id, created_at, body: .body[0:400]}'
gh api repos/DYAI2025/project-atlas-foundation/pulls/1/reviews --paginate \
  --jq '.[] | {id, state, submitted_at, body: .body[0:400]}'
```

**Step 2: Inhaltlich prüfen**
- Check 4: Ein Kommentar dokumentiert die Content-Reconciliation (Suchbegriffe: „Reconciliation", „reconcili").
- Check 5: Die ursprünglichen PO-Findings 1–5 sind als geschlossen dokumentiert (Findings einzeln benennen und Schließungs-Evidenz zitieren).
- Check 8: Kein späterer Kommentar/Review enthält eine neue OFFENE Code-/Content-Finding.

Fehlt Evidenz für einen der drei Checks → STOP, Befund an PO.

### Task 6: Gate-Check 6 (Foundation-Validator grün auf exaktem Head)

**Step 1: Fresh Checkout des PR-#1-Heads**
```bash
FRESH1=$(mktemp -d)/pr1
gh repo clone DYAI2025/project-atlas-foundation "$FRESH1" -- --quiet
git -C "$FRESH1" checkout --quiet 2c6cd52901a783135e6eeece86aeb23c454ab815
git -C "$FRESH1" rev-parse HEAD   # MUSS 2c6cd52901a783135e6eeece86aeb23c454ab815 sein
```

**Step 2: Validator ausführen**
```bash
cd "$FRESH1" && node scripts/validate-current-repository.mjs; echo "EXIT=$?"
```
Erwartung: Ausgabe `VALIDATION PASSED`, `EXIT=0`. Sonst → STOP-Gate 2/5.

### Task 7: Gate-Check 7 (GitHub Actions auf exaktem Head)

**Step 1:**
```bash
gh api repos/DYAI2025/project-atlas-foundation/actions/runs/31163903654 \
  --jq '{id,workflow:.name,head_sha,status,conclusion}'
gh api repos/DYAI2025/project-atlas-foundation/actions/jobs/92820242425 \
  --jq '{id,name,status,conclusion,head_sha}'
```
Erwartung: beide `head_sha == 2c6cd52…`, `status: completed`, `conclusion: success`.

**Step 2: Kein späterer Run auf demselben Head fehlgeschlagen:**
```bash
gh api "repos/DYAI2025/project-atlas-foundation/actions/runs?head_sha=2c6cd52901a783135e6eeece86aeb23c454ab815" \
  --jq '.workflow_runs[] | {id,name,status,conclusion}'
```
Erwartung: kein `failure`. Sonst STOP.

### Task 8: Gate-Checks 9–10 (behind-2, Security/Governance)

**Step 1: behind-2 exakt bestimmen**
```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git log --oneline \
  $(git merge-base 2c6cd52901a783135e6eeece86aeb23c454ab815 origin/main)..origin/main
```
Erwartung: EXAKT zwei Commits, beide mit `ci(ATLAS-55)` + `ACTIONS_PROBE` im Betreff (`c5260db`, `421ac70`). Zusätzliche/andere Commits → STOP-Gate 1.

**Step 2: Kein Content-Konflikt** — bereits durch `mergeable: MERGEABLE` (Task 4) belegt; zusätzlich prüfen, dass die 2 Probecommits nur `.github/workflows/actions-probe.yml` berühren:
```bash
git diff --name-only $(git merge-base 2c6cd52901a783135e6eeece86aeb23c454ab815 origin/main)..origin/main
```
Erwartung: nur `.github/workflows/actions-probe.yml`.

**Step 3: Security/Governance-Scan (Check 10)**
```bash
gh pr diff 1 --repo DYAI2025/project-atlas-foundation --name-only
```
Prüfen: keine Secrets, keine Berührung der per `build-manifest.json`/`approval-boundary.md` geschützten Objekte (gbrain-atlas-Remote, Atlassian-Spaces, VPS, Upstream-Archive ausführen), keine Punkte der „Separate approval required"-Liste. Neuer Befund → STOP-Gate 5.

### Task 9: G2-Audit-Kommentar auf PR #1 + Read-after-write

**Step 1: Kommentar posten** (Inhalt normal formuliert, exakt diese Struktur):

```bash
gh pr comment 1 --repo DYAI2025/project-atlas-foundation --body "$(cat <<'EOF'
PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION

- PR: #1 `feat/ATLAS-13-sprint-1-foundation` → `main`
- Merge-Head (exakt): 2c6cd52901a783135e6eeece86aeb23c454ab815
- CI-Evidenz: workflow `foundation-consistency`, Run 31163903654 / Job 92820242425 = success auf exakt diesem Head; Foundation-Validator lokal auf Fresh Checkout dieses Heads: VALIDATION PASSED.
- Content-Gate: Content-Reconciliation dokumentiert; ursprüngliche PO-Findings 1–5 geschlossen; keine neuen offenen Code-/Content-Findings.
- Approval-Status: KEIN unabhängiges GitHub-APPROVED vorhanden. Strukturell unerreichbar: das private Repository hat genau einen realen Collaborator/Owner.
- Autorisierung: Der Product Owner aktiviert für genau diesen PR die dokumentierte G2-Solo-Owner-Ausnahme (Owner-autorisierter Merge ohne unabhängiges Approval; Integrationsauftrag vom 2026-08-07). Diese Ausnahme ist KEIN DoD-Waiver und gilt NICHT automatisch für zukünftige PRs.
- Branch Protection: BLK-ATLAS-13-01 bleibt OFFEN (GitHub-Free-Konto, Branch-Protection-/Rulesets-API 403 auf privatem Repo). Die Branch-Protection-AC von ATLAS-13 ist NICHT erfüllt.
- Konsequenz: Dieser Merge setzt ATLAS-13 NICHT auf Done.
EOF
)"
```

**Step 2: Read-after-write**
```bash
gh api repos/DYAI2025/project-atlas-foundation/issues/1/comments --paginate \
  --jq '.[-1] | {id, created_at, body: .body[0:200]}'
```
Erwartung: der soeben gepostete Kommentar ist les- und identifizierbar. Nicht lesbar → STOP-Gate 7. (Berichtspunkt 5.)

### Task 10: PR #1 mergen (Merge-Commit, Head-geschützt)

**Step 1: Merge**
```bash
gh pr merge 1 --repo DYAI2025/project-atlas-foundation --merge \
  --match-head-commit 2c6cd52901a783135e6eeece86aeb23c454ab815
```
KEIN `--squash`, KEIN `--rebase` (Audit-/Commit-Historie erhalten). `--match-head-commit` ist der Expected-Head-SHA-Schutz. Fehlermeldung „head … does not match" → STOP-Gate 1.

### Task 11: Post-Merge-Verifikation PR #1

**Step 1: Merge-Zustand lesen**
```bash
gh pr view 1 --repo DYAI2025/project-atlas-foundation \
  --json state,merged,mergedAt,mergeCommit
```
Erwartung: `merged: true`, `mergeCommit.oid` notieren (= NEUE main-SHA-Kandidatin).

**Step 2: main-Historie verifizieren**
```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git fetch origin
git rev-parse origin/main                       # MUSS == mergeCommit.oid
git log --first-parent --oneline -5 origin/main # Merge-Commit oben, davor 421ac70
git cat-file -p origin/main | head -5           # 2 Parents: 421ac70… und 2c6cd52…
```
Abweichung (mehr als der eine neue Merge-Commit, falsche Parents) → STOP-Gate 6. (Berichtspunkte 6, 7.)

### Task 12: main-CI nach PR #1 (Pflicht-Gate für Phase 2/3)

**Step 1: Automatisch getriggerten push-Run finden** (foundation-consistency, `on: push [main]`; `actions-probe` feuert NICHT, da sein Pfadfilter nicht berührt ist):
```bash
NEWMAIN=$(git rev-parse origin/main)
gh api "repos/DYAI2025/project-atlas-foundation/actions/runs?head_sha=$NEWMAIN" \
  --jq '.workflow_runs[] | {id,name,event,status,conclusion}'
```
Falls nach ~2 Minuten kein Run: bis zu 10 Minuten wiederholt lesen (kein manueller Dispatch!).

**Step 2: Run abwarten**
```bash
gh run watch <RUN_ID> --repo DYAI2025/project-atlas-foundation --exit-status
```

**Entscheidungslogik (hart):**
- `conclusion: success` → weiter zu Phase 2. (Berichtspunkt 8.)
- `conclusion: failure` → **STOP. PR #3/#2 NICHT integrieren.** PO-Bericht.
- Run bleibt dauerhaft `queued` / kein Job wird akquiriert (>15 min) → **STOP + ATLAS-55 erneut als AKTIVEN Blocker melden.**

---

# Phase 2 — PR #3 / ATLAS-12 Writer Registry Slice 1

(bewusst vor PR #2: kleiner Slice, null Dependencies, zentrale Routing-/Registry-Grundlage)

### Task 13: PR #3 Fresh-Verify

**Step 1: Zustand + Kommentare lesen**
```bash
gh pr view 3 --repo DYAI2025/project-atlas-foundation \
  --json state,merged,headRefOid,mergeable,mergeStateStatus,commits
gh api repos/DYAI2025/project-atlas-foundation/issues/3/comments --paginate \
  --jq '.[] | {created_at, body: .body[0:300]}'
```

**Step 2: Prüfen**
- fachliche PO-Akzeptanz als Kommentar vorhanden (Evidenz zitieren)
- ursprüngliche Findings geschlossen
- Head == `fd442f95be6eceba289b0ef1b4dfae87408dbebe`, keine neuen Commits
- `mergeable: MERGEABLE` (nach PR-#1-Merge erwartbar `mergeStateStatus: BEHIND` — das ist OK und wird in Task 14 behoben)

Abweichung → STOP.

### Task 14: Branch-Sync — main kontrolliert in den Feature-Branch mergen

KEIN Force-Push, KEIN Rebase, KEIN History-Rewrite.

**Step 1: Merge lokal ausführen**
```bash
cd /Users/benjaminpoersch/Projects/project-atlas-foundation
git checkout feat/ATLAS-12-writer-registry-slice-1
git pull --ff-only origin feat/ATLAS-12-writer-registry-slice-1
git merge origin/main --no-edit
```
Erwartung: konfliktfreier Merge (Konfliktprognose: disjunkte Dateien). Konflikt → `git merge --abort` → STOP-Gate 3.

**Step 2: Neuen Head notieren + pushen (normaler Push)**
```bash
NEWHEAD3=$(git rev-parse HEAD); echo "$NEWHEAD3"
git push origin feat/ATLAS-12-writer-registry-slice-1
```
(Berichtspunkt 9: Synchronisierungs-SHA.)

### Task 15: Lokale Tests auf dem NEUEN exakten Head

**Step 1: Fachliche Suite**
```bash
git rev-parse HEAD   # MUSS == $NEWHEAD3
node --test test/registry-resolve.test.mjs
```
Erwartung: `# pass 41`, `# fail 0`. Regression → STOP-Gate 10, NICHT reparieren, PO-Befund.

**Step 2: Foundation-Validator** (jetzt via main im Branch enthalten)
```bash
node scripts/validate-current-repository.mjs; echo "EXIT=$?"
```
Erwartung: `VALIDATION PASSED`, `EXIT=0`. (Berichtspunkt 10.)

### Task 16: Fresh Checkout des neuen Heads

**Step 1:**
```bash
FRESH3=$(mktemp -d)/pr3
gh repo clone DYAI2025/project-atlas-foundation "$FRESH3" -- --quiet
git -C "$FRESH3" checkout --quiet "$NEWHEAD3"
cd "$FRESH3" && node --test test/registry-resolve.test.mjs && \
  node scripts/validate-current-repository.mjs; echo "EXIT=$?"
```
Erwartung: 41 pass / 0 fail, `VALIDATION PASSED`, `EXIT=0`. Fehlschlag → STOP-Gate 4. (Berichtspunkt 11.)

### Task 17: CI auf dem neuen PR-Head abwarten

Der Push aus Task 14 triggert automatisch `foundation-consistency` (Event `pull_request`/synchronize — Workflow-Datei kommt jetzt über main in den Merge-Ref). KEIN manueller Rerun.

**Step 1:**
```bash
gh api "repos/DYAI2025/project-atlas-foundation/actions/runs?head_sha=$NEWHEAD3" \
  --jq '.workflow_runs[] | {id,name,event,status,conclusion}'
gh run watch <RUN_ID> --repo DYAI2025/project-atlas-foundation --exit-status
```
Erwartung: `success` auf exakt `$NEWHEAD3`. Failure → STOP-Gate 2. Kein Job akquiriert (>15 min) → STOP-Gate 9. (Berichtspunkt 12.)

### Task 18: G2-Audit-Kommentar auf PR #3 + Read-after-write

**Step 1:** Kommentar analog Task 9, mit: `PO INTEGRATION AUTHORIZATION — G2 SOLO-OWNER EXCEPTION` als Titel, exaktem `$NEWHEAD3`, CI-Run-ID aus Task 17, lokaler + Fresh-Checkout-Testevidenz (41/0, Validator PASSED), fehlendem unabhängigem Approval, expliziter G2-Ausnahme (kein DoD-Waiver, nicht übertragbar), Branch Protection weiterhin offen (BLK-ATLAS-13-01), sowie: „Dieser Merge integriert NUR Slice 1 — ATLAS-12 wird dadurch NICHT Done (Ticket hat weiteren Scope)."

**Step 2: Read-after-write** — analog Task 9 Step 2 auf `issues/3/comments`.

### Task 19: PR #3 mergen + Post-Merge-Verifikation

**Step 1:**
```bash
gh pr merge 3 --repo DYAI2025/project-atlas-foundation --merge \
  --match-head-commit "$NEWHEAD3"
```

**Step 2: Read-after-write**
```bash
gh pr view 3 --repo DYAI2025/project-atlas-foundation --json state,merged,mergeCommit
git fetch origin && git rev-parse origin/main   # == mergeCommit.oid
git log --first-parent --oneline -3 origin/main
```
(Berichtspunkte 13, 14.)

### Task 20: main-CI nach PR #3

Analog Task 12 auf der neuen main-SHA. `success` → Phase 3. `failure` → STOP, PR #2 NICHT integrieren. Kein Job → STOP + ATLAS-55.

---

# Phase 3 — PR #2 / ATLAS-22 Local Adapter Contract Slice 1

### Task 21: PR #2 Fresh-Verify

Analog Task 13 für PR #2: Head vor Sync erwartbar `70d08503762e9a2de026181513be3127622d4847`, keine neuen Commits, PO-Akzeptanz-Evidenz (16/16 Tests, Contract-Invarianten, Ajv-Parität) in Kommentaren belegen, `mergeable: MERGEABLE`. Abweichung → STOP.

### Task 22: Branch-Sync main → `feat/ATLAS-22-local-contract-slice-1`

Analog Task 14. Konfliktprognose: konfliktfrei (PR #2 ändert `README.md`, das weder PR #1 noch PR #3 anfasst). Konflikt → abort → STOP.

```bash
git checkout feat/ATLAS-22-local-contract-slice-1
git pull --ff-only origin feat/ATLAS-22-local-contract-slice-1
git merge origin/main --no-edit
NEWHEAD2=$(git rev-parse HEAD); echo "$NEWHEAD2"
git push origin feat/ATLAS-22-local-contract-slice-1
```
(Berichtspunkt 15.)

### Task 23: Lokale Tests auf dem NEUEN exakten Head

**Step 1: Dependencies + Gesamtsuite**
```bash
git rev-parse HEAD          # MUSS == $NEWHEAD2
node --version              # >= 22 (engines-Constraint; lokal v24.16.0)
npm ci --ignore-scripts
npm test
```
Erwartung: `npm test` (= `node --test`) läuft über test/local-contract.test.mjs UND test/registry-resolve.test.mjs → **57 pass / 0 fail gesamt** (16 + 41). JEDER fail → STOP-Gate 10.

**Step 2: Fachliche 16er-Suite isoliert belegen**
```bash
node --test test/local-contract.test.mjs
```
Erwartung: `# pass 16`, `# fail 0`.

**Step 3: Foundation-Validator**
```bash
node scripts/validate-current-repository.mjs; echo "EXIT=$?"
```
Erwartung: `VALIDATION PASSED`, `EXIT=0`. (Berichtspunkt 16.)

### Task 24: Fresh Checkout des neuen Heads

```bash
FRESH2=$(mktemp -d)/pr2
gh repo clone DYAI2025/project-atlas-foundation "$FRESH2" -- --quiet
git -C "$FRESH2" checkout --quiet "$NEWHEAD2"
cd "$FRESH2" && npm ci --ignore-scripts && npm test && \
  node scripts/validate-current-repository.mjs; echo "EXIT=$?"
```
Erwartung: 57 pass / 0 fail, `VALIDATION PASSED`, `EXIT=0`. Fehlschlag → STOP-Gate 4. (Berichtspunkt 17.)

### Task 25: CI auf dem neuen PR-Head abwarten

Analog Task 17 mit `$NEWHEAD2`. Erwartung `success` auf exaktem Head. (Berichtspunkt 18.)

### Task 26: G2-Audit-Kommentar auf PR #2 + Read-after-write

Analog Task 18, mit `$NEWHEAD2`, CI-Run-ID, Testevidenz (16/16 fachlich, 57/0 gesamt, Ajv-Parität laut PO-Akzeptanz, Validator PASSED) und: „Slice 1 integriert ≠ gesamtes Ticket abgeschlossen — ATLAS-22 wird NICHT Done." Read-after-write auf `issues/2/comments`.

### Task 27: PR #2 mergen + Post-Merge-Verifikation

```bash
gh pr merge 2 --repo DYAI2025/project-atlas-foundation --merge \
  --match-head-commit "$NEWHEAD2"
gh pr view 2 --repo DYAI2025/project-atlas-foundation --json state,merged,mergeCommit
git fetch origin && git rev-parse origin/main
git log --first-parent --oneline -4 origin/main
```
(Berichtspunkte 19, 20: finaler main-SHA.)

### Task 28: main-CI nach PR #2

Analog Task 12. `success` → Phase 4. `failure`/kein Job → STOP (+ ATLAS-55-Meldung).

---

# Phase 4 — Jira-Reconciliation (nur wenn Jira erreichbar; sonst CAPABILITY_MISSING dokumentieren)

### Task 29: Issues frisch lesen + Evidenz-Kommentare (KEINE Done-Transitionen)

Für ATLAS-13, ATLAS-12, ATLAS-22 jeweils:

**Step 1:** `getJiraIssue` frisch lesen (Status, AC-Felder).

**Step 2:** `addCommentToJiraIssue` mit Integrations-Evidenz (normal formuliert): PR-Nummer, Merge-Commit-SHA, CI-Run, G2-Ausnahme-Referenz, und explizit warum NICHT Done:
- ATLAS-13: „Merge unter G2-Ausnahme integriert. BLK-ATLAS-13-01 (Branch Protection) bleibt offen → Branch-Protection-AC nicht erfüllt → Status bleibt In Arbeit."
- ATLAS-12: „Slice 1 integriert (Merge-Commit …). Ticket-Scope geht über Slice 1 hinaus → Status bleibt In Arbeit."
- ATLAS-22: „Slice 1 integriert (Merge-Commit …). Slice 1 ≠ gesamtes Ticket → Status bleibt In Arbeit."

**Step 3:** Read-after-write: Issue erneut lesen, Kommentar-Sichtbarkeit + unveränderten Status verifizieren. Nicht nachlesbar → STOP-Gate 7.

**KEINE Transition ausführen.** Sollte ein Status wider Erwarten falsch stehen (z. B. bereits Fertig): NICHT korrigierend transitionieren, sondern als Abweichung berichten.

### Task 30: ATLAS-55 frisch bewerten

**Step 1:** `getJiraIssue ATLAS-55` + `getTransitionsForJiraIssue ATLAS-55` frisch lesen (Acceptance-/Closure-Kriterien aus Description zitieren).

**Step 2:** Kommentar mit neuer Evidenz posten — wörtlich enthalten:
```
Runner acquisition currently operational; original root cause remains unknown.
```
plus Liste der erfolgreichen Hosted-Runner-Runs dieser Session (Run-IDs aus Tasks 12/17/20/25/28). KEINE Root-Cause-Behauptung.

**Step 3:** Statusänderung NUR, wenn die tatsächlichen Acceptance-/Bug-Closure-Kriterien des Tickets sie eindeutig rechtfertigen UND die Ziel-Transition unmittelbar zuvor frisch gelesen wurde. Im Zweifel: keine Transition, nur Kommentar. Read-after-write.

### Task 31: Jira-Links 10666/10667 prüfen

**Step 1:** Aus Task 2 (bzw. frisch nachlesen): Link-IDs 10666/10667 — welche Issues, welche Richtung (`blocks` vs `is blocked by`).

**Step 2:** Bewerten, ob die Blockierungsrichtung fachlich falsch ist. **KEINE widersprüchlichen Reverse-Duplikate erzeugen.** Das MCP-Toolset hat keine Delete-Link-Capability → Korrektur NICHT ausführen, nur präzise melden (`CAPABILITY_MISSING: issue link delete/edit`). (Berichtspunkt 23.)

---

# Phase 5 — Abschlussbericht & STOP

### Task 32: Abschlussbericht (exakt 30 Punkte) liefern, dann STOP

Alle 30 Punkte des PO-Auftrags in Reihenfolge, mit konkreten SHAs/Run-IDs/Statusnamen:

1. Capability-Status (Matrix aus Task 1)
2. Jira-Sprintzustand vor Integration (Task 2)
3. main vorher (`421ac70…`, Task 3)
4. PR #1 Gate-Matrix (Checks 1–10, je Evidenz)
5. G2-Audit-Kommentar PR #1 (ID + read-after-write)
6. PR #1 Merge-Ergebnis (mergeCommit)
7. main nach PR #1
8. main-CI nach PR #1 (Run-ID, conclusion)
9. PR #3 Synchronisierungs-SHA (`$NEWHEAD3`)
10. PR #3 lokale Tests (41/0 + Validator)
11. PR #3 Fresh Checkout
12. PR #3 CI (Run-ID, conclusion)
13. PR #3 Merge-Ergebnis
14. main nach PR #3
15. PR #2 Synchronisierungs-SHA (`$NEWHEAD2`)
16. PR #2 lokale Tests (16/0 fachlich, 57/0 gesamt + Validator)
17. PR #2 Fresh Checkout
18. PR #2 CI
19. PR #2 Merge-Ergebnis
20. finaler main-SHA
21. Jira-Status ATLAS-12/13/22/55 (nach Reconciliation)
22. Jira-Mutationen + Read-after-write-Belege
23. Jira-Linkstatus 10666/10667
24. verbleibende Blocker (mind. BLK-ATLAS-13-01; ggf. ATLAS-55-Restunbekannte)
25. Anzahl offener PRs (erwartet: 0)
26. WIP nach Integration
27. Bestätigung: kein Ticket fälschlich Done
28. Bestätigung: kein neuer Feature-Slice
29. nächste PO-Empfehlung: ATLAS-23 ja/nein + Evidenz (Runner operational [Run-IDs], Foundation auf main, CI-/Security-Gates = Risikoreduktion + Abhängigkeitsmultiplikator; ATLAS-23 in dieser Session NICHT starten)
30. alle Abweichungen vom erwarteten Zustand (auch „keine")

**Danach STOP. Keine neue Implementierung. Keine weiteren Mutationen.**

---

## Aufräumen (nach Bericht, optional)

```bash
rm -rf "$FRESH1" "$FRESH3" "$FRESH2"   # nur die mktemp-Checkouts, NIE den kanonischen Clone
```
Der kanonische Clone darf auf dem zuletzt ausgecheckten Branch stehen bleiben; `git checkout main && git pull --ff-only` als sauberer Endzustand ist erlaubt (kein Commit!).

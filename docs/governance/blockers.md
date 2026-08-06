# Governance-Blocker

## BLK-ATLAS-13-02 — GitHub Actions erzeugt keine Runs für dieses Repository

- **Datum:** 2026-08-06
- **Ticket:** ATLAS-13 (Korrekturschnitt), betrifft auch ATLAS-23
- **Befund:** Workflow `.github/workflows/foundation-consistency.yml` liegt auf
  dem PR-Branch (Commits `d7ef3ec`, `689611a`). Actions-Permissions:
  `{"enabled": true, "allowed_actions": "all"}`. Trotzdem: 0 Workflow-Runs,
  `gh workflow list` leer, und auf dem Head-Commit existieren 9 Check-Suites
  von Dritt-Apps (render, railway, fly-io, cursor, vercel, trunk-io, supabase,
  sourcery-ai, google-cloud-build), aber **keine** `github-actions`-Suite —
  GitHub Actions verarbeitet die `pull_request`-Events dieses privaten Repos
  nicht.
- **Versuche (2, materiell unterschiedlich, gemäß Fehlerregel gestoppt):**
  1. Workflow-Datei per Push auf den PR-Branch (synchronize-Event) — kein Run.
  2. Frisches synchronize-Event per Empty-Commit `689611a` — kein Run.
- **Wahrscheinliche Ursache:** Account-/Billing-seitige Actions-Blockade des
  Free-User-Accounts `DYAI2025` für private Repositories (API meldet
  `plan: null`); nicht über Repo-Einstellungen behebbar.
- **Owner-Optionen:**
  1. GitHub Web-UI → Actions-Tab des Repos öffnen (Aktivierungs-/Billing-Banner
     bestätigen), Settings → Billing → Spending-Limit/Zahlungsmethode prüfen.
  2. Nach Merge von PR #1 ist der Workflow auf `main` registriert; prüfen, ob
     Folge-PRs dann Runs erhalten.
  3. Einmaliger Owner-genehmigter Direkt-Push des Workflows auf `main`
     (dokumentierte Ausnahme analog Bootstrap).
- **Interim-Evidenz:** Lokale Ausführung `node scripts/validate-current-repository.mjs`
  → `VALIDATION PASSED` (42 Checks), Log versioniert in
  `reports/current-validation.log`.
- **Status:** OPEN — verhindert den CI-Ausführungsnachweis für PR #1 und die
  Required-Checks-Verknüpfung (zusammen mit BLK-ATLAS-13-01).

## BLK-ATLAS-13-01 — Branch Protection auf privatem Repo nicht verfügbar

- **Datum:** 2026-08-06
- **Ticket:** ATLAS-13
- **Befund:** `DYAI2025` ist ein GitHub-User-Account im Free-Plan. Sowohl die
  Branch-Protection-API als auch die Rulesets-API antworten für das private
  Repository mit HTTP 403:
  `"Upgrade to GitHub Pro or make this repository public to enable this feature."`
- **Konflikt:** Approval Boundary §12 verbietet öffentliche Distribution des
  ATLAS-Repositories. Public schalten scheidet daher als Lösung aus.
- **Interim:** PR-Pflicht, Review-Pflicht und Konversationsauflösung gelten
  als dokumentierte, disziplinarisch verbindliche Policy
  (`docs/policies/pr-rules.md`), sind aber technisch nicht erzwungen.
  CODEOWNERS ist vorbereitet.
- **Owner-Entscheidung (06.08.2026): Option 3 — dokumentiertes Interim bis
  zum Release-Gate.** Für Sprint 1 gilt: Repository bleibt privat; kein
  GitHub-Pro-Upgrade im Sprint; kein Organisationsumzug im Sprint; keine
  öffentliche Sichtbarkeit; disziplinarische PR-Policy bleibt aktiv.
- **Status:** OPEN (Interim akzeptiert) — blockiert weiterhin `Done` für
  ATLAS-13 und teilweise ATLAS-23 („Default-Branch ist geschützt", „Gates
  als Branch-Protection-Rules verknüpft"). Vor produktivem Agent-Write
  beziehungsweise Release MUSS technische Branch Protection vorhanden sein
  (DEC-10).

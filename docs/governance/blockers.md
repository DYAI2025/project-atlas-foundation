# Governance-Blocker

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
- **Auflösungsoptionen (Owner-Entscheidung):**
  1. GitHub Pro für den Account `DYAI2025` (Branch Protection + Rulesets auf
     privaten Repos).
  2. Umzug des Repositories in eine GitHub-Organisation mit Team-Plan.
  3. Interim akzeptieren bis Release-Gate; vor produktivem Agent-Write
     (DEC-10) MUSS die technische Erzwingung stehen.
- **Status:** OPEN — blockiert die Akzeptanzkriterien „Default-Branch ist
  geschützt" und „Gates als Branch-Protection-Rules verknüpft" (ATLAS-13,
  ATLAS-23) auf technischer Ebene.

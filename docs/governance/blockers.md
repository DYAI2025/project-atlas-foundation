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
- **Owner-Entscheidung (06.08.2026): Option 3 — dokumentiertes Interim bis
  zum Release-Gate.** Für Sprint 1 gilt: Repository bleibt privat; kein
  GitHub-Pro-Upgrade im Sprint; kein Organisationsumzug im Sprint; keine
  öffentliche Sichtbarkeit; disziplinarische PR-Policy bleibt aktiv.
- **Status:** OPEN (Interim akzeptiert) — blockiert weiterhin `Done` für
  ATLAS-13 und teilweise ATLAS-23 („Default-Branch ist geschützt", „Gates
  als Branch-Protection-Rules verknüpft"). Vor produktivem Agent-Write
  beziehungsweise Release MUSS technische Branch Protection vorhanden sein
  (DEC-10).

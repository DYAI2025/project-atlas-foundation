# Governance-Blocker

## BLK-ATLAS-13-02 — GitHub Actions: Hosted-Runner akquiriert keine Jobs (Jira: ATLAS-55)

- **Datum:** 2026-08-06 (aktualisiert nach ATLAS-55-Probe-Test)
- **Ticket:** ATLAS-55 (Bug); blockiert ATLAS-13 und ATLAS-23
- **Teilbefund 1 — GELÖST (Trigger/Registrierung):** Die ursprünglich
  beobachtete Run-Losigkeit (0 Runs für `d7ef3ec`/`689611a`/`a1dbfc6`) lag
  daran, dass noch kein Workflow auf dem Default Branch `main` registriert
  war. Beweis: Nach dem genehmigten Probe-Commit
  (`BOOTSTRAP_EXCEPTION_ATLAS_55_ACTIONS_PROBE`, `c5260db`) listet
  `gh workflow list` beide Workflows als `active` (actions-probe 328876692,
  foundation-consistency 328873830), und GitHub erzeugte selbständig den
  ausstehenden `pull_request`-Run 31127753756 für PR #1 (Head `a1dbfc6`)
  sowie `workflow_dispatch`-Runs. Trigger und Eventverarbeitung
  funktionieren damit nachweislich. Die frühere Billing-Vermutung war als
  Ursache hierfür falsch und ist verworfen.
- **Teilbefund 2 — OFFEN (Runner-Acquisition):** Alle drei erzeugten Runs
  enden `failure`, Job `cancelled` nach exakt 15m02s, 0 ausgeführte Steps,
  keine Logs. Konkrete GitHub-Annotation (wörtlich, in allen drei Jobs
  92705654160, 92706093471, 92707084002 identisch):
  `The job was not acquired by Runner of type hosted even after multiple attempts`
- **Versuche (2, materiell unterschiedlich, gemäß Fehlerregel gestoppt):**
  1. Probe-Run 31127837386 mit `runs-on: ubuntu-latest` (`c5260db`) —
     cancelled, Annotation wie oben.
  2. Probe-Run 31128025409 mit explizitem `runs-on: ubuntu-24.04`
     (`421ac70`) — identisches Ergebnis.
- **Klassifikation:** Hosted-Runner-Acquisition-Failure gemäß tatsächlicher
  GitHub-Meldung. Der dahinterliegende Grund wird von GitHub nicht benannt →
  `UNKNOWN_PLATFORM_OR_POLICY`. Billing/Spending-Limit ist eine mögliche
  Hypothese unter mehreren (Policy, Aktivierung, Plattformfehler) und darf
  ohne konkrete GitHub-Meldung nicht als Ursache dokumentiert werden.
- **Owner-Aktionen (außerhalb der Agent-Reichweite):** GitHub Web-UI →
  Repo-Actions-Tab und Account Settings → Billing auf konkrete Warnbanner
  prüfen; ggf. GitHub-Support mit Run-IDs 31127837386/31128025409 und der
  Annotation kontaktieren.
- **Interim-Evidenz:** Lokale Ausführung `node scripts/validate-current-repository.mjs`
  → `VALIDATION PASSED` (42 Checks, frisch gemessen 2026-08-07), Log versioniert in
  `reports/current-validation.log`. Historie der Zahl, damit sie prüfbar bleibt: Die
  frühere Angabe „42" war zum Zeitpunkt ihrer Niederschrift falsch — der Validator
  lieferte damals 41 Checks. Mit der Aufteilung der Sprint-Ticket-Prüfung in
  „exactly the eight delivery tickets" + „exactly one sprint enabler: ATLAS-55"
  (Aufnahme von ATLAS-55 in Sprint 370 als Enabler) sind es jetzt tatsächlich 42.
- **Status:** OPEN — verhindert weiterhin den CI-Ausführungsnachweis für
  PR #1 und die Required-Checks-Verknüpfung (zusammen mit BLK-ATLAS-13-01).

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

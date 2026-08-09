> **ARCHIVIERUNGSVERMERK (2026-08-09):** Historischer Planungsstand, TEILWEISE
> ausgeführt: Task 0 (ATLAS-56 / Gate 0) ist abgeschlossen (PR #9, main
> `37d05148…`); die Tasks 1–5 (ATLAS-12/15/22/23/11) sind zum Archivierungszeitpunkt
> NICHT ausgeführt. Die Selbstbeschreibung „lokal, uncommitted, untracked; darf
> NIEMALS Bestandteil von PR #9 werden“ beschrieb die Planungssession (PR #9 ist
> inzwischen gemerged); diese Archivierung ersetzt sie. Die Integration dieses
> Archivierungsstands erfordert vor dem Merge ein gültiges, PR-#10- und
> Head-spezifisches G2-Autorisierungsartefakt des menschlichen PO; zum Zeitpunkt
> dieses Vermerks existiert kein solches Artefakt.
> **Entscheidungsstand:** D1 ist belegt und ausgeführt — G2-Autorisierungsartefakt
> = PR-#9-Kommentar 5226700791, PO-Integrations-Audit 5227041045, Merge
> `37d05148687fb96fd034e197070341460a991f3b`. D2–D9 sind seit dem 09.08.2026
> materialisiert und belegt: Confluence-Seite 15171611 („14 – Delivery Model,
> Program Increment and Sprint Plan“, Space PRODUKTMAN), Abschnitt
> „PO-Entscheidungen D1–D9 im Wortlaut (materialisiert 09.08.2026)“, ursprünglich
> materialisiert in Version 12. Version 13 (09.08.2026) ergänzt an genau diesem Block
> die Agenten-Provenienzkennzeichnung nach Bedingung 8 und fügt den Abschnitt
> „PO-Review-Entscheidungen zu PR #10 (materialisiert 09.08.2026)“ hinzu. Beide
> Confluence-Abschnitte sind durch den ausführenden Agenten auf ausdrücklichen
> PO-Auftrag materialisiert, nicht vom PO selbst verfasst.
> Die frühere Diskrepanz zur Seite 14 („Ein nächster Sprint-Slice ist bewusst NICHT
> entschieden“) ist damit aufgelöst; die Seite führt diese Formulierung seit dem
> 09.08.2026 selbst als SUPERSEDED.
> Ursprünglicher Inhalt darunter unverändert.

# Sprint 1 Runway Scope Sharpening — Implementation Plan (Rev. 2, nach PO-Review)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **Status:** PO-Review 2026-08-08 eingearbeitet (Entscheidungen D1–D9, verbindlich). Dokument ist lokal, uncommitted, untracked; darf NIEMALS Bestandteil von PR #9 werden. Aktueller Zustand: `WAITING FOR PRODUCT OWNER EXECUTION AUTHORIZATION`. Keine Implementierung vor dieser Autorisierung.

**Goal:** Den verbleibenden Sprint-1-Rest auf den minimalen robusten Runway zuschneiden, damit Sprint 2 ohne weitere Foundation-Runde einen realen Projekt-Datensatz über einen versionierten Read-Pfad als sichtbaren semantischen Graphen darstellen kann.

**Architecture:** Kein neuer Architektur-Entwurf. Der Plan schärft ausschließlich Reihenfolge und Fokus des bestehenden Sprint-1-Backlogs (Jira Sprint 370) entlang der verbindlichen PO-Entscheidungen D1–D9. Kanonische Systeme unverändert: GitHub `DYAI2025/project-atlas-foundation` (Code), Jira ATLAS/Board 304 (Sprint/Status/AC), Confluence PRODUKTMAN Root 14778372 (Product Goal/Architektur/Entscheidungen).

**Tech Stack:** Node ≥ 22, `node --test`, Ajv 8.20.0 (einzige Dev-Dependency), GitHub Actions (`ci.yml`, Context `check`), deterministische CLI-Checker (`src/local-contract/`, `src/registry/`), G2-Gate `scripts/g2-authorization-gate.mjs` (PR #9, noch nicht auf main).

---

## Verhältnis zum historischen Plan (verbindlich)

- `docs/plans/2026-08-06-atlas-sprint-1-foundation.md` (Rev. 2) bleibt **unverändert als historische Planung und Evidenz** bestehen. Nichts daraus wird überschrieben, still korrigiert oder gelöscht.
- Dieser Plan **ersetzt keine Akzeptanzkriterien** und schwächt keine ab. Wo der PO Scope splittet oder defer'd (D2, D3), geschieht das als dokumentierte, nachvollziehbare Entscheidung — der spätere Jira-Split/Backlog-Move muss explizit ausweisen, welcher ursprüngliche Umfang ausgegliedert wurde.
- Optimierungsziel: **Sprint 2 kann direkt sichtbaren Nutzerwert liefern** (read-only Semantic-Atlas-Slice), nicht Ticketdurchsatz.

---

## PO DECISIONS (verbindlich, Review 2026-08-08)

| ID | Entscheidung |
|---|---|
| **D1** | PR #9 wird nach erfolgreichem G2-Gate gemerged. Das ersetzt NICHT das menschliche Autorisierungsartefakt: Ohne GitHub-Kommentar des menschlichen PO-Accounts mit exakt `G2-AUTHORIZATION` / `PR: #9` / `HEAD: 87bbcb08fc00e18378f94f50c2d878ce065de348` bleibt der Merge blockiert. Kein Agent erzeugt oder editiert dieses Artefakt jemals selbst. |
| **D2** | ATLAS-22: **SPLIT.** Sprint 1 fokussiert auf den gbrain-read / graph-projection contract. Restlicher Adapterumfang (gbrain-evals, Jira, Confluence, Obsidian) wird explizites Carry-over/Backlog. Original-AC und historische Evidenz bleiben unangetastet; der spätere Jira-Split dokumentiert nachvollziehbar den ausgegliederten Umfang. |
| **D3** | ATLAS-24: **DEFER aus Sprint 1**, zurück ins Product Backlog / Carry-over. Begründung: Release-/Supply-Chain-Wert, entsperrt aber nicht den ersten sichtbaren Read-only-Pilot. Jira-Mutation erst in einer Execution-Session. |
| **D4** | ATLAS-12: Keine gbrain-seitige Registry-Mutation künstlich in den Sprint ziehen. Erfüllen kanonische Registry + Routing + Root-Auflösung + Verifikation/Evidenz das live gelesene Jira-AC, darf die Execution ATLAS-12 abschließen. Verlangt das Live-AC ausdrücklich gbrain-seitige Persistenz: nicht waiven, sondern als sauber abgetrenntes Carry-over kennzeichnen. |
| **D5** | Sprint-2-Richtung ist PO-autorisiert für kanonische Confluence-Verankerung, sobald wieder mutiert wird: „Ein reales ATLAS-Projekt wird aus einem versionierten kanonischen Read-Pfad als interaktiver semantischer Graph sichtbar; Beziehungen bleiben bis zur Quelle nachvollziehbar." Vertikaler Slice: real project → versioned read adapter → deterministic graph snapshot → browser viewer → node focus → direct neighbours → source provenance. Danach: Overlap Lens (zwei Projekte/Themen → gemeinsame Konzepte → nachvollziehbare Erklärung). Keine Confluence-Mutation in dieser Planänderung. |
| **D6** | ATLAS-14 wird NICHT neues Sprint-1-Implementationsthema. Formale ADR-Abnahme ist verpflichtendes **PRE-SPRINT-2 GATE** vor dem ersten Sprint-2-Code. |
| **D7** | Erster Sprint-2-Slice läuft **lokal gegen deterministischen Snapshot**. Kein Live-VPS-Zwang → ATLAS-16 ist für diesen ersten Read-only-Piloten kein harter Blocker. Ausdrücklich KEINE Behauptung, ATLAS-16 sei generell erledigt oder unwichtig. |
| **D8** | Carry-over bestätigt: ATLAS-13 bleibt offen/parked (BLK-ATLAS-13-01); keine weiteren Branch-Protection-/Ruleset-API-Versuche. ATLAS-23 liefert nur den unblocked Gate-Anteil; solange das Live-AC technisch verknüpfte Required Checks verlangt, wird das Gesamt-Issue nicht künstlich auf Fertig gesetzt. |
| **D9** | Seite 05 wird NICHT als gelöst behandelt. ATLAS-22-Verträge dürfen für den Sprint-2-Read-Pfad deterministische **projektionslokale** stabile IDs definieren: project-scoped, source-scoped, reproduzierbar, für Nodes und Edges referenzierbar, provenance-fähig, für spätere Overlap-Lens verwendbar. Sie sind ausdrücklich NICHT automatisch die endgültigen kanonischen Entity IDs. |

---

## Current Evidence (Fresh Reads, 2026-08-08)

### GitHub (live, 2026-08-08)

- `origin/main` = `2b05e9914544c7f1086eb25b422467edeed07ce6` (Merge PR #8).
- Offene PRs: genau **PR #9** `fix/ATLAS-56-g2-authorization-gate`, Head `87bbcb08fc00e18378f94f50c2d878ce065de348`, State OPEN, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`.
- PR #9 CI: Check `check` (Workflow `ci`) SUCCESS, Run 31231505456. PO-Code-Review 2026-08-08 08:48 (DYAI2025): „READY FOR MERGE after the remaining fresh G2 preconditions are verified" — mit explizitem Schlusssatz „This review itself is NOT the G2 authorization artifact."
- **PR #9 hat null Issue-Kommentare.** Kein G2-Autorisierungsartefakt vorhanden. → Gate 0 offen.
- PR-#9-Diff (6 Dateien, +675): `scripts/g2-authorization-gate.mjs`, `test/g2-authorization-gate.test.mjs` (30 Tests), `docs/policies/pr-rules.md`-Erweiterung, Validator-Bindung, Plan-Doku, Skill-Update.
- Auf `main` vorhanden: `config/project-registry.json` (ATLAS/EASYTREE/PLUMBLINE, deterministisch, DEC-05/DEC-09), `src/registry/{resolve,cli}.mjs` + Test, `contracts/local-adapter/v1/` + `src/local-contract/` + Checker + Fixtures (ATLAS-22 Slice 1), `DEPENDENCIES.md` + Generator + Lock-Tests (ATLAS-21), `docs/governance/blockers.md`, `docs/policies/pr-rules.md`, CODEOWNERS.
- Auf `main` **fehlend**: `config/data-classification.json`, `proposals/`-Verzeichnis, `docs/evidence/sprint-1-evidence.md`, Format/Lint/Type/Secret/Vuln/License-Gates in `ci.yml` (CI = `npm ci --ignore-scripts` + `npm test` + Repository-Validator; `package.json`-Scripts nur `test`/`check`).
- `docs/governance/blockers.md`: BLK-ATLAS-13-02 (Runner) RESOLVED 2026-08-07; **BLK-ATLAS-13-01 OPEN** (Free-Plan + privates Repo → Branch-Protection/Rulesets-API 403; Owner-Interim 06.08.: kein Public, kein Pro-Upgrade, kein Org-Umzug im Sprint; **kein DoD-Waiver**).
- ADR-0001: Status **Conditional**; Bedingungen: ATLAS-14-Abnahme, ATLAS-16-VPS-Audit, Seite 05 Entity-IDs/Lifecycle, ATLAS-54 RLS-/Rollentests, Remote-Strategie für `gbrain-atlas`.
- Lokaler Working Tree: Checkout auf `fix/ATLAS-56-g2-authorization-gate`; `git status --porcelain` zeigt ausschließlich dieses untracked Plan-Dokument.

### Jira (live, 2026-08-08)

- Aktiver Sprint: **„ATLAS Sprint 1", Sprint-ID 370**, Board 304, 2026-08-06 → 2026-08-20. Sprint Goal wörtlich: „Governance-Fundament und Repository-Infrastruktur für Project Atlas vollständig etablieren. …"
- Sprint-Mitglieder: genau ATLAS-11, 12, 13, 15, 21, 22, 23, 24, 55, 56. ATLAS-14/16/54 sind NICHT im Sprint.
- Status: Fertig: ATLAS-21 (Resolution Fertig, PO-Kommentar 12479), ATLAS-55. In Arbeit: ATLAS-12, ATLAS-13, ATLAS-22, ATLAS-23, ATLAS-56. Zu erledigen: ATLAS-11, ATLAS-15, ATLAS-24.
- ATLAS-56 (Bug, Medium): AC (1) G2-Workflow verhindert Merge ohne referenzierbares PO-Autorisierungsartefakt, (2) keine Inferenz aus `READY FOR …`-Zuständen, (3) Audit-Kommentare nur mit beobachteten Freigaben. Kommentar 12512: Sprint-Intake per PO-Entscheid, ausdrücklich KEINE Merge-Autorisierung. Kommentar 12545: PR #9 review-ready, 99/99 Tests, Validator 49 Checks, G2-Selbsttest blockiert PR #9 mit Exit 1; „WAITING FOR PRODUCT OWNER MERGE REVIEW".
- ATLAS-22 (Story, Highest): Summary „Lokale Adapterverträge **für alle Repositories** definieren"; AC „Input/Output, Fehler, Versionen und Capability-Boundaries schema-valid." Kommentar 12346: Slice 1 merged (`e1a532a`), NICHT Done, weil AC alle Repositories umfasst.
- ATLAS-23 (Task, High): AC „Clean checkout besteht alle required gates" (Format, Lint, Type, Test, Secret, Vulnerability, License). Kommentar 12380: Slice 1 (`ci.yml`, Context `check`) geliefert; explizit offen: Format, Lint, Type-Check, Secret-Scan (`secret-scan`), Vuln-Scan (`vuln-scan`), License-Compliance, Required-Checks-Verknüpfung (blockiert durch BLK-ATLAS-13-01).
- ATLAS-12 (Task, Highest): AC wörtlich „Space, Root-ID, Seitenbaum und Writer-Registry sind eindeutig aufgelöst." — Das AC nennt gbrain-seitige Persistenz NICHT ausdrücklich; der „technische Writer-Registry-Eintrag in gbrain" stammt aus Kommentar 12137 als benannter Rest. Kommentar 12345: Resolver-Slice merged (`02a9727`).
- ATLAS-15 (Task, High): AC „Klassen, Retention, Delete, Backup und External-sharing policy dokumentiert." Owner-Eckwerte 06.08. in Description: PUBLIC/INTERNAL/CONFIDENTIAL_PROJECT ingestierbar, RESTRICTED ausgeschlossen, Retention gem. ATLAS-45-Zielwerten, kein External Sharing in V1.
- ATLAS-11 (Story, Highest): AC „Jira-Projekt existiert; Owner, Approver, Workflow und Issue-Typen sind dokumentiert."
- ATLAS-24 (Task, Medium): AC „SBOM reproduzierbar; MIT- und Apache-Hinweise enthalten."
- ATLAS-13 (Task, Highest): AC „Default branch geschützt; CODEOWNERS, PR-Regeln und CI-Baseline dokumentiert." Protection-AC durch BLK-ATLAS-13-01 in Sprint 1 unerfüllbar.

### Confluence (live, 2026-08-08, Root 14778372, Space PRODUKTMAN)

- Seiten 13/14 am 08.08. reconciled (main `2b05e99`, „0 offene PRs" — Stand vor PR #9, veraltet). Seite 14: „Ein nächster Sprint-Slice ist bewusst NICHT entschieden — Entscheidung erst nach abgeschlossener Reconciliation und PO-Priorisierung" + 8 Delivery-Guardrails (u. a. WIP-Limit 1, „Kein Done aus Aktivität"). → Die PO-Entscheidungen D1–D9 SIND diese Priorisierung.
- Seite 18: G2-Abweichung PR #8 (Bug ATLAS-56, PO-Korrektur 5222416143); Handoff-Auflage: „vor jedem künftigen G2-Merge: referenzierbares PO-Autorisierungsartefakt gemäß ATLAS-56 sicherstellen. Kein neues Implementierungsticket ohne PO-Order."
- Seite 12 / DEC-04: Datenklassen, Ausschlüsse, Quarantäne-Grundsatz, Retention (RPO ≤ 24 h / RTO ≤ 4 h, Backups 30 Tage täglich / 12 Monate monatlich, Off-Host-Kopie), kein External Sharing V1 — entschieden; Artefakt fehlt.
- Seite 05: **leeres Skelett** — alle 12 Begriffsdefinitionen ohne Inhalt; Entity-ID-Schema offen (per D9 nicht als gelöst behandeln).
- Seite 00 / DEC-07: Premium Graph UI als DECIDED_AS_ACCEPTANCE_TARGETS. Kein „Sprint 2" in Confluence (Verankerung per D5 autorisiert, Ausführung in späterer Mutations-Session). Seite 00 eine Reconciliation-Runde veraltet.

---

## PO DECIDED / Facts / Assumptions / Missing / Blockers

**PO DECIDED (Review 2026-08-08):** D1–D9 wie oben — Merge-Weg PR #9, ATLAS-22-Split, ATLAS-24-Defer, ATLAS-12-Abschlussregel, Sprint-2-Richtung + Confluence-Verankerung autorisiert, ATLAS-14 als PRE-SPRINT-2 GATE, lokales Snapshot-Deployment für Slice 1, Carry-over ATLAS-13 + ATLAS-23-Wiring, projektionslokale IDs erlaubt (nicht kanonisch).

**FACT (belegt):**
- main `2b05e99`; PR #9 offen, CI-grün, mergeable; G2-Artefakt fehlt (0 Kommentare); PO-Review ist ausdrücklich keine Autorisierung.
- Sprint 370 aktiv bis 20.08.; Statusbild wie oben; ATLAS-56 im Sprint (Kommentar 12512), In Arbeit.
- Registry + Resolver, Local-Contract v1 + Checker, Upstream-Lock + DEPENDENCIES.md, CI-Baseline (`check`) sind integrierte Inkremente auf main.
- BLK-ATLAS-13-01 OPEN; kein DoD-Waiver für ATLAS-13 und den Wiring-Teil von ATLAS-23.
- DEC-04-Eckwerte für Datenklassifikation vollständig entschieden; Artefakt fehlt.
- Seite 05 leer → kein kanonisches Entity-ID-Schema definiert.
- ATLAS-12-Live-AC nennt gbrain-seitige Persistenz nicht ausdrücklich; sie ist Kommentar-benannter Rest (12137).

**ASSUMPTION (im Sprint-Verlauf zu verifizieren):**
- gbrain bleibt gepinnt (0.42.73.2, `upstreams.lock.json`); der Read-Pfad wird als Vertrag + Snapshot-Format definiert, nicht als unkontrollierte Upstream-Kopplung.
- Der PR-#9-Head bleibt `87bbcb0`; ändert er sich, verfällt jede Artefakt-Bindung und Gate 0 beginnt mit frischem Head-Bezug neu (Fresh-Evidence-Pflicht).

**MISSING (auf main):** `config/data-classification.json`; gbrain-read-/graph-projection-Contract; Format/Lint/Type/Secret/Vuln/License-CI-Gates; ATLAS-11-Governance-Artefakt/Publikation; Sprint-1-Evidence-Sammeldokument; gbrain-seitiger Registry-Eintrag (Carry-over-Kandidat per D4); SBOM/NOTICE (deferred per D3).

**BLOCKER:**
- **Gate 0:** Fehlendes menschliches G2-Autorisierungsartefakt für PR #9 (nur PO; Agent erzeugt/editiert es niemals).
- **BLK-ATLAS-13-01:** blockiert ATLAS-13-`Fertig` und Required-Checks-Wiring in ATLAS-23. Keine weiteren API-Versuche (D8).
- **PRE-SPRINT-2 GATE (D6):** formale ADR-0001-Abnahme (ATLAS-14) vor dem ersten Sprint-2-Code — blockiert nicht den Sprint-1-Rest.

---

## Reconciliation (Widersprüche + Source-of-Truth-Auflösung)

| # | Widerspruch | SoT | Auflösung |
|---|---|---|---|
| R1 | Confluence Seite 18 („ATLAS-56 … Zu erledigen, kein Sprint") vs. Jira live (In Arbeit, Sprint 370) | Jira (Sprint/Status) | Seite-18-Eintrag älter als Sprint-Intake (Kommentar 12512). **Confluence veraltet**; Update nur in PO-autorisierter Mutations-Session. |
| R2 | Seiten 13/14 („0 offene PRs") vs. GitHub live (PR #9 offen) | GitHub (PRs) | Reconciliation-Stand vor PR-#9-Eröffnung. **Confluence veraltet.** |
| R3 | Seite 00 (main `dd42544`, ATLAS-21 „Zu erledigen") vs. GitHub/Jira live | GitHub/Jira | Eine Reconciliation-Runde hinter Seiten 13/14/18. **Veraltet, bekannt.** |
| R4 | ATLAS-22-Jira-AC („alle Repositories") vs. Sprint-1-Fokus gbrain-read | Jira (AC) + PO | **Per D2 entschieden: Split.** Kein stilles Überschreiben; Jira-Split dokumentiert ausgegliederten Umfang nachvollziehbar (Execution-Session). |
| R5 | Sprint-2-Richtung vs. Confluence (kein Sprint 2 dokumentiert) | Confluence (Product Goal) + PO als Autor | **Per D5 entschieden:** Verankerung autorisiert; Ausführung erst bei nächster zulässiger Mutation. |
| R6 | `reports/release-decision.json` (Repo-Snapshot) vs. Live-Zustand | GitHub live + aktuelle Confluence-Seiten | Bekannter Rest-Drift, nicht als SSoT verwenden. |

Keine historische Evidenz wird überschrieben.

---

## FINAL SPRINT-1 SCOPE MATRIX

| Issue | Status (Jira) | Entscheidung (per PO-Review) | Rest |
|---|---|---|---|
| ATLAS-56 | In Arbeit | **MUST FINISH — Gate 0** (D1) | Menschliches G2-Artefakt → Gate-Lauf → Merge → Evidenz. Kein neues Coding vorher. |
| ATLAS-12 | In Arbeit | **FOCUS** (D4) | Registry/Routing/Root-Auflösung/Evidenz gegen Live-AC verifizieren; Abschluss zulässig, wenn AC erfüllt. gbrain-seitiger Eintrag: NICHT in den Sprint ziehen; falls AC-pflichtig → Carry-over-Kennzeichnung, kein Waiver. |
| ATLAS-15 | Zu erledigen | **MUST FINISH (minimal)** | Artefakt `config/data-classification.json` + Test + Doku, exakt DEC-04/Seite-12-Eckwerte. Vor ATLAS-22 (PO-Reihenfolge). |
| ATLAS-22 | In Arbeit | **FOCUS — SPLIT** (D2, D9) | Sprint-1-Slice: gbrain-read / graph-projection contract. Restliche Adapter = Carry-over/Backlog mit dokumentiertem Split. Issue als Ganzes wird in Sprint 1 nicht `Fertig`, sofern der Jira-Split nicht vorher formal erfolgt. |
| ATLAS-23 | In Arbeit | **FOCUS (nur unblocked)** (D8) | Format/Lint/Type/Secret/Vuln/License-Gates lokal + CI. Wiring-AC bleibt offen; Gesamt-Issue nicht künstlich Fertig. Carry-over akzeptiert. |
| ATLAS-11 | Zu erledigen | **FOCUS (minimal)** | Governance-Proposal nur mit belegbaren Tatsachen; `Fertig` erst nach Owner-Publikation (Seite 02/14680066). |
| ATLAS-13 | In Arbeit | **BLOCKED / PARK** (D8) | Nur Blocker-Doku aktuell halten. Null Branch-Protection-/Ruleset-API-Versuche. Carry-over akzeptiert. |
| ATLAS-24 | Zu erledigen | **DEFERRED** (D3, entschieden) | Zurück ins Product Backlog / Carry-over. Jira-Mutation erst in Execution-Session. Keine Sprint-1-Arbeit. |
| ATLAS-21 | Fertig | **COMPLETE** | — |
| ATLAS-55 | Fertig | **COMPLETE** | — |

---

## EXECUTION ORDER (per PO, verbindlich; WIP-Limit 1)

**Gate 0 — ATLAS-56 vollständig durch G2 abschließen.** Kein neues Coding vorher.

Danach sequenziell (max. ein Implementierungsthema gleichzeitig):

1. **ATLAS-12** — Adressierbarkeits-Rest verifizieren/abschließen (D4-Regel).
2. **ATLAS-15** — Datenklassifikations-Artefakt. *(PO-Begründung: erlaubte Datenklassifikation steht fest, BEVOR der Read-/Projection-Vertrag finalisiert wird.)*
3. **ATLAS-22** — gbrain-read / graph-projection Slice (D2, D9).
4. **ATLAS-23** — unblocked Quality-/Security-Gates.
5. **ATLAS-11** — Minimum Viable Governance.

Park: **ATLAS-13**. Defer: **ATLAS-24**. Complete: **ATLAS-21, ATLAS-55**.

Jeder Schritt endet mit Jira-Evidence-Kommentar + Reconciliation (Guardrail Seite 14) und läuft als eigener PR durch das (dann gemergte) G2-Gate.

---

## Ticket-by-Ticket Tasks

### Task 0: ATLAS-56 — G2-Gate abschließen (Gate 0)

- **Jira-Key:** ATLAS-56 · **Nutzer-/Produktwert:** Kein künftiger Merge kann PO-Autorisierung inferieren; schützt alle Sprint-1/2-Inkremente.
- **Dateien/Systeme:** PR #9 (GitHub); keine Code-Änderung erwartet (Head `87bbcb0` review-ready).
- **Schritte:**
  1. **(NUR menschlicher PO-Account):** Autorisierungsartefakt als PR-#9-Kommentar, exakt: `G2-AUTHORIZATION` / `PR: #9` / `HEAD: 87bbcb08fc00e18378f94f50c2d878ce065de348`. Agent erzeugt/editiert es niemals.
  2. Agent: Fresh Read von PR #9 (Head unverändert `87bbcb0`? Artefakt vorhanden?), dann `node scripts/g2-authorization-gate.mjs` (vom PR-Branch) gegen PR #9. Erwartet: Exit 0 mit Artefakt-Referenz. Fehlerpfad: Exit 1 „no valid authorization artifact" → STOPP, kein Merge, keine Inferenz.
  3. Merge ausschließlich nach Gate-Exit 0 (per D1 autorisiert); Audit-Kommentar referenziert das beobachtete Artefakt (Kommentar-ID).
  4. Fresh Checkout von neuem main: `npm run check` → erwartet 99/99 Tests + Validator PASSED (49 Checks).
  5. Jira ATLAS-56: Evidence-Kommentar (Artefakt-ID, Merge-SHA, CI-Run); Fertig-Transition nur per PO-Entscheid.
- **Out of Scope:** Selbst-Erzeugen des Artefakts (verboten, AC-widrig); Branch Protection.
- **Abhängigkeiten:** keine. · **Evidenz:** PR-#9-Kommentar-ID, Gate-Output, Merge-SHA, CI-Run-ID.
- **DoD:** AC 1–3; Gate auf main; Selbsttest-Verhalten dokumentiert. · **Stop-Gate:** Ohne Artefakt bleibt der gesamte Plan bei Task 0 stehen. Head-Wechsel → Artefakt-Bindung verfällt, neuer Fresh Read.

### Task 1: ATLAS-12 — Adressierbarkeits-Rest (D4)

- **Jira-Key:** ATLAS-12 · **Wert:** Sprint 2 adressiert ein Projekt (Pilotkandidaten EASYTREE/PLUMBLINE, DEC-05) deterministisch.
- **Dateien/Systeme:** `config/project-registry.json`, `src/registry/` (vorhanden — NICHT neu bauen); Verifikations-Test/Evidenz Registry ↔ Confluence-Root-IDs (14778372/5505026/7503873).
- **Testkommando:** `npm run check` + `node src/registry/cli.mjs ATLAS`. Erwartet: deterministisches JSON (jira_key/space/root_page_id). Fehlerpfad: unbekannte project_id → non-zero Exit, deterministische Meldung.
- **Abschlussregel (D4):** Live-AC („Space, Root-ID, Seitenbaum und Writer-Registry sind eindeutig aufgelöst") gegen vorhandene Artefakte + Evidenz (u. a. Kommentar 12137 Seitenbaum-Evidenz) prüfen. Erfüllt → Abschluss zulässig (Fertig-Transition per PO). Verlangt das AC nach Fresh Read ausdrücklich gbrain-Persistenz → Carry-over-Kennzeichnung im Jira-Kommentar, kein Waiver, kein Hineinziehen in den Sprint.
- **Out of Scope:** Neue Registry-Architektur; Confluence-Mutationen; jede gbrain-/VPS-Mutation.
- **Abhängigkeiten:** Task 0. · **Evidenz:** Jira-Kommentar mit Testlauf + Auflösungs-Output + AC-Abgleich. · **DoD:** AC-Abgleich dokumentiert; Statuswechsel nur per PO. · **Stop-Gate:** gbrain-Persistenz-Frage.

### Task 2: ATLAS-15 — Datenklassifikations-Artefakt (vor ATLAS-22)

- **Jira-Key:** ATLAS-15 · **Wert:** Maschinenlesbar fixiert, welche Datenklassen in den read/projection-Pfad dürfen — Vertragsgrundlage für Task 3 und regelkonforme Quellenwahl in Sprint 2.
- **Dateien/Systeme:** `config/data-classification.json` (Klassen PUBLIC/INTERNAL/CONFIDENTIAL_PROJECT ingestierbar; RESTRICTED excluded; Ausschlussliste, Quarantäne-Grundsatz, Retention RPO ≤ 24 h/RTO ≤ 4 h, Backup-Fenster, external_sharing: none — exakt DEC-04/Seite 12, keine eigenen Policy-Erfindungen), `test/data-classification.test.mjs` (Schema + Invarianten, z. B. RESTRICTED nie ingestierbar), Validator-Aufnahme.
- **Testkommando:** `npm run check` → neue Tests grün. Fehlerpfad: manipulierte Klasse (RESTRICTED→ingestable) → Invariantentest schlägt fehl.
- **Out of Scope:** Quarantäne-Runtime, Ingestion-Pipeline, Policy-Plattform, Scanner.
- **Abhängigkeiten:** Task 0 (+1 sequenziell). · **Evidenz:** Jira-Kommentar mit Pfad, Commit, Testlauf, DEC-04-Verweis. · **DoD:** AC vollständig via Artefakt + Doku-Verweis Seite 12. · **Stop-Gate:** keins.

### Task 3: ATLAS-22 Slice 2 — gbrain Read Boundary / Graph Projection Contract (D2, D9)

- **Jira-Key:** ATLAS-22 · **Wert:** Der versionierte Read-Pfad, aus dem Sprint 2 den sichtbaren Graphen zieht — Kernstück des Runways.
- **Dateien/Systeme (neu):** `contracts/gbrain-read/v1/{request,response}.schema.json` (+ ggf. `graph-snapshot.schema.json`), `src/gbrain-read-contract/` (deterministischer Checker analog `src/local-contract/`), Fixtures (valide/invalide Snapshots, Fehlerpfad), `test/gbrain-read-contract.test.mjs`.
- **Vertrag MUSS enthalten (D2-Mindestumfang):** project identity (`project_id`, Registry-referenziert) · source identity (`source_id` + Quell-Revision) · gbrain version/pin (aus `third_party/upstreams.lock.json`, 0.42.73.2) · read-only boundary (keine Write-Operationen im Schema) · deterministische stabile **projektionslokale** IDs (D9: project-scoped, source-scoped, reproduzierbar, für Nodes UND Edges referenzierbar, provenance-fähig, Overlap-Lens-tauglich; ausdrücklich NICHT die endgültigen kanonischen Entity IDs — Seite 05 bleibt offen) · Nodes · Edges · Source/Provenance pro Node/Edge · deterministisches Output-Verhalten (byte-identisch) · `contract_version` · explizites Fehlermodell · keine unkontrollierte direkte Upstream-Kopplung (Vertrag beschreibt Grenze, importiert keinen gbrain-Code).
- **Klassifikationsbindung:** Snapshot-Quellen müssen per `config/data-classification.json` (Task 2) zulässig sein — Vertragsfeld/Invariante, kein Scanner.
- **Testkommando:** `npm test` (neue Suite); `node src/gbrain-read-contract/cli.mjs fixtures/gbrain-read/valid-snapshot.json` → Exit 0; invalid → Exit 1 mit versioniertem `{contract_version, valid, errors[]}`; unlesbar/kein JSON → Exit 2. Ausgabe byte-identisch über Läufe/Locales.
- **Out of Scope (D2/D5):** vollständige Adapter für gbrain-evals/Jira/Confluence/Obsidian (Carry-over mit dokumentiertem Split), produktive Writes, Viewer/UI, Overlap Lens, Snapshot-ERZEUGUNG aus echtem gbrain, MCP-Anbindung, Ingestion.
- **Abhängigkeiten:** Task 0, Task 2. · **Evidenz:** Jira-Kommentar mit Vertragspfaden, Testlauf, PR/CI-Run; Split-Dokumentation (welcher Original-Umfang ausgegliedert). · **DoD:** Schema-valide Verträge + Checker + Tests grün + `npm run check` grün; Issue-`Fertig` nur nach formal dokumentiertem Jira-Split (Execution-Session, PO-sichtbar). · **Stop-Gate:** Split-Dokumentation vor Fertig-Transition.

### Task 4: ATLAS-23 Rest — unblocked CI-/Security-Gates (D8)

- **Jira-Key:** ATLAS-23 · **Wert:** Jeder Sprint-2-PR wird automatisch auf Format/Lint/Typ/Secrets/Vulns/Lizenzen geprüft.
- **Dateien/Systeme:** `package.json` (neue Scripts), `.github/workflows/ci.yml` (Contexts `secret-scan`, `vuln-scan` + Format/Lint/Type/License), Tool-Configs. Toolwahl minimal + gepinnt; Auswahl im PR begründen.
- **Testkommando:** lokal erweitertes `npm run check`; CI-Lauf auf PR-Head grün; bewusster Negativtest (Pseudo-Secret-Fixture im Testlauf) → Gate schlägt reproduzierbar fehl (Nachweis, danach entfernt).
- **Out of Scope (D8):** Required-Checks-Wiring/Branch-Protection (BLK-ATLAS-13-01 — null Versuche), Deployment-Pipelines, SBOM (ATLAS-24, deferred).
- **Abhängigkeiten:** Task 0. · **Evidenz:** CI-Run-Link, Gate-Liste, Clean-Checkout-Output, Jira-Vermerk „Wiring pending BLK-ATLAS-13-01". · **DoD:** Clean Checkout besteht alle NEUEN Gates; Gesamt-Issue bleibt offen (Wiring-AC), Carry-over akzeptiert. · **Stop-Gate:** Wiring-AC.

### Task 5: ATLAS-11 — Minimum Viable Governance

- **Jira-Key:** ATLAS-11 · **Wert:** Belegbare Projektidentität/Entscheidungsrechte ohne Prosa.
- **Dateien/Systeme:** `proposals/confluence/ATLAS-11-governance.md` (Frontmatter `target_page_id: "14680066"`, `status: PROPOSAL_PENDING_OWNER_APPROVAL`) mit NUR belegbaren Tatsachen: Jira-Projekt ATLAS/Board 304, Owner benjamin.poersch, Rollen (read+propose vs. approve/publish getrennt, DEC-06), existierender Workflow (Zu erledigen→In Arbeit→Fertig, G2-Gate), Issue-Typen (Story/Task/Bug); `test/governance-proposal.test.mjs` (Frontmatter/Pflichtfelder).
- **Testkommando:** `npm test` → Proposal-Test grün.
- **Out of Scope:** Confluence-Schreiben (Owner publiziert selbst), neue Rollenmodelle.
- **Abhängigkeiten:** Task 0. · **Evidenz:** Jira-Kommentar mit Proposal-Pfad, Commit, Testlauf. · **DoD:** AC erfüllt; `Fertig` erst nach Owner-Publikation auf Seite 14680066. · **Stop-Gate:** Owner-Publikation.

### Geparkt / Deferred (keine Tasks)

- **ATLAS-13 (PARK, D8):** Einzige erlaubte Aktion: Blocker-Doku aktuell halten. Kein API-Retry.
- **ATLAS-24 (DEFERRED, D3):** Zurück ins Product Backlog. Jira-Mutation (Sprint-Entfernung + Begründung) in der ersten Execution-Session mit Jira-Zugriff, nachvollziehbar dokumentiert. Keine Sprint-1-Arbeit.

---

## Sprint-2 Readiness Gate (8 beobachtbare Aussagen)

| # | Aussage | Stand heute | Liefert |
|---|---|---|---|
| 1 | Projekt deterministisch adressierbar | WEITGEHEND ERFÜLLT (Registry + Resolver auf main) | Task 1 |
| 2 | gbrain-Read-Pfad hat versionierten Vertrag | FEHLT | Task 3 |
| 3 | Erlaubte Datenklassen eindeutig definiert | Entschieden (DEC-04), Artefakt FEHLT | Task 2 |
| 4 | Ungültiger Input / Fehlerpfad scheitert reproduzierbar | Erfüllt für local-contract v1; FEHLT für Read-Pfad | Task 3 |
| 5 | Lokale + CI-Gates schützen den nächsten Slice | Baseline vorhanden; Qualitäts-/Security-Gates FEHLEN | Task 4 |
| 6 | PR-/Merge-Verfahren kann keine PO-Autorisierung inferieren | Gate gebaut (PR #9), NICHT auf main | Task 0 |
| 7 | Stable IDs + project/source provenance reichen für spätere Overlap-Lens | Offen | Task 3 (D9-ID-Form; nur Datenform, keine Lens) |
| 8 | Keine offene ADR-Bedingung blockiert den READ-ONLY Slice | Per D6/D7/D9 aufgelöst, siehe unten | Bewertung unten + PRE-SPRINT-2 GATE |

### ADR-0001-Bedingungen — Endbewertung (per PO-Entscheid)

| Bedingung | Einstufung | Grundlage |
|---|---|---|
| ATLAS-14 (formale ADR-Abnahme) | **PRE-SPRINT-2 GATE** — kein Sprint-1-Implementationsthema, aber verpflichtend VOR dem ersten Sprint-2-Code | D6 |
| ATLAS-16 (VPS-Audit + bge-m3-Digest) | **Kein harter Blocker für Slice 1** (läuft lokal gegen deterministischen Snapshot). ATLAS-16 bleibt offen, weder erledigt noch unwichtig; wird relevant, sobald gegen Live-VPS-gbrain gelesen/deployt wird. | D7 |
| Seite 05 Entity-IDs/Lifecycle | **Offen — NICHT als gelöst behandelt.** Mitigation: projektionslokale stabile IDs im ATLAS-22-Vertrag (project-scoped, source-scoped, reproduzierbar, Node+Edge-referenzierbar, provenance-fähig, Overlap-Lens-tauglich); ausdrücklich nicht die endgültigen kanonischen Entity IDs. | D9 |
| ATLAS-54 (RLS, Composite-FKs, Rollen) | Blockiert nur canonical writes / produktive Runtime — Slice 1 unberührt. | Fresh-Read-Bewertung, PO-Review unwidersprochen |
| Remote-Strategie `gbrain-atlas` | Blockiert Slice 1 nicht; Legacy bleibt read-only gepinnt. | Fresh-Read-Bewertung, PO-Review unwidersprochen |

---

## Explicit Deferrals (bewusst NICHT vor Sprint 2)

- Write-MCP, produktive Writes, autonome Ingestion, Chat, Cluster Builder, komplexe Graph-Analysen, Multi-Agent-Systeme, Control-Plane-Ausbau.
- Overlap Lens (kommt NACH dem ersten sichtbaren Slice; jetzt nur ID-/Provenance-Datenform, Task 3).
- Browser Viewer und Graph-Snapshot-Erzeugung (Sprint 2 selbst).
- Branch-Protection-/Ruleset-API-Versuche, Public-Schalten, Pro-Upgrade, Org-Umzug (D8 + Owner-Interim 06.08.).
- Vollständige Adapter gbrain-evals/Jira/Confluence/Obsidian (D2-Carry-over mit dokumentiertem Split).
- ATLAS-24 SBOM/NOTICE (D3: DEFERRED ins Product Backlog).
- Kanonisches Datenmodell Seite 05 / ATLAS-54-Schema-Runtime; VPS-Deployment und Live-VPS-Lesen (D7: Slice 1 lokal gegen Snapshot).
- Confluence-Verankerung der Sprint-2-Richtung (D5: autorisiert, Ausführung erst in zulässiger Mutations-Session).
- Jegliche Confluence-/Jira-Mutationen aus dieser Planning-Session.

---

## PO Decisions Required

**None before Gate 0; fresh evidence checks still apply.**

Bereits entschieden und hier nur ausgeführt: D1–D9. Ausführungszeitpunkt-gebundene menschliche Akte (kein offener Entscheidungsbedarf): G2-Artefakt für PR #9 setzen (D1), Fertig-Transitionen je Ticket, Owner-Publikation ATLAS-11, formale ADR-Abnahme als PRE-SPRINT-2 GATE (D6), Confluence-Verankerung der Sprint-2-Richtung (D5). Jede dieser Handlungen setzt einen frischen Evidenz-Read voraus (z. B. PR-#9-Head unverändert).

---

*Erstellt 2026-08-08 aus Fresh Reads (GitHub live, Jira Sprint 370, Confluence 00/01/05/12/13/14/18); Rev. 2 nach PO-Review mit verbindlichen Entscheidungen D1–D9. Historischer Plan Rev. 2 (2026-08-06) unangetastet.*

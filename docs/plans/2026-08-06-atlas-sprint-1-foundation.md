# ATLAS Sprint 1 Foundation Implementation Plan — Rev. 2

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (oder subagent-driven-development) to implement this plan task-by-task. Arbeitsverzeichnis: `/Users/benjaminpoersch/Projects/project-atlas-foundation`.

**Goal:** Alle 8 ATLAS-Sprint-1-Tickets (ATLAS-11, -12, -13, -15, -21, -22, -23, -24) mit nachlesbarer Evidenz abschließen — im kanonischen Repository `DYAI2025/project-atlas-foundation`. Das Sprintziel besteht aus genau diesen 8 Delivery-Outcomes. Zusätzlich wird **ATLAS-55 als notwendiger Sprint Enabler / Impediment** im Sprint Backlog geführt, weil der Bug ATLAS-13 und ATLAS-23 auf dem kritischen Delivery-Pfad blockiert; ATLAS-55 ist ausdrücklich **kein neuntes Delivery-Outcome** (siehe Abschnitt „ATLAS-55 — Sprint Enabler / Delivery Blocker").

**Architecture:** ATLAS-eigener Control Plane als kanonische Governance-Schicht (ADR-0001); gbrain (gepinnt) als abgeleitete Projektion. Confluence-Inhalte werden direkt aktualisiert, wo der Owner es explizit angeordnet hat (Setup-Checkpoint-Seiten 00/13/14/16); alle übrigen Confluence-Inhalte entstehen als Proposals unter `proposals/confluence/` und werden erst nach Owner-Freigabe publiziert (DEC-06). Maschinenlesbare Governance-Artefakte (Registry, Klassifikation, Adapterverträge, Upstream-Pins) werden durch Zero-Dependency-Node-Tests validiert.

**Tech Stack:** Node.js 22 (`node --test`, keine Runtime-Deps), npm devDependencies (prettier, eslint, typescript, @cyclonedx/cyclonedx-npm), GitHub CLI, gitleaks + osv-scanner in CI.

---

## Korrekturen gegenüber Rev. 1 (2026-08-06, Owner-Entscheidung Option A)

| # | Rev.-1-Annahme (falsch/überholt) | Rev.-2-Korrektur |
|---|---|---|
| 1 | Arbeitsverzeichnis hat kein Remote; `gh repo create --source . --push` aus `semantic-gbrain-vps` | Kanonisches Repo `DYAI2025/project-atlas-foundation` existiert (privat, `main`); Arbeit ausschließlich dort. `semantic-gbrain-vps`/`Gbrain-vps` = eingefrorener Snapshot. |
| 2 | `gbrain-atlas` evtl. kanonisch / Migrationsfrage offen | Entschieden: `gbrain-atlas` = read-only Legacy, Pin `aea0fb0b93478…`, keine History-Migration. |
| 3 | `Gbrain-vps` als möglicher Zielremote | Verboten. Deprecated, privat, keine weitere ATLAS-Implementierung dort. |
| 4 | EasyTree/Plumbline Space-Keys unbekannt (`null` + pending) bzw. Risiko der Verwechslung mit `EYT`/`PLUM` | Owner-verifiziert und per read-only Atlassian-MCP bestätigt (2026-08-06): Page 5505026 und Page 7503873 liegen beide in Space `PRODUKTMAN` („Produktmanagement"). Beide Einträge: `confluence_space_key: "PRODUKTMAN"`. `EYT`/`PLUM` sind ausschließlich Jira-Keys. |
| 5 | Branch Protection per API frei setzbar | **BLK-ATLAS-13-01:** Free-Plan + privates Repo → Protection/Rulesets-API 403. Interim: disziplinarische PR-Policy; technische Erzwingung nach Owner-Entscheidung (Pro-Upgrade / Org-Umzug). Public schalten ist keine Option (Approval Boundary §12). |
| 6 | Repo-Anlage + CODEOWNERS + Branch-Protection als Task 4 | Bereits im Setup-Checkpoint erledigt (Bootstrap `BOOTSTRAP_EXCEPTION_ATLAS_13`, CODEOWNERS vorbereitet, Blocker dokumentiert). ATLAS-13-Rest: Blocker-Auflösung + Required-Checks-Wiring (mit ATLAS-23). |
| 7 | Confluence ausschließlich proposals-only | Owner hat direkte Updates der Seiten 00/13/14/16 für den Setup-Checkpoint angeordnet (mit Read-after-write). Alle weiteren Seiten bleiben proposals-only bis zur Freigabe. |

## Verbindliche Constraints

1. **Repository-Rollen** gemäß `docs/governance/repository-roles.md` — `gbrain-atlas` nie verändern; `Gbrain-vps` nie als Ziel verwenden.
2. **Confluence:** Setup-Checkpoint-Seiten (00/13/14/16) direkt mit Read-after-write; alles andere als Proposal unter `proposals/confluence/` bis Owner-Freigabe (DEC-06).
3. **Jira-Disziplin:** `In Progress` erst bei nachweisbarer Arbeit im kanonischen Repo; `Review` erst bei offenem PR mit ausgeführten Prüfungen; `Done` erst nach AC-Evidenz + grüner CI + unabhängigem Review + behobenen Findings + aktualisierter Confluence-Doku. Nach jeder Jira-Mutation Read-after-write.
4. **Keine geratenen Identifier.** Unbekannte Werte → `pending_owner_confirmation`, niemals erfinden.
5. **`project_id: "ATLAS"`** auf jedem maschinenlesbaren Artefakt (DEC-09). Kein Legacy-Import (DEC-08). Idempotente Schritte.
6. **Commit-Konvention:** `feat|docs|ci|test|chore(ATLAS-XX): …` + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
7. **Fehlerregel:** Nach zwei materiell unterschiedlichen fehlgeschlagenen Lösungsversuchen: stoppen, Evidenz sichern, Blocker/Follow-up-Ticket dokumentieren, zum Sprintpfad zurückkehren.
8. **Repository bleibt privat** (Approval Boundary §12).

## Globales Definition-of-Done-Gate (jedes Ticket)

- [ ] Alle Akzeptanzkriterien mit Evidenz (Dateipfad, Commit-SHA, Link, CI-Run) in `docs/evidence/sprint-1-evidence.md`
- [ ] `npm run check` grün auf frischem Clone (sobald Scaffold existiert)
- [ ] PR-Review durchlaufen, Findings behoben
- [ ] Jira-Evidence-Kommentar gepostet, Status korrekt, Read-after-write ausgeführt
- [ ] Confluence-Aktualisierung erledigt (direkt bei 00/13/14/16-Bezug, sonst Proposal + Owner-Freigabe)

---

## Phase 0: Scaffold (Voraussetzung, Teil von ATLAS-13-Nacharbeit)

**Dateien:** `package.json`, `.nvmrc`, `.editorconfig`, `test/smoke.test.mjs` (Inhalte identisch Rev. 1 Task 0; `.gitignore` existiert aus Bootstrap).

**Schritte:** Dateien anlegen → `npm test` (erwartet: `# pass 1`) → Commit `chore(ATLAS-13): scaffold Node 22 foundation with test harness`.

---

## ATLAS-11 — Projektidentität + Governance (Phase 1)

**Akzeptanzkriterien:** Jira-Projekt ATLAS konfiguriert · Owner dokumentiert · Approver-Rolle dokumentiert · Workflow (Zu erledigen → In Bearbeitung → Fertig) dokumentiert · Issue-Typen (Epic/Story/Task) dokumentiert · nachlesbar auf/unter Governance-Seite 14680066.

**Dateien:** `proposals/confluence/ATLAS-11-governance.md` (Frontmatter: `target_page_id: "14680066"`, `status: PROPOSAL_PENDING_OWNER_APPROVAL`) · Test `test/governance-proposal.test.mjs`.

**Tests/Validierung:** Test prüft Frontmatter, Pflicht-Überschriften (`## Projektname`, `## Jira-Key`, `## Owner`, `## Approver`, `## Workflow`, `## Issue-Typen`) und Werte (`ATLAS`, `benjamin.poersch`, Workflow-Kette, Epic/Story/Task). TDD: Test zuerst, FAIL (ENOENT), dann Proposal, PASS.

**Abhängigkeiten:** Scaffold (Phase 0). **Out-of-Scope:** Jira-Workflow-Umbau, neue Issue-Typen, Rollen-/Rechteänderungen in Jira.

**Jira-Evidence:** Kommentar auf ATLAS-11 mit Commit-SHA, Testlauf-Output, Proposal-Pfad; `In Progress` bei Arbeitsbeginn im Repo, `Done` erst nach Owner-Publikation auf Seite 14680066.

**Confluence:** Proposal für Seite 14680066 (Publikation = Owner-Gate).

**DoD-Gate:** Globales Gate + Owner hat Governance-Inhalt publiziert oder Publikation explizit delegiert.

---

## ATLAS-12 — Writer Registry + Confluence-Root (Phase 1)

**Akzeptanzkriterien:** Space PRODUKTMAN identifiziert · Root-Page-ID 14778372 dokumentiert · Seitenbaum 00–18 unter Root verifiziert · Registry-Eintrag mit `project_id`, `confluence_space_key`, `root_page_id`, `allowed_writers`, `approval_workflow`.

**Dateien:** `config/project-registry.json` · `proposals/confluence/ATLAS-12-registry.md` · Test `test/registry.test.mjs`.

**Registry-Inhalt (korrigiert, alle drei Einträge `"status": "active"`):**

```json
{
  "schema_version": "1.0",
  "project_id": "ATLAS",
  "description": "Writer registry: deterministic project routing per DEC-05/DEC-09. Never inferred from titles or semantics.",
  "projects": [
    { "project_id": "ATLAS", "jira_key": "ATLAS", "confluence_space_key": "PRODUKTMAN", "root_page_id": "14778372", "allowed_writers": ["benjamin.poersch"], "approval_workflow": "proposal->owner-approval->publish", "status": "active" },
    { "project_id": "EASYTREE", "jira_key": "EYT", "confluence_space_key": "PRODUKTMAN", "root_page_id": "5505026", "allowed_writers": ["benjamin.poersch"], "approval_workflow": "proposal->owner-approval->publish", "status": "active" },
    { "project_id": "PLUMBLINE", "jira_key": "PLUM", "confluence_space_key": "PRODUKTMAN", "root_page_id": "7503873", "allowed_writers": ["benjamin.poersch"], "approval_workflow": "proposal->owner-approval->publish", "status": "active" }
  ]
}
```

**Tests/Validierung (TDD):** Pflichtfelder je Eintrag; ATLAS-Werte exakt; EasyTree/Plumbline: `confluence_space_key === "PRODUKTMAN"` UND `jira_key` ∈ {EYT, PLUM} (Verwechslungsschutz-Assertion: Space-Key darf nie `EYT`/`PLUM` sein); kein Agent/Bot in `allowed_writers`. Seitenbaum-Verifikation read-only via Atlassian MCP `getConfluencePageDescendants(14778372)`; Ergebnis in Proposal-Abschnitt `## Verifizierter Seitenbaum` (bei MCP-Ausfall: `pending_owner_confirmation`, nicht fabrizieren).

**Abhängigkeiten:** Scaffold. **Out-of-Scope:** gbrain-seitige Registry-Persistenz (kommt mit Projektor-Implementierung), Anlage neuer Confluence-Seiten.

**Jira-Evidence:** Kommentar auf ATLAS-12: Registry-Pfad, Commit-SHA, Testlauf, Seitenbaum-Verifikationsergebnis.

**Confluence:** Proposal „Writer Registry" als Unterseite von 14778372 (Owner-Gate).

**DoD-Gate:** Globales Gate + Seitenbaum-Verifikation dokumentiert.

---

## ATLAS-15 — Datenklassifikation (Phase 1)

**Akzeptanzkriterien:** Klassen PUBLIC/INTERNAL/CONFIDENTIAL_PROJECT definiert, RESTRICTED excluded · Retention-Policy (Verweis ATLAS-45) · Delete-Policy · Backup-Policy · External-Sharing V1 = none · Quarantäne-Verhalten bei RESTRICTED (DEC-04).

**Dateien:** `config/data-classification.json` (Inhalt wie Rev. 1 Task 3, unverändert gültig) · `proposals/confluence/ATLAS-15-data-classification.md` · Test `test/data-classification.test.mjs`.

**Tests/Validierung (TDD):** exakt {PUBLIC, INTERNAL, CONFIDENTIAL_PROJECT} ingestierbar; RESTRICTED `ingest:false` + `on_detection:"quarantine"`; jede Klasse hat retention/delete_policy/backup/external_sharing; sharing überall `none`; `project_id === "ATLAS"`.

**Abhängigkeiten:** Scaffold. **Out-of-Scope:** technische Quarantäne-Implementierung (Ingest-Pipeline ist nicht Sprint 1), ATLAS-45-Zielwerte selbst.

**Jira-Evidence:** Kommentar auf ATLAS-15 mit Pfaden, Commit, Testlauf.
**Confluence:** Proposal mit Governance-Tabelle (Klasse → Ingest → Retention → Delete → Backup → Sharing) + Quarantäne-Abschnitt, Ziel unter Seite 14680066 (Owner-Gate).
**DoD-Gate:** Globales Gate.

---

## ATLAS-13 — Repository + Branch-Regeln (Phase 2) — TEILWEISE ERLEDIGT

**Akzeptanzkriterien:** Repo existiert ✅ (Setup-Checkpoint) · `main` geschützt ⚠️ BLK-ATLAS-13-01 · CODEOWNERS ✅ (vorbereitet) · PR-Regeln dokumentiert ✅ (`docs/policies/pr-rules.md`) · CI-Baseline dokumentiert (mit ATLAS-23) · nachlesbar auf Seite 15040514 ✅ (Setup-Checkpoint, direkt).

**Verbleibende Dateien/Schritte:**
1. Blocker-Auflösung nach Owner-Entscheidung (Pro-Upgrade / Org-Umzug), danach: `gh api -X PUT repos/DYAI2025/project-atlas-foundation/branches/main/protection --input scripts/branch-protection.json` (Datei mit `enforce_admins:false` per G2, `required_conversation_resolution:true`) + Verifikations-GET als Evidenz.
2. Required-Checks-Wiring (`check`, `secret-scan`, `vuln-scan`) — zusammen mit ATLAS-23.

**Tests/Validierung:** Verifikations-GET der Protection-Settings; Screenshot/JSON in Evidence.
**Abhängigkeiten:** Owner-Entscheidung zu BLK-ATLAS-13-01; ATLAS-23 für Checks-Kontexte.
**Out-of-Scope:** Jede Operation auf `gbrain-atlas`/`Gbrain-vps`; Public-Visibility.
**Jira-Evidence:** Bereits: Repo-URL, Default Branch, Bootstrap-Exception, Policy, Blocker, Legacy-Abgrenzung (Setup-Checkpoint-Kommentar). Nachzuliefern: Protection-Verifikation nach Blocker-Auflösung.
**Confluence:** Seite 15040514 direkt aktualisiert (Setup-Checkpoint) ✅; bei Blocker-Auflösung Folge-Update.
**DoD-Gate:** Globales Gate + **technische Branch Protection aktiv**. Das dokumentierte Owner-Interim zu BLK-ATLAS-13-01 ist **kein DoD-Waiver**: Es erlaubt ausschließlich, die Sprintarbeit fortzusetzen (Repository bleibt privat, disziplinarische PR-Policy gilt, technische Erzwingung wird bis zum Release-/produktiven-Agent-Write-Gate verschoben). Solange das Protection-AC technisch unerfüllt ist, darf ATLAS-13 **nicht** auf `Fertig` gesetzt werden (DEC-10; Semantik gemäß `docs/governance/blockers.md`, Status BLK-ATLAS-13-01 = OPEN).

---

## ATLAS-21 — Upstream-Pins + DEPENDENCIES.md (Phase 3)

**Akzeptanzkriterien:** Alle Upstreams mit Commit-SHA gepinnt · Lizenzen dokumentiert · SHA-256-Checksums · Upgrade-Policy · alles in `DEPENDENCIES.md`.

**Dateien:** `third_party/upstreams.lock.json` (aus Clean Export vorhanden — Single Source) · `scripts/gen-dependencies.mjs` · `DEPENDENCIES.md` (generiert) · Test `test/upstreams.test.mjs`.

**Tests/Validierung (TDD):** je Upstream 40-Hex-SHA, Lizenz, 64-Hex-Archiv-Checksum; `approval_required ⇒ enabled:false`; `DEPENDENCIES.md` enthält jede ID + SHA + Lizenz + `## Upgrade-Policy`. Generator-Inhalt wie Rev. 1 Task 5, Pfad angepasst auf `third_party/upstreams.lock.json`.

**Abhängigkeiten:** Scaffold. **Out-of-Scope:** tatsächliche Archiv-Verifikation gegen `/mnt/data`-Dateien (nicht auf dieser Maschine), Upstream-Upgrades, gbrain-evals-Patching (eigene Arbeit bei Adapter-Nutzung).

**Jira-Evidence:** Kommentar auf ATLAS-21: Generator-Lauf-Output (`5 upstreams`), Testlauf, Commit.
**Confluence:** Kein Pflicht-Update; Verweis in ATLAS-22-Proposal genügt.
**DoD-Gate:** Globales Gate.

---

## ATLAS-22 — Adapterverträge (Phase 3)

**Akzeptanzkriterien:** Vertrag je genutztem Repository/Integration · je Vertrag Input-Schema, Output-Schema, Fehlerverhalten, Versionierung · Capability-Boundaries abgegrenzt · schema-valide · keine direkte Upstream-Kopplung.

**Dateien:** `adapters/{gbrain,gbrain-evals,confluence,jira,obsidian}/contract.json` · `adapters/README.md` (hermes-gbrain-bridge: reference-only, bewusst ohne Vertrag) · `proposals/confluence/ATLAS-22-adapters.md` · Test `test/adapter-contracts.test.mjs`.

**Vertragsinhalte:** wie Rev. 1 Task 6 (gbrain-Vollbeispiel + vier Variantenbeschreibungen), unverändert gültig; gbrain-Pin `15b9863d…`, gbrain-evals-Pin `565b8075…` müssen `third_party/upstreams.lock.json` exakt entsprechen (Test-Assertion).

**Tests/Validierung (TDD):** Verzeichnis-Vollständigkeit; Pflichtfelder; `project_id === "ATLAS"`; Schemas strukturell JSON Schema (`type:"object"` + `properties`); Error-Model retryable/fatal + `on_fatal:"halt_and_report"`; Pin-Gleichheit mit Lock; write-fähige Adapter (gbrain, confluence, jira) deklarieren No-direct-write-Boundary.

**Abhängigkeiten:** ATLAS-21 (Lock als Pin-Quelle). **Out-of-Scope:** Adapter-Implementierungscode, MCP-Server-Anbindung, gbrain-Projektor-Laufzeit.

**Jira-Evidence:** Kommentar auf ATLAS-22: Vertragspfade, Testlauf, Commit.
**Confluence:** Proposal-Übersichtstabelle (Adapter → Capabilities → Boundary → Schema-Pfad) unter Seite 15040514 (Owner-Gate).
**DoD-Gate:** Globales Gate.

---

## ATLAS-23 — CI Foundation + Security Gates (Phase 4)

**Akzeptanzkriterien:** Funktionale GitHub-Actions-Pipeline · Gates required: Format, Lint, Type-Check, Unit-Tests, Secret-Scanning, Vulnerability-Scan, License-Compliance · Clean Checkout besteht alle Gates · Gates als Branch-Protection verknüpft ⚠️ (BLK-ATLAS-13-01).

**Dateien:** `.github/workflows/ci.yml` · `eslint.config.mjs` · `.prettierrc.json` · `.prettierignore` · `jsconfig.json` · `scripts/check-licenses.mjs` · Test `test/license-check.test.mjs` · `package.json`-Scripts (`check:format`, `lint`, `check:types`, `check:licenses`, `check`). Inhalte wie Rev. 1 Task 7.

**Tests/Validierung:** `npm run check` lokal grün · Action-SHAs via `git ls-remote` auflösen und pinnen (niemals raten; Kommentar mit Tag) · gitleaks als gepinntes Binary mit Checksum-Verifikation · osv-scanner gegen `package-lock.json` · Clean-Checkout-Beweis: frischer Clone in Temp-Dir, `npm ci --ignore-scripts && npm run check`, Exit 0, Output in Evidence · CI-Run-URL grün.

**Abhängigkeiten:** Scaffold, ATLAS-21 (License-Check liest Lock). **Out-of-Scope:** Required-Checks-Erzwingung solange BLK-ATLAS-13-01 offen (Wiring-Befehl vorbereitet in `scripts/branch-protection.json`, `contexts: ["check","secret-scan","vuln-scan"]`); Deployment-Pipelines; SBOM (ATLAS-24).

**Jira-Evidence:** Kommentar auf ATLAS-23: CI-Run-Link, Clean-Checkout-Output, Gate-Liste; bei offenem Blocker expliziter Hinweis „Wiring pending BLK-ATLAS-13-01".
**Confluence:** CI-Baseline-Abschnitt als Folge-Update auf Seite 15040514 (direkt zulässig, da Owner Seite 13 für Repo-Doku freigegeben hat — Read-after-write).
**DoD-Gate:** Globales Gate + grüner Clean-Checkout-Nachweis + **technisch verknüpfte Required Checks**. Das Branch-Protection-AC darf **nicht** unter Verweis auf die dokumentierte Blocker-Ausnahme als erfüllt markiert werden; die Ausnahme erlaubt nur die Weiterarbeit, nicht den AC-Abschluss. Solange BLK-ATLAS-13-01 `OPEN` ist, bleibt das Wiring-AC unerfüllt und ATLAS-23 darf insoweit nicht auf `Fertig` (Semantik gemäß `docs/governance/blockers.md`).

---

## ATLAS-24 — SBOM + NOTICE + Lizenzregister (Phase 5)

**Akzeptanzkriterien:** SBOM reproduzierbar (CycloneDX) · `NOTICE` im Root · MIT-Hinweise vollständig · Apache-2.0-Hinweise vollständig · SBOM-Generierung in CI (Release/Tag).

**Dateien:** `NOTICE` · `package.json` (+`sbom`-Script, devDep `@cyclonedx/cyclonedx-npm`) · `.github/workflows/ci.yml` (sbom-Job auf Tags, upload-artifact gepinnt) · Test `test/notice.test.mjs`. Inhalte wie Rev. 1 Task 8.

**Tests/Validierung (TDD):** NOTICE nennt jeden MIT/Apache-Upstream mit Lizenz; NOTICE verweist auf `sbom.cdx.json` + `npm run sbom`; lokaler `npm run sbom`-Lauf erzeugt Datei; CI-Job-Definition vorhanden.

**Abhängigkeiten:** ATLAS-21, ATLAS-23. **Out-of-Scope:** Signierung/Attestation, SBOM für Upstream-Archive (nur npm-Baum + Upstream-Register via DEPENDENCIES.md).

**Jira-Evidence:** Kommentar auf ATLAS-24: NOTICE-Pfad, SBOM-Erzeugungsnachweis, CI-Job, Commit.
**Confluence:** Kein Pflicht-Update; Lizenzregister-Verweis im ATLAS-22-Proposal bzw. Seite 13-Folge-Update.
**DoD-Gate:** Globales Gate.

---

## ATLAS-55 — Sprint Enabler / Delivery Blocker (kein Delivery-Outcome)

**Einordnung:** ATLAS-55 ist ein Bug und ein **Sprint Enabler / Impediment**, kein neuntes Sprintziel. Der Sprint liefert weiterhin genau die 8 oben geplanten Delivery-Outcomes. ATLAS-55 wird im Sprint Backlog geführt, weil er ATLAS-13 und ATLAS-23 auf dem kritischen Delivery-Pfad blockiert und der Blocker im Sprintzustand sichtbar sein muss. Er zählt nicht in die Delivery-Velocity und erzeugt kein eigenes Produktinkrement.

**Befund:** GitHub-hosted Runner akquiriert für dieses Repository keine Jobs. Alle drei existierenden Runs (31127753756, 31127837386, 31128025409) enden `failure`; die Jobs werden vor dem ersten Step abgebrochen (0 Steps, keine Logs). Wörtliche GitHub-Annotation:
`The job was not acquired by Runner of type hosted even after multiple attempts`

**Klassifikation:** `HOSTED_RUNNER_ACQUISITION_FAILURE` · Root Cause: `UNKNOWN_PLATFORM_OR_POLICY`. Billing ist eine unbestätigte Hypothese und darf ohne konkrete GitHub-Meldung nicht als Ursache dokumentiert werden.

**Abgrenzung:** ATLAS-55 (`BLK-ATLAS-13-02`, Hosted-Runner-Acquisition) und `BLK-ATLAS-13-01` (Branch Protection auf privatem Repo unter dem aktuellen Accountplan nicht verfügbar) sind **zwei verschiedene Blocker** und dürfen nicht vermischt werden. Details je Blocker: `docs/governance/blockers.md`.

**Wirkung auf Delivery:** Ohne Runner-Akquisition entsteht keine CI-Evidenz an einem PR-Head. Das blockiert das CI-Gate für PR #1/#2/#3 und damit den Merge; lokale, reproduzierbare Testevidenz bleibt Interim.

**Keine weiteren technischen Versuche** ohne neue externe Evidenz — die zwei materiell unterschiedlichen Versuche (`ubuntu-latest`, `ubuntu-24.04`) sind gemäß Fehlerregel ausgeschöpft. Kein `workflow_dispatch`, kein Rerun, kein Probecommit, kein neuer Workflow.

**Owner-/Support-Paket:** `docs/support/github-actions-runner-acquisition-case.md`.

**Abschlusswege (einer von zwei):** Erfolgsweg — ein hosted Job wird akquiriert, mindestens ein Step läuft, `foundation-consistency` läuft am aktuellen PR-Head erfolgreich. Externer Blockerweg — GitHub liefert einen konkreten Billing-, Policy- oder Plattformfehler; dieser wird dokumentiert und die Sprintsteuerung entscheidet über Auslagerung oder Planänderung.

**Out-of-Scope:** Feature-Arbeit jeder Art; Vermischung mit BLK-ATLAS-13-01; Umgehung des CI-Gates durch Selbstbestätigung.

---

## Abschluss (nach allen Tickets)

1. `docs/evidence/sprint-1-evidence.md` vervollständigen (jede AC-Zeile → Evidenz).
2. PR(s) auf `main` finalisieren; Review-Findings beheben.
3. Owner-Gate: Confluence-Proposals publizieren (ATLAS-11/-12/-15/-22), danach betroffene Jira-Tickets auf `Fertig` mit Read-after-write.
4. `Gbrain-vps` bleibt deprecated/privat; `gbrain-atlas` unverändert — Abschluss-Check dokumentieren.

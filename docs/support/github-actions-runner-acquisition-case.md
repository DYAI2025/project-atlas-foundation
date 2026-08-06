# GitHub Support Case — Hosted Runner Acquisition Failure

Jira: ATLAS-55 · Interne Kennung: BLK-ATLAS-13-02 · Stand: 2026-08-06/07

Alle Angaben unten sind API-belegt (GitHub CLI/REST); keine Vermutungen.

## Repository

| Feld | Wert |
|---|---|
| Repository | `DYAI2025/project-atlas-foundation` |
| Visibility | private (`gh repo view`: `"visibility": "PRIVATE"`) |
| Owner-Typ | User-Account (`gh api users/DYAI2025`: `"type": "User"`) |
| Default Branch | `main` |
| Actions-Permissions | `{"enabled": true, "allowed_actions": "all", "sha_pinning_required": false}` (re-verifiziert 2026-08-07 via `gh api repos/DYAI2025/project-atlas-foundation/actions/permissions`) |

## Workflows (registriert, `active`)

| Workflow | ID | Datei |
|---|---|---|
| actions-probe | 328876692 | `.github/workflows/actions-probe.yml` (minimaler Shell-Job, keine Secrets, keine Dritt-Actions) |
| foundation-consistency | 328873830 | `.github/workflows/foundation-consistency.yml` |

## Fehlgeschlagene Runs (alle: Job cancelled, bevor ein Step lief)

| Run-ID | Workflow | Trigger | Head-SHA | Runner-Label | Job-ID | Dauer bis Cancel | Steps | Logs |
|---|---|---|---|---|---|---|---|---|
| 31127753756 | foundation-consistency | `pull_request` (PR #1) | `a1dbfc671a82c828fb0ce9d92caaee7c98b24419` | ubuntu-latest | 92705654160 | 15m02s | 0 | keine (`log not found`) |
| 31127837386 | actions-probe | `workflow_dispatch` | `c5260db69d9afa61f32f5511b832af27fa05b930` | ubuntu-latest | 92706093471 | 15m02s | 0 | keine |
| 31128025409 | actions-probe | `workflow_dispatch` | `421ac70409201c0e3e5c4bb6e706d2fe70e3f0d8` | ubuntu-24.04 | 92707084002 | 15m02s | 0 | keine |

Run-Status jeweils: `completed` / `failure`; Job-Conclusion: `cancelled`.

## Wörtliche Fehlerannotation

In allen drei Jobs identisch (via `gh api repos/DYAI2025/project-atlas-foundation/check-runs/<job_id>/annotations`):

> The job was not acquired by Runner of type hosted even after multiple attempts

## Bereits getestete Varianten

1. `runs-on: ubuntu-latest`, Trigger `workflow_dispatch` (Run 31127837386) — Job nicht akquiriert.
2. `runs-on: ubuntu-24.04`, Trigger `workflow_dispatch` (Run 31128025409) — identisch.
3. `pull_request`-Trigger (Run 31127753756) — identisch.
4. Minimaler Workflow ohne Secrets, ohne Netzwerk-Extras, ohne Dritt-Actions, `permissions: contents: read` — identisch.

Kontext: Vor der Registrierung eines Workflows auf dem Default Branch wurden gar keine Runs erzeugt; nach der Registrierung entstehen Runs zuverlässig (inkl. automatisch nachgeholtem `pull_request`-Run), sie scheitern jedoch sämtlich an der Runner-Akquisition.

## Klassifikation

`HOSTED_RUNNER_ACQUISITION_FAILURE` — dahinterliegender Grund: `UNKNOWN_PLATFORM_OR_POLICY`. GitHub nennt in Annotation, API-Responses und Run-Metadaten keinen Grund; ein Billing-/Plan-Zusammenhang ist unbestätigte Hypothese.

## Fragen an GitHub Support

1. Warum akquiriert kein GitHub-hosted Runner die Jobs der oben gelisteten Runs (Run-IDs 31127753756, 31127837386, 31128025409) in `DYAI2025/project-atlas-foundation`, obwohl Actions `enabled/all` ist?
2. Liegt für den Account `DYAI2025` oder dieses private Repository eine Billing-, Verifizierungs- oder Policy-Einschränkung vor, die hosted Runner-Zuteilung verhindert? Falls ja: welche konkret, und wo ist sie für den Account sichtbar?
3. Ist ein Plattform-Incident oder eine Kontingent-/Quota-Sperre für diesen Account bekannt (Zeitraum 2026-08-06 ~19:30–21:30 UTC)?
4. Welche konkreten Schritte sind nötig, damit hosted Jobs für dieses private Repository wieder akquiriert werden?

Keine Zugangsdaten, Tokens oder Billing-Daten in diesem Dokument.

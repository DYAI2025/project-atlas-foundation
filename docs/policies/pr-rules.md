# PR-Regeln (ATLAS-13)

- Default-Branch `main`: kein Force-Push, kein Branch-Delete, kein Direkt-Push.
- Jeder Merge erfordert einen Pull Request mit mindestens 1 Approval.
- Alle Review-Threads müssen vor Merge aufgelöst sein.
- Kein Self-Merge ohne dokumentierte Owner-Ausnahme (Solo-Owner-Situation:
  Owner-Merge nach Review-Evidenz zulässig, `enforce_admins` wäre false —
  Owner-Entscheidung G2 vom 2026-08-06).
- Required CI-Checks ab ATLAS-23: `check`, `secret-scan`, `vuln-scan`.
- Commit-Konvention: `feat|docs|ci|test|chore(ATLAS-XX): Beschreibung`.

**Erzwingungsstatus:** Diese Regeln sind derzeit disziplinarische Policy ohne
technische Erzwingung — siehe `docs/governance/blockers.md` (BLK-ATLAS-13-01).

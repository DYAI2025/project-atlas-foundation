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

## G2-Autorisierungsartefakt (ATLAS-56)

Jeder G2-Solo-Owner-Merge erfordert ein VOR der Gate-Prüfung existierendes,
referenzierbares PO-Autorisierungsartefakt. Das Artefakt ist ein GitHub-Kommentar
auf dem zu mergenden PR selbst, verfasst vom PO-Account (`DYAI2025` — der
Repository-Owner-Account ist per Policy die PO-Identität), mit diesem
maschinenlesbaren Block (drei Zeilen, jeweils am Zeilenanfang, ungequotet):

```
G2-AUTHORIZATION
PR: #<Nummer>
HEAD: <40-hex-Head-SHA>
```

Regeln:

- PR-Nummer und Head-SHA müssen exakt den zu mergenden PR-Head bezeichnen;
  ein Artefakt für einen anderen PR oder einen anderen Head zählt nicht.
- Das Artefakt muss zeitlich VOR der Gate-Prüfung existieren; maßgeblich ist
  der letzte Bearbeitungszeitpunkt (`updated_at`) — nachträglich erzeugte oder
  nachträglich editierte Kommentare validieren nicht rückwirkend.
- Autorisierung wird NIEMALS inferiert — nicht aus `READY FOR MERGE`,
  `READY FOR PO AUTHORIZATION`, einem erwarteten nächsten Schritt, Chatkontext
  oder erwarteter Zustimmung. Audit-Kommentare sind selbst nie Artefakte.
- Prüfung (fail closed, Exit 0 nur bei gültigem Artefakt):
  `node scripts/g2-authorization-gate.mjs <pr> <head-sha>`
- Der G2-Audit-Kommentar MUSS das verifizierte Artefakt referenzieren
  (`Authorization artifact: comment <id>`) und darf ausschließlich tatsächlich
  beobachtete Freigaben behaupten.

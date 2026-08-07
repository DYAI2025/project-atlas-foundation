# Repository-Rollen (verbindlich, Owner-Entscheidung 2026-08-06)

project_id: ATLAS · Jira: ATLAS-13

## `DYAI2025/project-atlas-foundation` (dieses Repository)

- **Einziges kanonisches Implementierungsrepository** für Project ATLAS.
- ATLAS-eigener Control Plane und Governance Layer (ADR-0001).
- Source of Truth für Code, Tests, CI, Contracts und Release-Evidence.
- Visibility: private. Default Branch: `main`.
- Alle Änderungen über Pull Requests auf `main` (Review-Policy: siehe
  `docs/policies/pr-rules.md`; technische Erzwingung derzeit blockiert,
  siehe `docs/governance/blockers.md`).

## `DYAI2025/gbrain-atlas`

- Legacy-Prototyp (Juni 2026), **keine Basis für den neuen Git-Verlauf**.
- Legacy-Pin: `aea0fb0b934780a205db92066786b265de0de22a`.
- Nur read-only analysieren. Keine Änderungen, Branches oder Pull Requests.
- Einzelne Ideen oder Verträge dürfen nur nach expliziter Provenienzprüfung
  (Lizenz, Herkunft, Architektur-Kompatibilität) wiederverwendet werden.

## `DYAI2025/Gbrain-vps`

- Nicht kanonischer Artefakt-Snapshot (Quelle des sanitized clean export,
  siehe `import-provenance.json`).
- Keine weitere Sprint-Implementierung, keine Veröffentlichung dorthin.
- Nach Übernahme in dieses Repository als deprecated gekennzeichnet.
- Wird nicht gelöscht. Visibility: private (korrigiert 2026-08-06,
  vorher fälschlich public — Verstoß gegen Approval Boundary §12 behoben).

## Historie

- Keine Migration der Git-Historie aus `gbrain-atlas` oder `Gbrain-vps`.
- Der Git-Verlauf dieses Repositories beginnt mit dem Bootstrap-Commit
  (`BOOTSTRAP_EXCEPTION_ATLAS_13`); Provenienz maschinenlesbar in
  `import-provenance.json`.

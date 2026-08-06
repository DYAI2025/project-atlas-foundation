# Project ATLAS Foundation (historisches Importdokument)

> **Status: historical_import_evidence.** Original-README des Dry-Run-Pakets vom
> 2026-08-06 (importiert über `DYAI2025/Gbrain-vps@fad6e83e`). Beschreibt den
> damaligen Paketzustand, nicht das heutige kanonische Repository — dessen
> aktuelle README liegt im Repository-Root. Die Remote-Entscheidung ist
> inzwischen getroffen (Option A, 06.08.2026): kanonisch ist
> `DYAI2025/project-atlas-foundation`; `DYAI2025/gbrain-atlas` bleibt
> unveränderte read-only Legacy-Referenz.

This repository is the **clean implementation foundation** for Project ATLAS. It is not a continuation of the legacy PGLite brain and it does not silently replace the existing `DYAI2025/gbrain-atlas` prototype.

## Current status

- Decision: **conditional foundation**
- Build mode: `BUILD_DRY_RUN`
- Foundation maturity: established by `reports/release-decision.json`
- Runtime deployment: blocked until `ATLAS-14` and `ATLAS-16` are complete
- Productive agent publish: blocked until all 14 release gates are evidenced

## Core architecture

1. **Confluence** remains the canonical fachliche Source of Truth.
2. **ATLAS Core** owns project registry, source revisions, proposals, approval evidence, audit events, and project isolation.
3. **gbrain** is integrated as a pinned retrieval and graph projection, not treated as the unmodified canonical write store.
4. **Obsidian** is a read-only, reconstructable projection in V1.
5. Agents receive `read + propose` by default. `approve` and `publish` remain technically separated.

See [ADR-0001](architecture/adr/ADR-0001-canonical-store-and-gbrain-projection.md).

## Start locally

Requirements:

- Node.js 22.x for foundation validation and tests
- No network access is required for the current foundation checks

```bash
npm ci --ignore-scripts
npm run check
```

No production service, database migration, container, or VPS change is executed by these commands.

## Repository map

- `config/` — proposed deterministic project registry; production write still pending
- `contracts/` — active boundary contracts and draft knowledge contracts
- `src/` — tested registry, policy, and provenance primitives
- `architecture/` — candidates, ADR, C4/Mermaid diagrams, approval boundary
- `adapters/` — integration boundaries; no direct SDK choice yet
- `services/` — responsibility stubs, not fake implementations
- `db/draft/` — non-runnable database design draft pending architecture approval
- `infra/` — non-applied Compose/systemd templates pending VPS audit
- `third_party/` — pinned upstream inventory, licenses, and integration status
- `docs/testing/` — ATLAS release gates and evidence model

## Deliberately not included without separate approval

- replacement or deletion of the current `DYAI2025/gbrain-atlas` prototype
- bidirectional Obsidian synchronization
- ingestion of raw agent transcripts
- Smart Connections or Advanced Canvas source vendoring
- a specific Graph UI framework or graph rendering library
- a separate graph database, queue, Kubernetes, or multi-host split
- LLM-dependent ingestion, classification, or relation publication

See [Approval Boundary](architecture/approval-boundary.md).

## GitHub handoff (historisch — Entscheidung inzwischen getroffen)

Zum Zeitpunkt des Dry Runs existierte `DYAI2025/gbrain-atlas` als Legacy-Prototyp mit fremder Historie; der Dry Run hat ihn weder überschrieben noch dorthin gepusht. Das damals referenzierte Dokument `docs/delivery/github-handoff.md` wurde **nicht** in dieses Repository importiert. Die Handoff-Frage ist durch die Owner-Entscheidung vom 06.08.2026 (Option A: neues kanonisches Repository `DYAI2025/project-atlas-foundation`, keine History-Migration) abgeschlossen — siehe `docs/governance/repository-roles.md`.

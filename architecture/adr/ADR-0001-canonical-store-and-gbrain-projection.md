# ADR-0001: ATLAS-owned canonical control plane with pinned gbrain projection

- Status: **Conditional**
- Date: 2026-08-06
- Decision ID: AD-001
- Jira: ATLAS-14, ATLAS-22, ATLAS-30, ATLAS-31, ATLAS-54
- Confluence: pages 04, 05, 07, 08, 09, 13

## Context

Project ATLAS requires deterministic project boundaries, PostgreSQL RLS, `project_id` on canonical data, separate proposal/approval/publish responsibilities, evidence, clean rebuilds, and a premium graph/retrieval experience. The pinned gbrain source provides substantial retrieval, graph, MCP, source-scoping, and evaluation capability, but its unmodified data and authorization model does not completely implement the ATLAS canonical governance contract.

## Decision

Create a small ATLAS-owned canonical control plane for:

- project registry
- source revision identity and hashes
- classifications and quarantine decisions
- knowledge proposals and approval evidence
- publication/audit records
- projection checkpoints

Use the pinned gbrain snapshot as a **derived retrieval and graph projection**. Approved source revisions are projected idempotently under project-bound gbrain sources. gbrain data remains reproducible and replaceable from canonical sources and ATLAS evidence.

Confluence remains the fachliche Source of Truth. Obsidian remains a read-only projection.

## Consequences

Positive:

- avoids a deep fork of a fast-moving upstream
- isolates ATLAS governance from gbrain internal schema changes
- makes rebuild and rollback explicit
- supports independent evaluation and projection replacement
- preserves gbrain's useful MCP, retrieval, graph, and source-scoped capabilities

Negative:

- canonical and projection stores can drift
- projector idempotency, lag, and reconciliation become first-class responsibilities
- some gbrain operations must be wrapped or disabled
- two data models must be traced and tested

## Strongest counterargument

A second control-plane store creates unnecessary duplication. Extending gbrain upstream with native ATLAS project IDs, proposal roles, and project RLS could produce a simpler system.

This counterargument becomes decisive if an upstream-compatible extension can satisfy all DEC-09 and DEC-10 tests with less code and lower upgrade cost, or if projection drift cannot meet the release gates. Reopen after the EasyTree and Plumbline pilot measures projection lag, reconciliation failure rate, and operational burden.

## Conditions before implementation

- ATLAS-14 approves this ADR and current diagrams.
- ATLAS-16 confirms Docker, storage, memory, ports, and BGE-M3 digest.
- Page 05 defines canonical entity identifiers and lifecycle rules.
- ATLAS-54 defines executable RLS and role tests.
- The exact target remote strategy for existing `DYAI2025/gbrain-atlas` is approved.

# Approval boundary

This file distinguishes the **approved foundation** from changes that need a separate Owner decision.

## Included in this foundation

- deterministic routing by Jira key, Confluence root Page ID, GitHub repository, or explicit project ID
- V1 registry entries for ATLAS, EasyTree, and Plumbline
- local BGE-M3/1024d configuration contract, still conditional on VPS audit and digest pinning
- `read`, `propose`, `approve`, `publish`, and `admin` policy primitives
- separate approver and publisher identities
- proposal second-confirmation rule for bulk, delete, and supersede
- provenance hashes and evidence references
- pinned upstream inventory and license boundaries
- non-applied Compose, systemd, and database design templates

## Separate approval required

The following are **not implemented or enabled**:

1. Replacing, deleting, or moving the existing `DYAI2025/gbrain-atlas` prototype.
2. A bidirectional Obsidian synchronization path.
3. Direct agent publish or Confluence write without a human-approved proposal.
4. Ingestion of raw agent transcripts, private mail, chats, calendars, contacts, secrets, or unknown archives.
5. Vendoring or deriving core code from Smart Connections.
6. Vendoring or deriving core code from Advanced Canvas under GPL-3.0.
7. Choosing React, Vue, Svelte, Three.js, Cytoscape, Sigma, Cosmograph, or another Premium Graph UI stack.
8. A separate graph database, message broker, Kubernetes, multi-host deployment, or managed cloud database.
9. LLM-dependent chunking, classification, entity extraction, relation publication, or provider fallback.
10. Full source-code ingestion for pilot repositories.
11. Federation across projects without an explicit `read:federated` capability and negative-isolation evidence.
12. Public distribution or open-source licensing of the ATLAS repository.

## Change control

A proposal crossing this boundary must include:

- decision question and alternatives
- Jira issue and Confluence specification reference
- license, security, cost, and rollback impact
- complete file and dependency diff
- explicit Owner approval before implementation

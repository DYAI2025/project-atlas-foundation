# Repository assessment

## Existing target repository: DYAI2025/gbrain-atlas

Observed default branch: `main`. Latest observed commit: `aea0fb0b934780a205db92066786b265de0de22a`.

The current repository is a June 2026 prototype built around:

- gbrain 0.37.9.0 and local PGLite
- React/Vite and 2D/3D force-graph libraries
- a polling curator and deterministic 34-hub ontology
- a reversible `atlas-onto` source
- direct assumptions about local filesystem layout and a sibling gbrain checkout

Useful assets to reassess later:

- graph interaction and visual effects concepts
- live refresh patterns
- deterministic relation materialization tests
- reversible source removal

Reasons it is not used as the foundation without a separate migration decision:

- it predates the current Confluence/Jira architecture
- it assumes PGLite and local paths rather than the approved VPS/Postgres model
- it does not implement the ATLAS canonical proposal, approval, publish, RLS, and project registry boundaries
- it references a substantially older gbrain version
- replacing or reorganizing its foreign history requires explicit approval

## Attached upstream snapshots

### gbrain 0.42.73.2

**Use:** required pinned projection runtime.

Strengths:

- mature Bun/TypeScript codebase
- PGLite and Postgres engines
- Postgres/pgvector, MCP, search, graph, sources, audit-oriented features
- tests and security checks
- MIT license

Boundary:

- source scoping does not by itself satisfy ATLAS canonical `project_id`, RLS, proposal, and publish separation
- use behind an ATLAS adapter and projector

### gbrain-evals 0.2.0

**Use:** required evaluation adapter for ATLAS-43.

Strengths:

- adapter-based harness
- offline and sealed-answer patterns
- MIT license

Boundary:

- dependency points at gbrain `master` and must be pinned
- upstream benchmark scores are not ATLAS evidence

### hermes-gbrain-bridge 0.1.0

**Use:** reference-only adapter patterns.

Strengths:

- small dependency-free Bun/TypeScript codebase
- discovery, normalization, and canonical event patterns

Boundary:

- raw agent transcripts are excluded from V1
- redaction-first behavior cannot replace quarantine and review

### Smart Connections 4.7.2

**Use:** optional external Obsidian capability only.

Boundary:

- supplied source is not standalone and uses multiple local file dependencies
- a separate embedding store would create drift from the canonical BGE-M3 index
- the Smart Plugins License needs an explicit distribution/product decision

### Advanced Canvas 6.5.0

**Use:** optional external presentation plugin only.

Boundary:

- GPL-3.0 source must not be copied into an unlicensed or differently licensed ATLAS core without an explicit decision

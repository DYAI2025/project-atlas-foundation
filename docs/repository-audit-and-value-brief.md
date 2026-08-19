# Project ATLAS Foundation — Repository Audit & Value Brief

**Audit snapshot:** `main` at `7b88d4f05f422cdf63e19e62cede57e3188b62ca` (19 Aug 2026)  
**Scope:** repository architecture, contracts, implemented pilot pipeline, Semantic Atlas viewer, governance boundaries, tests/CI, dependency and licensing signals, and public repository positioning.

## Executive assessment

Project ATLAS Foundation is best understood today as a **high-trust reference implementation and local pilot for governed knowledge projection**.

Its strongest differentiator is not “graph visualization” by itself. The repository demonstrates a disciplined path from explicitly scoped source knowledge to a graph that remains inspectable and provenance-aware after projection. It repeatedly chooses refusal over invention: unknown projects are denied, malformed or cross-project snapshots fail closed, inferred relations are excluded from the accepted pilot graph, missing provenance stays missing, and invalid/torn viewer state does not silently fall back to demo data.

That makes the repository particularly relevant to teams asking a harder question than “Can we build a knowledge graph?”:

> **Can we let people and AI systems explore derived knowledge without losing track of scope, source, evidence and authority?**

The answer demonstrated by the current local pilot is materially **yes**. The answer for a production, multi-project ATLAS control plane is **not yet proven** and must remain a separate claim.

## What is implemented now

The current repository contains an end-to-end local pilot with these observable layers:

1. **Explicit project scope** through the project registry and fail-closed selector handling.
2. **Live Confluence capture** of a bounded declared source set, including revision and hierarchy verification.
3. **Deterministic projection** into a pinned GBrain instance backed by local PGLite.
4. **Persisted readback only** for snapshot construction; the readback path cannot quietly re-fetch the source.
5. **`gbrain-read/v1` validation** for contract shape, project scope, identifiers and accepted relation origin.
6. **Provenance sidecar** carrying source page metadata for the user-facing evidence layer.
7. **Validate-then-serve** local delivery that refuses invalid or torn state.
8. **Semantic Atlas workspace** with WebGL graph rendering, search, focus, zoom, pan, navigator and evidence inspector.
9. **Accessible interaction semantics** in a DOM overlay tied to the same projected scene used by the GPU renderer.
10. **Repository gates** covering contracts, architecture/document invariants, viewer behavior, deterministic outputs and secret scanning.

The most recently inspected CI run for the ATLAS-40 merge path completed **408 tests with 408 passing and 0 failing**, followed by repository validation reporting `VALIDATION PASSED`. The associated secret-scan workflow also completed successfully and inspected the reachable Git history rather than only the working tree.

## Customer and user value

### 1. Trustworthy graph experiences instead of impressive-but-ambiguous graphs

ATLAS treats the visible graph as a **derived projection**, not as a new source of truth. This reduces a common failure mode in AI knowledge products: users seeing a relationship and being unable to tell whether it was sourced, inferred, stale or invented.

**Potential value:** higher confidence in knowledge exploration, review and AI-assisted workflows where provenance matters.

### 2. Provenance survives the projection boundary

Source page identifiers, revisions, URLs and capture metadata travel through the local pipeline and are surfaced by the viewer rather than discarded after ingestion.

**Potential value:** faster verification, easier audit conversations, and a shorter path from “Why is this node here?” back to source evidence.

### 3. Scope is an executable rule, not a README promise

Project resolution and graph validation fail closed on unknown, ambiguous and cross-project combinations.

**Potential value:** a stronger foundation for multi-project knowledge systems where accidental scope mixing would be costly or misleading.

### 4. Deterministic, rebuildable derived state

The projection and snapshot logic are designed for stable output from stable inputs, and GBrain is explicitly replaceable/rebuildable rather than promoted to canonical authority.

**Potential value:** easier debugging, reproducible evidence, safer upgrades and less lock-in to one retrieval/graph runtime.

### 5. A graph UI that preserves evidence and accessibility

The WebGL renderer is not allowed to become the semantic layer. Keyboard and assistive-technology interaction lives in DOM controls derived from the same scene geometry, while the evidence inspector exposes what is known about a focused node.

**Potential value:** a richer exploration experience without making GPU rendering the only way to understand or operate the graph.

### 6. Useful failure is part of the product model

The pilot has explicit failure codes and intentionally avoids fixture substitution on accepted production paths.

**Potential value:** operators and developers can distinguish “no data” from “data could not be trusted,” which is essential in evidence-sensitive systems.

## Who can benefit from this repository

The repository is most relevant to:

- **AI platform and agent teams** that need governed retrieval or graph context rather than unconstrained ingestion.
- **Knowledge-management and enterprise-search teams** that need traceable source-to-graph behavior.
- **Architecture and security teams** evaluating project isolation, provenance and human approval boundaries for AI systems.
- **Developers building graph products** who want a working example of keeping rendering, read contracts and canonical authority separate.
- **Teams prototyping regulated or high-consequence knowledge workflows** where “the model probably inferred it” is not an acceptable evidence standard.

It is less suitable today for buyers seeking a turnkey hosted SaaS product, a production-scale graph platform, or a finished autonomous publishing system.

## Architecture assessment

### Strong current properties

- Clear canonical-vs-derived boundary.
- Deterministic projection and validation behavior.
- Explicit source and project scope.
- Provenance-aware read side.
- Viewer failure states instead of deceptive fallbacks.
- Separation of browser wiring from testable graph/scene logic.
- Pinned upstream dependency model and dependency documentation.
- Dedicated CI and reachable-history secret scanning.
- Accessibility concerns incorporated into the rendering architecture rather than bolted on after the fact.

### Gaps and risks that should remain visible

#### Production architecture is still a target

The implemented ATLAS-65/39/40 path is a **local pilot**. The production control plane described by the architecture — canonical ATLAS persistence, PostgreSQL RLS, service-role isolation, separated approval/publication identities, reconciliation/checkpoints and VPS deployment — is not established by this pilot.

**Consequence:** do not market the repository as production-ready multi-project governance.

#### Existing C4 container documentation is stale

`architecture/c4-container.mmd` still describes the local pilot lane as “target slice, not implemented.” That no longer matches the implemented ATLAS-65 pipeline and ATLAS-39/40 viewer.

**Consequence:** readers can underestimate what exists or, worse, mix old status wording with the newer implementation. The new `architecture/architecture.json` explicitly separates current and target state.

#### Public repository, no root license observed

The GitHub repository is public, but neither `LICENSE` nor `LICENSE.md` was present at the audited snapshot.

**Consequence:** public visibility should not be described as an open-source license. Reuse and distribution rights remain unclear until the owner makes an explicit licensing decision.

#### CI emits JSON Schema strictness warnings

The inspected CI output includes Ajv `strictTypes` warnings around `minItems` / `maxItems` usage in the local-adapter response schema. Tests still pass, but warning-free schema validation would make the contract surface cleaner.

**Consequence:** minor schema-hygiene debt; not observed as a failing runtime defect in this audit.

#### Pilot scale is deliberately small

The accepted ATLAS-65 evidence path uses a fixed bounded set of real source pages. It demonstrates correctness properties, not graph-scale or multi-tenant performance.

**Consequence:** performance, reconciliation at scale and production isolation still need separate evidence.

## Evidence strength

| Claim | Evidence level | Notes |
|---|---|---|
| Local source → GBrain → persisted readback → validated snapshot path exists | Strong | Implemented modules, runbook and tests |
| Semantic Atlas WebGL workspace exists | Strong | Viewer source, renderer modules and tests |
| Fail-closed / no-fixture behavior is intentional and tested | Strong | Source comments, tests, runbook and CI |
| Provenance is preserved and displayed | Strong | Projection/snapshot/viewer implementation |
| Current tested path is production-ready | **Not established** | Local pilot explicitly excludes production claims |
| Production PostgreSQL/RLS control plane exists | **Not established** | Target architecture only |
| Repository is open source | **Not established** | Public repository, no root license observed |

## Recommended public positioning

Use this framing:

> **Project ATLAS Foundation is a provenance-first, fail-closed reference implementation for turning governed source knowledge into an inspectable graph experience. It demonstrates deterministic project scoping, derived GBrain projection, evidence-preserving readback and an accessible WebGL workspace — while keeping the later production control plane explicitly separate from the local pilot.**

Avoid these claims until additional evidence exists:

- “production-ready”
- “multi-tenant secure”
- “open source”
- “autonomous knowledge governance”
- “canonical knowledge graph” for the current GBrain projection
- performance or scalability claims not backed by measurements

## Recommended next product evidence

1. Resolve and publish the repository license decision.
2. Bring the legacy C4 container status in line with the implemented pilot.
3. Add a reproducible browser screenshot or short demo capture generated from committed accepted evidence.
4. Remove the Ajv strict-schema warnings.
5. Define measurable production-readiness gates for isolation, reconciliation, scale, recovery and deployment.
6. When production work starts, preserve the current discipline: **pilot evidence may inform the target, but must never silently authorize it.**

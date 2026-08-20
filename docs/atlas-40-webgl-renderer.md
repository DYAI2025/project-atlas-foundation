# ATLAS-40 — WebGL Renderer, Core Navigation and Deterministic Views (Slices 1–2)

## What this is

The graph in the Semantic Atlas Workspace is now drawn by WebGL. The browser
success path no longer goes through the ATLAS-39 SVG renderer.

This is **slice 1 of ATLAS-40**, not ATLAS-40. What it delivers is the renderer
foundation plus the navigation a renderer is useless without: search, zoom, pan,
node focus, and the evidence inspector still showing real Confluence provenance.
The cluster/view system, saved views, the minimap, semantic zoom and the
performance programme are **not** in it — see the last section.

## One command

```bash
npm ci                # dev dependency for tests only (ajv)
npm run atlas39:serve # -> http://127.0.0.1:4339/
```

Unchanged from ATLAS-39, deliberately: the same validate-then-serve server, the
same committed accepted evidence, no credentials, no GBrain runtime, no pipeline
run. The serve command still carries the `atlas39:` prefix because it serves the
`viewer/atlas39/` workspace, which ATLAS-40 modified rather than replaced.

## Data shown

| Property | Value in the committed evidence |
|---|---|
| Project | `ATLAS` |
| Confluence root | `14778372` |
| Nodes / edges | 5 / 4 |
| Snapshot sha256 | `12c32883a6ccaeb0455b33715af89d4d8cc5547a255fec3386edcb158980b739` |
| Identifier scheme | `projection-local/v1`, `canonical_entity_ids=false` |

Same real data, same digest, same pipeline as the accepted ATLAS-65 evidence.
There is no fixture, cached or demo graph anywhere in the viewer, and the WebGL
renderer added no way to introduce one.

## Architecture

```
viewer/atlas39/core/view-model.mjs   snapshot + provenance -> view model    (pure, fail-closed)   unchanged
viewer/atlas39/core/layout.mjs       view model -> stage geometry           (pure, deterministic) unchanged
viewer/atlas39/core/scene.mjs        view model + layout + focus -> scene   (pure)                NEW
viewer/atlas39/core/transform.mjs    zoom / pan / reset algebra             (pure, total clamp)   NEW
viewer/atlas39/core/scene-guard.mjs  scene -> refusal verdict               (pure, fail-closed)   NEW
viewer/atlas39/core/render-webgl.mjs screen scene -> WebGL draw calls                             NEW
viewer/atlas39/core/search.mjs       view model + query -> matches          (pure)                NEW
viewer/atlas39/app.mjs               fetch, canvas, overlay, events, focus  (no graph logic)
viewer/atlas39/core/render-svg.mjs   geometry + focus -> SVG markup                               SUPERSEDED
viewer/atlas39/core/stage-mount.mjs  markup -> allowlist verdict                                  SUPERSEDED
```

ATLAS-39 predicted that replacing the renderer would need no change to the view
model, the layout, the navigator, the inspector or the keyboard model. That held:
neither `view-model.mjs` nor `layout.mjs` was touched, and the goldens rendered
from them are byte-identical to before this ticket.

### The renderer boundary moved from markup to data

ATLAS-39's boundary was a markup **string**, because an SVG renderer's product is
markup. A WebGL renderer's product is geometry, so the boundary is now a plain
data scene:

```
buildScene(viewModel, layout, focusState)  -> world scene
projectScene(scene, transform)             -> screen scene   <- drawn AND mounted
```

The screen scene has two consumers and that is the point:

- `core/render-webgl.mjs` uploads it to the GPU;
- the accessible DOM overlay positions its buttons from the *same objects*.

### Security: the property, not the mechanism

The ATLAS-39 property was **nothing derived from Confluence data may become
executable DOM**. It survives, by construction rather than by scanning:

- The GPU path receives only numbers. No string derived from page data is ever
  uploaded, and the shader sources are constant template literals with no
  interpolation — `test/atlas40-render-webgl.test.mjs` asserts both.
- The overlay is built with `document.createElement`, `textContent` and a fixed
  set of attributes. `app.mjs` contains no `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write` or `createContextualFragment`, and no
  longer contains `DOMParser`, `parseFromString` or `importNode` either —
  `test/atlas39-stage-mount.test.mjs` asserts the whole list.

The SVG markup allowlist (`core/stage-mount.mjs`) was therefore **not** carried
over into the WebGL path. Routing geometry through a scan for `<script>` would be
theatre. What *was* carried over is the half that still applies: a fail-closed
guard that refuses rather than repairs.

### `core/scene-guard.mjs` — what replaced the allowlist

It asks the questions a WebGL stage can genuinely get wrong:

| Refusal | Why it matters |
|---|---|
| a non-finite coordinate | most drivers silently drop a triangle containing `NaN` — a node vanishes and the graph still looks fine |
| an unknown node or edge state | would be painted as some default and read as a real state |
| `hitR !== haloR` | pins the repaired ATLAS-39 defect as an invariant |
| not exactly one node tabbable | zero strands the keyboard user, more than one recreates the tab tunnel |
| a label that is not plain text | including control characters, which mean the title did not survive the pipeline |
| counts disagreeing with contents | a truncated upload is the quiet way to lose part of a graph |

Every one of these is proved by a counterexample test that breaks exactly that
one thing in the real accepted scene, next to a control test showing the
unbroken scene passes.

## Accessibility

The canvas is `aria-hidden` and carries no semantics at all. Every graph
semantic lives in a DOM overlay of real `<button>` elements, one per node,
positioned and sized from the projected scene.

Preserved from ATLAS-39, unchanged: five named landmarks, one `h1`, the skip
link, roving tabindex, `Enter`/`Space` to focus, arrow keys to traverse in
hierarchy order, `Home`/`End`, `Escape` to clear, the polite live region, and
reduced motion honoured globally.

Added by ATLAS-40:

- `+` / `-` zoom, `0` reset, `Shift`+arrows pan — so no view control is
  mouse-only. The same three actions are also toolbar buttons.
- The search field announces its result politely and marks itself `aria-invalid`
  when nothing matched, so a no-match is distinguishable from an empty project.
- Overlay buttons are **reconciled, not rebuilt**, across renders. Rebuilding
  them would drop keyboard focus on every pan and zoom.
- A pan repaints the stage only. Running the full render would rebuild the
  navigator list mid-gesture and destroy focus inside it.

## Repaired ATLAS-39 findings

Both accepted ATLAS-39 quality observations were on surfaces this slice replaced,
so both were repaired rather than reported forward.

1. **Label clipping (~18px at 1440x900).** ATLAS-39 truncated every label at a
   fixed 26 characters, which cannot know how close to the stage border a label
   begins. The overlay now computes the real room available between the label's
   anchor and the border (`labelBudget()`) and ellipsises with CSS at that width.
   Full titles reach the DOM untruncated and stay in the accessible name.
2. **Halo larger than the hit target.** In the SVG stage the visible halo was
   `r + 9` while only the disc answered a click. `haloR` and `hitR` are now the
   same field of the same object; the GPU draws that radius and the overlay
   button *is* that circle. A screen-space floor keeps the target operable when
   zoomed out, and it raises both together. `scene-guard.mjs` refuses any scene
   where they differ.

## Failure modes

| Condition | Behaviour |
|---|---|
| `/graph-snapshot.json` unreachable or non-2xx | Failure panel, `E_SNAPSHOT_UNAVAILABLE`, no graph drawn |
| Snapshot loads but violates the contract | Failure panel, `E_VIEW_MODEL_INVALID`, no graph drawn |
| No WebGL context, or a shader/program that will not build | Failure panel, `E_WEBGL_UNAVAILABLE`, no graph drawn, **no fallback renderer** |
| WebGL context lost while running | Failure panel, `E_WEBGL_CONTEXT_LOST`; the GL context is disposed so no stale frame survives |
| Scene refused by the guard | Failure panel, `E_STAGE_SCENE_REFUSED`, no graph drawn |
| Design tokens unresolvable | Failure panel, `E_PALETTE_INVALID` — the renderer owns no colour of its own |
| `/provenance.json` unavailable | Graph still renders; status bar shows `provenance unavailable` and each node's inspector states that revision and source URL are not known |
| Extreme zoom or pan | Clamped, never lost; `Reset view` and `0` always recover the default |

A failure disables the search field and every view control, tears down the GL
context and sets `data-stage="failed"` on `<body>`. There is deliberately no
2D-canvas or SVG fallback: a substitute renderer would look like success while
the thing actually asked for is absent.

## Dependencies

**No runtime or dev dependency was added by this ticket.** The renderer is raw
WebGL against browser primitives. GLSL ES 1.00 is used so one shader source
serves both WebGL 2 and WebGL 1 contexts and there is no second code path.

Playwright was used for the headed acceptance run from a temporary directory
outside the repository, so `package.json` and CI are unchanged.

## Verification

```bash
npm test                                    # includes every atlas40-* suite
node scripts/validate-current-repository.mjs
node scripts/secret-scan.mjs
npm run atlas39:visual                      # golden geometry gate (also inside npm test)
```

The golden SVG files under `test/golden/` are **no longer evidence about what the
browser paints** — the browser paints WebGL. They remain a dependency-free
regression gate over what both renderers share: the view model and the
deterministic layout. `render-svg.mjs` carries a banner saying so, and the
validator checks that banner is present.

What the headless gates cannot cover is rasterisation on a real driver. That is
covered by a headed Chromium run at 1440x900, which verifies that the canvas is
bound to a real WebGL context (`getContext('2d')` returns `null`,
`getContext('webgl2')` returns the live context), that its pixels are non-uniform,
and that search, zoom, pan, reset, node focus, inspector provenance and keyboard
access all behave. That evidence is attached to the pull request rather than
committed, per the existing ATLAS-39 practice.

## Not delivered by slice 1

These remain open ATLAS-40 acceptance criteria. The ticket stays **In Arbeit**.

- Saved views
- Minimap
- The cluster / view system, and any clustering at all
- Semantic zoom and level-of-detail above the detail threshold
- The 4,000-node / 15,000-edge performance programme and its measurements.
  DEC-07 names pan/zoom p95 ≥ 30 FPS and search p95 ≤ 800 ms as targets; **no
  frame rate or search latency has been measured**, and nothing in this slice
  should be read as evidence about either. Slice 1 rebuilds its vertex buffers
  on every frame, which is correct at five nodes and is exactly what the
  performance slice will replace with instancing and culling.
- Edge bundling, labels rendered on the GPU, and any layout other than the
  ATLAS-39 deterministic radial tree

## Delivered by slice 2

**Views (AC5).** Two modes, both pure projections over the snapshot that is
already loaded:

| Mode | Contents |
| --- | --- |
| Overview | every node and every edge |
| Direct neighbourhood | one real node, the nodes its explicit edges reach, and every explicit edge whose both endpoints are in that set |

"Cluster" in AC5 is read strictly as *a UI projection over explicit graph state*.
No cluster label, no community detection, no similarity, no inferred edge and no
relation-type catalogue is created — the canonical relation-type catalogue is
still an open ATLAS question, and a viewer that invented one would put a
decision on screen that nobody has made.

A view restricts which nodes and edges reach the layout. It does **not** rewrite
node facts: `depth`, `degree`, `provenance` and the adjacency the inspector reads
stay the full-graph values, because those are facts about the page rather than
about the view. Search stays full-graph for the same reason: a scoped view can
never hide a page from the navigator.

Focusing a node the current view does not draw returns the view to Overview and
announces it. A selection the user cannot see is the same defect as losing the
graph.

**Saved views (AC5).** One deterministic slot in `localStorage`, keyed
`atlas40.saved-view.v1`, carrying UI state only — never graph data:

```json
{
  "saved_view_version": 1,
  "snapshot": { "project_id": "…", "source_id": "…", "contract_version": "…",
                "id_scheme": "…", "node_count": 5, "edge_count": 4 },
  "view":      { "mode": "neighbourhood", "anchor_id": "…" },
  "focus_id":  "…",
  "transform": { "scale": 1.75, "tx": -412, "ty": -88 },
  "viewport":  { "width": 1092, "height": 693 }
}
```

The contract version is `saved_view_version`: `1`.

Restoring is fail-closed, and the refusal is always a coded refusal that changes
nothing on the stage:

| Code | Cause |
| --- | --- |
| `E_SAVED_VIEW_INVALID` | absent, not JSON, not an object, or an unusable field |
| `E_SAVED_VIEW_VERSION` | not version 1 — checked before any field is interpreted |
| `E_SAVED_VIEW_MODE` | a view mode this build does not support |
| `E_SAVED_VIEW_SNAPSHOT` | any of the six identity fields differs from the loaded graph |
| `E_SAVED_VIEW_STALE_NODE` | the saved anchor or focus is not a node of this graph |
| `E_SAVED_VIEW_STORAGE` | the browser refused to store or read |

The six identity fields are `project_id`, `source_id`, `contract_version`,
`id_scheme`, `node_count` and `edge_count`.

A stale node is **refused, never resolved to a substitute**. `node_count` and
`edge_count` are part of the identity on purpose: a re-scanned Confluence tree
invalidates a saved view rather than restoring it into a graph that has quietly
changed shape.

A refused saved view is deliberately *not* a stage failure. A refused snapshot
tears the renderer down because the data cannot be trusted; a saved view that
does not apply leaves a graph that is still real and still drawn, so it is
refused loudly and locally instead — `body[data-saved-view="refused"]`, the
reason and its code next to the control, and an announcement that ends by saying
nothing on the stage was changed.

Mode, anchor and focus restore exactly. Zoom and position restore exactly when
the stage is the same size and are re-fitted otherwise — which the restore
announcement says, because claiming pixel-identical restoration across viewport
sizes would be an overclaim.

**Edge legend (AC7).** The legend is computed from the model the stage is
drawing: one row per distinct `(relation_type, origin)` pair that really occurs,
in code-unit order of type then origin, with the count. A type that is not in the
view has no row. For the accepted snapshot that means exactly one row —
`parent_of · explicit (4)`.

Every explicit relation is drawn with the same stroke (`--line-strong`); the only
per-edge variation is the focus highlight. The legend says so rather than
implying that its colours tell the types apart, because inventing a per-type
colour would be inventing an encoding.

Hierarchy remains, under its own **Hierarchy** heading, derived from the depths
actually present, with each swatch bound to the same design token
`core/scene.mjs` strokes the disc with. It is not the edge legend and is not
presented as one.

That binding is pinned by test, not asserted by construction, and the difference
matters enough to be written down. `core/render-webgl.mjs` — the code that
actually strokes the disc on the GPU — inlines the same depth ladder as its own
chain of ternaries, and `stage.css` spells it a third time for the golden-SVG
path; this slice changes neither. What holds them together is measurement:
`test/atlas40-render-webgl.test.mjs` reads the stroke colour back out of the
uploaded vertex buffer and compares it to `depthColor` for every depth class,
`test/atlas40-scene.test.mjs` pins depth to token name against a hand-written
table and re-reads `tokens.css` by that token name, and the `stage.css` copy is
inlined verbatim into the committed goldens, so an edit to it moves the golden
bytes. That last one **detects** an edit; it never compares it to the ladder.
"Cannot change unnoticed" is the honest claim for the CSS copy — not "the same
token by construction".

That group has one limit of its own, and it says so rather than leaving it to be
inferred from the swatches: `core/scene.mjs` collapses every depth from 3 onward
onto a single token, so on a graph deeper than three levels differently-labelled
rows carry an identical colour. When that happens the group carries a note naming
the level the collapse starts at, derived from the rows themselves — with the
ladder this build ships, "Level 3 and deeper share one colour." The accepted
snapshot is three levels deep, every row there has its own token, and the note is
empty.

**Repaired: the pointer gesture (slice-1 Minor).** After a drag crossed the
movement threshold, `pointercancel` left the click suppression armed. A cancelled
pointer delivers no click, so the flag stayed armed with nothing to spend it on.
The gesture is now a pure state machine in `core/gesture.mjs`, `pointercancel`
disarms it, and `test/atlas40-gesture.test.mjs` holds the repair. Slice 1 could
only assert that `app.mjs` still contained the string `suppressClick = true`,
which is precisely how the defect shipped.

## Not delivered by slice 2

These remain open ATLAS-40 acceptance criteria. The ticket stays **In Arbeit**.

- **AC6 Minimap** — explicitly deferred to the next slice
- **AC8** the 4,000-node / 15,000-edge performance programme. DEC-07 names
  pan/zoom p95 ≥ 30 FPS and search p95 ≤ 800 ms as targets; **no frame rate or
  search latency has been measured**, and nothing in this slice should be read as
  evidence about either
- Instancing, culling, semantic zoom, level-of-detail and edge bundling
- Multiple named saved-view slots, sharing a saved view, or persisting one
  anywhere but this browser. One slot is deliberate: a named list is the general
  workspace/configuration platform this slice must not build
- Any relation-type catalogue, inferred edge, similarity or mutual-kNN semantics
- AC13 and the final story DoD

## Pilot boundary (unchanged)

Identifiers remain `projection-local/v1` with `canonical_entity_ids=false` and
are explicitly not canonical entity identifiers; the workspace states this in the
inspector and in the status bar. GBrain remains a derived, rebuildable projection
and never the canonical ATLAS write store. Nothing here makes or supports a claim
about the production Postgres/RLS/VPS architecture.

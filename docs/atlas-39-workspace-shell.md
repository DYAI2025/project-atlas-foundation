# ATLAS-39 — Semantic Atlas Workspace Shell

## What this is

The application shell and design system around the accepted ATLAS-65 graph
path. It replaces the bare pilot page (`viewer/atlas65/index.html`, still
present and unchanged) with a full-screen, graph-centric workspace that renders
the **real** ATLAS Confluence projection: navigator, dominant graph stage,
evidence inspector, status bar.

It does **not** contain the WebGL renderer, the force/cluster engine, the
minimap, saved views or semantic zoom. Those are ATLAS-40.

## One command

```bash
npm ci                # dev dependency for tests only (ajv)
npm run atlas39:serve # -> http://127.0.0.1:4339/
```

This serves the committed, accepted ATLAS-65 evidence — `docs/evidence/atlas-65/`
— through the same validate-then-serve server the pilot uses. **No Confluence
credentials, no GBrain runtime and no pipeline run are required**: the snapshot
and provenance sidecar in that directory are the artifacts the accepted
ATLAS-65 run published, byte for byte.

To point the workspace at a freshly generated local pipeline run instead:

```bash
npm run atlas39:serve -- --dir out/atlas65 --request out/atlas65/read-request.json
```

The server still refuses to start unless the request + snapshot + provenance
triple is complete and the snapshot is accepted by the `gbrain-read/v1` contract
CLI, and it still answers `503` if the snapshot becomes invalid while running.
ATLAS-39 adds no way to bypass that.

## Data shown

| Property | Value in the committed evidence |
|---|---|
| Project | `ATLAS` |
| Confluence root | `14778372` |
| Nodes / edges | 5 / 4 |
| Snapshot sha256 | `12c32883a6ccaeb0455b33715af89d4d8cc5547a255fec3386edcb158980b739` |
| Identifier scheme | `projection-local/v1`, `canonical_entity_ids=false` |

There is no fixture, cached or demo graph anywhere in the viewer. If the
snapshot cannot be loaded, or loads but violates the contract, the workspace
paints a failure state naming the error code and draws no graph.

## Architecture — the ATLAS-40 boundary

```
viewer/atlas39/core/view-model.mjs   snapshot + provenance -> view model   (pure, fail-closed)
viewer/atlas39/core/layout.mjs       view model -> stage geometry          (pure, deterministic)
viewer/atlas39/core/render-svg.mjs   geometry + focus -> SVG markup        <-- ATLAS-40 replaces THIS
viewer/atlas39/core/stage-mount.mjs  markup -> allowlist verdict           (pure, fail-closed)
viewer/atlas39/app.mjs               fetch, mount, events, focus           (no graph logic)
viewer/atlas39/{tokens,stage,shell}.css   design system
```

`core/` is loaded byte-identically by the browser and by `node --test`. ATLAS-40
replaces `render-svg.mjs` alone: the view model, the layout, the navigator, the
inspector, the keyboard model and the whole shell stay as they are.

### Mounting the renderer output

The renderer boundary is a markup *string* — that is what makes the golden SVG a
statement about what the browser actually draws. The shell never hands that
string to `innerHTML`. It crosses two independent barriers:

1. `core/stage-mount.mjs` enumerates every element and attribute the stage
   renderer may emit and **refuses** anything else — a `<script>`, an `on*`
   handler, an `xlink:href`, a comment, an unquoted attribute. Nothing is
   stripped; a violation paints `E_STAGE_MARKUP_REFUSED` and draws no graph.
   Being pure and DOM-free, it is provable under `node --test` without a
   headless browser.
2. `app.mjs` parses the checked markup with `DOMParser` as `image/svg+xml` — an
   inert document that runs no script and fetches nothing — requires the root to
   be an `<svg>` in the SVG namespace, and imports that node with
   `replaceChildren(document.importNode(root, true))`.

Barrier 1 exists because barrier 0 (XML-escaping every data-derived value in
`render-svg.mjs`) is one regression away from being wrong.
`test/atlas39-stage-mount.test.mjs` simulates exactly that regression and shows
the mount refusing it.

The layout is a deterministic radial tree — depth becomes distance from the
centre, each subtree owns an angular sector proportional to its leaf count, and
a child sits radially outward from its parent. It is deliberately **not** a
force simulation: a layout that moves on every reload cannot have a visual
baseline, and the real force/cluster engine belongs to ATLAS-40.

**No runtime or dev dependency was added by this ticket.**

## Design system

`tokens.css` is the only ATLAS-39 stylesheet permitted to contain a colour
literal; `stage.css` and `shell.css` reference tokens exclusively, and
`test/atlas39-shell.test.mjs` enforces both halves of that rule plus the
requirement that every token used is actually defined.

- Low-chroma, single-hued dark palette. One calm teal (`--accent`) means "graph
  relation". One warm gold (`--focus-ring`) is used for keyboard focus and for
  nothing else, so focus is never confused with selection.
- Depth comes from layered surfaces and hairlines, not from saturation or large
  gradients. The stage has one soft radial field and faint depth rings.
- Two motion durations (`--t-fast`, `--t-slow`), one easing curve, and every
  transition is disabled under `prefers-reduced-motion: reduce`.

## Accessibility

- Five named landmarks (`header`, `nav`, `main`, `aside`, `footer`), one `h1`,
  a skip link into the graph stage.
- Each graph node is a `role="button"` with an accessible name carrying its
  hierarchy level and relation count. Decorative rings and edges are
  `aria-hidden`.
- **Roving tabindex**: exactly one node is in the tab order at a time, so a
  large graph never becomes a long tab tunnel.
- Keyboard on the stage: `Enter`/`Space` focus a node, `ArrowLeft`/`Right`/
  `Up`/`Down` traverse nodes in hierarchy order, `Home`/`End` jump to the first
  and last node, `Escape` clears focus. Neighbours are reachable as buttons in
  the inspector and in the navigator.
- A polite live region announces every focus change with the node label, its
  level and its relation count.
- No shell function is mouse-only. Below 1200px the inspector becomes an overlay
  drawer opened by the header toggle (`aria-expanded` / `aria-controls`); it is
  moved off screen, never `display:none`.

## Visual verification

```bash
npm run atlas39:visual   # verify   (also runs inside npm test)
npm run atlas39:golden   # regenerate after an intended visual change
```

`test/golden/*.svg` are real SVG files rendered from the committed real evidence
by the exact modules the browser loads, with the stage tokens inlined — open one
in a browser and you are looking at the stage. Because the renderer is a pure
function of `(snapshot, viewport, focus)`, byte comparison is a genuine visual
regression gate, which is why this ticket adds **no headless-browser
dependency** and requires no CI change.

What the golden gate does **not** cover, and what was checked manually instead
at 1440×900 in Chrome: font rasterisation, painted pixels, and browser layout of
the shell chrome (header, navigator, inspector, status bar, responsive drawer).

## Failure modes

| Condition | Behaviour |
|---|---|
| `/graph-snapshot.json` unreachable or non-2xx | Failure panel, `E_SNAPSHOT_UNAVAILABLE`, no graph drawn |
| Snapshot loads but violates the contract | Failure panel, `E_VIEW_MODEL_INVALID`, no graph drawn |
| `/provenance.json` unavailable | Graph still renders; status bar shows `provenance unavailable`, capture time `unknown`, and each node's inspector states that revision and source URL are not known |
| Provenance present but missing a page | Status `partial`; that node's inspector says so; other nodes keep their real provenance |
| Snapshot invalidated while the server runs | Server answers `503`; the workspace shows the failure panel on reload |
| `--viewer` names a path or a missing directory | Server refuses to start (`E_VIEWER_INVALID` / `E_VIEWER_MISSING`) |
| Any URL outside the viewer asset manifest | `404` — request paths are never joined onto filesystem paths |

## Pilot boundary (unchanged)

Identifiers remain `projection-local/v1` with `canonical_entity_ids=false` and
are explicitly not canonical entity identifiers; the workspace states this in
the inspector and in the status bar. GBrain remains a derived, rebuildable
projection and never the canonical ATLAS write store. Nothing here makes or
supports a claim about the production Postgres/RLS/VPS architecture.

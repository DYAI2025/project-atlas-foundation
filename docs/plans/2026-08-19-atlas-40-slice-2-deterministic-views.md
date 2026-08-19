# ATLAS-40 Slice 2 — Deterministic Views, Saved Views and a Truthful Edge Legend

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the accepted ATLAS-40 WebGL workspace from transient navigation into reusable, deterministic graph views — an Overview mode, a direct-neighbourhood mode, one deterministic saved view with a versioned fail-closed contract, and an Edge Legend derived from the relations actually in the loaded snapshot — while closing the stale `suppressClick` defect in the pointer gesture.

**Architecture:** All new logic goes into four new pure modules under `viewer/atlas39/core/` (`view-state.mjs`, `saved-view.mjs`, `legend.mjs`, `gesture.mjs`), loaded byte-identically by the browser and by `node --test`. `app.mjs` stays wiring only. A "view" is strictly a projection over the already-loaded snapshot: it filters which nodes and edges reach `computeLayout`/`buildScene`, and adds no relationship, no inferred edge, no cluster taxonomy and no relation-type enum. The canonical graph model (`buildViewModel`) is not touched.

**Tech Stack:** Node 22 `node --test`, zero runtime dependencies, WebGL 2/1 via `core/render-webgl.mjs`, Playwright 1.62.1 (headed, scratchpad only — never a repository dependency).

---

## 0. Start state (measured 2026-08-19, before any edit)

| Fact | Value | How it was measured |
| --- | --- | --- |
| `origin/main` | `7b88d4f05f422cdf63e19e62cede57e3188b62ca` | `git rev-parse origin/main` — matches the expected baseline exactly |
| Slice-1 PR | #21 MERGED, head `854f21c0f8a0fde1498bf5c6b4a8cbb0ebfd31f2` | `gh pr list --state all --json ...` |
| Feature branch | `feat/ATLAS-40-slice-2-views-saved-views-edge-legend` @ `7b88d4f0` | `git worktree add -b ... 7b88d4f0` |
| Baseline `npm run check` | **exit 0**, `tests 408 / pass 408 / fail 0`, `VALIDATION PASSED`, **131** validator checks | run in a clean detached worktree at `7b88d4f0` after `npm ci` |
| Baseline `npm run secret-scan` | **exit 0**, `SECRET-SCAN PASSED` (gitleaks 8.30.1, 124 revisions) | same worktree |
| ATLAS-25 / PR #19 | **OPEN**, head `72bb627ea371790d428e1c1aa9f9b2b9ed78c7bd`, updated 2026-08-16 | `gh pr view 19 --json ...` — recorded, not touched |

**Stop condition "Slice 1 already regressed on main" is cleared:** the baseline is green.

`npm ci` is mandatory in any throwaway worktree. Without it two `ajv` suites fail and the total collapses to a smaller number that looks like a regression.

### The real data this slice is measured against

`docs/evidence/atlas-65/graph-snapshot.json` — 5 nodes, 4 edges, and **exactly one distinct edge kind**:

```
parent_of | explicit   ×4
```

So the truthful Edge Legend for the accepted snapshot has **exactly one row**. Anything more is invention. This is the single most important fact in this plan: the legend must be *derived*, and it must be provably capable of showing nothing when there is nothing.

---

## 1. Architecture decisions

Each decision is numbered so the PR body and the review can refer to it.

### D1 — A view is a projection, never a second graph

`applyView(viewModel, view)` returns `{ ok, view, model, scope }` where `model` is the same object shape `computeLayout`, `buildScene` and `selectFocus` already consume, with only `nodes` and `edges` restricted. `depth`, `degree`, `provenance` and `adjacency` keep their **full-graph** values, because those are facts about the node, not about the view — restricting `degree` would make the inspector under-report a page's real relations, which is the same class of lie as drawing an edge that is not there.

Consequence: `computeLayout` and `buildScene` need **zero** changes.

### D2 — Two modes only

| Mode | Contents | Derived from |
| --- | --- | --- |
| `overview` | every node, every edge | nothing — identity |
| `neighbourhood` | one real anchor node + the nodes its explicit edges reach, and every explicit edge whose **both** endpoints are in that set | `viewModel.adjacency`, `viewModel.edges` |

Edges *between two neighbours* are included. They are real explicit edges between two nodes that are on screen; hiding them would also draw a graph the snapshot does not contain.

"Cluster" in AC5 is interpreted strictly as *a UI projection over explicit graph state*. No cluster label, no community detection, no similarity, no kNN.

### D3 — Full-graph search and navigator are preserved; focus can leave a view

`matchNodes(state.viewModel, …)` keeps operating on the **full** view model, so every Slice-1 search assertion stays true and a scoped view can never hide a page from search. If a focus lands on a node the current view does not draw, the view returns to Overview **and says so**. A selection the user cannot see is the same defect as losing the graph.

`stepFocus` (arrow keys) walks the **displayed** node order, so keyboard traversal stays inside the current view instead of repeatedly kicking it back to Overview.

### D4 — One saved-view slot, versioned, fail-closed

Persisted in `localStorage` under `atlas40.saved-view.v1`. One slot, not a named list: a named list is the "general workspace/configuration platform" this slice must not build. Multiple named slots are explicitly deferred.

The contract, version `1`:

```json
{
  "saved_view_version": 1,
  "snapshot": {
    "project_id": "ATLAS",
    "source_id": "14778372",
    "contract_version": "1.0.0",
    "id_scheme": "projection-local/v1",
    "node_count": 5,
    "edge_count": 4
  },
  "view":      { "mode": "neighbourhood", "anchor_id": "ATLAS:confluence:14778372:15171611" },
  "focus_id":  "ATLAS:confluence:14778372:22478849",
  "transform": { "scale": 1.75, "tx": -412, "ty": -88 },
  "viewport":  { "width": 1092, "height": 693 }
}
```

Refusal codes — every one is a **value**, never a thrown error, and never a partial application:

| Code | Cause |
| --- | --- |
| `E_SAVED_VIEW_INVALID` | absent, not JSON, not an object, missing/unusable field |
| `E_SAVED_VIEW_VERSION` | `saved_view_version !== 1` — checked **first**, before any field is read |
| `E_SAVED_VIEW_MODE` | `view.mode` is not a mode this build supports |
| `E_SAVED_VIEW_SNAPSHOT` | any of the six snapshot-identity fields differs from the loaded graph |
| `E_SAVED_VIEW_STALE_NODE` | `anchor_id` or `focus_id` is not a node of the loaded graph |
| `E_SAVED_VIEW_STORAGE` | the browser refused to store or read (private mode, quota) |

`node_count`/`edge_count` are part of the identity **on purpose**: a re-scanned Confluence tree invalidates the saved view rather than restoring it into a graph that has silently changed shape. That trade-off is documented in the runbook.

### D5 — A refused restore is not a stage failure

A refused snapshot tears the renderer down (`showFailure`), because the data cannot be trusted. A refused *saved view* must not: the loaded graph is still real and still drawn. It is refused **loudly and locally** — `body[data-saved-view="refused"]`, an inline reason plus code next to the control, and a live-region announcement ending in "Nothing on the stage was changed." No state is assigned before every check passes, so a refusal cannot leave a half-restored view.

### D6 — The transform restores as a *logical* view, and says when it was re-fitted

`transform` is in world coordinates that depend on the stage size. On restore it is applied and then `clampTransform`-ed to the current world. Mode, anchor and focus reproduce **exactly**; the zoom/position reproduce exactly when the stage is the same size, and are re-fitted otherwise — which the announcement states. `viewport` is persisted purely so that statement can be made truthfully. Claiming pixel-identical restoration across viewport sizes would be an overclaim.

### D7 — The legend is derived from the model on the stage, and admits what it cannot distinguish

`buildEdgeLegend(model)` counts distinct `(relation_type, origin)` pairs of the **displayed** edges, ordered by `relationType` then `origin` in code-unit order (never `localeCompare`, never Map insertion order). `relation_type` and `origin` are echoed exactly as the snapshot spells them, through `textContent`.

The stage draws **every** explicit edge with the same idle stroke (`--line-strong`); the only per-edge variation is the focus highlight. So the legend carries `distinguishesTypes: false` and a note that says so. Inventing a per-type colour would be inventing an encoding, and claiming the colours tell the types apart would be a lie about what is drawn.

Depth/hierarchy stays, in a **separately headed** "Hierarchy" group, derived from the depths actually present, with the swatch bound to the *same token* the renderer strokes the disc with (D8). It is not the Edge Legend and is not labelled as one.

### D8 — One depth→token function, so the swatch cannot drift from the stroke unnoticed

`core/scene.mjs` gains `depthTokenName(depth)` returning `--depth-0|--depth-1|--depth-2|--depth-n|--depth-none`, and `depthColor()` is re-expressed in terms of it. The legend swatch sets `style.borderColor = \`var(${token})\`` behind an allowlist regex.

**Corrected 2026-08-19 (review of Task 1).** The first draft of this decision said legend colour and drawn colour are the same token *by construction*. That is not reachable in this slice and the implementation must not claim it. `core/render-webgl.mjs` `nodeAppearance()` — the code that actually strokes the disc on the GPU — inlines the same ladder as a chain of ternaries, and `core/render-webgl.mjs` is on the must-not-change list in §2, so this slice may not delete that duplicate. `stage.css:70-93` spells the ladder a third time for the golden-SVG path and is likewise must-not-change.

What is true, and what the PR body may cite, is **pinned by test**:

- renderer vs. `depthColor` — `test/atlas40-render-webgl.test.mjs` reads the stroke colour back out of the uploaded vertex buffer and compares it to `depthColor(palette, depth)` for every depth class, so those two cannot diverge without a red test;
- depth vs. token name — `test/atlas40-scene.test.mjs` carries a hand-written expectation table, so a depth cannot be moved onto a different token silently;
- token name vs. colour — the same test re-reads `tokens.css` by the token name `depthTokenName` returned, so `resolvePalette`'s `wanted` map cannot repoint a palette key silently;
- `stage.css` — inlined verbatim into the committed goldens, so an edit moves the golden bytes and trips that gate. That detects the edit; it never compares it to this ladder. "Cannot change unnoticed" is the honest claim for the CSS copy.

Making D8 literally true by construction requires the single-expression change `const depthStroke = depthColor(palette, node.depth)` at `render-webgl.mjs:191-199`, which is a plan amendment to the §2 must-not-change list and is **deferred out of this slice**, not silently carried.

### D9 — The pointer gesture becomes a pure state machine

The defect: after a drag crosses the movement threshold, `endPan` clears `gesture` but leaves `suppressClick === true`. A `pointercancel` delivers no click, so the flag stays armed with nothing to spend it on.

The `pointerdown` handler re-arms `suppressClick = false`, which **masks** the stale flag for any click preceded by a left-button `pointerdown` inside `#stage-host`. It does **not** mask it when that handler early-returns (`event.button !== 0`, or a target inside `.a39-stage-controls`), nor for any click that arrives without a preceding `pointerdown`.

Task 9 must therefore report honestly: the *state* defect is proven by a pure test; whether a **user-visible** swallow reproduces in a real browser is measured, not assumed, and reported either way.

The repair is one branch in `end()`. Getting a real regression test for it requires the state machine to leave `app.mjs` — a `node --test` regex over `wirePointer` can only prove the words are still there, which is exactly what let this defect ship. `core/gesture.mjs` consumes plain `{type, pointerId, button, clientX, clientY}` records and returns what the shell should do.

### D10 — What is *not* built

Minimap · performance/benchmark/LOD/instancing/culling · semantic zoom · edge bundling · inferred edges · mutual-kNN · a relation-type catalogue · named saved-view lists · ATLAS-33/41/42/54 · ATLAS-25/PR #19 · VPS · canonical entity-ID redesign · any new dependency.

**No performance claim is made anywhere in this slice.** DEC-07 values remain unmeasured targets.

---

## 2. Files

**Create**

- `viewer/atlas39/core/view-state.mjs`
- `viewer/atlas39/core/saved-view.mjs`
- `viewer/atlas39/core/legend.mjs`
- `viewer/atlas39/core/gesture.mjs`
- `test/atlas40-view-state.test.mjs`
- `test/atlas40-saved-view.test.mjs`
- `test/atlas40-legend.test.mjs`
- `test/atlas40-gesture.test.mjs`
- `docs/plans/2026-08-19-atlas-40-slice-2-deterministic-views.md` — **this file.** Added to the inventory 2026-08-19 after the Task-1 review. It is the scope contract the PR's scope proof is measured against, so it has to exist in the branch it governs; every plan already in `docs/plans/`, 2026-08-06 through 2026-08-13, is tracked — measured before the Task-1 commit, `git ls-files docs/plans | wc -l` = 11, and 12 with this file — so leaving this one untracked would have been a new convention, not the existing one. It is committed with Task 1, the first commit that cites it.

**Modify**

- `viewer/atlas39/core/scene.mjs` (add `depthTokenName`, re-express `depthColor`)
- `viewer/atlas39/app.mjs`
- `viewer/atlas39/index.html`
- `viewer/atlas39/shell.css`
- `test/atlas39-shell.test.mjs` (`AUTHORED` must list the four new modules)
- `test/atlas40-shell.test.mjs` (pointer assertions move to the gesture module; new wiring assertions)
- `test/atlas40-scene.test.mjs` (token↔colour parity)
- `test/atlas40-render-webgl.test.mjs` (Task 1: pins the ladder the GPU is fed against `depthColor`; added to this inventory 2026-08-19 after the Task-1 review, because the file inventory is the scope contract the PR's scope proof is measured against)
- `scripts/validate-current-repository.mjs`
- `docs/atlas-40-webgl-renderer.md`

**Must not change:** `viewer/atlas39/tokens.css`, `viewer/atlas39/stage.css`, `test/golden/*.svg`, `viewer/atlas39/core/view-model.mjs`, `core/layout.mjs`, `core/render-webgl.mjs`, `core/scene-guard.mjs`, `core/search.mjs`, `core/render-svg.mjs`, `viewer/atlas65/**`, anything under `scripts/atlas65/`, `package.json` dependencies.

Two invariants that constrain the CSS work:

1. `test/atlas39-shell.test.mjs` asserts **shell.css contains no colour literal**. Every new rule uses `var(--token)` only.
2. The golden SVG gate inlines `tokens.css` + `stage.css` only (verified in `scripts/atlas39/render-golden.mjs:45-47`). `shell.css` and `index.html` edits cannot move the golden bytes — but `tokens.css`/`stage.css` edits would, so do not make any.

---

## Task 1: Depth token function (D8)

**Files** — four, not two; corrected 2026-08-19 after the Task-1 review, and anchored by symbol rather than by line, because the pre-change line numbers stop being true the moment Step 3 runs. This list, §2's inventory and Step 5's `git add` all name the same four paths:

- Modify: `viewer/atlas39/core/scene.mjs` — the `depthColor` function and the block immediately above it.
- Test: `test/atlas40-scene.test.mjs` — the new test named `'every depth maps to exactly one design token, and that token is the colour drawn'`, plus the `depthColor` assertions inside `'the palette resolves from tokens.css and fails closed when a token is missing'`.
- Test: `test/atlas40-render-webgl.test.mjs` — the new test named `'the depth ladder the GPU is fed is the one depthColor computes'`. This is the file §2's Modify inventory gained for Task 1; the two lists have to agree, because that inventory is what the PR's scope proof is measured against.
- Create: `docs/plans/2026-08-19-atlas-40-slice-2-deterministic-views.md` — this plan, committed here because Task 1 is the first commit that cites it as its scope contract (see §2).

**Step 1: Write the failing test**

Append to `test/atlas40-scene.test.mjs`, and add `depthTokenName` to the import list at the top of that file:

```js
test('every depth maps to exactly one design token, and that token is the colour drawn', () => {
  const palette = resolvePalette(readToken)
  const byToken = {
    '--depth-0': palette.depth0,
    '--depth-1': palette.depth1,
    '--depth-2': palette.depth2,
    '--depth-n': palette.depthN,
    '--depth-none': palette.depthNone
  }
  const expected = {
    null: '--depth-none', 0: '--depth-0', 1: '--depth-1', 2: '--depth-2',
    3: '--depth-n', 9: '--depth-n', 40: '--depth-n'
  }
  for (const depth of [null, 0, 1, 2, 3, 9, 40]) {
    const token = depthTokenName(depth)
    assert.ok(token in byToken, `depth ${depth} produced unknown token ${token}`)
    assert.equal(token, expected[String(depth)], `depth ${depth} was assigned ${token}`)
    // The legend swatch is painted from the token name and the disc is stroked
    // from the colour. If these two could disagree the legend would be decoration.
    assert.deepEqual(depthColor(palette, depth), byToken[token], `depth ${depth}`)
    assert.deepEqual(
      depthColor(palette, depth),
      parseCssColor(readToken(token)),
      `depth ${depth} is not painted the colour its own token names`
    )
  }
})
```

**Corrected 2026-08-19 (review of Task 1).** The first draft of this step told the implementer to reuse a `TOKEN_FIXTURE` constant. No such constant exists in `test/atlas40-scene.test.mjs` — that file reads the real `tokens.css` inline. Do not go hunting for it. `readToken` is the module-scope reader of the real `tokens.css` at `test/atlas40-scene.test.mjs:55-61`, hoisted there so every palette test in the file resolves from one reader; use it, and do not write a hand-made colour fixture, which could drift from the design system and still pass.

The two assertions the first draft omitted are load-bearing and are shown above:

- `assert.equal(token, expected[...])` — without it, `depthColor(...) === byToken[depthTokenName(...)]` moves on both sides when a depth is reassigned to another token, so the test stays green while the disc is painted the wrong colour.
- `parseCssColor(readToken(token))` — without it, the same is true one link further down: `byToken['--depth-1']` is `palette.depth1`, and which CSS token that key holds is decided by the `wanted` map in `resolvePalette` (its five `depth*` entries — `viewer/atlas39/core/scene.mjs:137-141`, a position this task's edit does not move, since it only touches the block below `depthTokenName`), which both sides of the first assertion also read.

**Step 2: Run test to verify it fails**

```
node --test test/atlas40-scene.test.mjs
```
Expected: FAIL — `SyntaxError` / `depthTokenName is not exported`.

**Step 3: Write minimal implementation**

Replace the existing `depthColor` function in `viewer/atlas39/core/scene.mjs` — locate it by name, it sat at `:159-166` before this task's edit — with:

```js
/**
 * The name of the design token that a node disc at this depth is stroked with.
 * (Docstring shortened here. What ships must NOT claim this is the token "the
 * renderer paints" or that it "mirrors stage.css exactly" — see D8: two
 * hand-maintained copies of this ladder remain, and the honest claim is
 * "cannot drift without a red test" for the renderer and "cannot change
 * unnoticed" for the CSS.)
 */
export function depthTokenName(depth) {
  if (depth === null) return '--depth-none'
  if (depth === 0) return '--depth-0'
  if (depth === 1) return '--depth-1'
  if (depth === 2) return '--depth-2'
  return '--depth-n'
}

/** Hand-written inverse of the `depth*` entries of `resolvePalette`'s `wanted` map. */
const DEPTH_PALETTE_KEY = Object.freeze({
  '--depth-0': 'depth0',
  '--depth-1': 'depth1',
  '--depth-2': 'depth2',
  '--depth-n': 'depthN',
  '--depth-none': 'depthNone'
})

/** The disc stroke for a node, by hierarchy depth. Fails closed on a miss. */
export function depthColor(palette, depth) {
  const token = depthTokenName(depth)
  const key = DEPTH_PALETTE_KEY[token]
  const colour = key === undefined ? undefined : palette?.[key]
  if (!colour) {
    throw new PaletteError(`${E_PALETTE_INVALID}: no palette colour for depth token ${token}`)
  }
  return colour
}
```

**Corrected 2026-08-19 (review of Task 1).** The first draft of this step wrote `return palette[DEPTH_PALETTE_KEY[depthTokenName(depth)]]`, which returns `undefined` — a fail-open — if either table ever loses an entry, in a module whose own `resolvePalette` throws `PaletteError` for exactly this class of breakage 60 lines above. Not reachable through the two tables as they stand, so it was latent rather than live, but it is guarded now and pinned by an `assert.throws` in `'the palette resolves from tokens.css and fails closed when a token is missing'`.

`DEPTH_PALETTE_KEY` remains a hand-written fourth copy of the five depth pairs, in the same file as `resolvePalette`'s `wanted` map. Deriving both from one frozen table would delete the duplicate and the fail-open together; that is **deferred to Task 5/6**, where the legend becomes the first production consumer of `depthColor`, rather than done here — Task 1 has no consumer that would exercise it, and the pairs are pinned by the tokens.css re-read in Step 1's test until then.

**Step 4: Run test to verify it passes**

```
node --test test/atlas40-scene.test.mjs
```
Expected: PASS, and the pre-existing `depthColor` assertions inside `'the palette resolves from tokens.css and fails closed when a token is missing'` still pass. (The first draft cited "lines 220-223"; those four assertions sit at `test/atlas40-scene.test.mjs:226-229` — corrected 2026-08-19 after the Task-1 review. Locate them by the test name, which does not move when lines are inserted above it.)

**Step 5: Commit**

```bash
git add viewer/atlas39/core/scene.mjs \
        test/atlas40-scene.test.mjs \
        test/atlas40-render-webgl.test.mjs \
        docs/plans/2026-08-19-atlas-40-slice-2-deterministic-views.md
git commit -m "ATLAS-40: name the depth design token, and pin the renderer's copy of the ladder"
```

**Corrected 2026-08-19 (review of Task 1).** Two changes to this step. (1) The `git add` listed two files while §2's inventory and the commit itself carry four: `test/atlas40-render-webgl.test.mjs` (the renderer-parity test) and this plan document (see §2 — the scope contract has to be in the branch it governs). (2) The first draft's subject was "...name the depth design token once, so the legend cannot drift from the stroke". That is the overclaim D8 dropped: nothing in Task 1 makes any legend consume `depthTokenName`, and the renderer keeps its own copy of the ladder. The subject above says what the commit does — names the token, and pins the renderer's copy against it.

---

## Task 2: `core/gesture.mjs` — the pointer state machine and the pointercancel repair (D9)

**Files:**
- Create: `viewer/atlas39/core/gesture.mjs`
- Test: `test/atlas40-gesture.test.mjs`

**Step 1: Write the failing test**

Create `test/atlas40-gesture.test.mjs`:

```js
// ATLAS-40 slice 2: the pointer drag state machine.
//
// The defect this file exists for: after a drag crossed the movement threshold,
// a pointercancel left the click suppression armed. A cancelled pointer never
// delivers the click the suppression was waiting for, so the armed flag was
// spent on the NEXT, unrelated click — the user presses something and the
// application ignores them once, with nothing on screen to explain why.
//
// Slice 1 could only assert that app.mjs still contained the string
// "suppressClick = true". That is exactly why this shipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createDragGesture, DRAG_THRESHOLD } from '../viewer/atlas39/core/gesture.mjs'

const down = (over = {}) => ({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 100, clientY: 100, ...over })
const move = (over = {}) => ({ type: 'pointermove', pointerId: 1, clientX: 100, clientY: 100, ...over })
const up = (over = {}) => ({ type: 'pointerup', pointerId: 1, ...over })
const cancel = (over = {}) => ({ type: 'pointercancel', pointerId: 1, ...over })

/** Drags far enough to cross the threshold. Returns the gesture. */
function panned() {
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4, clientY: 100 }))
  assert.equal(step.panning, true, 'the fixture did not actually start a pan')
  assert.equal(step.began, true)
  return g
}

test('a movement below the threshold is a click, not a pan', () => {
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD - 1 }))
  assert.equal(step.panning, false)
  assert.equal(g.isClickSuppressed(), false, 'a click gesture must never suppress its own click')
  g.end(up())
  assert.equal(g.consumeClick(), false)
})

test('a threshold-crossing drag suppresses exactly the click it produced', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true)
  g.end(up())
  assert.equal(g.consumeClick(), true, 'the click that ends a pan must be swallowed')
  // Spent, not sticky: a second click is a real click again.
  assert.equal(g.consumeClick(), false, 'the suppression leaked into a second click')
})

test('REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  const done = g.end(cancel())
  assert.equal(done.ended, true)
  assert.equal(done.wasPanning, true)
  // A cancelled pointer delivers no click, so nothing is left to swallow.
  assert.equal(g.isClickSuppressed(), false, 'pointercancel left the click suppression armed')
  assert.equal(g.consumeClick(), false, 'the next unrelated click was swallowed')
})

test('a cancelled drag below the threshold also leaves nothing armed', () => {
  const g = createDragGesture()
  g.start(down())
  g.move(move({ clientX: 101 }))
  g.end(cancel())
  assert.equal(g.consumeClick(), false)
})

test('the state machine ignores a second, unrelated pointer', () => {
  const g = panned()
  assert.equal(g.move(move({ pointerId: 2, clientX: 900 })).panning, false)
  assert.equal(g.end(up({ pointerId: 2 })).ended, false, 'another pointer ended this gesture')
  assert.equal(g.isPanning(), true, 'the real gesture was cancelled by an unrelated pointer')
})

test('only the primary button starts a gesture', () => {
  const g = createDragGesture()
  assert.equal(g.start(down({ button: 2 })), false)
  assert.equal(g.move(move({ clientX: 400 })).panning, false)
})

test('a fresh press always disarms, whatever the previous gesture left behind', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true)
  g.end(up())
  g.start(down({ pointerId: 7 }))
  assert.equal(g.isClickSuppressed(), false)
})

test('end() reports the pointer id so the shell releases the capture it took', () => {
  const g = panned()
  const done = g.end(up())
  assert.equal(done.pointerId, 1)
  assert.equal(done.wasPanning, true)
})

test('the gesture carries no clock, randomness or DOM', () => {
  const source = readFileSync(new URL('../viewer/atlas39/core/gesture.mjs', import.meta.url), 'utf8')
  for (const forbidden of ['Date.', 'Math.random', 'document', 'window', 'requestAnimationFrame']) {
    assert.equal(source.includes(forbidden), false, `gesture.mjs references ${forbidden}`)
  }
})
```

Add `import { readFileSync } from 'node:fs'` at the top for the last test.

**Step 2: Run test to verify it fails**

```
node --test test/atlas40-gesture.test.mjs
```
Expected: FAIL — `Cannot find module .../core/gesture.mjs`.

**Step 3: Write minimal implementation**

Create `viewer/atlas39/core/gesture.mjs`:

```js
// ATLAS-40 core / slice 2: the pointer drag state machine.
//
// Slice 1 kept this state inside wirePointer() in app.mjs, where `node --test`
// could only assert that the source still contained the right words. That was
// enough to stop the wiring being deleted and not enough to notice it was
// wrong: after a pan crossed the movement threshold, a `pointercancel` — a
// touch the browser takes over, a window losing the pointer, a device
// disconnecting — left the click suppression armed. A cancelled pointer never
// delivers the click that suppression was waiting for, so the flag stayed
// armed with nothing to spend it on.
//
// A swallowed click is the worst kind of interaction defect: nothing is drawn
// wrong, nothing errors, the application simply ignores the user once. So the
// state machine lives here, where the defect is a test rather than a comment.
//
// This module knows nothing about the DOM. It consumes plain records
// {type, pointerId, button, clientX, clientY} and returns what the shell should
// do about them.
//
// Pure: no IO, no clock, no randomness, no DOM.

/** Screen pixels of movement that turn a press into a pan instead of a click. */
export const DRAG_THRESHOLD = 4

/**
 * @param {{threshold?: number}} [options]
 * @returns {{start:Function, move:Function, end:Function,
 *            isClickSuppressed:Function, consumeClick:Function, isPanning:Function}}
 */
export function createDragGesture({ threshold = DRAG_THRESHOLD } = {}) {
  let active = null
  let suppressClick = false

  return {
    /** @returns {boolean} true when a gesture actually started */
    start(event) {
      if (event.button !== 0) return false
      // A fresh press always disarms: whatever a previous gesture left behind,
      // the click that belongs to THIS press must be allowed through.
      suppressClick = false
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false }
      return true
    },

    /**
     * @returns {{panning:boolean, began:boolean, dx:number, dy:number}}
     *   `began` is true only on the step that crossed the threshold, so the
     *   shell takes the pointer capture exactly once.
     */
    move(event) {
      const idle = { panning: false, began: false, dx: 0, dy: 0 }
      if (!active || event.pointerId !== active.id) return idle
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      let began = false
      if (!active.panning) {
        if (Math.hypot(dx, dy) < threshold) return idle
        active.panning = true
        began = true
        // Above the threshold this gesture is a pan, so the click the browser
        // synthesises at pointerup is not a selection and must not act like one.
        suppressClick = true
      }
      active.x = event.clientX
      active.y = event.clientY
      return { panning: true, began, dx, dy }
    },

    /** @returns {{ended:boolean, wasPanning:boolean, pointerId:(number|null)}} */
    end(event) {
      if (!active || event.pointerId !== active.id) {
        return { ended: false, wasPanning: false, pointerId: null }
      }
      const wasPanning = active.panning
      const pointerId = active.id
      // THE REPAIR. A cancelled pointer never delivers the click the
      // suppression was armed for. Leaving it armed spends it on the next,
      // unrelated click instead.
      if (event.type === 'pointercancel') suppressClick = false
      active = null
      return { ended: true, wasPanning, pointerId }
    },

    /** True when the next click is the tail of a pan and must be swallowed. */
    isClickSuppressed() {
      return suppressClick
    },

    /**
     * Swallows at most one click. Returns true when the caller should stop it.
     * The suppression is spent either way, so it can never reach a second click.
     */
    consumeClick() {
      if (!suppressClick) return false
      suppressClick = false
      return true
    },

    /** True while a pan is in progress. */
    isPanning() {
      return active?.panning === true
    }
  }
}
```

**Step 4: Run test to verify it passes**

```
node --test test/atlas40-gesture.test.mjs
```
Expected: PASS, 9/9.

**Step 5: Counterexample proof (do not commit the mutation)**

Prove the regression test actually holds the repair:

```bash
# revert only the repair line
perl -0pi -e "s/      if \(event\.type === 'pointercancel'\) suppressClick = false\n//" viewer/atlas39/core/gesture.mjs
node --test test/atlas40-gesture.test.mjs; echo "MUTANT EXIT=$?"
git checkout -- viewer/atlas39/core/gesture.mjs
node --test test/atlas40-gesture.test.mjs; echo "RESTORED EXIT=$?"
```

Expected: `MUTANT EXIT=1` with the failing test named
`REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click`,
then `RESTORED EXIT=0`. **Record both exit codes and the failing test name verbatim in the PR evidence.** Confirm the file is clean afterwards with `git diff --stat viewer/atlas39/core/gesture.mjs` (expected: empty).

**Step 6: Commit**

```bash
git add viewer/atlas39/core/gesture.mjs test/atlas40-gesture.test.mjs
git commit -m "ATLAS-40: make the pointer drag a pure state machine and stop pointercancel arming a stale click suppression"
```

---

## Task 3: `core/view-state.mjs` — the deterministic view model (D1, D2)

**Files:**
- Create: `viewer/atlas39/core/view-state.mjs`
- Test: `test/atlas40-view-state.test.mjs`

**Step 1: Write the failing test**

Create `test/atlas40-view-state.test.mjs`:

```js
// ATLAS-40 slice 2: views as projections over the real accepted snapshot.
//
// Everything here runs against docs/evidence/atlas-65/graph-snapshot.json — the
// same five real Confluence pages and four real parent_of edges the browser
// loads. A view that cannot be checked against the real graph is a view that
// can quietly invent one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import {
  VIEW_MODES,
  DEFAULT_VIEW,
  normalizeView,
  applyView,
  isInView,
  viewCaption,
  E_VIEW_MODE,
  E_VIEW_ANCHOR
} from '../viewer/atlas39/core/view-state.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
const vm = buildViewModel(snapshot, provenance)

const ROOT = 'ATLAS:confluence:14778372:14778372'
const DELIVERY = 'ATLAS:confluence:14778372:15171611'
const SPRINT = 'ATLAS:confluence:14778372:22478849'
const ARCH = 'ATLAS:confluence:14778372:15073290'

test('the mode list is exactly what this build supports', () => {
  assert.deepEqual([...VIEW_MODES], ['overview', 'neighbourhood'])
  assert.deepEqual({ ...DEFAULT_VIEW }, { mode: 'overview', anchorId: null })
})

test('overview draws the whole real graph', () => {
  const applied = applyView(vm, DEFAULT_VIEW)
  assert.equal(applied.ok, true)
  assert.equal(applied.model.nodes.length, 5)
  assert.equal(applied.model.edges.length, 4)
  assert.equal(applied.scope.complete, true)
  assert.equal(viewCaption(applied.scope), 'Overview — 5 of 5 nodes, 4 of 4 relations.')
})

test('a neighbourhood is the anchor plus the nodes its explicit edges reach', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(applied.ok, true)
  // 14 – Delivery Model has one parent (the root) and one child (Sprint 2).
  assert.deepEqual(applied.model.nodes.map((n) => n.node_id).sort(), [ROOT, DELIVERY, SPRINT].sort())
  assert.deepEqual(
    applied.model.edges.map((e) => e.edge_id).sort(),
    [
      'ATLAS:confluence:14778372:parent_of:14778372:15171611',
      'ATLAS:confluence:14778372:parent_of:15171611:22478849'
    ].sort()
  )
  assert.equal(applied.scope.shownNodes, 3)
  assert.equal(applied.scope.totalNodes, 5)
  assert.equal(applied.scope.complete, false)
})

test('a neighbourhood keeps an edge between two neighbours, because that edge is real', () => {
  // The root has three real children; anchoring on it must not drop the
  // root->delivery->sprint chain's first hop, and must not add the second.
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: ROOT })
  const ids = new Set(applied.model.nodes.map((n) => n.node_id))
  assert.equal(ids.has(SPRINT), false, 'a grandchild is not a direct neighbour')
  for (const edge of applied.model.edges) {
    assert.equal(ids.has(edge.from) && ids.has(edge.to), true, `${edge.edge_id} has an endpoint off view`)
  }
})

test('a leaf neighbourhood is the leaf and its parent, never an empty stage', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.deepEqual(applied.model.nodes.map((n) => n.node_id).sort(), [DELIVERY, SPRINT].sort())
  assert.equal(applied.model.edges.length, 1)
})

test('a view never invents, drops or renames a node fact', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: ARCH })
  for (const node of applied.model.nodes) {
    const real = vm.nodes.find((n) => n.node_id === node.node_id)
    // depth, degree and provenance are facts about the page, not about the view.
    assert.deepEqual(node, real, `${node.node_id} was rewritten by the view`)
  }
  // The full-graph adjacency survives, so the inspector still reports the real
  // number of relations rather than the number that happens to be on screen.
  assert.equal(applied.model.adjacency, vm.adjacency)
  assert.deepEqual(applied.model.counts, vm.counts)
})

test('applying the same view twice produces the same view, node for node and edge for edge', () => {
  for (const view of [DEFAULT_VIEW, { mode: 'neighbourhood', anchorId: DELIVERY }]) {
    const a = applyView(vm, view)
    const b = applyView(vm, view)
    assert.deepEqual(a.model.nodes.map((n) => n.node_id), b.model.nodes.map((n) => n.node_id))
    assert.deepEqual(a.model.edges.map((e) => e.edge_id), b.model.edges.map((e) => e.edge_id))
    assert.deepEqual(a.scope, b.scope)
  }
})

test('view order follows the view model, not insertion or identifier accident', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: DELIVERY })
  const full = vm.nodes.map((n) => n.node_id)
  const shown = applied.model.nodes.map((n) => n.node_id)
  assert.deepEqual(shown, full.filter((id) => shown.includes(id)), 'the view reordered the graph')
})

test('an unknown mode is refused, never coerced into overview', () => {
  for (const mode of ['cluster', 'Overview', '', null, 42, undefined]) {
    const result = applyView(vm, { mode, anchorId: null })
    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} was accepted`)
    assert.equal(result.code, E_VIEW_MODE)
    assert.equal('model' in result, false, 'a refused view still produced a model')
  }
})

test('a neighbourhood with no anchor, or an unknown anchor, is refused and retargets nothing', () => {
  assert.equal(applyView(vm, { mode: 'neighbourhood', anchorId: null }).code, E_VIEW_ANCHOR)
  assert.equal(applyView(vm, { mode: 'neighbourhood', anchorId: '' }).code, E_VIEW_ANCHOR)
  const stale = applyView(vm, { mode: 'neighbourhood', anchorId: `${DELIVERY}X` })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, E_VIEW_ANCHOR)
  // The refusal must not hand back a "closest" node instead.
  assert.equal(JSON.stringify(stale).includes(DELIVERY) && !JSON.stringify(stale).includes(`${DELIVERY}X`), false)
})

test('isInView answers for the drawn set only, and never for an unknown id', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.equal(isInView(applied, SPRINT), true)
  assert.equal(isInView(applied, DELIVERY), true)
  assert.equal(isInView(applied, ARCH), false)
  assert.equal(isInView(applied, 'not-a-node'), false)
})

test('the caption counts what is drawn and what exists, and nothing else', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.equal(viewCaption(applied.scope), 'Direct neighbourhood — 2 of 5 nodes, 1 of 4 relations.')
  assert.equal(
    viewCaption(applied.scope, '14 – Delivery Model, Program Increment and Sprint Plan'),
    'Direct neighbourhood of “14 – Delivery Model, Program Increment and Sprint Plan” — 2 of 5 nodes, 1 of 4 relations.'
  )
})

test('the module carries no clock, randomness or DOM', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/view-state.mjs'), 'utf8')
  for (const forbidden of ['Date.', 'Math.random', 'document', 'window', 'localStorage', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `view-state.mjs references ${forbidden}`)
  }
})
```

**Step 2: Run test to verify it fails**

```
node --test test/atlas40-view-state.test.mjs
```
Expected: FAIL — `Cannot find module .../core/view-state.mjs`.

**Step 3: Write minimal implementation**

Create `viewer/atlas39/core/view-state.mjs`:

```js
// ATLAS-40 core / slice 2: which part of the real graph is on the stage.
//
// A "view" here is strictly a PROJECTION over the snapshot that is already
// loaded. It adds no relationship, infers nothing, names no cluster and knows
// no taxonomy: the canonical relation-type catalogue is still an open ATLAS
// question, and a viewer that invented one would be putting a decision on
// screen that nobody has made.
//
// Two modes, both derived from data that is literally in the snapshot:
//
//   overview       every node and every edge of the loaded graph
//   neighbourhood  one real node, plus the nodes its EXPLICIT edges reach, plus
//                  every explicit edge whose BOTH endpoints are in that set
//
// The projected model keeps the node facts of the full graph — depth, degree,
// provenance and the adjacency the inspector reads — because those are facts
// about the page, not about the view. Restricting them would make the inspector
// under-report a page's real relations, which is the same class of lie as
// drawing an edge that is not there.
//
// Pure: no IO, no clock, no randomness, no DOM.

export const VIEW_MODES = Object.freeze(['overview', 'neighbourhood'])
export const DEFAULT_VIEW = Object.freeze({ mode: 'overview', anchorId: null })

export const E_VIEW_MODE = 'E_VIEW_MODE'
export const E_VIEW_ANCHOR = 'E_VIEW_ANCHOR'

const refusal = (code, reason) => ({ ok: false, code, reason })

/**
 * Validates a view descriptor against the modes this build supports, without
 * looking at any graph. An unknown mode is refused, never coerced to overview:
 * a view from another build must not come back as a different view that happens
 * to render.
 *
 * @returns {{ok:true, view:{mode:string, anchorId:(string|null)}}|{ok:false, code:string, reason:string}}
 */
export function normalizeView(view) {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) {
    return refusal(E_VIEW_MODE, 'view is not an object')
  }
  if (!VIEW_MODES.includes(view.mode)) {
    return refusal(E_VIEW_MODE, `unsupported view mode ${JSON.stringify(view.mode)}`)
  }
  if (view.mode === 'overview') return { ok: true, view: { mode: 'overview', anchorId: null } }
  if (typeof view.anchorId !== 'string' || view.anchorId.length === 0) {
    return refusal(E_VIEW_ANCHOR, 'a neighbourhood view has no anchor node')
  }
  return { ok: true, view: { mode: 'neighbourhood', anchorId: view.anchorId } }
}

function scopeOf(view, viewModel, nodes, edges) {
  return {
    mode: view.mode,
    anchorId: view.anchorId,
    shownNodes: nodes.length,
    totalNodes: viewModel.nodes.length,
    shownEdges: edges.length,
    totalEdges: viewModel.edges.length,
    complete: nodes.length === viewModel.nodes.length && edges.length === viewModel.edges.length
  }
}

/**
 * @param {object} viewModel from buildViewModel()
 * @param {{mode:string, anchorId:(string|null)}} view
 * @returns {{ok:true, view:object, model:object, scope:object}
 *          |{ok:false, code:string, reason:string}}
 */
export function applyView(viewModel, view) {
  const normalized = normalizeView(view)
  if (!normalized.ok) return normalized
  const resolved = normalized.view

  if (resolved.mode === 'overview') {
    return {
      ok: true,
      view: resolved,
      model: viewModel,
      scope: scopeOf(resolved, viewModel, viewModel.nodes, viewModel.edges)
    }
  }

  if (!viewModel.adjacency.has(resolved.anchorId)) {
    // Refused, never silently retargeted. An anchor the graph does not contain
    // must not become "the closest node we do have" — the user would believe
    // they are looking at the thing they asked for.
    return refusal(E_VIEW_ANCHOR, `the anchor node ${JSON.stringify(resolved.anchorId)} is not in this graph`)
  }

  const inView = new Set([resolved.anchorId, ...viewModel.adjacency.get(resolved.anchorId)])
  // View-model order is preserved by construction: filter never reorders.
  const nodes = viewModel.nodes.filter((node) => inView.has(node.node_id))
  // Every explicit edge whose BOTH endpoints are shown — including an edge
  // between two neighbours. That edge is real and both of its ends are on
  // screen; hiding it would draw a graph the snapshot does not contain either.
  const edges = viewModel.edges.filter((edge) => inView.has(edge.from) && inView.has(edge.to))

  return {
    ok: true,
    view: resolved,
    model: { ...viewModel, nodes, edges },
    scope: scopeOf(resolved, viewModel, nodes, edges)
  }
}

/** True when this view actually draws the node. An unknown id is never in view. */
export function isInView(applied, nodeId) {
  return applied.model.nodes.some((node) => node.node_id === nodeId)
}

/**
 * The sentence the shell shows and announces. It counts what is drawn against
 * what exists, so a scoped view can never read as "this is the whole graph".
 */
export function viewCaption(scope, anchorLabel = null) {
  const nodes = `${scope.shownNodes} of ${scope.totalNodes} ${scope.totalNodes === 1 ? 'node' : 'nodes'}`
  const edges = `${scope.shownEdges} of ${scope.totalEdges} ${scope.totalEdges === 1 ? 'relation' : 'relations'}`
  if (scope.mode === 'overview') return `Overview — ${nodes}, ${edges}.`
  const of = typeof anchorLabel === 'string' && anchorLabel.length > 0 ? ` of “${anchorLabel}”` : ''
  return `Direct neighbourhood${of} — ${nodes}, ${edges}.`
}
```

**Step 4: Run test to verify it passes**

```
node --test test/atlas40-view-state.test.mjs
```
Expected: PASS, 13/13.

**Step 5: Commit**

```bash
git add viewer/atlas39/core/view-state.mjs test/atlas40-view-state.test.mjs
git commit -m "ATLAS-40: deterministic view state as a pure projection over the loaded snapshot"
```

---

## Task 4: `core/saved-view.mjs` — the versioned saved-view contract (D4, D5, D6)

**Files:**
- Create: `viewer/atlas39/core/saved-view.mjs`
- Test: `test/atlas40-saved-view.test.mjs`

**Step 1: Write the failing test**

Create `test/atlas40-saved-view.test.mjs`:

```js
// ATLAS-40 slice 2: saving and restoring a view without lying about it.
//
// The whole point of this module is what it REFUSES. A saved view that is
// restored into a graph it was not captured against, or onto a node that no
// longer exists, would look exactly like a successful restore — the stage would
// draw something plausible and the user would believe it is what they saved.
// So every mismatch is a coded refusal that changes nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import {
  SAVED_VIEW_VERSION,
  captureSavedView,
  serializeSavedView,
  parseSavedView,
  restoreSavedView,
  E_SAVED_VIEW_INVALID,
  E_SAVED_VIEW_VERSION,
  E_SAVED_VIEW_MODE,
  E_SAVED_VIEW_SNAPSHOT,
  E_SAVED_VIEW_STALE_NODE
} from '../viewer/atlas39/core/saved-view.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
const vm = buildViewModel(snapshot, provenance)

const DELIVERY = 'ATLAS:confluence:14778372:15171611'
const SPRINT = 'ATLAS:confluence:14778372:22478849'
const VIEWPORT = { width: 1092, height: 693 }

const sample = () =>
  captureSavedView({
    viewModel: vm,
    view: { mode: 'neighbourhood', anchorId: DELIVERY },
    focusId: SPRINT,
    transform: { scale: 1.75, tx: -412, ty: -88 },
    viewport: VIEWPORT
  })

test('the contract version is pinned and carried in every saved view', () => {
  assert.equal(SAVED_VIEW_VERSION, 1)
  assert.equal(sample().saved_view_version, 1)
})

test('a saved view carries UI state and identity only — never the graph', () => {
  const saved = sample()
  assert.deepEqual(Object.keys(saved).sort(), ['focus_id', 'saved_view_version', 'snapshot', 'transform', 'view', 'viewport'])
  const text = serializeSavedView(saved)
  // No node label, no page title, no edge, no provenance may be persisted: the
  // graph always comes from the snapshot the workspace loaded.
  for (const node of vm.nodes) assert.equal(text.includes(node.label), false, `${node.label} was persisted`)
  for (const edge of vm.edges) assert.equal(text.includes(edge.edge_id), false, `${edge.edge_id} was persisted`)
  assert.equal(text.includes('provenance'), false)
})

test('serialising is byte-stable, so the same view always stores the same bytes', () => {
  assert.equal(serializeSavedView(sample()), serializeSavedView(sample()))
  // Key order must not depend on how the object was assembled.
  const reordered = JSON.parse(JSON.stringify(sample()))
  assert.equal(serializeSavedView(reordered), serializeSavedView(sample()))
})

test('roundtrip: capture -> serialise -> parse -> restore reproduces the view exactly', () => {
  const parsed = parseSavedView(serializeSavedView(sample()))
  assert.equal(parsed.ok, true, parsed.reason)
  const bound = restoreSavedView(vm, parsed.value, VIEWPORT)
  assert.equal(bound.ok, true, bound.reason)
  assert.deepEqual(bound.view, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(bound.focusId, SPRINT)
  assert.deepEqual(bound.transform, { scale: 1.75, tx: -412, ty: -88 })
  assert.equal(bound.viewportChanged, false)
})

test('restoring the same saved view repeatedly gives the identical result every time', () => {
  const text = serializeSavedView(sample())
  const first = restoreSavedView(vm, parseSavedView(text).value, VIEWPORT)
  for (let i = 0; i < 5; i += 1) {
    const again = restoreSavedView(vm, parseSavedView(text).value, VIEWPORT)
    assert.deepEqual(again, first, `restore ${i} differed`)
  }
})

test('a different stage size restores the same logical view and admits the re-fit', () => {
  const bound = restoreSavedView(vm, parseSavedView(serializeSavedView(sample())).value, { width: 1440, height: 900 })
  assert.equal(bound.ok, true)
  assert.deepEqual(bound.view, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(bound.focusId, SPRINT)
  // The transform is handed back unchanged; the shell clamps it to the world it
  // actually has. What must not happen is a silent claim that nothing changed.
  assert.equal(bound.viewportChanged, true)
})

test('an overview saved view needs no anchor and restores to overview', () => {
  const saved = captureSavedView({
    viewModel: vm,
    view: { mode: 'overview', anchorId: null },
    focusId: null,
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  })
  const bound = restoreSavedView(vm, parseSavedView(serializeSavedView(saved)).value, VIEWPORT)
  assert.equal(bound.ok, true)
  assert.deepEqual(bound.view, { mode: 'overview', anchorId: null })
  assert.equal(bound.focusId, null)
})

test('nothing stored, empty storage or non-JSON is a refusal, not a crash', () => {
  for (const text of [null, undefined, '', '   ', '{', 'not json', '[]', '"a string"', '7']) {
    const result = parseSavedView(text)
    assert.equal(result.ok, false, `${JSON.stringify(text)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID)
    assert.equal('value' in result, false)
  }
})

test('an unsupported version is refused before any field is interpreted', () => {
  for (const version of [0, 2, 99, '1', null, undefined]) {
    const raw = { ...sample(), saved_view_version: version }
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false, `version ${JSON.stringify(version)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_VERSION)
  }
})

test('an unsupported view mode is refused explicitly, never downgraded to overview', () => {
  const raw = sample()
  for (const mode of ['cluster', 'timeline', 'minimap', '', null]) {
    const result = parseSavedView(JSON.stringify({ ...raw, view: { mode, anchor_id: DELIVERY } }))
    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_MODE)
    assert.equal(JSON.stringify(result).includes('overview'), false, 'the refusal fell back to overview')
  }
})

test('a malformed shape is refused field by field', () => {
  const base = sample()
  const mutations = [
    ['snapshot', undefined],
    ['snapshot', { ...base.snapshot, project_id: 42 }],
    ['snapshot', { ...base.snapshot, node_count: '5' }],
    ['view', undefined],
    ['focus_id', 42],
    ['transform', { scale: 0, tx: 0, ty: 0 }],
    ['transform', { scale: Number.NaN, tx: 0, ty: 0 }],
    ['transform', { scale: 1, tx: 'left', ty: 0 }],
    ['transform', undefined],
    ['viewport', { width: 0, height: 693 }],
    ['viewport', undefined]
  ]
  for (const [key, value] of mutations) {
    const raw = { ...base, [key]: value }
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false, `${key}=${JSON.stringify(value)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `${key}: ${result.code}`)
  }
})

test('a saved view from a different graph is refused, per identity field', () => {
  const parsed = parseSavedView(serializeSavedView(sample())).value
  const fields = {
    project_id: 'OTHER',
    source_id: '99999999',
    contract_version: '2.0.0',
    id_scheme: 'canonical/v1',
    node_count: 6,
    edge_count: 3
  }
  for (const [key, value] of Object.entries(fields)) {
    const drifted = { ...parsed, snapshot: { ...parsed.snapshot, [key]: value } }
    const result = restoreSavedView(vm, drifted, VIEWPORT)
    assert.equal(result.ok, false, `${key} drift was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_SNAPSHOT)
    assert.match(result.reason, new RegExp(key))
  }
})

test('COUNTEREXAMPLE: a stale node id is refused and is never mapped onto another node', () => {
  const parsed = parseSavedView(serializeSavedView(sample())).value

  const staleAnchor = { ...parsed, view: { mode: 'neighbourhood', anchorId: `${DELIVERY}-deleted` } }
  const anchorResult = restoreSavedView(vm, staleAnchor, VIEWPORT)
  assert.equal(anchorResult.ok, false)
  assert.equal(anchorResult.code, E_SAVED_VIEW_STALE_NODE)

  const staleFocus = { ...parsed, focusId: 'ATLAS:confluence:14778372:00000000' }
  const focusResult = restoreSavedView(vm, staleFocus, VIEWPORT)
  assert.equal(focusResult.ok, false)
  assert.equal(focusResult.code, E_SAVED_VIEW_STALE_NODE)

  // The decisive property: a refusal must carry NO usable node of this graph.
  // If it did, the shell could restore "something close" and look successful.
  for (const result of [anchorResult, focusResult]) {
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
    for (const node of vm.nodes) {
      assert.equal(
        JSON.stringify(result).includes(`"${node.node_id}"`),
        false,
        `the refusal offered ${node.node_id} as a substitute`
      )
    }
  }
})

test('the module carries no storage, clock, randomness or DOM', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/saved-view.mjs'), 'utf8')
  for (const forbidden of ['localStorage', 'sessionStorage', 'Date.', 'Math.random', 'document', 'window', 'fetch(']) {
    assert.equal(source.includes(forbidden), false, `saved-view.mjs references ${forbidden}`)
  }
})
```

**Step 2: Run test to verify it fails**

```
node --test test/atlas40-saved-view.test.mjs
```
Expected: FAIL — `Cannot find module .../core/saved-view.mjs`.

**Step 3: Write minimal implementation**

Create `viewer/atlas39/core/saved-view.mjs`:

```js
// ATLAS-40 core / slice 2: the saved-view contract.
//
// A saved view is a small, explicitly versioned record of UI state — which
// view, anchored where, focused on what, at which transform, captured at which
// stage size. It carries NO graph: the graph always comes from the snapshot the
// workspace loaded, so restoring can never resurrect a stale copy of the data.
//
// Restoring is fail-closed in a specific way. A saved view that does not fit the
// loaded snapshot is REFUSED with a code and a reason. It is never adapted,
// never partially applied, and never mapped onto whichever node happens to be
// nearest. A silently retargeted view is worse than no saved view at all,
// because the user would believe they are looking at the thing they saved.
//
// The refusal is a value, not a thrown error, and it does NOT tear the stage
// down: the loaded graph is still real and still drawn. That is the difference
// between "this snapshot cannot be trusted" — a stage failure — and "this saved
// view does not apply here".
//
// Pure: no IO, no clock, no randomness, no DOM, no storage. The shell owns the
// storage, because storage can fail and a pure module has nowhere to say so.

import { normalizeView, E_VIEW_MODE } from './view-state.mjs'

export const SAVED_VIEW_VERSION = 1

export const E_SAVED_VIEW_INVALID = 'E_SAVED_VIEW_INVALID'
export const E_SAVED_VIEW_VERSION = 'E_SAVED_VIEW_VERSION'
export const E_SAVED_VIEW_MODE = 'E_SAVED_VIEW_MODE'
export const E_SAVED_VIEW_SNAPSHOT = 'E_SAVED_VIEW_SNAPSHOT'
export const E_SAVED_VIEW_STALE_NODE = 'E_SAVED_VIEW_STALE_NODE'
/** Raised by the shell, not here: storage is the one part this module cannot own. */
export const E_SAVED_VIEW_STORAGE = 'E_SAVED_VIEW_STORAGE'

/** The identity fields a saved view must match to be restorable. */
export const IDENTITY_FIELDS = Object.freeze([
  'project_id',
  'source_id',
  'contract_version',
  'id_scheme',
  'node_count',
  'edge_count'
])

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.length > 0
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const refusal = (code, reason) => ({ ok: false, code, reason })

function snapshotIdentity(viewModel) {
  return {
    project_id: viewModel.project_id,
    source_id: viewModel.source.source_id,
    contract_version: viewModel.contract_version,
    id_scheme: viewModel.id_scheme,
    node_count: viewModel.counts.nodes,
    edge_count: viewModel.counts.edges
  }
}

/**
 * @returns {object} the saved-view record, ready to serialise
 */
export function captureSavedView({ viewModel, view, focusId, transform, viewport }) {
  return {
    saved_view_version: SAVED_VIEW_VERSION,
    snapshot: snapshotIdentity(viewModel),
    view: { mode: view.mode, anchor_id: view.anchorId ?? null },
    focus_id: typeof focusId === 'string' ? focusId : null,
    transform: { scale: transform.scale, tx: transform.tx, ty: transform.ty },
    viewport: { width: viewport.width, height: viewport.height }
  }
}

// A replacer array both fixes key order and drops anything not in the contract,
// so the stored bytes are a function of the view alone.
const KEY_ORDER = [
  'saved_view_version',
  'snapshot', ...IDENTITY_FIELDS,
  'view', 'mode', 'anchor_id',
  'focus_id',
  'transform', 'scale', 'tx', 'ty',
  'viewport', 'width', 'height'
]

/** Byte-stable serialisation. The same view always stores the same string. */
export function serializeSavedView(saved) {
  return JSON.stringify(saved, KEY_ORDER)
}

/**
 * @param {string|null|undefined} text whatever storage handed back
 * @returns {{ok:true, value:object}|{ok:false, code:string, reason:string}}
 */
export function parseSavedView(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return refusal(E_SAVED_VIEW_INVALID, 'no saved view is stored')
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return refusal(E_SAVED_VIEW_INVALID, `the saved view is not valid JSON: ${error.message}`)
  }
  return validateSavedView(raw)
}

/** @returns {{ok:true, value:object}|{ok:false, code:string, reason:string}} */
export function validateSavedView(raw) {
  if (!isObject(raw)) return refusal(E_SAVED_VIEW_INVALID, 'the saved view is not an object')

  // Version first. An unsupported version must not be read field by field and
  // partially understood — that is how a future field silently becomes a
  // different view in an older build.
  if (raw.saved_view_version !== SAVED_VIEW_VERSION) {
    return refusal(
      E_SAVED_VIEW_VERSION,
      `unsupported saved view version ${JSON.stringify(raw.saved_view_version)}; this workspace reads version ${SAVED_VIEW_VERSION}`
    )
  }

  const snapshot = raw.snapshot
  if (
    !isObject(snapshot) ||
    !isText(snapshot.project_id) ||
    !isText(snapshot.source_id) ||
    !isText(snapshot.contract_version) ||
    !isText(snapshot.id_scheme) ||
    !Number.isInteger(snapshot.node_count) ||
    !Number.isInteger(snapshot.edge_count)
  ) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved view carries no usable snapshot identity')
  }

  if (!isObject(raw.view)) return refusal(E_SAVED_VIEW_INVALID, 'the saved view carries no view')
  const view = normalizeView({ mode: raw.view.mode, anchorId: raw.view.anchor_id ?? null })
  if (!view.ok) {
    return refusal(view.code === E_VIEW_MODE ? E_SAVED_VIEW_MODE : E_SAVED_VIEW_INVALID, view.reason)
  }

  if (raw.focus_id !== null && !isText(raw.focus_id)) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved focus is not a node id')
  }

  const t = raw.transform
  if (!isObject(t) || !isFiniteNumber(t.scale) || t.scale <= 0 || !isFiniteNumber(t.tx) || !isFiniteNumber(t.ty)) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved transform is not a usable transform')
  }

  const v = raw.viewport
  if (!isObject(v) || !isFiniteNumber(v.width) || v.width <= 0 || !isFiniteNumber(v.height) || v.height <= 0) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved stage size is not a usable size')
  }

  const identity = {}
  for (const key of IDENTITY_FIELDS) identity[key] = snapshot[key]

  return {
    ok: true,
    value: {
      saved_view_version: raw.saved_view_version,
      snapshot: identity,
      view: view.view,
      focusId: raw.focus_id ?? null,
      transform: { scale: t.scale, tx: t.tx, ty: t.ty },
      viewport: { width: v.width, height: v.height }
    }
  }
}

/**
 * Binds a validated saved view to the graph that is actually loaded.
 *
 * @param {object} viewModel from buildViewModel()
 * @param {object} parsed the `value` of a successful parseSavedView()
 * @param {{width:number,height:number}} viewport the stage size right now
 * @returns {{ok:true, view:object, focusId:(string|null), transform:object, viewportChanged:boolean}
 *          |{ok:false, code:string, reason:string}}
 */
export function restoreSavedView(viewModel, parsed, viewport) {
  const identity = snapshotIdentity(viewModel)
  for (const key of IDENTITY_FIELDS) {
    if (parsed.snapshot[key] !== identity[key]) {
      return refusal(
        E_SAVED_VIEW_SNAPSHOT,
        `the saved view was captured against a different graph (${key} was ${JSON.stringify(parsed.snapshot[key])}, this graph has ${JSON.stringify(identity[key])})`
      )
    }
  }

  // A node id that is no longer in the graph is refused — never resolved to a
  // neighbour, a prefix match or the nearest surviving page.
  for (const [what, id] of [['anchor', parsed.view.anchorId], ['focus', parsed.focusId]]) {
    if (id !== null && !viewModel.adjacency.has(id)) {
      return refusal(
        E_SAVED_VIEW_STALE_NODE,
        `the saved ${what} node is not in this graph, and no other node is substituted for it`
      )
    }
  }

  return {
    ok: true,
    view: parsed.view,
    focusId: parsed.focusId,
    // Handed back unchanged; the shell clamps it to the world it actually has.
    transform: parsed.transform,
    // Mode, anchor and focus restore exactly. The zoom and position restore
    // exactly only when the stage is the same size, so the difference is
    // reported rather than presented as pixel-identical.
    viewportChanged: parsed.viewport.width !== viewport.width || parsed.viewport.height !== viewport.height
  }
}
```

**Step 4: Run test to verify it passes**

```
node --test test/atlas40-saved-view.test.mjs
```
Expected: PASS, 14/14.

**Step 5: Commit**

```bash
git add viewer/atlas39/core/saved-view.mjs test/atlas40-saved-view.test.mjs
git commit -m "ATLAS-40: versioned saved-view contract that refuses a view it cannot honestly restore"
```

---

## Task 5: `core/legend.mjs` — the truthful Edge Legend (D7, D8)

**Files:**
- Create: `viewer/atlas39/core/legend.mjs`
- Test: `test/atlas40-legend.test.mjs`

**Step 1: Write the failing test**

Create `test/atlas40-legend.test.mjs`:

```js
// ATLAS-40 slice 2 / AC7: a legend that explains only what is really drawn.
//
// Slice 1 shipped three fixed rows of markup — "Root / Level 1 / Level 2". At
// five real nodes it happened to be accurate. It was still a claim the
// application could not lose: a snapshot with four levels, with unrooted pages,
// or with no hierarchy at all would have produced the same three rows.
//
// The accepted snapshot contains exactly ONE kind of relation: parent_of /
// explicit. The legend for it must therefore have exactly one row, and this
// suite exists mostly to prove the legend can say less than it does today.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import { applyView } from '../viewer/atlas39/core/view-state.mjs'
import { depthTokenName } from '../viewer/atlas39/core/scene.mjs'
import { buildEdgeLegend, edgeLegendNote, buildDepthLegend, depthCaption } from '../viewer/atlas39/core/legend.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
const vm = buildViewModel(snapshot, provenance)

const SPRINT = 'ATLAS:confluence:14778372:22478849'

/** A synthetic model, used ONLY to prove the legend follows the data it is given. */
const synthetic = (edges, nodes = vm.nodes) => ({ ...vm, nodes, edges })

test('the real accepted snapshot yields exactly one edge legend row', () => {
  const legend = buildEdgeLegend(vm)
  assert.equal(legend.entries.length, 1)
  assert.deepEqual(legend.entries[0], { relationType: 'parent_of', origin: 'explicit', count: 4 })
  assert.equal(legend.total, 4)
  assert.equal(legend.empty, false)
})

test('COUNTEREXAMPLE: a relation type that is not in the graph is never displayed', () => {
  const legend = buildEdgeLegend(vm)
  const shown = JSON.stringify(legend.entries)
  for (const invented of [
    'similar_to', 'related_to', 'mentions', 'links_to', 'derived_from',
    'inferred', 'mutual_knn', 'cluster_of', 'sibling_of', 'references'
  ]) {
    assert.equal(shown.includes(invented), false, `the legend invented ${invented}`)
  }
  // And nothing but the origin the contract admits.
  for (const entry of legend.entries) assert.equal(entry.origin, 'explicit')
})

test('the legend follows the data: a model with more types shows exactly those types', () => {
  const model = synthetic([
    { edge_id: 'c', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'a', from: 'a', to: 'b', relation_type: 'zzz_last', origin: 'explicit' },
    { edge_id: 'b', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'd', from: 'a', to: 'b', relation_type: 'aaa_first', origin: 'explicit' }
  ])
  const legend = buildEdgeLegend(model)
  assert.deepEqual(legend.entries.map((e) => e.relationType), ['aaa_first', 'parent_of', 'zzz_last'])
  assert.deepEqual(legend.entries.map((e) => e.count), [1, 2, 1])
})

test('ordering is deterministic and independent of edge order', () => {
  const edges = [
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'b_type', origin: 'explicit' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'a_type', origin: 'explicit' },
    { edge_id: '3', from: 'a', to: 'b', relation_type: 'a_type', origin: 'derived' }
  ]
  const forward = buildEdgeLegend(synthetic(edges)).entries
  const backward = buildEdgeLegend(synthetic(edges.slice().reverse())).entries
  assert.deepEqual(forward, backward, 'insertion order changed the legend')
  // relationType first, then origin — both in code-unit order.
  assert.deepEqual(
    forward.map((e) => `${e.relationType}/${e.origin}`),
    ['a_type/derived', 'a_type/explicit', 'b_type/explicit']
  )
})

test('a view with no relations says so, and shows no row at all', () => {
  const legend = buildEdgeLegend(synthetic([]))
  assert.deepEqual(legend.entries, [])
  assert.equal(legend.empty, true)
  assert.equal(legend.total, 0)
  assert.equal(edgeLegendNote(legend), 'This view draws no relations.')
})

test('the legend does not claim an encoding the stage does not draw', () => {
  const one = buildEdgeLegend(vm)
  assert.equal(one.distinguishesTypes, false)
  assert.equal(one.encodingToken, '--line-strong')
  assert.equal(
    edgeLegendNote(one),
    'Every relation drawn here is parent_of (explicit); all are drawn with the same stroke.'
  )
  const many = buildEdgeLegend(synthetic([
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'x', origin: 'explicit' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'y', origin: 'explicit' }
  ]))
  assert.equal(
    edgeLegendNote(many),
    'All relation types are drawn with the same stroke; the stage does not tell them apart visually.'
  )
})

test('the legend describes the view on the stage, not the whole snapshot', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  const legend = buildEdgeLegend(applied.model)
  assert.equal(legend.total, 1, 'the legend counted edges that are not drawn')
  assert.equal(legend.entries[0].count, 1)
})

test('the hierarchy legend shows the depths that really occur, with the token that is really stroked', () => {
  const legend = buildDepthLegend(vm)
  assert.deepEqual(legend.entries.map((e) => e.depth), [0, 1, 2])
  assert.deepEqual(legend.entries.map((e) => e.count), [1, 3, 1])
  for (const entry of legend.entries) {
    assert.equal(entry.token, depthTokenName(entry.depth), 'the swatch token is not the stroked token')
  }
  assert.deepEqual(legend.entries.map((e) => depthCaption(e.depth)), ['Root', 'Level 1', 'Level 2'])
})

test('an absent depth is never displayed, and unrooted nodes sort last', () => {
  const nodes = [
    { node_id: 'a', source_ref: '1', label: 'a', depth: null, degree: 0, provenance: null },
    { node_id: 'b', source_ref: '2', label: 'b', depth: 4, degree: 0, provenance: null }
  ]
  const legend = buildDepthLegend(synthetic([], nodes))
  assert.deepEqual(legend.entries.map((e) => e.depth), [4, null])
  assert.deepEqual(legend.entries.map((e) => e.token), ['--depth-n', '--depth-none'])
  assert.deepEqual(legend.entries.map((e) => depthCaption(e.depth)), ['Level 4', 'No hierarchy path'])
  // Root / Level 1 / Level 2 are not in this graph and must not appear.
  const shown = JSON.stringify(legend.entries.map((e) => depthCaption(e.depth)))
  for (const absent of ['Root', 'Level 1', 'Level 2']) {
    assert.equal(shown.includes(absent), false, `the legend invented "${absent}"`)
  }
})

test('relation types are echoed exactly, never normalised or prettified', () => {
  const odd = 'parent_of/v2 (draft)'
  const legend = buildEdgeLegend(synthetic([{ edge_id: '1', from: 'a', to: 'b', relation_type: odd, origin: 'explicit' }]))
  assert.equal(legend.entries[0].relationType, odd)
})

test('the module carries no clock, randomness or DOM', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/legend.mjs'), 'utf8')
  for (const forbidden of ['Date.', 'Math.random', 'document', 'window', 'localeCompare', 'innerHTML']) {
    assert.equal(source.includes(forbidden), false, `legend.mjs references ${forbidden}`)
  }
})
```

Before running, confirm the depth distribution assumed above:

```bash
node -e '
const {readFileSync}=require("fs");
import("./viewer/atlas39/core/view-model.mjs").then(({buildViewModel})=>{
  const s=JSON.parse(readFileSync("docs/evidence/atlas-65/graph-snapshot.json","utf8"));
  const p=JSON.parse(readFileSync("docs/evidence/atlas-65/provenance.json","utf8"));
  const vm=buildViewModel(s,p);
  const m=new Map(); for(const n of vm.nodes) m.set(n.depth,(m.get(n.depth)||0)+1);
  console.log([...m].sort((a,b)=>(a[0]??99)-(b[0]??99)));
})'
```
Expected: `[ [ 0, 1 ], [ 1, 3 ], [ 2, 1 ] ]`. **If it differs, fix the test's expected counts to the measured values — do not adjust the module to fit a guess.**

**Step 2: Run test to verify it fails**

```
node --test test/atlas40-legend.test.mjs
```
Expected: FAIL — `Cannot find module .../core/legend.mjs`.

**Step 3: Write minimal implementation**

Create `viewer/atlas39/core/legend.mjs`:

```js
// ATLAS-40 core / slice 2: the legend, derived from the graph on the stage.
//
// Slice 1 shipped a legend that read "Root / Level 1 / Level 2" as three fixed
// rows of markup. At five real nodes it happened to be accurate. It was still a
// claim the application could not lose: a snapshot with four levels, with
// unrooted pages, or with no hierarchy at all would have produced the same
// three rows, and nobody would have seen it go wrong.
//
// AC7 asks for a legend that explains the edge types and encodings ACTUALLY
// present, so:
//
//   - one entry per distinct (relation_type, origin) pair that really occurs;
//   - nothing for a type that does not occur — including one that occurred in a
//     different snapshot, or in the view the user was looking at a moment ago;
//   - a deterministic order that depends on neither insertion order, nor Map
//     iteration, nor the process locale;
//   - and an explicit statement of whether the stage distinguishes those types
//     visually. Right now it does not: every explicit relation is drawn with the
//     same idle stroke and the only per-edge variation is the focus highlight.
//     Claiming otherwise would be inventing an encoding.
//
// No enum, no catalogue, no inferred type, no cluster taxonomy. relation_type
// and origin are echoed exactly as the snapshot spells them.
//
// Pure: no IO, no clock, no randomness, no DOM.

import { depthTokenName } from './scene.mjs'

// Code-unit order, deliberately not localeCompare: the legend must not reorder
// itself because the process locale changed.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The design token every explicit relation is actually stroked with. */
export const EDGE_ENCODING_TOKEN = '--line-strong'

/**
 * @param {object} model a view model, or the projected model of a view
 * @returns {{entries:Array, total:number, distinguishesTypes:boolean,
 *            encodingToken:string, empty:boolean}}
 */
export function buildEdgeLegend(model) {
  const counts = new Map()
  for (const edge of model.edges) {
    // A NUL separator, so a relation type containing the separator cannot
    // collide with a different (type, origin) pair.
    const key = `${edge.relation_type}\u0000${edge.origin}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { relationType: edge.relation_type, origin: edge.origin, count: 1 })
  }
  const entries = [...counts.values()].sort(
    (a, b) => byCodeUnit(a.relationType, b.relationType) || byCodeUnit(a.origin, b.origin)
  )
  return {
    entries,
    total: model.edges.length,
    // One stroke for every relation, so the legend must not imply the colours
    // tell the types apart.
    distinguishesTypes: false,
    encodingToken: EDGE_ENCODING_TOKEN,
    empty: entries.length === 0
  }
}

/** The sentence under the edge rows. It says only what is true of this view. */
export function edgeLegendNote(legend) {
  if (legend.empty) return 'This view draws no relations.'
  if (legend.entries.length === 1) {
    const only = legend.entries[0]
    return `Every relation drawn here is ${only.relationType} (${only.origin}); all are drawn with the same stroke.`
  }
  return 'All relation types are drawn with the same stroke; the stage does not tell them apart visually.'
}

/**
 * Hierarchy depths that really occur, each with the SAME token the renderer
 * strokes the disc with. This is NOT the ATLAS-40 edge legend and is headed as
 * hierarchy; it exists because depth is what the node colours encode, and an
 * unexplained colour is its own small lie.
 */
export function buildDepthLegend(model) {
  const counts = new Map()
  for (const node of model.nodes) {
    const key = node.depth === null ? 'none' : String(node.depth)
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { depth: node.depth, token: depthTokenName(node.depth), count: 1 })
  }
  const entries = [...counts.values()].sort((a, b) => {
    // Nodes with no hierarchy path sort last, together — the same rule the
    // layout uses to give them their own outermost ring.
    if (a.depth === null) return b.depth === null ? 0 : 1
    if (b.depth === null) return -1
    return a.depth - b.depth
  })
  return { entries, empty: entries.length === 0 }
}

/** The caption for a hierarchy depth. The one place this wording is decided. */
export function depthCaption(depth) {
  if (depth === null) return 'No hierarchy path'
  return depth === 0 ? 'Root' : `Level ${depth}`
}
```

**Step 4: Run test to verify it passes**

```
node --test test/atlas40-legend.test.mjs
```
Expected: PASS, 11/11.

**Step 5: Counterexample proof (do not commit the mutation)**

```bash
# hardcode a row the graph does not contain
perl -0pi -e "s/  const entries = \[\.\.\.counts\.values\(\)\]\.sort\(/  counts.set('X', { relationType: 'similar_to', origin: 'inferred', count: 1 })\n  const entries = [...counts.values()].sort(/" viewer/atlas39/core/legend.mjs
node --test test/atlas40-legend.test.mjs; echo "MUTANT EXIT=$?"
git checkout -- viewer/atlas39/core/legend.mjs
node --test test/atlas40-legend.test.mjs; echo "RESTORED EXIT=$?"
git diff --stat viewer/atlas39/core/legend.mjs
```

Expected: `MUTANT EXIT=1` failing at least
`COUNTEREXAMPLE: a relation type that is not in the graph is never displayed`,
then `RESTORED EXIT=0` and an empty `git diff --stat`. Record verbatim.

**Step 6: Commit**

```bash
git add viewer/atlas39/core/legend.mjs test/atlas40-legend.test.mjs
git commit -m "ATLAS-40: derive the edge legend from the relations actually on the stage"
```

---

## Task 6: Wire the view controls, saved view and legend into the shell

**Files:**
- Modify: `viewer/atlas39/index.html:60-72`
- Modify: `viewer/atlas39/shell.css` (append; and change the `@media (max-width: 960px)` legend rule at `:718-720`)
- Modify: `viewer/atlas39/app.mjs`

This task has no new pure logic — it is wiring, so it is verified by Task 7's source-text assertions and by the headed acceptance run in Task 9. Commit it as one change.

**Step 1: `index.html` — replace the static legend and add the view controls**

Replace lines 60-72 (`.a39-stage-controls` group through the closing `</div>` of `.a39-legend`) with:

```html
  <div class="a39-stage-controls" role="group" aria-label="Graph view controls">
    <button type="button" class="a39-button" id="zoom-out" aria-label="Zoom out">−</button>
    <span class="a39-zoom" id="zoom-level">100%</span>
    <button type="button" class="a39-button" id="zoom-in" aria-label="Zoom in">+</button>
    <button type="button" class="a39-button" id="reset-view" disabled>Reset view</button>
    <button type="button" class="a39-button" id="clear-focus" disabled>Clear focus</button>
  </div>

  <div class="a39-stage-controls a39-view-controls" role="group" aria-label="Graph views">
    <button type="button" class="a39-button" id="view-overview" aria-pressed="true">Overview</button>
    <button type="button" class="a39-button" id="view-neighbourhood" aria-pressed="false" disabled>Neighbourhood</button>
    <span class="a39-view-readout" id="view-readout">—</span>
    <button type="button" class="a39-button" id="save-view">Save view</button>
    <button type="button" class="a39-button" id="restore-view" disabled>Restore view</button>
    <button type="button" class="a39-button" id="clear-saved-view" disabled>Clear saved view</button>
    <span class="a39-saved-view-state" id="saved-view-state"></span>
  </div>

  <section class="a39-legend" id="legend" aria-labelledby="legend-title">
    <h2 class="a39-legend-title" id="legend-title">Edge legend</h2>
    <div class="a39-legend-group" id="legend-edges"></div>
    <p class="a39-legend-note" id="legend-note"></p>
    <h3 class="a39-legend-title" id="legend-depth-title">Hierarchy</h3>
    <div class="a39-legend-group" id="legend-depth" aria-labelledby="legend-depth-title"></div>
  </section>
```

Notes that matter:
- The legend loses `aria-hidden="true"`. AC7 asks for a *visible* legend; a legend hidden from assistive technology is visible to some users only.
- `#saved-view-state` gets **no** `role="status"`. `#live` is the one live region; a second would announce everything twice.
- The new group carries `class="a39-stage-controls"` deliberately: `onStageKeydown` already skips `.a39-stage-controls`, so arrow keys on the new buttons cannot be hijacked into graph traversal. Reusing the class is what makes that true without a second guard.

**Step 2: `shell.css`**

Change the `@media (max-width: 960px)` rule (currently `:718-720`) from hiding the legend to laying it out compactly — a legend that disappears at the countercheck viewport cannot satisfy AC7 there:

```css
  .a39-legend {
    position: static;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--s2) var(--s3);
    margin: var(--s3) var(--s4) 0;
  }

  .a39-legend-note {
    flex-basis: 100%;
  }
```

Append (colours by token only — `shell.css` may contain no colour literal):

```css
/* Slice 2: the view + saved-view controls. They sit opposite the zoom controls
 * so neither group covers the other, and they share .a39-stage-controls so the
 * stage keydown handler treats them as controls, not as graph. */
.a39-view-controls {
  right: auto;
  left: var(--s4);
  max-width: calc(100% - 2 * var(--s4));
  flex-wrap: wrap;
}

.a39-view-readout,
.a39-saved-view-state {
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

.a39-saved-view-state {
  max-width: 34ch;
}

body[data-saved-view="refused"] .a39-saved-view-state {
  color: var(--accent);
}

.a39-legend-title {
  margin: 0;
  font-size: var(--fs-micro);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.a39-legend-group {
  display: flex;
  flex-direction: column;
  gap: var(--s2);
}

.a39-legend-note {
  margin: 0;
  max-width: 46ch;
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

/* An edge is drawn as a stroke, so the legend shows a stroke. */
.a39-edge-swatch {
  width: 18px;
  height: 2px;
  border-radius: 1px;
  background: var(--line-strong);
  flex: none;
}
```

Delete the now-unused `.a39-swatch[data-depth="0"|"1"|"2"]` rules (`:486-496`) — the swatch colour is set from the token the module returns (D8), so a second CSS list can no longer disagree with it. Keep the base `.a39-swatch` rule.

**Step 3: `app.mjs`**

Imports — append to the existing import block:

```js
import { DEFAULT_VIEW, applyView, isInView, viewCaption } from './core/view-state.mjs'
import {
  SAVED_VIEW_VERSION,
  captureSavedView,
  serializeSavedView,
  parseSavedView,
  restoreSavedView,
  E_SAVED_VIEW_STORAGE
} from './core/saved-view.mjs'
import { buildEdgeLegend, edgeLegendNote, buildDepthLegend, depthCaption } from './core/legend.mjs'
import { createDragGesture } from './core/gesture.mjs'
```

`dom` — add:

```js
  viewOverview: el('view-overview'),
  viewNeighbourhood: el('view-neighbourhood'),
  viewReadout: el('view-readout'),
  saveViewBtn: el('save-view'),
  restoreViewBtn: el('restore-view'),
  clearSavedViewBtn: el('clear-saved-view'),
  savedViewState: el('saved-view-state'),
  legendEdges: el('legend-edges'),
  legendNote: el('legend-note'),
  legendDepth: el('legend-depth')
```

`state` — add:

```js
  view: { ...DEFAULT_VIEW },
  displayed: null,
  store: null,
  savedViewPresent: false
```

Delete the local `levelCaption` (`:153-156`) and use the imported `depthCaption` at both call sites (`:178` and `:230`, plus the announcement at `:501`). One place decides that wording now.

Add the storage probe, the view resolution, the legend painter and the saved-view handlers:

```js
const SAVED_VIEW_KEY = `atlas40.saved-view.v${SAVED_VIEW_VERSION}`
/** Only tokens this build defines may reach a style property. */
const DEPTH_TOKEN = /^--depth-(?:0|1|2|n|none)$/

/**
 * localStorage that has been proved writable. Merely reading `window.
 * localStorage` is not enough — several engines expose the object and throw on
 * write, and a save that silently does nothing is exactly the failure mode this
 * slice exists to remove.
 */
function openStore() {
  try {
    const store = window.localStorage
    const probe = `${SAVED_VIEW_KEY}.probe`
    store.setItem(probe, '1')
    store.removeItem(probe)
    return store
  } catch {
    return null
  }
}

function anchorLabel() {
  const id = state.view.anchorId
  if (id === null) return null
  return state.viewModel.nodes.find((n) => n.node_id === id)?.label ?? null
}

function resolveDisplayed() {
  const applied = applyView(state.viewModel, state.view)
  if (applied.ok) {
    state.displayed = applied
    return
  }
  // Unreachable while every assignment to state.view goes through a validated
  // path — which is exactly why it must be visible if it ever happens, rather
  // than a quiet return to overview that looks like the user's own choice.
  state.view = { ...DEFAULT_VIEW }
  state.displayed = applyView(state.viewModel, state.view)
  announce(`That view could not be shown: ${applied.reason}. Showing the whole graph instead.`)
}

function paintLegend() {
  const model = state.displayed.model

  const edgeLegend = buildEdgeLegend(model)
  const edgeRows = document.createDocumentFragment()
  for (const entry of edgeLegend.entries) {
    const row = document.createElement('div')
    row.className = 'a39-legend-row'
    const swatch = document.createElement('span')
    swatch.className = 'a39-edge-swatch'
    const text = document.createElement('span')
    // relation_type and origin are echoed exactly as the snapshot spells them,
    // through textContent — so a relation type can never become markup.
    text.textContent = `${entry.relationType} · ${entry.origin} (${entry.count})`
    row.append(swatch, text)
    edgeRows.append(row)
  }
  if (edgeLegend.empty) {
    edgeRows.append(Object.assign(document.createElement('div'), {
      className: 'a39-legend-row',
      textContent: 'No relations in this view.'
    }))
  }
  dom.legendEdges.replaceChildren(edgeRows)
  dom.legendNote.textContent = edgeLegendNote(edgeLegend)

  const depthLegend = buildDepthLegend(model)
  const depthRows = document.createDocumentFragment()
  for (const entry of depthLegend.entries) {
    const row = document.createElement('div')
    row.className = 'a39-legend-row'
    const swatch = document.createElement('span')
    swatch.className = 'a39-swatch'
    // The swatch is painted from the same token the renderer strokes the disc
    // with. The allowlist keeps that assignment mechanically safe.
    if (DEPTH_TOKEN.test(entry.token)) swatch.style.borderColor = `var(${entry.token})`
    const text = document.createElement('span')
    text.textContent = `${depthCaption(entry.depth)} (${entry.count})`
    row.append(swatch, text)
    depthRows.append(row)
  }
  dom.legendDepth.replaceChildren(depthRows)
}

function paintViewControls() {
  const scope = state.displayed.scope
  dom.viewOverview.setAttribute('aria-pressed', String(scope.mode === 'overview'))
  dom.viewNeighbourhood.setAttribute('aria-pressed', String(scope.mode === 'neighbourhood'))
  dom.viewNeighbourhood.disabled = state.focusId === null
  dom.viewReadout.textContent = viewCaption(scope, anchorLabel())
  dom.saveViewBtn.disabled = state.store === null
  dom.restoreViewBtn.disabled = state.store === null || !state.savedViewPresent
  dom.clearSavedViewBtn.disabled = state.store === null || !state.savedViewPresent
}

function setView(next) {
  const applied = applyView(state.viewModel, next)
  if (!applied.ok) {
    announce(`That view could not be shown: ${applied.reason}.`)
    return
  }
  state.view = applied.view
  render()
  announce(viewCaption(state.displayed.scope, anchorLabel()))
}

/**
 * A saved view that does not apply is NOT a stage failure: the loaded graph is
 * still real and still drawn. It is refused loudly and locally instead. Nothing
 * has been assigned by the time this runs, so a refusal cannot leave a
 * half-restored view behind.
 */
function refuseSavedView(code, reason) {
  dom.body.dataset.savedView = 'refused'
  dom.savedViewState.textContent = `${reason} (${code})`
  announce(`Saved view refused. ${reason}. ${code}. Nothing on the stage was changed.`)
}

function onSaveView() {
  if (state.store === null) {
    refuseSavedView(E_SAVED_VIEW_STORAGE, 'This browser did not allow the workspace to store a saved view')
    return
  }
  const record = captureSavedView({
    viewModel: state.viewModel,
    view: state.view,
    focusId: state.focusId,
    transform: state.transform,
    viewport: stageViewport()
  })
  try {
    state.store.setItem(SAVED_VIEW_KEY, serializeSavedView(record))
  } catch (error) {
    refuseSavedView(E_SAVED_VIEW_STORAGE, `The saved view could not be stored: ${error.message}`)
    return
  }
  state.savedViewPresent = true
  dom.body.dataset.savedView = 'saved'
  const caption = viewCaption(state.displayed.scope, anchorLabel())
  dom.savedViewState.textContent = `Saved: ${caption}`
  paintViewControls()
  announce(`View saved. ${caption}`)
}

function onRestoreView() {
  if (state.store === null) {
    refuseSavedView(E_SAVED_VIEW_STORAGE, 'This browser did not allow the workspace to read a saved view')
    return
  }
  let stored = null
  try {
    stored = state.store.getItem(SAVED_VIEW_KEY)
  } catch (error) {
    refuseSavedView(E_SAVED_VIEW_STORAGE, `The saved view could not be read: ${error.message}`)
    return
  }
  const parsed = parseSavedView(stored)
  if (!parsed.ok) {
    refuseSavedView(parsed.code, parsed.reason)
    return
  }
  const bound = restoreSavedView(state.viewModel, parsed.value, stageViewport())
  if (!bound.ok) {
    refuseSavedView(bound.code, bound.reason)
    return
  }

  state.view = bound.view
  state.focusId = bound.focusId
  state.restoreStageFocus = false
  state.transform = clampTransform(bound.transform, state.world)
  dom.body.dataset.savedView = 'restored'
  dom.savedViewState.textContent = 'Restored.'
  render()
  announce(
    `Saved view restored. ${viewCaption(state.displayed.scope, anchorLabel())}` +
      (bound.viewportChanged
        ? ' The stage is a different size than when this view was saved, so the zoom and position were re-fitted.'
        : '')
  )
}

function onClearSavedView() {
  if (state.store === null) return
  try {
    state.store.removeItem(SAVED_VIEW_KEY)
  } catch (error) {
    refuseSavedView(E_SAVED_VIEW_STORAGE, `The saved view could not be cleared: ${error.message}`)
    return
  }
  state.savedViewPresent = false
  dom.body.dataset.savedView = 'none'
  dom.savedViewState.textContent = 'No saved view.'
  paintViewControls()
  announce('Saved view cleared.')
}
```

`paintStage()` — draw the displayed model:

```js
  const model = state.displayed.model
  const viewport = stageViewport()
  const layout = computeLayout(model, viewport)
  ...
  const scene = buildScene(model, layout, selectFocus(model, state.focusId))
```

`render()` — resolve the view first, then paint the two new surfaces:

```js
function render() {
  if (state.failed) return
  resolveDisplayed()
  if (!paintStage()) return
  paintNavigator()
  paintInspector()
  paintLegend()
  paintViewControls()
  dom.clearFocus.disabled = state.focusId === null
}
```

`applyTransform` still calls `paintStage()` only. Zoom and pan change no count and no legend row, and the Slice-1 test that forbids a full `render()` there must keep passing.

`setFocus` — a focus must never land where it cannot be seen:

```js
function setFocus(nodeId, { moveStageFocus = true, quiet = false, center = false } = {}) {
  const vm = state.viewModel
  const known = vm.nodes.some((n) => n.node_id === nodeId)
  // Focusing a node the current view does not draw would leave the user with a
  // selection they cannot see — the same defect as losing the graph. The view
  // returns to the whole graph, and says so.
  const leftView = known && state.view.mode !== 'overview' && !isInView(state.displayed, nodeId)
  if (leftView) state.view = { ...DEFAULT_VIEW }
  state.focusId = known ? nodeId : null
  state.restoreStageFocus = known && moveStageFocus
  ... // centring block unchanged
  render()
  if (quiet) return
  if (!known) { announce('Focus cleared. Showing the whole graph.'); return }
  const node = vm.nodes.find((n) => n.node_id === nodeId)
  announce(
    `${leftView ? 'Left the focused view. ' : ''}${node.label} focused. ` +
    `${depthCaption(node.depth)}. ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}.`
  )
}
```

`stepFocus` — traverse the view that is drawn:

```js
function stepFocus(delta) {
  const order = state.displayed.model.nodes.map((n) => n.node_id)
  ...unchanged...
}
```

`wirePointer` — replace the inline gesture state with the module:

```js
function wirePointer() {
  dom.stageHost.addEventListener('wheel', /* unchanged */)

  const gesture = createDragGesture()

  // Capture phase, so this runs before the node button's own click handler.
  dom.stageHost.addEventListener('click', (event) => {
    if (!gesture.consumeClick()) return
    event.stopPropagation()
    event.preventDefault()
  }, true)

  dom.stageHost.addEventListener('pointerdown', (event) => {
    if (event.target.closest?.('.a39-stage-controls')) return
    gesture.start(event)
  })

  dom.stageHost.addEventListener('pointermove', (event) => {
    const step = gesture.move(event)
    if (!step.panning) return
    if (step.began) {
      dom.stageHost.setPointerCapture?.(event.pointerId)
      dom.body.dataset.panning = 'true'
    }
    applyTransform(panBy(state.transform, step.dx, step.dy, state.world))
  })

  const endPan = (event) => {
    const done = gesture.end(event)
    if (!done.ended) return
    if (done.wasPanning) dom.stageHost.releasePointerCapture?.(done.pointerId)
    delete dom.body.dataset.panning
  }
  dom.stageHost.addEventListener('pointerup', endPan)
  dom.stageHost.addEventListener('pointercancel', endPan)
}
```

`wireEvents` — add:

```js
  dom.viewOverview.addEventListener('click', () => setView({ ...DEFAULT_VIEW }))
  dom.viewNeighbourhood.addEventListener('click', () => {
    if (state.focusId === null) return
    setView({ mode: 'neighbourhood', anchorId: state.focusId })
  })
  dom.saveViewBtn.addEventListener('click', onSaveView)
  dom.restoreViewBtn.addEventListener('click', onRestoreView)
  dom.clearSavedViewBtn.addEventListener('click', onClearSavedView)
```

`showFailure` — disable the new controls too, so a failed stage offers no view it cannot draw:

```js
  for (const control of [
    dom.clearFocus, dom.filter, dom.zoomIn, dom.zoomOut, dom.resetView,
    dom.viewOverview, dom.viewNeighbourhood, dom.saveViewBtn, dom.restoreViewBtn, dom.clearSavedViewBtn
  ]) {
    if (control) control.disabled = true
  }
  dom.legendEdges?.replaceChildren()
  dom.legendDepth?.replaceChildren()
  if (dom.legendNote) dom.legendNote.textContent = 'No graph is drawn, so there is nothing to explain.'
  if (dom.viewReadout) dom.viewReadout.textContent = '—'
```

`boot()` — open the store and seed the saved-view state, after `paintStatus()` and before `wireEvents()`:

```js
  state.store = openStore()
  state.savedViewPresent = state.store !== null && typeof state.store.getItem(SAVED_VIEW_KEY) === 'string'
  dom.body.dataset.savedView = state.savedViewPresent ? 'saved' : 'none'
  dom.savedViewState.textContent = state.store === null
    ? 'This browser did not allow the workspace to store a saved view.'
    : state.savedViewPresent ? 'A saved view is stored.' : 'No saved view.'
```

**Step 4: Verify the wiring parses and nothing regressed yet**

```bash
node --check viewer/atlas39/app.mjs && echo "APP SYNTAX OK"
node --test test/atlas39-shell.test.mjs test/atlas40-shell.test.mjs
```
Expected at this point: `APP SYNTAX OK`, and `test/atlas40-shell.test.mjs` **fails** on the two pointer assertions that still look for `DRAG_THRESHOLD` and `suppressClick = true` inside `wirePointer`. That failure is the signal for Task 7 — do not paper over it by keeping dead words in `app.mjs`.

**Step 5: Commit**

```bash
git add viewer/atlas39/app.mjs viewer/atlas39/index.html viewer/atlas39/shell.css
git commit -m "ATLAS-40: wire deterministic views, one saved view and the derived legend into the workspace shell"
```

---

## Task 7: Update the shell contract tests

**Files:**
- Modify: `test/atlas39-shell.test.mjs:28-32`
- Modify: `test/atlas40-shell.test.mjs:154-168` and append

**Step 1: `AUTHORED` must cover the new modules**

`AUTHORED` drives the "no remote resource", "no fixture or demo fallback" and "every module parses" checks. A new module outside it is a silent hole in exactly those guarantees. Extend the list:

```js
const AUTHORED = [
  'index.html', 'tokens.css', 'stage.css', 'shell.css', 'app.mjs',
  'core/view-model.mjs', 'core/layout.mjs', 'core/render-svg.mjs', 'core/stage-mount.mjs',
  'core/transform.mjs', 'core/scene.mjs', 'core/scene-guard.mjs', 'core/search.mjs', 'core/render-webgl.mjs',
  // ATLAS-40 slice 2. Listed for the same reason as the slice-1 renderer
  // modules: a source the no-fallback and no-remote-resource rules stopped
  // covering would be a hole in the reason a reader can trust this workspace.
  'core/view-state.mjs', 'core/saved-view.mjs', 'core/legend.mjs', 'core/gesture.mjs'
]
```

**Step 2: Replace the two pointer assertions that moved**

In `test/atlas40-shell.test.mjs`, rewrite the test at `:154-168`:

```js
test('a pan may start on a node, and a drag does not also activate it', () => {
  // Refusing to pan from a node is invisible at the default zoom and unusable
  // once zoomed in, where one node can cover most of the stage. The click is
  // protected by a movement threshold instead of by a dead zone.
  //
  // Slice 2 moved that threshold into core/gesture.mjs. A regex over app.mjs
  // could only ever assert that the words were still present — which is how a
  // pointercancel came to leave the suppression armed. The BEHAVIOUR is owned by
  // test/atlas40-gesture.test.mjs; what is asserted here is that the shell still
  // routes its pointer events through that state machine.
  const wirePointer = /function wirePointer\(\)[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(wirePointer, 'wirePointer is missing')
  assert.match(app, /import \{ createDragGesture \} from '\.\/core\/gesture\.mjs'/)
  assert.match(wirePointer, /const gesture = createDragGesture\(\)/)
  assert.match(wirePointer, /gesture\.consumeClick\(\)/)
  assert.match(wirePointer, /addEventListener\('click',[\s\S]*?\}, true\)/, 'the click guard must run in the capture phase')
  assert.match(wirePointer, /gesture\.end\(event\)/)
  assert.equal(
    /pointerdown'[\s\S]{0,400}closest\?\.\('\.a39-gnode'\)/.test(wirePointer),
    false,
    'pointerdown must no longer refuse to start a pan on a node'
  )
  // The threshold and the suppression are still real, in the module that owns them.
  const gestureSource = readFileSync(join(VIEWER, 'core/gesture.mjs'), 'utf8')
  assert.match(gestureSource, /DRAG_THRESHOLD/)
  assert.match(gestureSource, /suppressClick = true/)
  assert.match(gestureSource, /if \(event\.type === 'pointercancel'\) suppressClick = false/)
})
```

**Step 3: Append the slice-2 wiring assertions**

```js
/* ---------- ATLAS-40 slice 2: views, saved views, legend ---------- */

test('the shell routes the stage through the view-state projection, not the raw graph', () => {
  assert.match(app, /from '\.\/core\/view-state\.mjs'/)
  assert.match(app, /function resolveDisplayed\(\)/)
  assert.match(app, /computeLayout\(model, viewport\)/)
  assert.match(app, /buildScene\(model, layout, selectFocus\(model, state\.focusId\)\)/)
  // The canonical view model is not rewritten by a view.
  assert.equal(/state\.viewModel\s*=\s*applyView/.test(app), false)
})

test('both view modes are reachable, labelled and reflected in the controls', () => {
  for (const id of ['view-overview', 'view-neighbourhood', 'view-readout']) {
    assert.match(html, new RegExp(`id="${id}"`), `no ${id}`)
  }
  assert.match(html, /aria-label="Graph views"/)
  assert.match(app, /dom\.viewOverview\.setAttribute\('aria-pressed'/)
  assert.match(app, /dom\.viewNeighbourhood\.setAttribute\('aria-pressed'/)
  assert.match(app, /viewCaption\(state\.displayed\.scope, anchorLabel\(\)\)/)
})

test('a focus that the current view does not draw returns to the whole graph, and says so', () => {
  const setFocus = /function setFocus\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(setFocus, 'setFocus is missing')
  assert.match(setFocus, /isInView\(state\.displayed, nodeId\)/)
  assert.match(setFocus, /Left the focused view/)
})

test('keyboard traversal walks the view that is actually drawn', () => {
  const stepFocus = /function stepFocus\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(stepFocus)
  assert.match(stepFocus, /state\.displayed\.model\.nodes/)
})

test('the saved view is versioned, probed storage, and refuses without touching the stage', () => {
  assert.match(app, /from '\.\/core\/saved-view\.mjs'/)
  assert.match(app, /const SAVED_VIEW_KEY = `atlas40\.saved-view\.v\$\{SAVED_VIEW_VERSION\}`/)
  // A store that merely exists is not a store that works.
  assert.match(app, /function openStore\(\)/)
  assert.match(app, /store\.setItem\(probe, '1'\)/)
  const refuse = /function refuseSavedView\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(refuse, 'refuseSavedView is missing')
  assert.match(refuse, /Nothing on the stage was changed/)
  // A refused restore must NOT be a stage failure: the loaded graph is still real.
  assert.equal(/showFailure\(/.test(refuse), false, 'a refused saved view tore the stage down')
  for (const id of ['save-view', 'restore-view', 'clear-saved-view', 'saved-view-state']) {
    assert.match(html, new RegExp(`id="${id}"`), `no ${id}`)
  }
})

test('a restore assigns nothing until every check has passed', () => {
  const restore = /function onRestoreView\([\s\S]*?\n\}\n/.exec(app)?.[0]
  assert.ok(restore, 'onRestoreView is missing')
  const firstAssignment = restore.indexOf('state.view = bound.view')
  assert.ok(firstAssignment > -1, 'the restore never applies the view')
  const head = restore.slice(0, firstAssignment)
  for (const guard of ['parsed.ok', 'bound.ok']) {
    assert.ok(head.includes(guard), `${guard} is checked after the view was already applied`)
  }
})

test('the legend is derived at render time and is no longer three fixed rows of markup', () => {
  assert.match(app, /from '\.\/core\/legend\.mjs'/)
  assert.match(app, /function paintLegend\(\)/)
  assert.match(app, /buildEdgeLegend\(model\)/)
  assert.match(app, /edgeLegendNote\(edgeLegend\)/)
  // The static slice-1 legend is gone from the markup, in both label and swatch form.
  assert.equal(/<div class="a39-legend-row"><span class="a39-swatch"/.test(html), false)
  assert.equal(/>Level 1</.test(html), false, 'a hardcoded hierarchy row survived in index.html')
  assert.equal(/>Level 2</.test(html), false)
  assert.match(html, /id="legend-edges"/)
  assert.match(html, /id="legend-depth"/)
  // AC7 asks for a VISIBLE legend, so it is no longer hidden from assistive tech.
  const legend = /<section class="a39-legend"[\s\S]*?<\/section>/.exec(html)?.[0]
  assert.ok(legend, 'the legend section is missing')
  assert.equal(/aria-hidden/.test(legend), false, 'the legend is hidden from assistive technology')
  assert.match(legend, /aria-labelledby="legend-title"/)
  assert.match(legend, />Edge legend</)
})

test('legend text reaches the DOM only through textContent', () => {
  const paintLegend = /function paintLegend\(\)[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(paintLegend)
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(paintLegend), false)
  assert.match(paintLegend, /text\.textContent = `\$\{entry\.relationType\} · \$\{entry\.origin\} \(\$\{entry\.count\}\)`/)
  // The only style property assigned is a depth token, behind an allowlist.
  assert.match(paintLegend, /DEPTH_TOKEN\.test\(entry\.token\)/)
})

test('the legend survives the responsive countercheck instead of disappearing', () => {
  // A legend that vanishes below 960px cannot satisfy AC7 at the smaller
  // accepted viewport, so it is laid out compactly rather than hidden.
  const small = /@media \(max-width: 960px\)[\s\S]*?\n\}\n/.exec(shellCss)?.[0]
  assert.ok(small, 'the 960px breakpoint is missing')
  assert.equal(/\.a39-legend \{[^}]*display:\s*none/.test(small), false, 'the legend is hidden at 960px')
  assert.match(small, /\.a39-legend \{[\s\S]*?position: static/)
})

test('a failed stage offers no view, no saved view and no legend', () => {
  const showFailure = /function showFailure\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(showFailure)
  assert.match(showFailure, /dom\.viewOverview, dom\.viewNeighbourhood, dom\.saveViewBtn, dom\.restoreViewBtn, dom\.clearSavedViewBtn/)
  assert.match(showFailure, /dom\.legendEdges\?\.replaceChildren\(\)/)
})

test('the new controls cannot swallow the graph arrow keys', () => {
  // onStageKeydown skips .a39-stage-controls; the view group carries that class
  // on purpose, so arrow keys on its buttons are never hijacked into traversal.
  assert.match(html, /class="a39-stage-controls a39-view-controls"/)
  assert.match(app, /event\.target\.closest\?\.\('\.a39-stage-controls'\)/)
})
```

`test/atlas40-shell.test.mjs` needs `shellCss` (already read at the top) and `join`/`VIEWER` (already imported).

**Step 4: Run the shell suites**

```
node --test test/atlas39-shell.test.mjs test/atlas40-shell.test.mjs
```
Expected: PASS. Any failure here is a real disagreement between the wiring and the contract — fix `app.mjs`/`index.html`, never the assertion, unless the assertion is provably describing the old design.

**Step 5: Commit**

```bash
git add test/atlas39-shell.test.mjs test/atlas40-shell.test.mjs
git commit -m "ATLAS-40: pin the slice-2 shell contract and move the pointer assertions to the module that owns them"
```

---

## Task 8: Validator, runbook and README

**Files:**
- Modify: `scripts/validate-current-repository.mjs:92-107` and `:572-628`
- Modify: `docs/atlas-40-webgl-renderer.md`
- Modify: `README.md:87` (only if the runbook reference needs it)

**Step 1: Extend `REQUIRED_FILES`**

After the slice-1 block (`:95-105`), add:

```js
  // ATLAS-40 slice 2: the deterministic view model, the saved-view contract, the
  // derived legend and the pointer state machine. Existence only — the behaviour
  // is owned by the atlas40-* suites and is not duplicated here.
  'viewer/atlas39/core/view-state.mjs',
  'viewer/atlas39/core/saved-view.mjs',
  'viewer/atlas39/core/legend.mjs',
  'viewer/atlas39/core/gesture.mjs',
  'test/atlas40-view-state.test.mjs',
  'test/atlas40-saved-view.test.mjs',
  'test/atlas40-legend.test.mjs',
  'test/atlas40-gesture.test.mjs',
```

**Step 2: Add the slice-2 structural checks**

Insert before the `if (failures.length > 0)` block:

```js
// 18) ATLAS-40 SLICE 2: views, saved views and the derived legend. As in section
//     17, the behaviour is owned by the atlas40-* suites and by the headed
//     acceptance run; what is checked here is the structural claim the
//     documentation makes, so the two cannot drift apart silently.
check(
  'the workspace shell draws a view projection rather than the raw graph',
  atlas40App.includes("from './core/view-state.mjs'") && atlas40App.includes('function resolveDisplayed()'),
  atlas40Error || 'app.mjs does not resolve a view before painting the stage'
)
check(
  'the workspace shell has a versioned saved-view contract behind it',
  atlas40App.includes("from './core/saved-view.mjs'") &&
    atlas40App.includes('atlas40.saved-view.v${SAVED_VIEW_VERSION}'),
  atlas40Error || 'app.mjs does not key its saved view by the contract version'
)
// The runbook states the contract version in prose. A second copy that can
// disagree with the module is worse than no copy, so they are pinned together.
const savedViewModuleVersion =
  (await readFile('viewer/atlas39/core/saved-view.mjs', 'utf8').catch(() => ''))
    .match(/export const SAVED_VIEW_VERSION = (\d+)/)?.[1] ?? null
const savedViewDocVersion = atlas40Doc.match(/`saved_view_version`\s*:\s*`(\d+)`/)?.[1] ?? null
check(
  'the runbook documents the saved-view version the module actually implements',
  savedViewModuleVersion !== null && savedViewModuleVersion === savedViewDocVersion,
  `module: ${savedViewModuleVersion} / runbook: ${savedViewDocVersion}`
)
check(
  'the ATLAS-40 legend is derived from the graph, not hardcoded in the markup',
  atlas40App.includes("from './core/legend.mjs'") &&
    !(await readFile('viewer/atlas39/index.html', 'utf8').catch(() => '')).includes('>Level 1<'),
  atlas40Error || 'index.html still carries a hardcoded hierarchy legend row'
)
check(
  'the ATLAS-40 runbook records slice 2 and its still-deferred scope',
  atlas40Doc.includes('Slice 2') && /##\s*Not delivered by slice 2/i.test(atlas40Doc),
  atlas40Error || 'docs/atlas-40-webgl-renderer.md does not state the slice-2 boundary'
)
check(
  'the ATLAS-40 runbook still makes no performance claim',
  /no frame rate or search latency has been measured/i.test(atlas40Doc),
  'the runbook lost its explicit statement that DEC-07 is unmeasured'
)
```

The existing slice-1 checks — including `/##\s*Not delivered by slice 1/i` — stay exactly as they are. Nothing in section 17 is regenerated, renamed or removed: slice-1 evidence is history and is only added to.

**Step 3: Extend the runbook**

Add to `docs/atlas-40-webgl-renderer.md`, after `## Not delivered by slice 1` and before `## Pilot boundary (unchanged)`:

```markdown
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
about the view.

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

A stale node is **refused, never resolved to a substitute**. `node_count` and
`edge_count` are part of the identity on purpose: a re-scanned Confluence tree
invalidates a saved view rather than restoring it into a graph that has quietly
changed shape.

A refused saved view is deliberately *not* a stage failure. A refused snapshot
tears the renderer down because the data cannot be trusted; a saved view that
does not apply leaves a graph that is still real and still drawn, so it is
refused loudly and locally instead.

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
```

Update the title line to `# ATLAS-40 — WebGL Renderer, Core Navigation and Deterministic Views (Slices 1–2)`, leaving the `Slice 1` string intact elsewhere so the slice-1 validator check keeps passing.

**Step 4: Run the full gates**

```bash
npm run check 2>&1 | tail -25
npm run secret-scan 2>&1 | tail -6
```

Expected: `tests <N> / fail 0`, `VALIDATION PASSED`, `SECRET-SCAN PASSED`.
Baseline was 408 tests / 131 checks; expect **131 + 8 file checks + 6 new checks = 145** validator checks. **Report the measured numbers, do not assume these.** If the count differs, find out why before continuing — a check that silently did not register is a check that is not protecting anything.

**Step 5: Commit**

```bash
git add scripts/validate-current-repository.mjs docs/atlas-40-webgl-renderer.md README.md
git commit -m "ATLAS-40: bind the slice-2 view, saved-view and legend claims to the repository validator and runbook"
```

---

## Task 9: Headed browser acceptance

Nothing in this task is committed to the repository. Playwright stays a scratchpad tool — it has never been a repository dependency and must not become one.

**Step 1: Set up**

```bash
SP=<scratchpad>/atlas40-slice2
mkdir -p "$SP/pw" && cd "$SP/pw"
npm init -y >/dev/null && npm i playwright@1.62.1 >/dev/null
npx playwright install chromium
node -e "console.log('playwright', require('playwright/package.json').version)"
```

Reuse the slice-1 harness as the base — it already proves the WebGL claim from
outside the application, watches console/pageerror/requestfailed/responses, and
covers search, zoom, pan, reset, focus, inspector, keyboard, reduced motion,
devicePixelRatio, the invalid-snapshot path and the no-WebGL path:

```
/private/tmp/claude-501/-Users-benjaminpoersch-Projects-project-atlas-foundation/a991051b-b6bf-404d-9b2f-f7b731240452/scratchpad/atlas40-visual/pw/acceptance.mjs
```

Serve the branch build:

```bash
cd <worktree> && npm run atlas39:serve   # -> http://127.0.0.1:4339/
```

**Step 2: Keep every slice-1 check, and add the slice-2 checks**

Primary viewport **1440×900**. Responsive countercheck at **1280×800** and **900×700** (the two sizes slice 1 used — the 900×700 case is what proves the legend no longer disappears below the 960px breakpoint).

New checks, at minimum:

| # | Check |
| --- | --- |
| 1 | initial state is Overview: `#view-overview[aria-pressed="true"]`, readout `Overview — 5 of 5 nodes, 4 of 4 relations.`, 5 `.a39-gnode` buttons |
| 2 | the Edge Legend shows exactly one row, reading `parent_of · explicit (4)` |
| 3 | the legend note reads `Every relation drawn here is parent_of (explicit); all are drawn with the same stroke.` |
| 4 | the legend contains none of `similar_to`, `related_to`, `inferred`, `mutual_knn`, `cluster` |
| 5 | the Hierarchy group shows exactly `Root (1)`, `Level 1 (3)`, `Level 2 (1)` and each swatch's computed `border-color` equals the computed value of its `--depth-*` token |
| 6 | focus "14 – Delivery Model…", press Neighbourhood → 3 node buttons, readout names the anchor, `aria-pressed` moves to Neighbourhood |
| 7 | in that view the legend re-derives: one row, count **2**, not 4 |
| 8 | Save view → `body[data-saved-view="saved"]`, `#saved-view-state` names the saved view |
| 9 | mutate: zoom in twice, pan by ~180px, switch to Overview, focus a different node — assert the visible state really changed (zoom readout, node count, `aria-pressed`) |
| 10 | Restore view → `body[data-saved-view="restored"]`, node count back to 3, anchor and focus back to the saved ids, `aria-pressed` back on Neighbourhood |
| 11 | determinism: restore **three times in a row** and capture `{mode, anchorId, focusId, zoom readout, sorted overlay geometry}` each time — assert all three are `deepEqual` |
| 12 | stale refusal: `localStorage.setItem(key, <valid JSON with anchor_id + "-deleted">)`, click Restore → `body[data-saved-view="refused"]`, `#saved-view-state` contains `E_SAVED_VIEW_STALE_NODE`, **and the stage still shows the pre-click node count and zoom** (nothing was changed) |
| 13 | version refusal: store `{"saved_view_version": 99, …}` → `E_SAVED_VIEW_VERSION`, stage unchanged |
| 14 | mode refusal: store a valid v1 record with `"mode": "cluster"` → `E_SAVED_VIEW_MODE`, stage unchanged |
| 15 | shape refusal: store `not json` → `E_SAVED_VIEW_INVALID`, stage unchanged |
| 16 | snapshot refusal: store a valid v1 record with `node_count: 6` → `E_SAVED_VIEW_SNAPSHOT`, stage unchanged |
| 17 | keyboard: Tab reaches Overview / Neighbourhood / Save / Restore / Clear, each with a non-empty accessible name; Enter activates Save; focus is not trapped (Shift+Tab leaves the group) |
| 18 | the live region announces the restore and the refusal (read `#live` after each) |
| 19 | pointercancel regression: real mouse drag across the threshold on the stage, dispatch a real `pointercancel`, then click a node — assert the node becomes focused (`aria-pressed="true"`) and the inspector updated |
| 20 | normal suppression still holds: drag across the threshold from on top of a node, release, assert the node did **not** become focused |
| 21 | at 900×700 the legend is still rendered and visible (`getBoundingClientRect().height > 0`, `visibility !== 'hidden'`), and no legend row is clipped by the stage border |
| 22 | at every viewport: no `.a39-gnode` label is clipped, the canvas does not overlap the shell chrome, and the new control group does not overlap the zoom group |
| 23 | fail-closed paths unchanged: invalid snapshot → visible panel, no graph, view + saved-view controls all `disabled`; no WebGL → `E_WEBGL_UNAVAILABLE`, nothing substituted |
| 24 | console / pageerror / requestfailed / non-2xx buckets are all empty |

**Step 3: Reproduce the pointercancel defect against the pre-fix build (counterexample)**

```bash
cd <worktree>
git stash push -- viewer/atlas39/core/gesture.mjs   # or edit out the one repair line
# re-run ONLY checks 19 and 20 against the running server
node "$SP/pw/pointercancel-only.mjs"
git stash pop
node "$SP/pw/pointercancel-only.mjs"
```

Report honestly which of the two outcomes occurred:

- the pre-fix build **swallows** the click → a user-visible defect was reproduced and repaired; report both runs;
- the pre-fix build **passes** → the stale flag is masked in this path by the `pointerdown` re-arm (see D9). Say so plainly: what was repaired is a latent state defect proved by `test/atlas40-gesture.test.mjs`, and the browser check is a guard, not a reproduction.

**Do not report a reproduction that did not happen.**

**Step 4: Record**

Write `pass`/`fail` per check plus totals to `$SP/evidence/`, keep the video and screenshots there, and put nothing under `viewer/`, `test/` or `docs/`. Confirm with `git status --porcelain` (expected: clean).

---

## Task 10: Adversarial self-review, then PR

**Step 1: Re-derive every claim yourself**

A subagent report, a green log scrolled past, and this plan's own predictions are all claims. Re-measure:

```bash
cd <worktree>
git rev-parse HEAD
git diff --stat 7b88d4f05f422cdf63e19e62cede57e3188b62ca..HEAD
git diff 7b88d4f05f422cdf63e19e62cede57e3188b62ca..HEAD -- package.json package-lock.json | wc -l   # expected: 0
npm run check 2>&1 | tail -25
npm run secret-scan 2>&1 | tail -6
node --test 'test/**/*.test.mjs' 2>&1 | grep -E '^ℹ (tests|pass|fail)'
```

Hard gates:
- `fail 0`, and the total is **greater than 408**
- `VALIDATION PASSED`, and the check count is **greater than 131** (predicted 145 — report the measured value)
- `SECRET-SCAN PASSED`
- the `package.json` / `package-lock.json` diff is **0 lines**: no dependency was added
- `test/golden/*.svg` is **not** in the diff — the golden gate must be untouched
- `viewer/atlas65/**`, `scripts/atlas65/**`, `viewer/atlas39/tokens.css`, `viewer/atlas39/stage.css` are **not** in the diff

**Step 2: Adversarial pass — hunt for these specific failure shapes**

1. Does any refusal path assign state before it refuses? Read `onRestoreView` top to bottom.
2. Can `state.view` ever hold an anchor that is not in the graph? Trace every assignment.
3. Does the legend ever render a row the model does not contain? Re-run the Task 5 mutation.
4. Does `applyTransform` still avoid a full `render()`? The Slice-1 test asserts it; confirm the test is still in the run output, not merely in the file.
5. Is the `#live` region still the only live region? `grep -n 'aria-live\|role="status"' viewer/atlas39/index.html` — expect exactly one.
6. Does `shell.css` still contain zero colour literals? The ATLAS-39 test proves it; confirm that test appears in the pass list.
7. Is `depthCaption` now the only place the wording "Level n" is decided? `grep -rn "Level \${" viewer/atlas39/` — expect one hit.
8. Did any string in `docs/atlas-40-webgl-renderer.md` become a performance claim? `grep -in 'fps\|latency\|p95\|fast\|performant' docs/atlas-40-webgl-renderer.md` and read every hit.

Repair everything found **before** opening the PR.

**Step 3: Push and open the PR**

```bash
git push -u origin feat/ATLAS-40-slice-2-views-saved-views-edge-legend
gh pr create --base main --title "ATLAS-40: deterministic views, saved views and a truthful edge legend (slice 2)" --body-file <body>
```

The PR body must state, in the repository's established style: the slice boundary, D1–D10, the exact saved-view contract, the measured test/validator numbers, the counterexample runs with their verbatim exit codes, the acceptance-run totals, **that AC6 and AC8 remain open and ATLAS-40 stays In Arbeit**, and that **no performance claim is made**.

**Step 4: Verify the PR head and its CI**

```bash
gh pr view <N> --json number,headRefOid,headRefName,changedFiles
git rev-parse HEAD          # must equal headRefOid, byte for byte
~/.claude/scripts/gh-ci-wait DYAI2025/project-atlas-foundation <headRefOid> 1800
gh run list --commit <headRefOid> --json databaseId,name,conclusion
```

`gh pr view --json merged` does not exist; do not use it. Both workflows (`check` and `secret-scan`) must be `success` **for the exact head SHA**, not for an earlier push.

**Step 5: DO NOT MERGE**

No merge. No G2 artefact. No Jira transition. No Confluence edit. ATLAS-40 stays **In Arbeit**. Return the seven-section evidence packet to the PO.

---

## Stop conditions — abort and report instead of widening scope

| Trigger | Status at planning time |
| --- | --- |
| `origin/main` ≠ `7b88d4f05f422cdf63e19e62cede57e3188b62ca` | cleared — measured equal |
| Slice-1 behaviour already regressed on main | cleared — 408/408, 131 checks, scan green |
| Saved views need a canonical semantic/data-model decision | not expected: the contract stores UI state only and reuses `project_id`/`source_id`/`contract_version`/`id_scheme` that already exist |
| A new graph dependency looks necessary | must not happen — the dependency diff gate in Task 10 is the tripwire |
| AC5 cannot be satisfied without ATLAS-33 semantics | not expected: "cluster" is read as a UI projection (D2), which needs no new semantics. **If review rejects that reading, STOP** — do not invent a taxonomy to satisfy it |
| PR #19 / ATLAS-25 would have to be modified | forbidden. PR #19 head `72bb627e` is recorded; verify at the end that it is unchanged |
| Unrelated architecture work becomes necessary | STOP and report |
| Tests reveal a blocker outside this slice | STOP and report |

---

## Evidence packet to return

Exactly these seven sections, with measured values only:

1. **START STATE** — `origin/main` SHA, branch name, PR #19 head before and after (`72bb627ea371790d428e1c1aa9f9b2b9ed78c7bd`), and the statement that ATLAS-25 was not touched.
2. **IMPLEMENTATION** — files changed with line counts, D1–D10, the saved-view contract verbatim, the two view modes, the legend derivation rule, the pointercancel repair.
3. **TEST EVIDENCE** — per-suite results, full `npm run check` tail, secret-scan tail, every negative path, and both mutation runs with verbatim exit codes and failing test names.
4. **VISIBLE BROWSER EVIDENCE** — Playwright version, browser build, viewports, the check table with pass/fail counts, console/network buckets, evidence location (scratchpad, uncommitted).
5. **PR EVIDENCE** — commit SHA, branch, PR number, exact head SHA, changed-file count, dependency delta (expected `0`), CI run IDs + conclusions for that exact head, review threads.
6. **DEFERRED / KNOWN ISSUES** — Minimap (AC6), performance/benchmark/LOD (AC8), any remaining Minor, and an explicit statement that ATLAS-25 / PR #19 remained untouched.
7. **VERDICT** — exactly one of `READY_FOR_PO_REVIEW` / `CHANGES_REQUIRED` / `BLOCKED`.

Do not merge. Do not claim ATLAS-40 Done.

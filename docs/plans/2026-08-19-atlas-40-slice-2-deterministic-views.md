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

**Corrected 2026-08-19 (review of Task 3).** The accepted snapshot cannot witness this rule: it is a tree, and the number of its nodes whose two neighbours are joined by an edge is `0`. No assertion over the real snapshot can tell this rule apart from "every edge incident to the anchor" — measured, not assumed — so Task 3 pins it with a four-node witness graph instead, and says in the test file that the witness is not evidence about ATLAS content.

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

**Corrected 2026-08-19 (second review of Task 5).** The hierarchy group has a limit of its own and this decision did not state it, which left it to be discovered while wiring Task 6. `depthTokenName` collapses **every depth >= 3** onto `--depth-n`, so on a graph deeper than three levels several differently-labelled rows carry an **identical** swatch. Measured on a six-level graph against the shipped module: `Root -> --depth-0`, `Level 1 -> --depth-1`, `Level 2 -> --depth-2`, `Level 3 -> --depth-n`, `Level 4 -> --depth-n`, `Level 5 -> --depth-n` — **4 distinct tokens over 6 rows** — and `Object.keys(buildDepthLegend(model))` is exactly `['entries','empty']`, so nothing in the returned value says so. Rendered by Task 6 as label + swatch, that implies a per-level colour the stage does not draw: the same overclaim the edge legend refuses for itself one group over through `distinguishesTypes: false` and `edgeLegendNote`. Nothing is red today — the accepted snapshot is three levels deep and every row has its own token, measured as `new Set(entries.map((e) => e.token)).size === entries.length`.

**The decision, recorded here rather than settled in code:** `buildDepthLegend` returns **no extra flag** for it, because the fact is already in the rows, and **Task 6 must say it** — a shell whose hierarchy rows share a token derives that from `new Set(entries.map((e) => e.token)).size < entries.length` and states "Level 3 and deeper share one colour" next to the group. The collapse itself belongs to `depthTokenName` in `core/scene.mjs` and is **not** changed by this slice. The limitation is pinned by test in `test/atlas40-legend.test.mjs` (`an absent depth is never displayed, and unrooted nodes sort last`), so a ladder that stopped collapsing, or started collapsing sooner, cannot pass unnoticed: mutating the row's token to a constant scores exit 1, 11/13.

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

The `pointerdown` handler re-arms `suppressClick = false`, which **masks** the stale flag for any click preceded by a left-button `pointerdown` inside `#stage-host`. It does **not** mask it when that handler early-returns on `event.button !== 0`, nor for any click that arrives without a preceding `pointerdown` — a keyboard-activated (Enter/Space) click on a stage node button is the concrete case.

**Corrected 2026-08-19 (review of Task 2).** The first draft of this paragraph also named "a target inside `.a39-stage-controls`" as a route past the re-arm. That route is **not reachable** and the claim overstated the exposure: `index.html:58-60` makes `.a39-stage-controls` a *sibling* of `#stage-host`, not a descendant, and every pointer and click listener in `wirePointer()` is bound to `dom.stageHost` (`app.mjs:646, 653, 660, 682-683`). A pointer event on the controls therefore never reaches those listeners at all — neither the `pointerdown` early-return at `app.mjs:655` nor the capture-phase `click` handler at `app.mjs:646` is on that path — so a stale flag can be neither preserved nor spent there. The two routes above are the real ones.

A further route belongs to Task 9's measurement rather than to this repair: the module keys the disarm on the *cause* (`event.type === 'pointercancel'`), not on the invariant "a suppression that no click will ever spend must not outlive the gesture". A pan ended by `pointerup` that yields no synthesised click would leave the identical stale flag. Whether a real browser synthesises a click after a *touch* pan on a surface with `touch-action: none` (`shell.css:329`) is **unmeasured** — Task 9 measures it alongside the pointercancel route and reports either way. No code change is made for it in this slice on an assumption.

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
- `test/helpers/purity.mjs` — the one purity guard every pure-core suite is scanned with. Added to the inventory 2026-08-19 after the second review of Task 3, which measured Task 3's re-spelled copy of the guard disagreeing with Task 2's in both directions. It is a test helper, not a suite: `npm test` globs `test/**/*.test.mjs`, so it is imported and never run on its own. **Corrected 2026-08-19 (third review of Task 3):** it is spelled out verbatim in **Task 3, Step 0**. Until that round it was the only entry in this inventory with no verbatim block anywhere in the plan — measured as 0 exact whole-file occurrences against 1 for each of the other four created code files — so the scope contract named a file whose implementation it did not contain.
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
  // Two links of the chain move together unless they are pinned from outside
  // it, so each gets its own independent statement below:
  //
  //   1. depth -> token name. `depthColor(...) === byToken[depthTokenName(...)]`
  //      stays true when a depth is moved onto a different token, because both
  //      sides move together. `expected` is the hand-written statement of which
  //      token each depth is entitled to.
  //   2. token name -> colour. `byToken['--depth-1']` is `palette.depth1`, and
  //      which CSS token that palette key holds is decided by the `wanted` map
  //      in `resolvePalette` — so both sides of assertion 1 read that same
  //      entry too. Re-reading tokens.css by the token name `depthTokenName`
  //      returned is the statement that cannot move with it.
  const expected = {
    null: '--depth-none',
    0: '--depth-0',
    1: '--depth-1',
    2: '--depth-2',
    3: '--depth-n',
    9: '--depth-n',
    40: '--depth-n'
  }
  // Two of the four statements below are documentation, not independent
  // checks, and are kept only as documentation: `token in byToken` is subsumed
  // by the `expected` table on the next line, which pins the exact token, and
  // `depthColor(...) === byToken[token]` is subsumed by the tokens.css re-read
  // that follows it, because `byToken[token]` and `parseCssColor(readToken(
  // token))` are the same value whenever `resolvePalette`'s `wanted` map is
  // intact. Measured in a throwaway copy: with both of those lines deleted and
  // `DEPTH_PALETTE_KEY['--depth-1']` mutated to `'depth2'`, this file still
  // fails on "depth 1 is not painted the colour its own token names". They stay
  // because they state the depth -> token -> colour chain in the order a reader
  // needs it; they do not add coverage.
  for (const depth of [null, 0, 1, 2, 3, 9, 40]) {
    const token = depthTokenName(depth)
    assert.ok(token in byToken, `depth ${depth} produced unknown token ${token}`)
    assert.equal(token, expected[String(depth)], `depth ${depth} was assigned ${token}`)
    assert.deepEqual(depthColor(palette, depth), byToken[token], `depth ${depth}`)
    assert.deepEqual(
      depthColor(palette, depth),
      parseCssColor(readToken(token)),
      `depth ${depth} is not painted the colour its own token names`
    )
  }
})
```

**Corrected 2026-08-19 (second review of Task 1).** The block above is now the shipped test **verbatim** — `sha256` of the block extracted from this document and of `test/atlas40-scene.test.mjs` from the line `test('every depth maps to exactly one design token…` to end of file are both `9d30647cc9249e6e3f33d91257045c4b2b9778609bc82b13f721415809f0accf`. Two defects made that necessary, and neither was disclosed:

1. **The prescribed comment was the claim D8 retracted, still telling the implementer to write it.** Until this round the block carried `// The legend swatch is painted from the token name and the disc is stroked // from the colour.` Both halves are false at this head. There is no legend yet — the swatch is painted by `shell.css:481,486-496` from `data-depth` attributes — and the disc is stroked by `core/render-webgl.mjs:191-199`'s own inlined ladder, not by `depthColor`, which has no production caller at all: `grep -rn 'depthColor\|depthTokenName' viewer test scripts docs` finds only `core/scene.mjs`, `test/atlas40-scene.test.mjs`, `test/atlas40-render-webgl.test.mjs` and this plan. That is exactly the overclaim D8's own `Corrected 2026-08-19 (review of Task 1)` note (line 124) retracted from the docstring and from the Step-5 commit subject, left standing in the step that tells the next implementer what to type.
2. **The block silently diverged from the file it prescribes.** The shipped test replaced that comment with an accurate one during the Task-1 review, and nothing recorded the divergence — against the convention Task 2 follows, where both blocks are the files verbatim. A re-run of this plan would have re-introduced the retracted claim.

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
import { readFileSync } from 'node:fs'
import {
  createDragGesture,
  DRAG_THRESHOLD,
  GestureError,
  E_GESTURE_THRESHOLD
} from '../viewer/atlas39/core/gesture.mjs'
// One purity guard for every pure core module, so a second suite cannot ship a
// weaker copy of it. See the header above the STRING_MARKER_MUTANT below.
import {
  stripComments,
  purityViolations,
  PurityScanError,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'

const down = (over = {}) => ({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 100, clientY: 100, ...over })
// `buttons` is part of the record the module reads: 0 means the press is over.
// A move fixture without it would leave the whole "the button is still held"
// invariant untested, and the module refuses a step whose button state it
// cannot read rather than assuming one is held.
const move = (over = {}) => ({ type: 'pointermove', pointerId: 1, buttons: 1, clientX: 100, clientY: 100, ...over })
const up = (over = {}) => ({ type: 'pointerup', pointerId: 1, ...over })
const cancel = (over = {}) => ({ type: 'pointercancel', pointerId: 1, ...over })

/** Drags far enough to cross the threshold. Returns the gesture. */
function panned() {
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4, clientY: 100 }))
  assert.equal(step.panning, true, 'the fixture did not actually start a pan')
  assert.equal(step.began, true)
  // dx/dy are the whole numeric output of this module — what the shell feeds to
  // panBy. Asserting only `.panning` would let a build that reports no movement,
  // or movement at right angles to the pointer, ship green.
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the crossing step must report the full movement since the press')
  assert.equal(step.dy, 0, 'a purely horizontal drag reported vertical movement')
  return g
}

test('a movement below the threshold is a click, not a pan', () => {
  const g = createDragGesture()
  g.start(down())
  // isPanning() must distinguish "a pointer is down" from "a pan is running" —
  // that distinction is the whole reason the method exists, and every other
  // assertion of it runs with a pan already in flight, where a method that
  // merely reported "a pointer is down" would read identically.
  assert.equal(g.isPanning(), false, 'a press that has not moved is not a pan')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD - 1 }))
  assert.equal(step.panning, false)
  assert.equal(g.isPanning(), false, 'a press that moved below the threshold is not a pan')
  assert.equal(g.isClickSuppressed(), false, 'a click gesture must never suppress its own click')
  g.end(up())
  assert.equal(g.consumeClick(), false)
})

test('the threshold is 4 screen pixels, and exactly that far already pans', () => {
  // The value and the boundary are both hand-written here on purpose. Every
  // other test spells the threshold symbolically, so without this table a
  // tenfold change to an accepted, human-visually-signed-off interaction
  // constant — or a `>=` quietly becoming `>` — passes with nothing red.
  assert.equal(DRAG_THRESHOLD, 4, 'the accepted drag threshold changed')
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD }))
  assert.equal(step.panning, true, 'a movement of exactly the threshold must pan (the comparison is >=)')
  assert.equal(step.dx, DRAG_THRESHOLD)
  assert.equal(step.dy, 0)
})

test('the threshold option is honoured, so a caller can pass its own', () => {
  const g = createDragGesture({ threshold: DRAG_THRESHOLD * 5 })
  g.start(down())
  const below = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 }))
  assert.equal(below.panning, false, 'the default threshold was used instead of the option')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 5 }))
  assert.equal(step.panning, true)
  assert.equal(step.dx, DRAG_THRESHOLD * 5, 'a refused step must not consume the movement it refused')
  assert.equal(step.dy, 0)
})

test('a threshold that would disable the threshold is refused, not silently accepted', () => {
  // Both `Math.hypot(dx, dy) < NaN` and `Math.hypot(dx, dy) < 'x'` are false, so
  // an unvalidated option silently switches the threshold OFF: a half-pixel
  // twitch becomes a pan and every click on the stage is swallowed. The option
  // fails closed instead, the way ViewModelError/PaletteError do for their own
  // unusable input.
  for (const bad of [Number.NaN, -1, 0, null, 'x', Infinity, -Infinity]) {
    assert.throws(
      () => createDragGesture({ threshold: bad }),
      (err) => err instanceof GestureError && err.code === E_GESTURE_THRESHOLD,
      `createDragGesture accepted the unusable threshold ${String(bad)}`
    )
  }
  // The default is still reachable, and a usable explicit value still works.
  assert.equal(createDragGesture().isPanning(), false)
  assert.equal(createDragGesture({}).isPanning(), false)
  assert.equal(createDragGesture({ threshold: undefined }).isPanning(), false)
  const tight = createDragGesture({ threshold: 1 })
  tight.start(down())
  assert.equal(tight.move(move({ clientX: 101 })).panning, true, 'a usable explicit threshold was refused')
})

test('each pan step reports the delta since the previous point, and begins exactly once', () => {
  const g = createDragGesture()
  g.start(down())
  const first = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4, clientY: 100 }))
  assert.equal(first.began, true)
  assert.equal(first.dx, DRAG_THRESHOLD * 4)
  assert.equal(first.dy, 0)
  const second = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 + 3, clientY: 93 }))
  assert.equal(second.panning, true)
  // The shell takes the pointer capture on `began`; a second true would re-take it.
  assert.equal(second.began, false, 'began must be true only on the step that crossed the threshold')
  assert.equal(second.dx, 3, 'the delta is measured from the previous point, not from the press origin')
  assert.equal(second.dy, -7)
})

test('a threshold-crossing drag suppresses exactly the click it produced', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true)
  g.end(up())
  // Read once more AFTER the pan ended, which is the one moment the accessor
  // exists for and the only moment where `suppressClick` and `active?.panning`
  // DISAGREE. Every other reading of it in this file is taken where the two
  // agree, which let `isClickSuppressed()` be rewired to report the panning
  // flag instead with the whole suite green — the same surviving-mutant class
  // already found and repaired for its sibling `isPanning()`.
  assert.equal(g.isPanning(), false, 'the pan is over once its pointer lifted')
  assert.equal(g.isClickSuppressed(), true, 'the suppression the pan armed did not survive its own pointerup')
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

test('a pointercancel from a pointer this gesture does not own leaves the suppression alone', () => {
  // The mirror image of the REGRESSION test above, and the assertion that pins
  // WHERE the repair sits: hoisting `if (event.type === 'pointercancel')` above
  // the ownership early-return is a one-line reordering that keeps every other
  // test in this file green. On a multi-touch stage (`touch-action: none`) the
  // browser cancels unrelated pointers routinely, and a foreign cancel that
  // disarmed the owner's suppression would hand the pan's own synthesised click
  // to whatever node the pan ended over — a silent selection the user never made.
  const g = panned()
  const foreign = g.end(cancel({ pointerId: 2 }))
  assert.deepEqual(
    foreign,
    { ended: false, wasPanning: false, pointerId: null },
    'a foreign pointercancel ended a gesture it does not own'
  )
  assert.equal(g.isClickSuppressed(), true, 'a foreign pointercancel disarmed a suppression it does not own')
  assert.equal(g.isPanning(), true, 'a foreign pointercancel stopped the pan')
  const done = g.end(up())
  assert.equal(done.ended, true)
  assert.equal(done.wasPanning, true)
  assert.equal(g.consumeClick(), true, "the pan's own click was let through onto a node")
})

test('an accidental second press by another pointer is refused while the panning pointer is alive', () => {
  // The ordinary accidental second touch on a stage with `touch-action: none`.
  // Unguarded, start() overwrote the active gesture and cleared its suppression:
  // the finger that was moving could then neither move nor end, and because the
  // shell gates its cleanup on end() reporting `ended`, the pointer capture was
  // never released and body[data-panning] never removed — the pan dies under the
  // user's finger with nothing on screen to explain it.
  //
  // The name says "an accidental second press" and not "no second press",
  // because the module deliberately does not guarantee the stronger claim: the
  // panning pointer's OWN id re-anchors (the test below), and a second foreign
  // press that the owner answers with nothing re-anchors too (the test after
  // it). Both exemptions exist so a gesture whose end this module never sees
  // cannot disable the stage permanently.
  const g = panned()
  assert.equal(g.start(down({ pointerId: 2, clientX: 500, clientY: 500 })), false, 'a second press hijacked a pan in flight')
  assert.equal(g.isPanning(), true, 'the second press cancelled the pan it does not own')
  assert.equal(g.isClickSuppressed(), true, 'the second press disarmed a suppression it does not own')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 + 5 }))
  assert.equal(step.panning, true, 'the panning pointer could no longer move the stage')
  assert.equal(step.dx, 5)
  assert.equal(step.dy, 0)
  // That step is proof the owner is alive, so the next accidental touch is
  // refused again rather than counting as the second unanswered press.
  assert.equal(
    g.start(down({ pointerId: 3, clientX: 700, clientY: 700 })),
    false,
    'a pointer that had just moved the stage was presumed lost'
  )
  assert.equal(g.isPanning(), true)
  const done = g.end(up())
  assert.equal(done.ended, true, 'the panning pointer could no longer end its own gesture')
  assert.equal(done.pointerId, 1)
  assert.equal(done.wasPanning, true)
})

test('a lost panning TOUCH pointer gives the stage back on the second unanswered press', () => {
  // The residual the guard above used to leave permanently open. A touch pan
  // whose pointerup/pointercancel is never delivered cannot re-anchor on its
  // own id, because that finger is gone and its id never returns: every later
  // finger was refused, the stage could not be panned again for the life of the
  // page, body[data-panning] stayed set (the shell removes it only when end()
  // reports `ended`) and the grabbing cursor with it. Slice 1's app.mjs
  // self-healed on the very next press; this module must not be worse than the
  // code it replaces.
  const g = createDragGesture()
  assert.equal(g.start(down({ pointerId: 11 })), true)
  const pan = g.move(move({ pointerId: 11, clientX: 100 + DRAG_THRESHOLD * 4 }))
  assert.equal(pan.panning, true, 'precondition: a touch pan is in flight')
  // ...and pointer 11 is never heard from again.
  assert.equal(
    g.start(down({ pointerId: 12, clientX: 400, clientY: 400 })),
    false,
    'the first fresh finger stole a pan that may still be live'
  )
  // That refused tap must not be eaten by the lost pan's suppression either.
  assert.equal(g.consumeClick(), false, "the fresh finger's tap was swallowed by a pan it has nothing to do with")
  assert.equal(g.start(down({ pointerId: 13, clientX: 500, clientY: 500 })), true, 'the stage stayed bricked against every later finger')
  assert.equal(g.isPanning(), false, 're-anchoring left the stale pan running')
  assert.equal(g.isClickSuppressed(), false, 're-anchoring left the stale suppression armed')
  const step = g.move(move({ pointerId: 13, clientX: 500 + DRAG_THRESHOLD * 4, clientY: 500 }))
  assert.equal(step.panning, true, 'the re-anchored finger could not pan')
  assert.equal(step.began, true)
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the re-anchored finger measured from the lost gesture origin')
  const done = g.end(up({ pointerId: 13 }))
  assert.equal(done.ended, true, 'the shell never gets to release the capture or remove body[data-panning]')
  assert.equal(done.pointerId, 13)
})

test('a click that arrives while a gesture is still running is not that gesture to swallow', () => {
  // The browser synthesises a pan's click AFTER its pointerup, so a click that
  // arrives while the gesture is still in flight belongs to something else — a
  // second finger tapping a node, or a keyboard-activated click on a stage node
  // button. Spending the suppression on it is the swallowed click this module
  // exists to prevent, one gesture removed.
  const g = panned()
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  assert.equal(g.consumeClick(), false, "a click during a live pan was swallowed as that pan's tail")
  assert.equal(g.isClickSuppressed(), true, 'a click that is not the pan tail spent the suppression anyway')
  const done = g.end(up())
  assert.equal(done.ended, true)
  assert.equal(g.consumeClick(), true, "the pan's own click was no longer swallowed")
})

test('a press that never panned is replaceable by any other pointer', () => {
  // The guard above is keyed on `panning`, not on `active`, and this is why: a
  // press whose pointerup or pointercancel the shell never sees would otherwise
  // refuse every later press for the lifetime of the page.
  //
  // The name of this test is deliberately narrow. It pins the never-panned half
  // of the lost-pointer story only; the panning halves are the tests above and
  // below it.
  const g = createDragGesture()
  assert.equal(g.start(down()), true)
  assert.equal(g.start(down({ pointerId: 2, clientX: 200, clientY: 200 })), true, 'a press that never panned blocked the next one')
  const step = g.move(move({ pointerId: 2, clientX: 200 + DRAG_THRESHOLD * 4, clientY: 200 }))
  assert.equal(step.panning, true, 'the replacing press could not pan')
  assert.equal(step.dx, DRAG_THRESHOLD * 4)
  assert.equal(g.move(move({ pointerId: 1, clientX: 900 })).panning, false, 'the replaced pointer still drives the stage')
})

test('a lost PANNING pointer re-anchors on its own next press instead of dead-locking the stage', () => {
  // The longer-lived lost-pointer state, and the one where the pointer is most
  // likely to leave the element: a pan is in flight and the shell never sees
  // the matching pointerup/pointercancel — a window blur mid-drag, a native
  // drag or context-menu takeover, or an `up` that landed outside the listening
  // element because pointer capture was unavailable.
  //
  // Keyed on `panning` alone, that state was permanent: every later press of
  // every id was refused, while each stray pointermove still reported
  // `{panning: true}` with a live delta, so the wired stage would follow the
  // bare cursor with `began` false and therefore nothing in the DOM to show it.
  // Slice 1's app.mjs re-anchored on every primary pointerdown, so the identical
  // lost pointer self-healed on the user's next click; this test pins that the
  // module does not regress below that. For a mouse — whose pointer id does not
  // change, and whose bare hover also carries `buttons: 0` — this state is
  // closed twice over: by the drop in `move()` and by this re-anchor.
  const g = panned()
  assert.equal(g.isPanning(), true, 'precondition: a pan is in flight')
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  assert.equal(
    g.start(down({ pointerId: 1, clientX: 300, clientY: 300 })),
    true,
    'the lost panning pointer could not re-anchor, so no press can ever reach the stage again'
  )
  assert.equal(g.isPanning(), false, 're-anchoring left the stale pan running')
  assert.equal(g.isClickSuppressed(), false, 're-anchoring left the stale suppression armed')
  // The re-anchored press measures from where it pressed, not from the stale
  // origin the lost gesture left behind.
  const step = g.move(move({ pointerId: 1, clientX: 300 + DRAG_THRESHOLD * 4, clientY: 300 }))
  assert.equal(step.panning, true, 'the re-anchored press could not pan')
  assert.equal(step.began, true, 'the re-anchored press inherited the lost gesture\'s panning state')
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the re-anchored press measured from the lost gesture origin')
  assert.equal(step.dy, 0)
  const done = g.end(up())
  assert.equal(done.ended, true, 'the re-anchored gesture could not end')
  assert.equal(done.wasPanning, true)
  assert.equal(done.pointerId, 1)
})

test('a press whose end this module never sees is dropped by the first move with no button held', () => {
  // Ordinary mouse, no lost-pointer exoticism required. A press that stays
  // under the threshold never makes the shell take a pointer capture (Task 6
  // takes it on `began`), so a pointerup released over a SIBLING of
  // `#stage-host` — `.a39-stage-controls` and the sidebar both are, which
  // index.html:58-60 proves — never reaches the shell's listener and `end()`
  // is never called. Trusting `active` alone, the next bare hover measured a
  // large delta from the stale press origin, crossed the threshold, panned the
  // graph under a cursor with no button held, and armed a click suppression
  // that swallowed the user's next real click.
  const g = createDragGesture()
  g.start(down())
  assert.equal(g.move(move({ clientX: 101 })).panning, false, 'precondition: the press stayed under the threshold')
  // The pointerup happens somewhere this module never hears about it. Then the
  // user hovers back over the stage with NO button held.
  const hover = g.move(move({ clientX: 260, clientY: 180, buttons: 0 }))
  assert.deepEqual(hover, { panning: false, began: false, dx: 0, dy: 0 }, 'a bare hover panned the stage from a stale press origin')
  assert.equal(g.isPanning(), false)
  assert.equal(g.isClickSuppressed(), false, 'a bare hover armed a click suppression')
  // The stale press is gone, not merely skipped: even a later move that does
  // report a held button cannot resurrect it without a fresh pointerdown.
  assert.equal(g.move(move({ clientX: 900, clientY: 900 })).panning, false, 'a dropped press still drove the stage')
  assert.equal(g.consumeClick(), false)

  // Same story one step further along: a pan that crossed the threshold and
  // whose pointerup the module never saw. Here the suppression is already
  // armed, and the click it was waiting for — if the browser synthesised one at
  // all — was dispatched before this hover ever arrived.
  const p = panned()
  assert.equal(p.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  const hover2 = p.move(move({ clientX: 500, clientY: 500, buttons: 0 }))
  assert.equal(hover2.panning, false, 'a bare hover kept panning the stage')
  assert.equal(p.isPanning(), false, 'a pan with no button held is still a pan')
  assert.equal(p.isClickSuppressed(), false, 'a lost pan left a suppression with no click left to spend it on')
  assert.equal(p.consumeClick(), false, "the user's next real click was swallowed")
})

test('a step whose button state or coordinates cannot be read is refused, not treated as a pan', () => {
  // `Math.hypot(NaN, NaN) < 4` and `Math.hypot(Infinity, 0) < 4` are both
  // false — the identical fail-open mechanism this module documents and guards
  // against for the `threshold` operand, on the delta operand. Written as `<`,
  // a delta the module cannot measure fell straight through: a ZERO-pixel move
  // reported `{panning: true, began: true, dx: NaN}`, armed a click suppression
  // for a pan that never happened, and fed NaN to the shell's panBy, which
  // poisons the stage transform permanently.
  const g = createDragGesture()
  assert.equal(
    g.start({ type: 'pointerdown', pointerId: 1, button: 0 }),
    false,
    'a press with no coordinates started a gesture'
  )
  assert.equal(g.start(down({ clientX: Number.NaN })), false, 'a press at NaN started a gesture')
  assert.equal(g.start(down({ clientY: Infinity })), false, 'a press at Infinity started a gesture')
  assert.equal(g.isPanning(), false)

  assert.equal(g.start(down()), true)
  for (const bad of [{ clientX: Number.NaN }, { clientY: Infinity }, { clientX: undefined }, { clientY: -Infinity }]) {
    assert.deepEqual(
      g.move(move(bad)),
      { panning: false, began: false, dx: 0, dy: 0 },
      `a move at ${JSON.stringify(bad)} was treated as movement`
    )
  }
  assert.equal(g.isPanning(), false, 'a delta the module cannot measure started a pan')
  assert.equal(g.isClickSuppressed(), false, 'a pan that never happened armed a click suppression')
  // A pan already in flight skips the threshold comparison entirely, so up
  // there the delta guard is the only thing between NaN and the shell's panBy —
  // which renders the stage transform permanently unusable.
  const p = panned()
  assert.deepEqual(
    p.move(move({ clientX: Number.NaN })),
    { panning: false, began: false, dx: 0, dy: 0 },
    'a running pan fed NaN straight through to the shell'
  )
  assert.equal(p.isPanning(), true, 'a refused step ended a live pan')
  // A step whose button state is missing is refused the same way — but a stream
  // this module cannot read must not be able to cancel a real gesture, so the
  // press survives it.
  assert.equal(
    g.move({ type: 'pointermove', pointerId: 1, clientX: 200, clientY: 100 }).panning,
    false,
    'a step with no button state was treated as a held button'
  )
  assert.equal(
    g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 })).panning,
    true,
    'a refused step discarded the live gesture instead of just refusing itself'
  )
})

test('only the primary button starts a gesture', () => {
  const g = createDragGesture()
  assert.equal(g.start(down({ button: 2 })), false)
  assert.equal(g.move(move({ clientX: 400 })).panning, false)
  // The documented success return is read here, so a start() that reports
  // failure while starting a gesture cannot ship green.
  assert.equal(g.start(down()), true, 'a primary press must start a gesture and say so')
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

// ---------------------------------------------------------------------------
// The purity guard, and the guard on the guard.
//
// The scanner itself now lives in test/helpers/purity.mjs and is imported at
// the top of this file, because the view-state suite re-spelled it as a raw
// substring list of its own and the two disagreed in both directions — false
// reds on ordinary prose, blind spots on a real clock. Its rationale, its
// measured history and its denylists are documented there; the tests that pin
// its capability stay here, where they were written.
//
// The rule it exists for: scan the CODE, not the English. This module's
// comments are long and load-bearing, and 'window', 'document', 'navigator' and
// 'performance' are ordinary words inside them — a raw substring scan fires on
// vocabulary rather than on capability use, and it already did once: the
// comment "a window losing the pointer" tripped this guard while the code was
// pure.
// ---------------------------------------------------------------------------

/** The exact mutation that defeated the regex strip this scanner replaced. */
const STRING_MARKER_MUTANT = [
  "const OPEN_MARK = '/*'",
  'function leakProbe() { return document.title + window.name + navigator.userAgent }',
  "const CLOSE_MARK = '*/'",
  'export const MARKS = [OPEN_MARK, CLOSE_MARK, leakProbe]'
].join('\n')

// The exact mutation that defeated the string-aware scanner, in the same class:
// a scanner that knows strings but not REGULAR EXPRESSION literals consumes the
// `\/` of `/\//` as an ordinary escaped backslash, then reads the closing `/`
// plus the following `/` as the start of a line comment and deletes the rest of
// the line. Measured on the predecessor of the current scanner, verbatim:
// stripComments("const SLASH_RE = /\\//; const t = document.title") returned
// "const SLASH_RE = /\\", and purityViolations() of that same text returned [].
// End to end, appended as one line to viewer/atlas39/core/view-state.mjs with
// `grep -c document.title` = 1 proving the probe was on disk, that suite stayed
// green at exit 0, 18/18 — a clock and a DOM read walking past a guard named
// for refusing both.
const REGEX_MARKER_MUTANT = 'export const SLASH_RE = /\\//; export const stamp = () => document.title + Date.now()'

// The mutation above spells the regex after `=`, which is the one position the
// scanner already read correctly, so on its own it proved nothing about the
// sibling positions. This one is the shape this codebase actually writes:
// semicolon-free statements, so the keyword that licenses the regex follows an
// IDENTIFIER across a newline. Measured on the committed scanner before the
// word-boundary repair: `keep()` never ended a word at whitespace, so the
// previous word here was `textreturn`, which is in no keyword list, `/\//`
// lexed as a division and the `//` inside it deleted the rest of the line —
// purityViolations() returned [] on this exact text, while the same function
// with `String(text)` on the line above (a `)` ending the word, so `return` was
// seen) returned ["document.","document"]. End to end, appended to
// viewer/atlas39/core/view-state.mjs it left that suite at exit 0, 18/18 with a
// DOM read and a clock on disk.
const REGEX_AFTER_IDENTIFIER_MUTANT = [
  'export function hasSlash(text) {',
  '  const subject = text',
  "  return /\\//.test(subject) ? document.title + Date.now() : ''",
  '}'
].join('\n')

test('the gesture carries no clock, randomness or DOM', () => {
  const source = readFileSync(new URL('../viewer/atlas39/core/gesture.mjs', import.meta.url), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it
  // was meant to leave standing — one probe per region of the module.
  assert.match(code, /export function createDragGesture/, 'the comment strip removed the code as well')
  assert.match(code, /!\(Math\.hypot\(dx, dy\) >= threshold\)/, 'the comment strip removed the threshold comparison')
  assert.match(code, /event\.type === 'pointercancel'/, 'the comment strip removed the pointercancel repair')
  assert.match(code, /return active\?\.panning === true/, 'the comment strip removed isPanning')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(code.includes(forbidden), false, `gesture.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      code,
      new RegExp(`\\b${forbidden}\\b`),
      `gesture.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(code, MODULE_SPECIFIER, 'gesture.mjs imports from a module specifier')
  assert.deepEqual(purityViolations(source), [], 'the purity rules disagree with each other')
})

test('the purity guard cannot be switched off by a string or a regular expression literal, and sees imports and randomness', () => {
  // Without this test the guard proves only that four PRE-EXISTING regions
  // survived the strip, which says nothing about a newly added region the strip
  // ate. These assertions are about the guard's own capability.

  // 1. The superseded regex strip really did have the hole, so this is a repair
  //    and not decoration.
  const supersededStrip = STRING_MARKER_MUTANT
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(supersededStrip, /document\.title/, 'the superseded strip no longer reproduces its own hole')

  // 2. The scanner keeps that code, so the denylists get to see it.
  const scanned = stripComments(STRING_MARKER_MUTANT)
  assert.match(scanned, /function leakProbe/, 'two string literals deleted the code between them')
  assert.equal(
    scanned.split('document.title').length - 1,
    1,
    'the code between two string-literal comment markers was eaten by the strip'
  )
  assert.ok(
    purityViolations(STRING_MARKER_MUTANT).includes('document.'),
    'a probe hidden between two string literals passed the purity guard'
  )

  // 3. Comments are still removed, so prose still cannot fire the guard — the
  //    failure this guard was already reworked twice to repair.
  const prose = [
    '// a window losing the pointer, and document.title, and navigator.userAgent',
    '/** @param {number} x — window.name, document.body, performance.now() */',
    'const kept = 1'
  ].join('\n')
  assert.deepEqual(purityViolations(prose), [], 'prose fired the purity guard')
  assert.match(stripComments(prose), /const kept = 1/, 'the strip ate the code around the prose')

  // 4. A string whose CONTENT looks like a comment marker stays code.
  assert.match(
    stripComments("const s = 'a // and a /* inside a string are text'"),
    /a \/\/ and a \/\* inside a string are text/,
    'the scanner treated a string literal as a comment'
  )

  // 5. The denylists see the two capabilities they were blind to: module
  //    imports (static, re-exported and dynamic) and randomness.
  assert.ok(
    purityViolations("import { readFileSync } from 'node:fs'").includes('import'),
    'a static import passed the purity guard'
  )
  assert.ok(
    purityViolations("export { readFileSync } from 'node:fs'").includes("from '<specifier>'"),
    'a re-export from a module specifier passed the purity guard'
  )
  assert.ok(
    purityViolations("const load = () => import('node:fs')").includes('import'),
    'a dynamic import passed the purity guard'
  )
  assert.ok(
    purityViolations('const jitter = crypto.getRandomValues(new Uint8Array(1))[0]').includes('crypto'),
    'crypto.getRandomValues passed the purity guard'
  )
  assert.ok(
    purityViolations('const t = setTimeout(fn, 0)').includes('setTimeout'),
    'setTimeout passed the purity guard'
  )

  // 6. A regular expression literal is code too, and the one ending in an
  //    escaped slash is what defeated the scanner that knew only strings. The
  //    literal survives the strip whole, and everything after it on the same
  //    line is still scanned.
  const scannedRegex = stripComments(REGEX_MARKER_MUTANT)
  assert.match(scannedRegex, /const SLASH_RE = \/\\\/\//, 'the scanner truncated the regular expression literal')
  assert.match(scannedRegex, /document\.title/, 'a regex literal switched the scan off for the rest of the line')
  assert.ok(
    purityViolations(REGEX_MARKER_MUTANT).includes('document.'),
    'a DOM read behind a regular expression literal passed the purity guard'
  )
  assert.ok(
    purityViolations(REGEX_MARKER_MUTANT).includes('Date.'),
    'a clock behind a regular expression literal passed the purity guard'
  )

  // 6b. The same literal one token boundary further away: the keyword that
  //     licenses it follows an identifier across a newline, which is how every
  //     statement in this semicolon-free codebase ends. A word that does not
  //     close at whitespace re-opens the `//`-deletion hole of 6.
  const scannedAfterIdentifier = stripComments(REGEX_AFTER_IDENTIFIER_MUTANT)
  assert.match(
    scannedAfterIdentifier,
    /return \/\\\/\/\.test\(subject\)/,
    'a keyword that follows an identifier across whitespace was not recognised, so the regex literal was lexed as a division'
  )
  assert.match(
    scannedAfterIdentifier,
    /document\.title/,
    'a regex literal after a keyword that follows an identifier switched the scan off for the rest of the line'
  )
  assert.ok(
    purityViolations(REGEX_AFTER_IDENTIFIER_MUTANT).includes('document.'),
    'a DOM read behind a regex literal in statement-after-identifier position passed the purity guard'
  )
  assert.ok(
    purityViolations(REGEX_AFTER_IDENTIFIER_MUTANT).includes('Date.'),
    'a clock behind a regex literal in statement-after-identifier position passed the purity guard'
  )
  // The repair must not turn ordinary division into a regex: `subject` is not a
  // keyword, so the slash after it still divides and the line survives whole.
  assert.match(
    stripComments('const half = subject / 2\nconst t = 1'),
    /const half = subject \/ 2\nconst t = 1/,
    'a division after an ordinary identifier was read as a regular expression'
  )

  // 7. Where the scanner cannot classify a slash it refuses instead of
  //    guessing, because guessing is what deleted the line above. A regex
  //    literal cannot span a line, so one that does not close on its own is a
  //    text this scanner must not strip.
  assert.throws(
    () => stripComments('const broken = /abc\nconst t = document.title'),
    PurityScanError,
    'an unclassifiable slash was guessed at instead of refused'
  )
})
```

This block is the file verbatim; the `readFileSync` import the purity test needs is inside it.

**Corrected 2026-08-20 (fourth review of Task 3).** The block above is the repaired suite, `shasum -a 256 test/atlas40-gesture.test.mjs` = `4133ce3612f385788ba796eae8acebb018a602cc0d67e57f49a1daa5ddbba0a8`. Still **22** tests: the repair adds one constant and five assertions inside the existing guard-on-the-guard test. `node --test test/atlas40-gesture.test.mjs` exits **0** at `tests 22 / pass 22 / fail 0`.

`REGEX_MARKER_MUTANT` spells its regex literal after `=`, which is the one position the scanner already read correctly, so it gave **zero** coverage of the sibling positions while making the repair read as complete. The new `REGEX_AFTER_IDENTIFIER_MUTANT` is the shape this codebase actually writes — semicolon-free statements, so the keyword that licenses the regex follows an IDENTIFIER across a newline. Measured against the lexer as it was committed (the `keep()` body restored to `if (/\s/.test(ch)) continue; prev = ch; prevWord = IDENTIFIER_CHAR.test(ch) ? prevWord + ch : ''`, with the new assertions in place): exit **1**, `tests 22 / pass 21 / fail 1`, red on `a keyword that follows an identifier across whitespace was not recognised, so the regex literal was lexed as a division`. Restored to the repaired helper `0b0f00e2787cca25cce6732c931d30b5a7c205b3a1b1cc81ea789e5607b5c174` — the hash printed and compared, never an empty `diff` — it exits **0** at 22/22. Four of the five assertions are about that mutant; the fifth pins the other direction, that `subject / 2` after an ordinary identifier is still a division and not a regex. The lexer repair itself, its probe and the four-module byte-identity are in Task 3, Step 0.

**Corrected 2026-08-19 (third review of Task 3).** The block above gained the `PurityScanError` import, a `REGEX_MARKER_MUTANT` constant and four assertions, and the guard-on-the-guard test is renamed to `the purity guard cannot be switched off by a string or a regular expression literal, and sees imports and randomness`. Still 22 tests: `node --test test/atlas40-gesture.test.mjs` exits **0** at `tests 22 / pass 22 / fail 0`. The guard those assertions pin is the shared one in `test/helpers/purity.mjs`, whose verbatim block and measured repair are in Task 3, Step 0 — the scanner knew string literals but not regular-expression ones, which is the same class of hole a third time. With only the regex branch of the repaired scanner disabled (`if (false && ch === '/' && regexCanStart())`), this suite exits **1** at `pass 21 / fail 1`, red on `the scanner truncated the regular expression literal`.

The **pristine `test/atlas40-gesture.test.mjs` hash the Step-4a campaign restores to therefore moves** from `f680d1089d0ba973f3e7d92af20456a26f2885841ee0dd9955176213da3af7c6` to `d6a38df5cddf6be318e1e501fcc17aaa8ef2ee6c04aea78707367f04ab2549a9`; `viewer/atlas39/core/gesture.mjs` is untouched and stays `f7f96be96d85dd39b727f13410b9b797e6ecc9364deb46904fc5e5aed4dea6be`. The Step-4a table was not re-run in full this round, so three of its rows were re-measured against the changed suite as a spot check rather than the numbers being carried forward on the argument that only assertions were added — the string-marker probe appended to `gesture.mjs` gave exit 1, `pass 21 / fail 1`; deleting `if (event.type === 'pointercancel') suppressClick = false` gave exit 1, `pass 20 / fail 2`; `isPanning()` → `return active !== null` gave exit 1, `pass 17 / fail 5`. All three equal the values the table records, and `gesture.mjs` restored to the hash above after each.

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
// touch the browser takes over, a page that loses the pointer, a device
// disconnecting — left the click suppression armed. A cancelled pointer never
// delivers the click that suppression was waiting for, so the flag stayed
// armed with nothing to spend it on.
//
// A swallowed click is the worst kind of interaction defect: nothing is drawn
// wrong, nothing errors, the application simply ignores the user once. So the
// state machine lives here, where the defect is a test rather than a comment.
//
// Three invariants keep a gesture this module never sees the end of from
// outliving the press that started it, because every one of them shipped as a
// measured defect in an earlier round of this file:
//
//   1. A pan needs a button to still be held (`move()` reads `buttons`).
//   2. A click that arrives while a gesture is still running is not that
//      gesture's tail, so it is not swallowed (`consumeClick()`).
//   3. A pan whose owner answers nothing while two presses arrive is presumed
//      lost, so it cannot disable the stage for the life of the page
//      (`start()`).
//
// This module knows nothing about the DOM. It consumes plain records
// {type, pointerId, button, buttons, clientX, clientY} and returns what the
// shell should do about them.
//
// Pure: no IO, no clock, no randomness, no DOM.

/** Screen pixels of movement that turn a press into a pan instead of a click. */
export const DRAG_THRESHOLD = 4

export const E_GESTURE_THRESHOLD = 'E_GESTURE_THRESHOLD'

export class GestureError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GestureError'
    this.code = E_GESTURE_THRESHOLD
  }
}

/**
 * @param {{threshold?: number}} [options]
 * @returns {{start:Function, move:Function, end:Function,
 *            isClickSuppressed:Function, consumeClick:Function, isPanning:Function}}
 * @throws {GestureError} when `threshold` is not a finite number above zero.
 */
export function createDragGesture({ threshold = DRAG_THRESHOLD } = {}) {
  // Fail closed on the option, because failing open here disables the very
  // thing the option names: `Math.hypot(...) < NaN` and `Math.hypot(...) < 'x'`
  // are both false, so an unvalidated threshold turns a half-pixel twitch into
  // a pan and every click on the stage into a swallowed one. Sibling core
  // modules throw on this class of bad input (ViewModelError, PaletteError);
  // so does this one.
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new GestureError(
      `${E_GESTURE_THRESHOLD}: threshold must be a finite number of pixels above zero, received ${String(threshold)}`
    )
  }

  let active = null
  let suppressClick = false

  return {
    /**
     * @returns {boolean} true when a gesture actually started. False on a
     *   non-primary button, false on a press whose coordinates this module
     *   cannot measure from, and false on the FIRST press by a different
     *   pointer while a pan is in flight.
     */
    start(event) {
      if (event.button !== 0) return false
      // Fail closed on the origin. Everything this module reports is measured
      // from it, so a press at a coordinate that is not a finite number makes
      // every later delta NaN — and `Math.hypot(NaN, NaN) < threshold` is
      // false, which used to mean a zero-pixel move started a pan, armed a
      // click suppression for a pan that never happened, and fed NaN to the
      // shell's panBy, poisoning the stage transform permanently.
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false
      // A pan in flight owns the stage until it ends. A second primary press by
      // ANOTHER pointer — the ordinary accidental second touch on a surface with
      // `touch-action: none` — must not take the gesture away from the finger
      // that is moving: the replaced pointer could then neither move nor end,
      // and because the shell gates its cleanup on `end()` reporting `ended`,
      // its pointer capture would never be released and `body[data-panning]`
      // would stay set, with nothing on screen to explain it.
      //
      // Three exemptions keep that guard from becoming a dead-lock, because a
      // gesture this module never sees the end of would otherwise be permanent:
      //
      // 1. A press that has not yet panned is always replaceable (the guard is
      //    keyed on `panning`, not on `active`).
      // 2. The panning pointer's OWN id re-anchors. A second `pointerdown` for
      //    a pointer this module still believes is panning can only mean its
      //    `pointerup`/`pointercancel` was never delivered — a window blur
      //    mid-drag, a native drag or context-menu takeover, or an `up` that
      //    landed outside the listening element because pointer capture was
      //    unavailable. Re-anchoring restores slice 1's self-healing behaviour,
      //    which re-armed the gesture on every primary `pointerdown`. For a
      //    mouse, whose pointer id is always the same, that closes the lost
      //    pointer case completely.
      // 3. A SECOND foreign press with no sign of life from the owner in
      //    between re-anchors. A lost *touch* pointer never presses again — its
      //    id is gone with the finger — so keying the refusal on the owner's id
      //    alone made that state permanent: every later finger was refused, the
      //    stage could never be panned again, and `body[data-panning]` stayed
      //    set for the life of the page. Refusing once per contest keeps the
      //    accidental second touch from stealing a live pan (the defect this
      //    guard exists for) while making the lost-touch state cost the user
      //    one extra press instead of a reload. Any owned move clears the
      //    contest, so a pointer that is demonstrably alive is defended again.
      if (active?.panning === true && active.id !== event.pointerId) {
        if (active.contested !== true) {
          active.contested = true
          return false
        }
      }
      // A fresh press always disarms: whatever a previous gesture left behind,
      // the click that belongs to THIS press must be allowed through.
      suppressClick = false
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false, contested: false }
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
      // A pan needs a button to still be held. Trusting `active` alone left a
      // press whose end this module never saw alive for the life of the page:
      // a press that stayed under the threshold takes no pointer capture (the
      // shell takes it on `began`), so a `pointerup` over a SIBLING of
      // `#stage-host` — `.a39-stage-controls` and the sidebar both are — never
      // reaches the shell's listener and `end()` is never called. The next bare
      // hover then measured a large delta from the stale origin, crossed the
      // threshold, and panned the graph under a cursor with no button held.
      //
      // `buttons` is the bitmask of buttons currently held, so 0 means the
      // press is over. Its ABSENCE is refused rather than assumed, because "no
      // button state" is not evidence that a button is held; every real
      // PointerEvent carries it and Task 6 forwards the event itself. A
      // malformed step is refused without discarding the gesture — a stream
      // this module cannot read must not be able to cancel a real pan.
      if (!Number.isFinite(event.buttons)) return idle
      if (event.buttons === 0) {
        // The press ended where this module could not see it. Nothing is left
        // to swallow either: the click it would have produced, if any, was
        // dispatched before this hover ever arrived.
        active = null
        suppressClick = false
        return idle
      }
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      // Fail closed on the delta, for the same reason the `threshold` option
      // fails closed above and by the identical mechanism: `Math.hypot(NaN,
      // NaN) < 4` and `Math.hypot(Infinity, 0) < 4` are both false, so a
      // comparison written as `<` treats a delta it cannot measure as "far
      // enough to pan".
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return idle
      // A move this module owns is proof the pointer is alive, so the stage is
      // defended against the next accidental second press again.
      active.contested = false
      let began = false
      if (!active.panning) {
        if (!(Math.hypot(dx, dy) >= threshold)) return idle
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
      // Ownership first. A `pointercancel` for a pointer this gesture does not
      // own must not disarm the suppression the owner armed: on a multi-touch
      // stage the browser cancels unrelated pointers routinely, and a repair
      // hoisted above this early return would let a foreign cancel hand the
      // pan's own synthesised click straight to whatever node the pan ended
      // over — the mirror image of the defect this module was created to fix.
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

    /**
     * True while a click suppression is armed — i.e. a pan crossed the
     * threshold and the click it produces has not been spent or cancelled yet.
     * Armed is not the same as spendable: see `consumeClick`.
     */
    isClickSuppressed() {
      return suppressClick
    },

    /**
     * Swallows at most one click. Returns true when the caller should stop it.
     * The suppression is spent either way, so it can never reach a second click.
     *
     * A click that arrives while a gesture is STILL running is not that
     * gesture's tail — the browser synthesises the pan's click after its
     * pointerup — so it is neither swallowed nor allowed to spend the
     * suppression. That is what stops a pan this module never saw the end of
     * from eating an unrelated click: the fresh finger that taps a node while a
     * lost pan is still believed to be in flight is delivered, not ignored.
     */
    consumeClick() {
      if (!suppressClick) return false
      if (active !== null) return false
      suppressClick = false
      return true
    },

    /** True while a pan is in progress. A press that has not moved is not one. */
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
Expected: PASS, 22/22.

**Corrected 2026-08-19 (second review of Task 3).** The test block above no longer defines `stripComments`, `FORBIDDEN_TOKENS`, `FORBIDDEN_IDENTIFIERS`, `MODULE_SPECIFIER` and `purityViolations`; it imports them from `test/helpers/purity.mjs`. Nothing about the guard's behaviour changed — the five definitions moved byte-for-byte, and the two tests that pin the guard's capability stay in this file, where they were written. The move is the repair for a measured defect in Task 3, not a tidy-up: Task 3 re-spelled the guard as a raw `source.includes(token)` list over the whole file, which is the exact pattern this task had already measured and removed one commit earlier, and the two copies disagreed in **both** directions (the evidence is in the second review of Task 3 below). A third suite — Task 5's legend — would have copied whichever of the two it found first.

The relocation is proved not to have disarmed this task's own guard: with the string-literal probe appended to `viewer/atlas39/core/gesture.mjs` (`const OPEN_MARK = '/*'` … `const CLOSE_MARK = '*/'` around a probe using `document.title`, `window.name` and `navigator.userAgent`), `node --test test/atlas40-gesture.test.mjs` exits **1**, `pass 21 / fail 1`, red on `the gesture carries no clock, randomness or DOM`; restored, it exits **0** at `pass 22 / fail 0` and `shasum -a 256 viewer/atlas39/core/gesture.mjs` is `f7f96be96d85dd39b727f13410b9b797e6ecc9364deb46904fc5e5aed4dea6be` — the same pristine hash this task's Step-4a table records. The Step-4a rows therefore still hold as measured.

**Corrected 2026-08-19 (fourth review of Task 2).** Expected 16/16 until this round. Six tests were added, one was renamed, and `start()`, `move()` and `consumeClick()` each gained a guard. Each change answers a defect measured against the module at `5048f06`, and every counterexample is in the Step-4a table below.

- **A press whose end this module never saw stayed alive forever, and the next bare hover panned the stage with no button held. Critical, and it needed no lost-pointer exoticism.** `move()` never read `event.buttons`. Measured on an ordinary mouse: (1) `pointerdown` at (100,100) inside `#stage-host`; (2) a 1 px twitch, below the threshold, so `began` never fires and Task 6 therefore never takes a pointer capture (`step.began` is what takes it); (3) the user drags out of `#stage-host` and releases over a **sibling** — `index.html:58-60` makes `.a39-stage-controls` and the sidebar siblings, which D9's own correction above proves — so the shell's `pointerup` listener never runs and `end()` is never called; (4) the user hovers back with NO button held and the first `pointermove` measures `dx=160, dy=80` from the stale origin, returns `{panning: true, began: true}`, and the wired shell takes a capture, sets `body[data-panning]` (`shell.css:332` → `cursor: grabbing`) and pans the graph under a bare cursor; (5) `suppressClick` is now armed, so the user's next click on a node is silently swallowed — the exact defect this module's header says it exists to prevent. The repair is two lines: a step whose `buttons` cannot be read is refused, and `buttons === 0` discards the press and disarms the suppression, because the click that press would have produced, if any, was dispatched before the hover arrived. `buttons` is therefore part of the record this module consumes, and the `move` fixture in the test carries it.
- **The hijack guard turned a lost panning TOUCH pointer into a permanent brick that also ate one unrelated click.** The third review's guard exempted the panning pointer's own id, which closes the mouse case (the id never changes) and nothing else: a lost touch id never presses again, because the finger is gone. Measured on the previous module: pointer 11 pans and is never heard from again; finger 12 taps → `start()` refused, so nothing disarms, and the tap's click hit `consumeClick()` and was **swallowed**; finger 13 taps → refused as well; `body[data-panning]` was never deleted (the shell removes it only when `end()` reports `ended`), so the grabbing cursor and the un-pannable stage both survived for the life of the page. Slice 1 self-healed both on the next press, so on those two harms the module was *strictly worse than the code it replaces*, in the very defect class D9 indicts slice 1 for — and the plan disclosed the residual only as a refusal to pan "until the lost id presses again", which nothing in the shell or the module ever makes happen. Two repairs, and they are independent: (a) `consumeClick()` refuses while a gesture is still running, because the browser synthesises a pan's click **after** its pointerup, so a click that arrives mid-gesture is not that gesture's tail — that alone delivers finger 12's tap; (b) a **second** foreign press that the owner answers with nothing re-anchors, so the stage costs the user one extra press instead of a reload, while the single accidental second touch this guard exists for is still refused. Any owned move clears the contest, so a pointer that is demonstrably alive is defended again.
- **The threshold comparison failed open on a non-finite delta — the identical `< NaN` mechanism the module documents and guards against for the `threshold` operand, left unguarded on the delta operand.** `Math.hypot(NaN, NaN) < 4` and `Math.hypot(Infinity, 0) < 4` are both `false`, so a delta the module cannot measure fell through: a ZERO-pixel move returned `{panning: true, began: true, dx: NaN, dy: NaN}`, which makes the wired shell take a pointer capture and set `body[data-panning]` for a pan that never happened, and arms `suppressClick`, so the user's next click on a node is swallowed. `start({type:'pointerdown', button:0})` — no coordinates at all — returned `true` and admitted the malformed record in the first place. **The stage transform is not among the harms, and the finding that claimed it was is corrected here:** `core/transform.mjs:106-107` already drops a non-finite delta (`tx: transform.tx + (isFiniteNumber(dx) ? dx : 0)`), measured directly — `panBy({scale:1,tx:0,ty:0}, NaN, NaN, world)` returns `{"scale":1,"tx":0,"ty":0}` while `panBy(…, 160, 80, …)` returns `{"scale":1,"tx":160,"ty":80}` — so a NaN delta reaching `panBy` is a no-op, not a poisoned transform. Nor is any of this reachable through Task 6's wiring today, because a real `PointerEvent.clientX` is always finite: it was latent rather than live — exactly the status Task 1 gave the `depthColor` fail-open it chose to guard anyway (line 318). Three guards now: `start()` refuses a press whose origin is not finite, `move()` refuses a step whose delta is not finite, and the comparison itself is written fail-closed as `!(Math.hypot(dx, dy) >= threshold)`.
- **The purity guard could be switched off by two ordinary string literals.** `source.replace(/\/\*[\s\S]*?\*\//g, '')` runs over raw text and cannot tell a block-comment delimiter from a string, so appending `const OPEN_MARK = '/*'` … `const CLOSE_MARK = '*/'` around a probe that really referenced `document`, `window` and `navigator` deleted the probe **before** the denylists saw it. Measured against the module and test at `5048f06`, reconstructed with `git show` into a throwaway tree: exit 0, 16/16 with the probe on disk (`grep -c document.title` = 1). The comment on the previous version declared exactly this safe — "the block form is delimited, so it is safe whole" — and that sentence was committed verbatim in the test, in this plan, and by reference in the module header's "Pure: no IO, no clock, no randomness, no DOM". The strip is now a small scanner that knows where string and template literals begin and end. The four `assert.match` probes could not have seen this: they only prove four **pre-existing** regions survived the strip, and say nothing about a newly added region the strip ate — so the scanner is now pinned by its own test, over the exact mutation that defeated its predecessor.
- **The purity denylist held neither the IO half nor the whole of the randomness half of what it claims.** Neither list contained `import`, any module specifier, or `crypto`. Measured: a static `import { readFileSync } from 'node:fs'` plus `readFileSync('/etc/hosts', 'utf8')` as the first statement of `move()` — synchronous disk IO on every pointermove — scored exit 0, 16/16 against the files at `5048f06`, and so did `crypto.getRandomValues(new Uint8Array(1))` inside `move()`. `import`, `crypto`, `eval` and `Worker` join the identifier list, and `\bfrom\s*['"]` catches a re-export, which carries no `import` keyword at all. Both are pinned by the guard-on-the-guard test rather than only by the module's current text.
- **A `pointercancel` from a pointer this gesture does not own was untested, so the repair's placement was unpinned.** The repair sits correctly **after** the ownership early-return, but hoisting it above — a one-line reordering, and the most natural way to "simplify" it — kept the whole suite green while producing the mirror image of the defect the module was created to fix: a foreign cancel disarms the owner's suppression, and the pan's own synthesised click then lands on whatever node the pan ended over. Measured against the files at `5048f06`: the hoisted mutant scores exit 0, 16/16, and on one event sequence (press, threshold-crossing move, `pointercancel` for id 2, `pointerup` for id 1) pristine and mutant return the identical `{ended, wasPanning, pointerId}` records while `consumeClick()` diverges `true` → `false`.
- **`isClickSuppressed()` was a surviving mutant** — the same class the third review found and repaired for its sibling `isPanning()`, in the sibling that was never re-checked. Replacing `return suppressClick` with `return active?.panning === true` scored exit 0, 16/16 against the files at `5048f06`: every assertion that read it was taken at a moment where the two agree. It is now also read **after** `pointerup`, the one moment the accessor exists for and the only moment where they disagree.
- **A test name stated a guarantee the module deliberately does not provide.** `'a second primary press cannot take the stage away from a pan in flight'` was contradicted by the sibling test at `test/atlas40-gesture.test.mjs:192` in commit `5048f06`, which asserts that a second press by the panning pointer's own id ends the pan and disarms its suppression. Commit `5048f06` narrowed a different name for precisely this reason and left this one at its pre-widening wording. It is now `'an accidental second press by another pointer is refused while the panning pointer is alive'`, and its comment names both exemptions.

**Open item this round does not decide:** a foreign pointer capture the shell took for a pan it never sees the end of is still never released, because `end()` never reports `ended` for that pointer. A capture held on a pointer that no longer exists is inert, and slice 1 had the identical hole, so no code change is made for it here — but it is Task 9's to observe in a real browser rather than to assume, and it is named here so it is not discovered as a surprise.

**Corrected 2026-08-19 (third review of Task 2).** Expected 15/15 until this round. One test was added and one renamed, and the hijack guard was widened by one clause. Each change answers a measured finding:

- **The hijack guard turned a lost *panning* pointer into a permanent dead-lock — strictly worse than the slice-1 behaviour it replaces.** Measured against the previous module: after `start()` plus a threshold-crossing `move()`, if the shell never receives the matching `pointerup`/`pointercancel` (window blur mid-drag, a native drag or context-menu takeover, or an `up` outside `#stage-host` because `setPointerCapture?.()` was absent), `active = {id: 1, panning: true}` was permanent. `start(down({pointerId: 1}))` returned **false** — a re-press by the *same* id, which for a mouse is always id 1 — and so did `start(down({pointerId: 2}))`: no press of any kind could re-anchor. Meanwhile every later `pointermove` still returned `{panning: true, began: false, dx: <delta>}` — measured over three ordinary hover moves with no button held, `dx` was 84, 60, -20 — so Task 6's wiring, which forwards every `pointermove` unconditionally and only checks `step.panning`, would follow the bare cursor forever, with `began` false and therefore no `body[data-panning]` to show it. Slice 1's `app.mjs:653-657` re-anchored on every primary `pointerdown`, so the identical lost pointer self-healed on the user's next click. The guard is now `active?.panning === true && active.id !== event.pointerId`: a foreign id is still refused, the panning pointer's own id re-anchors. **Residual, stated rather than papered over:** a lost panning *touch* pointer is not closed, because the next finger arrives with a fresh id and is refused until the lost id presses again. Letting any id re-anchor would delete the hijack guard itself. A mouse, whose id does not change, is closed completely. **Superseded by the fourth review above:** that disclosure was materially incomplete — nothing in the shell or the module ever makes a lost touch id press again, so "until the lost id presses again" describes a permanent brick, and the residual also swallowed one unrelated click and pinned `body[data-panning]` on for the life of the page, both of which slice 1 self-healed. Two exemptions now close it.
- **A test name asserted a guarantee the module did not provide.** `'a press that never panned is replaceable, so a lost pointer cannot dead-lock the stage'` was true only of its first clause; its body never constructed a lost *panning* pointer, and that case dead-locked. The suite could not see the difference either — the strictly stronger guard passed all 15 tests unchanged, so the guard's exact keying was a surviving mutant. The name is now narrowed to `'a press that never panned is replaceable by any other pointer'`, and the panning half is a separate test, `'a lost PANNING pointer re-anchors on its own next press instead of dead-locking the stage'`, whose comment states the touch residual in the same place.
- **The purity guard had a block-comment hole and a bare-identifier hole.** (a) `source.replace(/^\s*\/\/.*$/gm, '')` stripped line comments only, so the module's four JSDoc blocks were still scanned as code: a future `@param` or `@returns` spelling `window.` would have re-created the exact prose-fires-the-guard failure the previous round repaired. Measured on a mutant that adds `window.title`, `document.body` and `navigator.userAgent` to a JSDoc block: the old single strip reports `OLD_STRIP_HIT=true` for all three; with the block strip added, `NEW_STRIP_HIT=false` for all three and the suite stays at 16/16. (b) The tokens were all property-access spellings, so bare environment sniffing escaped. Measured on a mutant containing `typeof document !== 'undefined'`, `typeof window !== 'undefined'`, `setTimeout(`, `queueMicrotask(`, `fetch(` and `process.argv`: the old ten-token list scored `OLD_TOKEN_LIST_HITS=0`. A word-boundary identifier list now runs over the already comment-free code, and that mutant exits 1 with `gesture.mjs references the bare identifier window`. **Superseded by the fourth review above:** the block strip introduced here was itself defeatable by two ordinary string literals, and neither list held `import`, a module specifier or `crypto`.

**Open PO decisions raised by this round (named once, decided by the PO, not by the implementer):**

1. **Two of the six returned methods have no production caller in the planned wiring.** Task 6 uses only `start`, `move`, `end` and `consumeClick`; `isPanning()` and `isClickSuppressed()` are read only by tests. Widening the hijack guard did **not** give either one a production caller, so the decision is unchanged by this round: keep both as the module's observable state (and accept test-only readers), or delete both and the assertions that read them. It is one decision, not two.
2. **The `threshold` option has no production caller either** — Task 6 constructs `createDragGesture()` bare. The option is the only thing that makes `GestureError`, `E_GESTURE_THRESHOLD`, the fail-closed validation and its seven-case test reachable; deleting the option deletes all four together. The guard itself is correct and matches `ViewModelError`/`PaletteError`, so this is a YAGNI question about the option, not a request to weaken the guard. If the option stays, it stays guarded exactly as it is.

**Corrected 2026-08-19 (second review of Task 2).** Expected 12/12 until this round; three more tests were added, and the module gained two guards and a fail-closed option. Each change answers a measured finding rather than a preference:

- **`isPanning()` was a surviving mutant.** Replacing `return active?.panning === true` with `return active !== null` left the 12-test suite fully green. The only assertion that read it ran with a pan already in flight, where "a pointer is down" and "a pan is running" are indistinguishable — precisely the distinction the method exists for. `'a movement below the threshold is a click, not a pan'` now reads it twice on a press that has not panned. Measured after the fix: that mutant exits 1 on that test.
- **A second primary `pointerdown` hijacked an in-flight gesture.** `start()` overwrote `active` and cleared `suppressClick` with no guard, a faithful port of slice 1's `app.mjs:653-657`. Measured against the unguarded module: while pointer 1 was panning, `start({pointerId: 2, button: 0})` returned true, after which pointer 1 could neither move (`{panning:false, began:false, dx:0, dy:0}`) nor end (`{ended:false, wasPanning:false, pointerId:null}`). With the Task-6 wiring below that is the ordinary accidental second touch on a stage with `touch-action: none`: the pan dies under the moving finger, and because the shell gates its cleanup on `done.ended`, `releasePointerCapture` is never called and `body[data-panning]` is never removed. `start()` now refuses while `active.panning` is true — keyed on `panning`, not on `active`, so a press whose pointerup the shell never sees cannot dead-lock the stage against every later press. Both halves are pinned, and Task 2 no longer ships a state defect untested in the task that exists to make this class of defect testable. **Superseded by the third review above:** keying on `panning` alone closed the never-panned dead-lock and opened a *panning* one; the guard now also exempts the panning pointer's own id.
- **`start()`'s documented success return was neither pinned nor read.** Changing `return true` to `return false` left the suite green. `'only the primary button starts a gesture'` now reads it, so the JSDoc contract and the code cannot disagree silently.
- **The `threshold` option failed open.** Measured: with `NaN`, `-1`, `0`, `null` or `'x'`, a 0.5 px twitch already reported `panning: true`, because `Math.hypot(…) < NaN` and `< 'x'` are both false — the option could silently switch off the very threshold it names, and every stage click after a twitch would be swallowed. It now throws `GestureError`/`E_GESTURE_THRESHOLD`, matching `ViewModelError` and `PaletteError` in the sibling core modules.
- **The purity guard scanned prose, not code.** `'performance'`, `'document'`, `'window'` and `'navigator'` are ordinary English in a repo whose convention is long, load-bearing comments, and a substring scan over the whole file cannot tell an identifier from prose — it already forced the reword of "a window losing the pointer" in the first round, when the code was pure and only the English was the failure. The guard now strips full-line comments (never partial lines, which a string containing `//` could use to truncate real code out of the scan) and spells the tokens as property accesses. Both halves are measured below. **Superseded by the third review above:** block comments were still scanned as code, and property-access spellings alone let bare environment sniffing through; the guard now strips both comment forms and also matches bare identifiers on word boundaries.

**Step 4a: Counterexample proofs for the new guarantees (do not commit the mutations)**

Same protocol as Step 5: `git add` the pristine files first, mutate, run, `git checkout --`, and confirm the restored `shasum -a 256` equals the pristine one. Every one of these was measured against a green suite before mutation — `15/15` for the rows carried from the second review, `16/16` for the third, and **`22/22` for the fourth, which re-measured every earlier row against the current module and files rather than carrying its predecessors' numbers forward**. The pristine hashes the whole campaign restored to are `f7f96be96d85dd39b727f13410b9b797e6ecc9364deb46904fc5e5aed4dea6be` (`viewer/atlas39/core/gesture.mjs`) and `f680d1089d0ba973f3e7d92af20456a26f2885841ee0dd9955176213da3af7c6` (`test/atlas40-gesture.test.mjs`); every row below restored to exactly those:

| Mutation | Must go red | Measured |
| --- | --- | --- |
| delete the `if (event.buttons === 0) { … }` block in `move()` | `a press whose end this module never sees is dropped by the first move with no button held` | exit 1, 21/22 |
| that block keeps `active = null` but drops `suppressClick = false` | the same test | exit 1, 21/22 |
| delete `if (!Number.isFinite(dx) \|\| !Number.isFinite(dy)) return idle` | `a step whose button state or coordinates cannot be read is refused, not treated as a pan` | exit 1, 21/22 |
| `!(Math.hypot(dx, dy) >= threshold)` → `Math.hypot(dx, dy) < threshold` | `the gesture carries no clock, randomness or DOM` — **source-text probe only**, see the note under this table | exit 1, 21/22 |
| delete `start()`'s `!Number.isFinite(event.clientX) \|\| !Number.isFinite(event.clientY)` guard | `a step whose button state or coordinates cannot be read is refused, not treated as a pan` | exit 1, 21/22 |
| delete `if (active !== null) return false` from `consumeClick()` | `a click that arrives while a gesture is still running is not that gesture to swallow` (and the lost-touch test) | exit 1, 20/22 |
| hoist `if (event.type === 'pointercancel') suppressClick = false` above the ownership early-return in `end()` | `a pointercancel from a pointer this gesture does not own leaves the suppression alone` | exit 1, 21/22 |
| delete the `if (event.type === 'pointercancel') suppressClick = false` line (Step 5's mutation) | `REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click` (and the source probe) | exit 1, 20/22 |
| `isClickSuppressed()` → `return active?.panning === true` | `a threshold-crossing drag suppresses exactly the click it produced` | exit 1, 21/22 |
| the hijack guard → the third review's `if (active?.panning === true && active.id !== event.pointerId) return false` (no contest exemption) | `a lost panning TOUCH pointer gives the stage back on the second unanswered press` | exit 1, 21/22 |
| delete the whole hijack-guard block, so every foreign press re-anchors | `an accidental second press by another pointer is refused while the panning pointer is alive` (and the lost-touch test) | exit 1, 20/22 |
| delete `active.contested = false` from `move()`, so an owned move is no longer a sign of life | `an accidental second press by another pointer is refused while the panning pointer is alive` | exit 1, 21/22 |
| that guard → `if (active !== null && active.id !== event.pointerId) return false` | `a press that never panned is replaceable by any other pointer` (and the lost-touch test) | exit 1, 20/22 |
| `isPanning()` → `return active !== null` | `a movement below the threshold is a click, not a pan` (and four more) | exit 1, 17/22 |
| `start()` success `return true` → `return false` | `only the primary button starts a gesture` (and four more) | exit 1, 17/22 |
| delete the `Number.isFinite(threshold)` block | `a threshold that would disable the threshold is refused, not silently accepted` | exit 1, 21/22 |
| re-introduce the comment "a window losing the pointer", `document.title`, `navigator.userAgent`, `performance.now` as a `//` line | nothing — prose is not capability use | exit 0, 22/22 |
| add `window.title`, `document.body`, `navigator.userAgent` to a **JSDoc block** | nothing — prose is not capability use | exit 0, 22/22 |
| add a never-called `function unusedProbe() { return document.title }` | `the gesture carries no clock, randomness or DOM` | exit 1, 21/22 |
| add a never-called probe using `typeof document`, `typeof window`, `setTimeout(`, `queueMicrotask(`, `fetch(`, `process.argv` | `the gesture carries no clock, randomness or DOM` | exit 1, 21/22 |
| append `const OPEN_MARK = '/*'`, a probe really using `document.title`, `window.name` and `navigator.userAgent`, and `const CLOSE_MARK = '*/'` | `the gesture carries no clock, randomness or DOM` | exit 1, 21/22 (**exit 0, 16/16 against the files at `5048f06`, before the scanner replaced the regex strip**) |
| add `import { readFileSync } from 'node:fs'` plus `readFileSync('/etc/hosts', 'utf8')` as the first statement of `move()` | `the gesture carries no clock, randomness or DOM` | exit 1, 21/22 (**exit 0, 16/16 against the files at `5048f06`, before `import` joined the denylist**) |
| add `crypto.getRandomValues(new Uint8Array(1))` inside `move()` | `the gesture carries no clock, randomness or DOM` | exit 1, 21/22 (**exit 0, 16/16 against the files at `5048f06`, before `crypto` joined the denylist**) |

**One row is weaker than it looks, and is labelled rather than dressed up.** `!(Math.hypot(dx, dy) >= threshold)` and `Math.hypot(dx, dy) < threshold` differ **only** on a non-finite delta, and `if (!Number.isFinite(dx) || !Number.isFinite(dy)) return idle` two lines above already refuses those — so the two spellings are behaviourally identical at this head and no behavioural test can separate them. What goes red is the source-text probe in the purity test. Both guards are kept on purpose (the module says so), and the honest statement of what holds them is: the delta guard is pinned by behaviour, the fail-closed comparison by source text. Deleting **both** is what the `a step whose button state or coordinates cannot be read…` test catches behaviourally.

**Corrected 2026-08-19 (review of Task 2).** The first draft expected 9/9. Three tests were added by that review, and the reason is worth carrying: nine tests asserted `.panning`, `.began`, `.ended`, `.wasPanning`, `.pointerId` and the suppression flags, and not one of them ever read `dx` or `dy` — the module's only numeric output and the entire payload Task 6 feeds to `panBy`. `DRAG_THRESHOLD`'s value and the strict `<` at the boundary were likewise unpinned, so a tenfold change to a human-visually-accepted interaction constant passed green. That is the same weakness D9 indicts slice 1 for, relocated: the state was testable, the number that moves the graph was not tested.

**Step 5: Counterexample proof (do not commit the mutation)**

Prove the regression test actually holds the repair. `git add` first: without it the restore and the verification below are both vacuous (see the correction under this step).

```bash
# stage the pristine file so `git checkout --` and `git diff` have something to restore/compare against
git add viewer/atlas39/core/gesture.mjs test/atlas40-gesture.test.mjs
shasum -a 256 viewer/atlas39/core/gesture.mjs           # record the pristine hash

# revert only the repair line
perl -0pi -e "s/      if \(event\.type === 'pointercancel'\) suppressClick = false\n//" viewer/atlas39/core/gesture.mjs
node --test test/atlas40-gesture.test.mjs; echo "MUTANT EXIT=$?"
git checkout -- viewer/atlas39/core/gesture.mjs
node --test test/atlas40-gesture.test.mjs; echo "RESTORED EXIT=$?"
shasum -a 256 viewer/atlas39/core/gesture.mjs           # must equal the pristine hash
```

Expected: `MUTANT EXIT=1` with the failing test named
`REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click`,
then `RESTORED EXIT=0` and the same `shasum` as before the mutation. **Record both exit codes, the failing test name and both hashes verbatim in the PR evidence.**

**Corrected 2026-08-19 (review of Task 2).** The first draft had no `git add` and verified the restore with `git diff --stat viewer/atlas39/core/gesture.mjs` (expected: empty). Both are vacuous at this point in the plan: Step 5 runs *before* Step 6's commit, so the file is still **untracked**. `git checkout -- <untracked path>` fails with `error: pathspec ... did not match any file(s) known to git` and leaves the mutation in place, while `git diff --stat` over an untracked path prints nothing — an empty output that reads as confirmation and proves nothing. Staging first puts the pristine bytes in the index so the restore is real, and the `shasum` pair is the verification, because it cannot be satisfied by an empty output.

While mutating, also confirm the tests hold the rest of the module's contract. Each of these must exit 1 (measured 2026-08-19 against the 12-test suite): `dx: 0, dy: 0` on the pan step; `dx: dy, dy: dx`; a crossing step that reports no delta; `DRAG_THRESHOLD = 40`; the boundary comparison loosened — since the fourth review the fail-closed spelling makes that `!(… >= threshold)` becoming `!(… > threshold)`, re-measured 2026-08-19 against the 22-test suite: exit 1, 18/22, red on `the threshold is 4 screen pixels, and exactly that far already pans`, `the threshold option is honoured, so a caller can pass its own`, `a threshold that would disable the threshold is refused, not silently accepted` and `the gesture carries no clock, randomness or DOM`; `let began = true`. Every one of those survived the 9-test suite.

**Step 6: Commit**

```bash
git add viewer/atlas39/core/gesture.mjs test/atlas40-gesture.test.mjs \
        docs/plans/2026-08-19-atlas-40-slice-2-deterministic-views.md
git commit -m "ATLAS-40: make the pointer drag a pure state machine and stop pointercancel arming a stale click suppression"
```

**Corrected 2026-08-19 (second review of Task 2).** The `git add` gains this plan document. The second review's repairs changed both Task-2 code blocks above — which are the two files verbatim — and Task 6's `wirePointer`, so the scope contract and the code it governs move in one commit instead of drifting apart between two.

---

## Task 3: `core/view-state.mjs` — the deterministic view model (D1, D2)

**Files:**
- Create: `viewer/atlas39/core/view-state.mjs`
- Create: `test/helpers/purity.mjs` (Step 0 — shared with Task 2, whose suite pins its capability)
- Test: `test/atlas40-view-state.test.mjs`

**Step 0: the shared purity guard**

Create `test/helpers/purity.mjs`:

```js
// ATLAS-40 slice 2: the purity guard the pure core modules are scanned with.
//
// One copy, imported by every suite that guards a module in
// viewer/atlas39/core/. It lives here because it was already re-derived once:
// the gesture suite built and measured this scanner, the view-state suite then
// re-spelled a raw `source.includes(token)` list of its own, and the two
// disagreed in both directions.
//
// Scan the CODE, not the English. The guarded modules carry long, load-bearing
// comments, and 'window', 'document', 'navigator', 'performance' and 'process'
// are ordinary words inside them — a raw substring scan over the whole file
// fires on vocabulary rather than on capability use, and it already did once:
// the comment "a window losing the pointer" tripped the guard while the code
// was pure. Measured again on the view-state suite's re-spelling, on a
// byte-identical pure module: "The trade-off is documented in the runbook."
// hits `document`, "a window onto the graph" hits `window`, a sentence ending
// "reading process." hits `process.`, "never a crypto digest" hits `crypto` —
// four ordinary comments, four red suites. In the other direction that same
// list is blind to `const clock = Date` + `clock.now()`, to
// `navigator.userAgent`, to `queueMicrotask` and to `eval`, all four of which
// the denylists below name on a word boundary.
//
// Removing the comments with two regexes over raw text was itself defeatable,
// and measured to be: `source.replace(/\/\*[\s\S]*?\*\//g, '')` cannot tell a
// block-comment delimiter from an ordinary string literal, so appending
// `const OPEN_MARK = '/*'` … `const CLOSE_MARK = '*/'` around a probe that
// really referenced document, window and navigator deleted the probe BEFORE the
// denylists ever saw it, and the suite stayed green. The comment stripper is
// therefore a small scanner that knows where literals begin and end.
//
// Knowing strings alone was not enough, and the hole was the same class again:
// a scanner blind to REGULAR EXPRESSION literals reads `/\//` as `/\` followed
// by a line comment and deletes the rest of the line. Measured on the
// string-aware predecessor: stripComments("const SLASH_RE = /\\//; const t =
// document.title") returned "const SLASH_RE = /\\" and purityViolations() of
// the same text returned []. End to end, appending
// `export const SLASH_RE = /\//` plus a `document.title + Date.now()` probe to
// viewer/atlas39/core/view-state.mjs left that suite green at 18/18 with the
// probe provably on disk. So the scanner now classifies a `/` before it decides
// anything, and refuses rather than guesses when it cannot.
//
// The third hole was in the WORD the classification reads, not in the
// characters it sees. `keep()` skipped whitespace without ending the word it
// had been building, so `const subject = text` followed by
// `return /\//.test(subject)` left the previous word as `textreturn`, which is
// in no keyword list, so that `/` was lexed as a DIVISION and the `//`-deletion
// hole above re-opened one line later. This codebase is semicolon-free, so that
// is the ordinary shape of two statements, not a contrived one. Measured on the
// committed predecessor: purityViolations() of that function returned [], while
// the same function with `String(text)` on the line above — a `)` before the
// `return`, which ends the word — returned ["document.","document"]. End to
// end, appending it to viewer/atlas39/core/view-state.mjs left that suite green
// at exit 0, 18/18 with a DOM read and a clock on disk. A word now starts fresh
// after any non-identifier character, whitespace included.
//
// This helper's own capability is pinned by test in
// test/atlas40-gesture.test.mjs ("the purity guard cannot be switched off by a
// string or a regular expression literal, and sees imports and randomness"),
// over the exact three mutations that defeated its predecessors.

/** Thrown instead of guessing. A scan that cannot classify a `/` deletes nothing. */
export class PurityScanError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PurityScanError'
  }
}

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/**
 * The keywords after which a `/` opens a regular expression instead of dividing.
 * Without them `return /x/.test(s)` would be read as a division and the regex
 * body scanned as code.
 */
const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw'
])

/** End index (exclusive) of the string or template literal opened at `start`. */
function literalEnd(source, start) {
  const quote = source[start]
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  // Unterminated: keep the rest verbatim. Deleting it is the one thing this
  // scanner must never do on input it does not understand.
  return source.length
}

/**
 * End index (exclusive) of the regular-expression literal that starts at
 * `start`, or -1 when the text from `start` is not one. A regex literal cannot
 * span a line, and a `/` inside a `[...]` character class does not close it.
 */
function regexLiteralEnd(source, start) {
  let i = start + 1
  let inClass = false
  while (i < source.length) {
    const ch = source[i]
    if (ch === '\n') return -1
    if (ch === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
    } else if (ch === '[') {
      inClass = true
    } else if (ch === '/') {
      i += 1
      while (i < source.length && IDENTIFIER_CHAR.test(source[i])) i += 1
      return i
    }
    i += 1
  }
  return -1
}

const lineOf = (source, index) => source.slice(0, index).split('\n').length

/**
 * Removes `//` and block comments, and only those. String, template and
 * regular-expression literals are code, so a comment delimiter inside any of
 * them is text and cannot switch the scan off.
 *
 * What it knows, stated exactly rather than as "the way a JavaScript reader
 * does" — the previous wording claimed a completeness this has never had:
 *
 * - `//` and `/*` are checked before a regular expression is considered, which
 *   is what a JavaScript lexer does and not a shortcut: neither sequence can
 *   open a regex literal.
 * - A `/` in any other position is a regex literal when a regex could start
 *   there, decided from the last significant character — an operand end
 *   (identifier, `)`, `]`, `}`, a closing quote) means division, anything else
 *   means regex, and an identifier is looked up in REGEX_AFTER_KEYWORDS as the
 *   WORD it ends, where a word starts fresh after any non-identifier character
 *   including whitespace and a newline.
 * - A regex literal that does not close on its own line is refused with a
 *   PurityScanError. Nothing is deleted on a guess.
 *
 * What is known to remain, stated as a list of measured shapes and not as a
 * count: a regex literal written directly after `)`, `}` or `]` — the
 * `if (x) /re/.test(y)` and statement-position shapes — is read as a division,
 * because telling those apart needs the parenthesis's own keyword. The body is
 * then emitted verbatim, so nothing is hidden by it unless that body contains a
 * literal `//` or `/*`. No guarded module contains either shape.
 *
 * This paragraph used to open "The one residual", and that word `one` was
 * false while it stood: the token-boundary hole described in the header — a
 * keyword that follows an identifier across whitespace — was open at the same
 * time, and `)` was in fact the SAFE position, because `)` is what ended the
 * word and let `return` be recognised. The list above is therefore what has
 * been measured, not a claim that nothing else is left; the next hole in this
 * file is still likelier to be found by measuring than by reading.
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  // The last significant character emitted, and the identifier it ended, are
  // all that separates a division from a regular expression. `lastRaw` is the
  // last character emitted INCLUDING whitespace, and it is what closes a word:
  // without it `const subject = text` + a newline + `return` builds the word
  // `textreturn`, which is in no keyword list, so `return /re/` lexes as a
  // division and the regex body is read as code.
  let prev = ''
  let prevWord = ''
  let lastRaw = ''

  const keep = (text) => {
    out += text
    for (const ch of text) {
      if (IDENTIFIER_CHAR.test(ch)) {
        prevWord = IDENTIFIER_CHAR.test(lastRaw) ? prevWord + ch : ch
        prev = ch
      } else if (!/\s/.test(ch)) {
        prev = ch
        prevWord = ''
      }
      lastRaw = ch
    }
  }

  const regexCanStart = () => {
    if (prev === '') return true
    if (prev === ')' || prev === ']' || prev === '}') return false
    if (prev === "'" || prev === '"' || prev === '`') return false
    if (IDENTIFIER_CHAR.test(prev)) return REGEX_AFTER_KEYWORDS.has(prevWord)
    return true
  }

  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === "'" || ch === '"' || ch === '`') {
      const end = literalEnd(source, i)
      keep(source.slice(i, end))
      i = end
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      // A deleted comment still ended the token before it.
      lastRaw = ' '
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 2
      lastRaw = ' '
      continue
    }
    if (ch === '/' && regexCanStart()) {
      const end = regexLiteralEnd(source, i)
      if (end === -1) {
        throw new PurityScanError(
          `unterminated regular expression literal at line ${lineOf(source, i)}: ` +
            'the purity scanner refuses to guess where it ends'
        )
      }
      keep(source.slice(i, end))
      i = end
      continue
    }
    keep(ch)
    i += 1
  }
  return out
}

/** Property-access spellings, which prose does not produce. */
export const FORBIDDEN_TOKENS = [
  'Date.', 'new Date', 'Math.random', 'performance.',
  'document.', 'window.', 'globalThis', 'navigator.', 'localStorage',
  'requestAnimationFrame', 'crypto.'
]

/**
 * Bare identifiers, matched on word boundaries over already comment-free code.
 * Property-access spellings alone cannot see `typeof document`, `fetch(...)`,
 * `setTimeout(...)`, a static `import` or `crypto.getRandomValues` — the last
 * two being the most direct ways to make a core module impure, and both
 * invisible to the first two versions of this guard.
 */
export const FORBIDDEN_IDENTIFIERS = [
  'window', 'document', 'navigator', 'performance', 'globalThis',
  'localStorage', 'sessionStorage', 'indexedDB', 'process', 'fetch',
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
  'requestAnimationFrame', 'Date', 'XMLHttpRequest', 'WebSocket', 'require',
  'import', 'crypto', 'eval', 'Worker'
]

/** `import … from '…'` and `export … from '…'` both spell this. */
export const MODULE_SPECIFIER = /\bfrom\s*['"]/

/** Every rule above, applied to one source text. Returns what it found. */
export function purityViolations(source) {
  const code = stripComments(source)
  const found = []
  for (const token of FORBIDDEN_TOKENS) if (code.includes(token)) found.push(token)
  for (const identifier of FORBIDDEN_IDENTIFIERS) {
    if (new RegExp(`\\b${identifier}\\b`).test(code)) found.push(identifier)
  }
  if (MODULE_SPECIFIER.test(code)) found.push("from '<specifier>'")
  return found
}
```

**Corrected 2026-08-20 (fourth review of Task 3).** The block above is the repaired guard, `shasum -a 256 test/helpers/purity.mjs` = `0b0f00e2787cca25cce6732c931d30b5a7c205b3a1b1cc81ea789e5607b5c174`. The scanner could still be walked past, and the paragraph that was supposed to warn the next reader named the wrong position.

**The hole.** `keep()` skipped whitespace with `continue`, so it never ended the word it was building. `const subject = text` followed on the next line by `return /\//.test(subject)` therefore left the previous word as `textreturn`, which is in no keyword list, so the `/` lexed as a DIVISION and the `//`-deletion hole the helper exists to close re-opened. This codebase is semicolon-free, so that is the ordinary shape of two statements. Measured on the committed helper `de71d1accbdf8109cdfad7dcf5de9a3a3ed079483b1ca4b6d6da72fb8b7c2bf3`:

```
violations(identifier-before-regex): []
violations(paren-before-regex):      ["Date.","document.","document","Date"]
stripComments(identifier-before-regex):
  export function hasSlash(text) {
    const subject = text
    return /\
  }
```

End to end, appending that function to `viewer/atlas39/core/view-state.mjs` left `node --test test/atlas40-view-state.test.mjs` at exit **0**, 18/18 — a DOM read AND a clock past a guard named `the module carries no clock, randomness or DOM`. Four modules sit behind this guard.

**The repair.** A word now starts fresh after any non-identifier character, whitespace and newlines included: `keep()` tracks `lastRaw`, the last character emitted *including* whitespace, and a deleted comment sets it to a space because a comment ends the token before it too. After the repair the same probe reports `["Date.","document.","document","Date"]` in BOTH positions, and `return /x/.test(s)` after a string literal is still lexed as a regex (`"const s = \"x\"\nreturn /x/.test(s)"` round-trips unchanged), as does `const half = subject / 2` remain a division — the repair adds recognised keywords, it does not turn identifiers into them.

**It changes no existing scan.** `stripComments` output over all FOUR guarded modules is byte-identical before and after, `/usr/bin/cmp` exit 0 on every one and `shasum -a 256` of the stripped text equal in both directions:

| module | stripComments sha256, before = after |
| --- | --- |
| `viewer/atlas39/core/gesture.mjs` | `e1149e3bb25a217eb2320a9b550f28353cd02c2fff17b1001803897686295df0` |
| `viewer/atlas39/core/view-state.mjs` | `f4ecd36a45ebb20d985329e7e118ea7ee205c9a84d9a4a6ea4f9c204090748ae` |
| `viewer/atlas39/core/saved-view.mjs` | `8fd54653374a5e456fdc5dd051f10ea7aefb3d741051e58fff80b83a403e6fc6` |
| `viewer/atlas39/core/legend.mjs` | `e5c25bafc5983378c98bb9c0ad2b125fdf59e0eb19ec1c2be8fa55533cfe6039` |

(The third review recorded this byte-identity over **two** modules and cited `823525c6…` for `view-state.mjs`. That hash was measured against the module as it stood then and is left as its record; the four hashes above are this round's, each measured before and after the lexer change against the same file bytes — the modules as they stood at `37b26fc`.)

Re-measured a second time at the end of this round, against the module bytes this round SHIPS (two of the four gained comments from the Task 3 and Task 5 repairs), by importing the `37b26fc` lexer and the repaired lexer side by side and stripping the same source with both: identical on all four, `mismatches: 0` — `e1149e3b…` gesture, `28e780dc…` view-state, `8fd54653…` saved-view, `0d5848a3…` legend, old and new alike. The two hashes that moved are the two modules that changed, not the two lexers disagreeing.

**The overclaiming paragraph.** The doc comment opened "The one residual: a regex literal written directly after `)` or `}`". The word `one` was false while it stood — the hole above was open at the same time — and `)` is in fact the SAFE position, because `)` is what ends a word and lets `return` be recognised, which is exactly why the `paren-before-regex` probe was caught and the `identifier-before-regex` probe was not. The paragraph now lists what has been measured to remain and says so as a list rather than as a count.

**The guard on the guard gave that position no coverage.** `REGEX_MARKER_MUTANT` in Task 2's suite spells the literal after `=`, the one position that already worked. A second constant `REGEX_AFTER_IDENTIFIER_MUTANT` is added next to it — see the fourth-review note in Task 2 — and it fails against the unrepaired lexer and passes against the repaired one.

**Corrected 2026-08-19 (third review of Task 3).** This Step block is new, and it repairs a convention break rather than a code defect. `test/helpers/purity.mjs` was added to the §2 Create inventory by the second review of Task 3 but carried no verbatim block anywhere in this plan, which every other created file has. Measured before this correction by counting exact whole-file occurrences inside the plan: 1 for `viewer/atlas39/core/view-state.mjs`, 1 for `test/atlas40-view-state.test.mjs`, 1 for `viewer/atlas39/core/gesture.mjs`, 1 for `test/atlas40-gesture.test.mjs`, and **0** for `test/helpers/purity.mjs`. Because both suites now import the guard instead of spelling it, the plan — the audited scope contract Task 10's scope proof is measured against — no longer contained the guard's implementation anywhere. It does now, and the block above is the file verbatim.

The file also changed in this round, and the hole is the same class for the third time: the scanner knew string and template literals but not **regular expression** literals, so it consumed the `\/` of `/\//` as an ordinary escaped backslash and then read the closing `/` plus the following `/` as the start of a line comment, deleting the rest of the line before the denylists ever saw it. Measured directly on the predecessor, verbatim:

```
INPUT  : "const SLASH_RE = /\\//; const t = document.title"
STRIPPED: "const SLASH_RE = /\\"
VIOLATIONS: []
```

End to end against the real module: appending `export const SLASH_RE = /\//; export const stamp = () => document.title + Date.now()` as **one line** to `viewer/atlas39/core/view-state.mjs`, with `grep -c 'document.title'` = 1 proving the probe was on disk, `node --test test/atlas40-view-state.test.mjs` exited **0** at `tests 18 / pass 18 / fail 0` — a clock and a DOM read walking straight past a guard named `the module carries no clock, randomness or DOM`. With the repaired scanner and the identical probe still on disk, the same command exits **1** at `tests 18 / pass 17 / fail 1`, red on that test. (The same probe split over two lines is caught by both scanners, because a line comment only eats its own line; the one-line spelling is the mutation that matters.)

The doc comment goes with it. "Removes `//` and block comments the way a JavaScript reader does" claimed a completeness this scanner has never had — a JavaScript reader knows regex literals — so the replacement states exactly what it knows, what it decides from the last significant character, and the one residual it does not close: a regex literal written directly after `)` or `}` is read as a division, because telling those apart needs the parenthesis's own keyword. Where it cannot classify a `/` at all it now throws `PurityScanError` instead of guessing, because guessing is what deleted the line.

The repair adds capability without changing what the guard already saw: `stripComments` output over the two guarded modules is **byte-identical** under the old and the new scanner — `e1149e3bb25a217eb2320a9b550f28353cd02c2fff17b1001803897686295df0` for `viewer/atlas39/core/gesture.mjs` and `823525c61378a2889288e5d7c75ef24aff75bb7fd8ce65dfb4a2c66858062149` for `viewer/atlas39/core/view-state.mjs` in both. It is pinned in Task 2's guard-on-the-guard test, next to the `STRING_MARKER_MUTANT` that pins its predecessor.

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
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
// Imported only for the one test that pins what the retained full-graph
// adjacency costs: a focus reported off view empties the roving tabindex.
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import { buildScene } from '../viewer/atlas39/core/scene.mjs'
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
// The purity guard is the one the gesture suite built and pinned, imported
// rather than re-spelled — see the test at the bottom of this file.
import {
  stripComments,
  purityViolations,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
const vm = buildViewModel(snapshot, provenance)

const ROOT = 'ATLAS:confluence:14778372:14778372'
const DELIVERY = 'ATLAS:confluence:14778372:15171611'
const SPRINT = 'ATLAS:confluence:14778372:22478849'
const ARCH = 'ATLAS:confluence:14778372:15073290'

test('the mode list is exactly what this build supports, and cannot be extended from outside', () => {
  assert.deepEqual([...VIEW_MODES], ['overview', 'neighbourhood'])
  assert.deepEqual({ ...DEFAULT_VIEW }, { mode: 'overview', anchorId: null })
  // Spreading reads the values and says nothing about the freeze. Without these
  // two assertions a caller could push a third mode into the exported list and
  // every "an unknown mode is refused" assertion below would still pass, because
  // the mode would no longer be unknown.
  assert.equal(Object.isFrozen(VIEW_MODES), true, 'the exported mode list can be extended by a caller')
  assert.equal(Object.isFrozen(DEFAULT_VIEW), true, 'the exported default view can be rewritten by a caller')
})

test('overview draws the whole real graph', () => {
  const applied = applyView(vm, DEFAULT_VIEW)
  assert.equal(applied.ok, true)
  assert.equal(applied.model.nodes.length, 5)
  assert.equal(applied.model.edges.length, 4)
  // The whole scope, not a field of it: a field nothing reads is a field nothing
  // pays for, so the shape is pinned here rather than sampled.
  assert.deepEqual(applied.scope, {
    mode: 'overview',
    shownNodes: 5,
    totalNodes: 5,
    shownEdges: 4,
    totalEdges: 4
  })
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
  assert.deepEqual(applied.scope, {
    mode: 'neighbourhood',
    shownNodes: 3,
    totalNodes: 5,
    shownEdges: 2,
    totalEdges: 4
  })
})

test('a neighbourhood draws no edge with an endpoint off view, and a grandchild is not a neighbour', () => {
  // The root has three real children; anchoring on it must not drop the
  // root->delivery->sprint chain's first hop, and must not add the second.
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: ROOT })
  const ids = new Set(applied.model.nodes.map((n) => n.node_id))
  assert.equal(ids.has(SPRINT), false, 'a grandchild is not a direct neighbour')
  for (const edge of applied.model.edges) {
    assert.equal(ids.has(edge.from) && ids.has(edge.to), true, `${edge.edge_id} has an endpoint off view`)
  }
})

// D2 says an edge BETWEEN TWO NEIGHBOURS is drawn, because both of its ends are
// on screen and hiding it would draw a graph the snapshot does not contain. The
// accepted snapshot cannot witness that rule: it is a tree, and the number of
// its nodes whose two neighbours are joined by a real edge is 0 — measured over
// all five. So a projection that kept only the edges TOUCHING THE ANCHOR passes
// every assertion above and every other assertion in this file.
//
// This is the smallest graph that tells the two rules apart. It is a witness for
// the projection rule and nothing else: it is never rendered, it is not evidence
// about ATLAS content, and no assertion about the real graph is made through it.
const TRIANGLE = {
  contract_version: '1.0.0',
  project_id: 'ATLAS',
  id_scheme: 'projection-local/v1',
  canonical_entity_ids: false,
  source: { source_kind: 'confluence', source_id: 'witness' },
  nodes: [
    { node_id: 'W:a', source_ref: 'a', label: 'A' },
    { node_id: 'W:b', source_ref: 'b', label: 'B' },
    { node_id: 'W:c', source_ref: 'c', label: 'C' },
    { node_id: 'W:d', source_ref: 'd', label: 'D' }
  ],
  edges: [
    { edge_id: 'W:ab', from: 'W:a', to: 'W:b', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'W:ac', from: 'W:a', to: 'W:c', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'W:bc', from: 'W:b', to: 'W:c', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'W:cd', from: 'W:c', to: 'W:d', relation_type: 'parent_of', origin: 'explicit' }
  ]
}

test('an edge between two neighbours is drawn, because both of its ends are on screen', () => {
  const witness = buildViewModel(TRIANGLE, null)
  const applied = applyView(witness, { mode: 'neighbourhood', anchorId: 'W:a' })
  assert.deepEqual(applied.model.nodes.map((n) => n.node_id), ['W:a', 'W:b', 'W:c'])
  // W:bc touches neither the anchor nor anything off view. Keeping only the
  // edges incident to the anchor would drop it and draw two neighbours that the
  // snapshot says are related as though they were not.
  assert.deepEqual(applied.model.edges.map((e) => e.edge_id), ['W:ab', 'W:ac', 'W:bc'])
  // W:cd has an endpoint off view and stays off, so "both endpoints" is a real
  // restriction and not just "every edge of every shown node".
  assert.equal(applied.model.edges.some((e) => e.edge_id === 'W:cd'), false)
  assert.equal(applied.scope.shownEdges, 3)
  assert.equal(applied.scope.totalEdges, 4)
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

test('overview hands back the view model itself; a neighbourhood hands back a restricted copy', () => {
  // The two modes really do differ in identity, and Task 6 assigns this result
  // to long-lived state, so the asymmetry is stated rather than left to be
  // rediscovered: in overview `applied.model` IS the canonical graph object, and
  // a consumer that mutated it would be mutating the graph itself.
  const overview = applyView(vm, DEFAULT_VIEW)
  assert.equal(overview.model, vm, 'overview copied the view model instead of projecting identity')
  const neighbourhood = applyView(vm, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.notEqual(neighbourhood.model, vm, 'a restricted view handed back the full graph object')
  assert.equal(vm.nodes.length, 5, 'projecting a neighbourhood mutated the view model')
  assert.equal(vm.edges.length, 4, 'projecting a neighbourhood mutated the view model')
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
  const full = vm.nodes.map((n) => n.node_id)
  for (const anchorId of [ROOT, DELIVERY]) {
    const applied = applyView(vm, { mode: 'neighbourhood', anchorId })
    const shown = applied.model.nodes.map((n) => n.node_id)
    assert.deepEqual(shown, full.filter((id) => shown.includes(id)), 'the view reordered the graph')
  }
  // That assertion can only see an identifier sort for an anchor whose two
  // orders actually differ. For DELIVERY they coincide, so with that anchor
  // alone the test proved nothing about the "identifier accident" it is named
  // for. ROOT is the anchor that tells them apart — pinned here so a future
  // change to the graph or to the node ordering cannot quietly disarm it again.
  const rootShown = applyView(vm, { mode: 'neighbourhood', anchorId: ROOT }).model.nodes.map((n) => n.node_id)
  assert.notDeepEqual(
    rootShown,
    [...rootShown].sort(),
    'this anchor no longer distinguishes view-model order from identifier order'
  )
})

test('an unknown mode is refused, never coerced into overview', () => {
  for (const mode of ['cluster', 'Overview', '', null, 42, undefined]) {
    const result = applyView(vm, { mode, anchorId: null })
    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} was accepted`)
    assert.equal(result.code, E_VIEW_MODE)
    assert.equal('model' in result, false, 'a refused view still produced a model')
  }
})

test('a view descriptor that is not an object is refused as a value, never thrown', () => {
  // Defence in depth at a seam Task 4 also guards itself: validateSavedView
  // refuses a non-object `view` with E_SAVED_VIEW_INVALID before it ever calls
  // normalizeView, and then passes a freshly built object literal. So this guard
  // is not the only thing standing between JSON.parse output and a crash — but
  // every refusal in this slice is a VALUE, and a TypeError here would be a crash
  // at a seam that exists to fail closed. Without the guard `applyView(vm, null)`
  // throws instead of refusing.
  for (const descriptor of [null, undefined, [], ['overview'], 'overview', 42, true]) {
    const result = applyView(vm, descriptor)
    assert.equal(result.ok, false, `${JSON.stringify(descriptor)} was accepted`)
    assert.equal(result.code, E_VIEW_MODE)
    assert.equal('model' in result, false, 'a refused view still produced a model')
  }
})

test('normalizeView answers without a graph, and an overview never keeps an anchor', () => {
  // Reaching normalizeView only through applyView masks its own anchor rule:
  // applyView re-checks the anchor against the graph and refuses '' with the
  // same code either way. Task 4 consumes normalizeView standalone, with no
  // graph in reach, so its no-graph contract is exercised here directly.
  assert.deepEqual(normalizeView({ mode: 'neighbourhood', anchorId: '' }), {
    ok: false,
    code: E_VIEW_ANCHOR,
    reason: 'a neighbourhood view has no anchor node'
  })
  assert.deepEqual(normalizeView({ mode: 'neighbourhood', anchorId: 'not-in-any-graph' }), {
    ok: true,
    view: { mode: 'neighbourhood', anchorId: 'not-in-any-graph' }
  })
  assert.equal(normalizeView(null).code, E_VIEW_MODE)
  // The anchor's TYPE is checked here and nowhere else. Task 4's
  // validateSavedView calls normalizeView with `raw.view.anchor_id ?? null`
  // taken straight from JSON.parse and type-checks that field nowhere, so this
  // half of the guard is all that stands between a stored `"anchor_id": 42` and
  // a view carrying a number as an anchor. Measured: mutated to
  // `view.anchorId == null || view.anchorId.length === 0` — which still refuses
  // null and '' — the whole suite stayed green at 18/18 while normalizeView
  // returned `{ok:true, view:{mode:'neighbourhood', anchorId:42}}`. The saved
  // view would then be refused one step later as E_SAVED_VIEW_STALE_NODE, whose
  // reason tells the user a number that was never a node id is a missing page,
  // where D4's table assigns an unusable field to E_SAVED_VIEW_INVALID.
  assert.equal(normalizeView({ mode: 'neighbourhood', anchorId: 42 }).code, E_VIEW_ANCHOR)
  // An overview carries no anchor, whatever it was handed. Task 4 persists
  // view.anchorId as anchor_id, so an anchor kept here would be written into a
  // saved overview and could later refuse that view for a stale node it does not
  // even use.
  assert.deepEqual(normalizeView({ mode: 'overview', anchorId: 'stale' }).view, {
    mode: 'overview',
    anchorId: null
  })
  assert.deepEqual(applyView(vm, { mode: 'overview', anchorId: DELIVERY }).view, {
    mode: 'overview',
    anchorId: null
  })
})

test('a neighbourhood with no anchor, or an unknown anchor, is refused and retargets nothing', () => {
  assert.equal(applyView(vm, { mode: 'neighbourhood', anchorId: null }).code, E_VIEW_ANCHOR)
  assert.equal(applyView(vm, { mode: 'neighbourhood', anchorId: '' }).code, E_VIEW_ANCHOR)
  const stale = applyView(vm, { mode: 'neighbourhood', anchorId: `${DELIVERY}X` })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, E_VIEW_ANCHOR)
  // The refusal must not hand back a "closest" node instead. Pinned as the SHAPE
  // of the refusal, because the reason quotes the anchor it refused: any test
  // that searched the serialised refusal for the id it did not retarget to would
  // find it inside the id it did quote, and could never fail.
  assert.deepEqual(Object.keys(stale).sort(), ['code', 'ok', 'reason'])
})

test('isInView answers for the drawn set only, and never for an unknown id', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.equal(isInView(applied, SPRINT), true)
  assert.equal(isInView(applied, DELIVERY), true)
  assert.equal(isInView(applied, ARCH), false)
  assert.equal(isInView(applied, 'not-a-node'), false)
  // In overview every node of the graph is drawn. Without this the predicate is
  // only ever asked about a neighbourhood, where the drawn set is exactly
  // "anchor + its adjacency" — so an implementation that answered from the
  // adjacency instead of from the drawn nodes would be indistinguishable here,
  // and would then answer false for EVERY node of the whole graph in overview.
  const overview = applyView(vm, DEFAULT_VIEW)
  assert.equal(isInView(overview, ARCH), true)
  assert.equal(isInView(overview, ROOT), true)
  assert.equal(isInView(overview, 'not-a-node'), false)
  // A refusal is a value here too: the predicate answers instead of throwing at a
  // caller that did not check `ok` first.
  const refused = applyView(vm, { mode: 'neighbourhood', anchorId: `${DELIVERY}X` })
  assert.equal(isInView(refused, DELIVERY), false)
  assert.equal(isInView(undefined, DELIVERY), false)
})

test('the neighbourhood model keeps the full adjacency, so selectFocus reports a focus this view does not draw', () => {
  // D1 names selectFocus as a consumer of exactly this shape, and the
  // neighbourhood projection is `{ ...viewModel, nodes, edges }` — the
  // FULL-graph adjacency survives into a model whose nodes are restricted. So
  // selectFocus, which decides hasFocus from `adjacency.has(id)`, answers TRUE
  // for a node this view does not draw. Measured on the accepted snapshot:
  // hasFocus true, isInView false, and the scene built from that focus state
  // has tabbable count 0 with every node `dim` — no entry in the roving
  // tabindex at all.
  //
  // This is a coupling, not a bug in either function on its own: the adjacency
  // is deliberately whole-graph, because degree and neighboursOf are properties
  // of the graph rather than of the window onto it. It is pinned here so the
  // runtime repair — a shell that consults isInView before it focuses — is a
  // requirement a later implementer inherits rather than one they have to
  // rediscover from a black stage.
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.equal(isInView(applied, ARCH), false, 'the fixture stopped excluding the off-view node')
  assert.equal(
    selectFocus(applied.model, ARCH).hasFocus,
    true,
    'selectFocus no longer reports a focus off view — if the adjacency is now restricted, the shell guard below may be dead code, so re-derive it rather than deleting this test'
  )
  // The consequence, stated as a number rather than as a warning.
  assert.equal(
    buildScene(
      applied.model,
      computeLayout(applied.model, { width: 800, height: 600 }),
      selectFocus(applied.model, ARCH)
    ).nodes.filter((node) => node.tabbable).length,
    0,
    'a focus on a node off view no longer empties the tab order'
  )
  // And the predicate that closes it: guarded by isInView, the focus falls back
  // to the neutral overview state, which puts the first node back in the tab
  // order.
  const guarded = isInView(applied, ARCH) ? selectFocus(applied.model, ARCH) : selectFocus(applied.model, null)
  assert.equal(guarded.hasFocus, false, 'isInView did not stop the off-view focus')
  assert.equal(
    buildScene(applied.model, computeLayout(applied.model, { width: 800, height: 600 }), guarded)
      .nodes.filter((node) => node.tabbable).length,
    1,
    'the isInView guard did not restore the roving tabindex entry'
  )
})

test('the caption counts what is drawn and what exists, and nothing else', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  assert.equal(viewCaption(applied.scope), 'Direct neighbourhood — 2 of 5 nodes, 1 of 4 relations.')
  assert.equal(
    viewCaption(applied.scope, '14 – Delivery Model, Program Increment and Sprint Plan'),
    'Direct neighbourhood of “14 – Delivery Model, Program Increment and Sprint Plan” — 2 of 5 nodes, 1 of 4 relations.'
  )
  // An empty label names nothing, so it is not announced as a name. Unreachable
  // through the shell — view-model.mjs:38 defines isText as a non-empty string
  // and line 68 refuses any node whose label is not isText, so anchorLabel() can
  // only return a non-empty string or null — but dropping `anchorLabel.length >
  // 0` survived the whole suite at 18/18 and rendered `Direct neighbourhood of
  // “” — …`. Pinned so the clause is not "simplified" away once that invariant
  // moves.
  assert.equal(viewCaption(applied.scope, ''), 'Direct neighbourhood — 2 of 5 nodes, 1 of 4 relations.')
})

test('the caption says “1 node” and “1 relation”, never “1 nodes”', () => {
  // Unreachable with the accepted five-node snapshot, and therefore unproven
  // text until it is asserted: the scope is built by hand here because this is an
  // assertion about the sentence, not about ATLAS content.
  assert.equal(
    viewCaption({ mode: 'overview', shownNodes: 1, totalNodes: 1, shownEdges: 1, totalEdges: 1 }),
    'Overview — 1 of 1 node, 1 of 1 relation.'
  )
  assert.equal(
    viewCaption({ mode: 'neighbourhood', shownNodes: 1, totalNodes: 1, shownEdges: 0, totalEdges: 1 }, 'A'),
    'Direct neighbourhood of “A” — 1 of 1 node, 0 of 1 relation.'
  )
  // Both scopes above set shownNodes === totalNodes === 1, so neither can tell
  // the two operands apart: `scope.totalNodes === 1` mutated to
  // `scope.shownNodes === 1` survived them at exit 0, 18/18. The plural agrees
  // with the number it follows, which is the TOTAL — and the mutant is
  // reachable, because an anchor with no neighbours (buildAdjacency initialises
  // every node to an empty Set, so the model permits an isolated node) draws
  // exactly one node out of five and would read "1 of 5 node". The twin mutation
  // on the edge branch is already killed by the SPRINT scope in the test above,
  // where shownEdges is 1 and totalEdges is 4; the node branch had no such
  // scope anywhere in this file.
  assert.equal(
    viewCaption({ mode: 'neighbourhood', shownNodes: 1, totalNodes: 5, shownEdges: 0, totalEdges: 4 }, 'A'),
    'Direct neighbourhood of “A” — 1 of 5 nodes, 0 of 4 relations.'
  )
})

test('the module carries no clock, randomness or DOM', () => {
  // The guard is imported, not re-spelled. The first version of this test was a
  // raw `source.includes(token)` scan over the whole file, comments included —
  // the exact pattern the gesture suite had already measured and removed one
  // commit earlier. Measured again on a byte-identical pure module: four
  // ordinary comments turn it red ("documented in the runbook" hits `document`,
  // "a window onto the graph" hits `window`, a sentence ending "reading
  // process." hits `process.`, "never a crypto digest" hits `crypto`), while
  // `const clock = Date` + `clock.now()`, `navigator.userAgent`,
  // `queueMicrotask` and `eval` all pass it — and the shared denylists name
  // every one of those four on a word boundary.
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/view-state.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function normalizeView/, 'the comment strip removed normalizeView')
  assert.match(code, /export function applyView/, 'the comment strip removed applyView')
  assert.match(code, /viewModel\.edges\.filter/, 'the comment strip removed the edge projection')
  assert.match(code, /export function isInView/, 'the comment strip removed isInView')
  assert.match(code, /export function viewCaption/, 'the comment strip removed viewCaption')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(code.includes(forbidden), false, `view-state.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      code,
      new RegExp(`\\b${forbidden}\\b`),
      `view-state.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(code, MODULE_SPECIFIER, 'view-state.mjs imports from a module specifier')
  assert.deepEqual(purityViolations(source), [], 'the purity rules disagree with each other')
})
```

**Corrected 2026-08-20 (fourth review of Task 3).** The neighbourhood projection makes `selectFocus` lie, and nothing recorded it. Both blocks above are the repaired files: the suite at `7d645ade7531c69834ee4b9935262852622b242890327df67f6202d2625042a2`, the module at `fe7356d87d0713a496568ee12c9780b853cfa694a119288812ab368a64383427` (comment only; no statement changed). The expected count moves from **18** to **19**, because the repair is a new test — the property matches no title already in the file.

The projection is `{ ...viewModel, nodes, edges }`, so the FULL-graph `adjacency` survives into a model whose `nodes` are restricted. D1 names `selectFocus` as a consumer of exactly this shape, and `selectFocus` (`viewer/atlas39/core/view-model.mjs:234-240`) decides `hasFocus` from `viewModel.adjacency.has(nodeId)`. Measured on the accepted snapshot, anchor `…:22478849`:

```
nodes in view: ["ATLAS:confluence:14778372:15171611","ATLAS:confluence:14778372:22478849"]
selectFocus(applied.model, ARCH).hasFocus: true
isInView(applied, ARCH): false
tabbable count: 0
states: ["dim","dim"]
```

`buildScene` (`viewer/atlas39/core/scene.mjs:277`, `tabbable: focusState.hasFocus ? focusState.focusId === node.node_id : index === 0`) therefore produces a scene with **tabbable count 0** and every node `dim`: the roving tabindex has no entry at all and the stage is unreachable from the keyboard. That is precisely the failure D3 exists to prevent.

The runtime repair belongs to **Task 6**, and `isInView` is the predicate for it — that assignment is unchanged. What was missing is that Task 6 is a different implementer and nothing in the module or the suite said that keeping the adjacency is what makes `selectFocus` lie; they would have had to rediscover it from a black stage. So the module now carries the one load-bearing comment naming `selectFocus` and the 0-tabbable consequence, and the suite carries the coupling as a test rather than a hope: `selectFocus(applied.model, offViewId).hasFocus === true` asserted against `isInView(applied, offViewId) === false`, the tabbable count of the unguarded scene asserted as **0**, and the guarded form — `isInView(...) ? selectFocus(...) : selectFocus(model, null)` — asserted to put the count back to **1**. The module's imports do not change; the suite imports `selectFocus`, `computeLayout` and `buildScene` for this one test.

**Corrected 2026-08-19 (third review of Task 3).** Still **18** tests: three assertions were added to existing tests, and **the module below changed too** — in two comment blocks and nothing else. `/usr/bin/diff` between the previous module and this one is 21 added lines, every one of them inside a comment; no statement changed. The three mutations below were measured against the module at `985d8b228f1b1002eb7d148fae91cfd5b15238b41d9e42be6a1c4455eda9ddb7`, restored and re-verified with `shasum -a 256` after every row, never with an empty `diff`. The second review's table further down was measured at `ea6a063bd17f21b98d5fce41cd0d60ef01bf4fbc67b27f70c62b6dd6bad347d0` and was **not** re-run this round; it is recorded as measured then, against the module those rows name.

1. **The node pluralization operand was unpinned, and a surviving mutant writes an ungrammatical caption.** `scope.totalNodes === 1` mutated to `scope.shownNodes === 1` scored exit 0, 18/18. The twin mutation on the edge branch is killed at exit 1, 16/18 by the SPRINT scope (`shownEdges` 1, `totalEdges` 4), so the gap was specific to the node branch: no scope in the file had `shownNodes === 1` while `totalNodes !== 1`, and both hand-built scopes in the pluralization test set `shownNodes === totalNodes === 1`, which cannot tell the two operands apart. It is reachable, not academic: `buildAdjacency` (`view-model.mjs:129-130`) initialises every node to an empty Set, so the model permits an isolated node, and an anchor with no neighbours draws one node of five — `Direct neighbourhood of “A” — 1 of 5 node, 0 of 4 relations.` under the mutant. One assertion closes it.
2. **The anchor's type check was unpinned, and it is the only type check between a stored `anchor_id` and Task 4's contract.** `typeof view.anchorId !== 'string' || view.anchorId.length === 0` mutated to `view.anchorId == null || view.anchorId.length === 0` — which still refuses `null` and `''`, the only two values the suite reached the guard with — scored exit 0, 18/18, and `normalizeView({mode:'neighbourhood', anchorId:42})` then returned `{"ok":true,"view":{"mode":"neighbourhood","anchorId":42}}`. Task 4's `validateSavedView` calls `normalizeView({ mode: raw.view.mode, anchorId: raw.view.anchor_id ?? null })` with a value taken straight from `JSON.parse` and type-checks that field nowhere else, so with the mutant a stored `"anchor_id": 42` parses, and `restoreSavedView` refuses it one step later as `E_SAVED_VIEW_STALE_NODE` — telling the user that a number which was never a node id is a missing page, where D4's table assigns a missing or unusable field to `E_SAVED_VIEW_INVALID`. One assertion closes it.
3. **The empty-label clause was unpinned.** Replacing `typeof anchorLabel === 'string' && anchorLabel.length > 0` with `typeof anchorLabel === 'string'` survived at exit 0, 18/18 and renders `Direct neighbourhood of “” — …`. It is unreachable through the shell today, and the reason is a foreign invariant rather than anything this module controls: `view-model.mjs:38` defines `isText` as a non-empty string and line 68 refuses any node whose `label` is not `isText`, so Task 6's `anchorLabel()` can only return a non-empty string or null. That dependency is now written down at the function and pinned by one assertion, so the clause is not "simplified" away once the label invariant moves.

| Mutation | Must go red | Measured |
| --- | --- | --- |
| `scope.totalNodes === 1 ? 'node'` → `scope.shownNodes === 1 ? 'node'` | `the caption says “1 node” and “1 relation”, never “1 nodes”` | exit 1, 17/18 |
| `typeof view.anchorId !== 'string'` → `view.anchorId == null` | `normalizeView answers without a graph, and an overview never keeps an anchor` | exit 1, 17/18 |
| drop `anchorLabel.length > 0` | `the caption counts what is drawn and what exists, and nothing else` | exit 1, 17/18 |
| `scope.totalEdges === 1 ? 'relation'` → `scope.shownEdges === 1 ? 'relation'` (the twin, re-measured) | both caption tests | exit 1, 16/18 |

**Open PO decision raised by this round (named once, decided by the PO, not by the implementer):** `VIEW_MODES` is exported with **no production reader**. Measured across the whole worktree, excluding `.git` and `node_modules`, its only readers are `normalizeView`'s own use inside the module and three lines in `test/atlas40-view-state.test.mjs`; Task 4 imports `normalizeView` and `E_VIEW_MODE`, Task 6 imports `DEFAULT_VIEW`, `applyView`, `isInView` and `viewCaption`. This is the same situation Task 2 raised for `isPanning()`/`isClickSuppressed()` and left to the PO, and Task 3 had settled it silently. Either keep the export, so a mode control enumerates the modes this build supports from one place instead of re-spelling them in the shell where the two lists could disagree, or delete it together with the two assertions that read it. It is one decision, not two. The module now records the open decision at the declaration, so the asymmetry with Task 2 is deliberate either way.

**Corrected 2026-08-19 (second review of Task 3).** Expected 15/15 until this round; the block above is now **18** tests, and **the module below changed too** — three repairs to it, each answering a measured finding. Both blocks are the files verbatim.

1. **The assertion that paid for a test's name could not fail.** `'…and retargets nothing'` ended in an `assert.equal(…, false)` over `JSON.stringify(stale).includes(DELIVERY) && !JSON.stringify(stale).includes(DELIVERY + 'X')`. The refusal reason quotes the anchor it refused, `…15171611X`, which contains **both** substrings, so the second conjunct is structurally false and the whole expression is `false` for every implementation that quotes the anchor — measured `false` on the pristine module and `false` again on a refusal mutated to carry `nearestAnchorId: <DELIVERY>`, i.e. a refusal that literally hands back "the closest node we do have", the one thing the comment above it forbids. The refusal's **shape** is pinned instead: `assert.deepEqual(Object.keys(stale).sort(), ['code', 'ok', 'reason'])`, which the same mutant fails.
2. **`isInView` was never asked about an overview.** For a neighbourhood the drawn set is provably identical to "anchor + adjacency(anchor)", so an implementation that answered from the adjacency was indistinguishable — and in overview the anchor is `null`, so that implementation returns `false` for **every node of the whole graph**. Measured: the mutant passed all 15 assertions. One line closes it, and the predicate is now also read in overview and on a refusal.
3. **The purity guard re-introduced the pattern the previous commit had measured and removed.** See the superseded bullet 3 below. The guard is now imported from `test/helpers/purity.mjs`, shared with Task 2, and the two directions are measured in the table below: four ordinary prose comments on a byte-identical pure module leave the suite green where the re-spelled list turned it red, and a clock reached through a bare `Date` alias turns it red where the re-spelled list stayed green.
4. **A false justification, in the test file and in this plan.** The Task-4 claim in bullet 4 below is contradicted by this plan's own Task-4 block; corrected there and in the test file.
5. **`scope` carried two fields nothing reads.** `scope.anchorId` has no reader anywhere in the ten tasks — Task 6's `paintViewControls` reads `scope.mode` and its `anchorLabel()` reads `state.view.anchorId` — and `scope.complete` appeared only in this task's own test. Both survived being mutated to a wrong value with the whole suite green. They are dropped rather than pinned: the anchor of an applied view is `applied.view.anchorId`. The two tests that sampled a scope field now pin the whole scope object, so a field with no reader cannot creep back in unnoticed.
6. **`isInView` threw on a refusal**, in a module whose contract is that refusals are values: `isInView(applyView(vm, {mode:'neighbourhood', anchorId:'…X'}), id)` raised `TypeError: Cannot read properties of undefined (reading 'nodes')`. Task 6's single call site is guarded, so this was latent rather than live; it is now `if (applied?.ok !== true) return false`, stated in the doc comment and pinned.
7. **Three unpinned properties of the module** are now asserted, each because a mutation of it survived: `Object.freeze` on `VIEW_MODES` and `DEFAULT_VIEW` (the test spread them, which reads the values and says nothing about the freeze); overview **clearing** a supplied anchor (Task 4 persists `view.anchorId` as `anchor_id`, so keeping a stale one would write it into a saved overview); and `normalizeView`'s own no-graph contract, which every assertion had been reaching through `applyView`, where the graph check masks it — while Task 4 consumes `normalizeView` standalone. The unreachable singular caption branches (`1 node`, `1 relation`) are covered with hand-built scope objects, and the `model` identity asymmetry between the two modes — overview returns the view model itself, a neighbourhood a shallow copy — is now stated in the module and pinned by test rather than left to be rediscovered.

Every mutation below was measured against the green 18-test suite, restoring `viewer/atlas39/core/view-state.mjs` to `ea6a063bd17f21b98d5fce41cd0d60ef01bf4fbc67b27f70c62b6dd6bad347d0` (verified by `shasum -a 256` after each row, never by an empty `diff`):

| Mutation | Must go red | Measured |
| --- | --- | --- |
| `refusal()` also returns `nearestAnchorId: <DELIVERY>` | `a neighbourhood with no anchor, or an unknown anchor, is refused and retargets nothing` | exit 1, 16/18 |
| `isInView` answers from `applied.view.anchorId` + `adjacency` instead of the drawn nodes | `isInView answers for the drawn set only, and never for an unknown id` | exit 1, 17/18 |
| delete `isInView`'s `if (applied?.ok !== true) return false` | the same test | exit 1, 17/18 |
| overview keeps a supplied anchor (`anchorId: view.anchorId ?? null`) | `normalizeView answers without a graph, and an overview never keeps an anchor` | exit 1, 17/18 |
| delete `normalizeView`'s `view.anchorId.length === 0` check | the same test | exit 1, 17/18 |
| drop `Object.freeze` from `VIEW_MODES` | `the mode list is exactly what this build supports, and cannot be extended from outside` | exit 1, 17/18 |
| drop `Object.freeze` from `DEFAULT_VIEW` | the same test | exit 1, 17/18 |
| an unread `complete` field creeps back into `scope` | `overview draws the whole real graph` and `a neighbourhood is the anchor plus the nodes its explicit edges reach` | exit 1, 16/18 |
| overview returns `{ ...viewModel }` instead of the view model itself | `overview hands back the view model itself; a neighbourhood hands back a restricted copy` | exit 1, 17/18 |
| `totalNodes === 1 ? 'node'` → `'nodes'` | `the caption says “1 node” and “1 relation”, never “1 nodes”` | exit 1, 17/18 |
| `totalEdges === 1 ? 'relation'` → `'relations'` | the same test | exit 1, 17/18 |
| add four ordinary prose comments to the module ("The trade-off is documented in the runbook.", "A view is a window onto the graph.", a sentence ending "reading process.", "never a crypto digest") | nothing — prose is not capability use | exit 0, 18/18 (**the superseded raw-substring list hits `document`, `window`, `process.` and `crypto` on those four lines**) |
| `const clock = Date` + `clock.now()` in the module | `the module carries no clock, randomness or DOM` | exit 1, 15/18 (**invisible to the superseded list: `'Date.'` and `'Date('` match neither spelling**) |
| `queueMicrotask(() => {})` in the module | the same test | exit 1, 17/18 (**invisible to the superseded list**) |
| `import { readFileSync } from 'node:fs'` in the module | the same test | exit 1, 17/18 |

**Corrected 2026-08-19 (review of Task 3).** The assertions above were mutation-tested against the module they guard, one regression at a time. Three of them did not fail when it regressed, so three claims in this task were not being paid for. All three are repaired in the block above — the block is the file — and **the module's own code is unchanged from the draft below**, verified by checksum after every mutation. (**That last clause is true of this round only**; the second review above changed the module in three places and says which.)

1. **D2's neighbour-to-neighbour rule had no witness, and the test named for it did not test it.** The accepted snapshot is a tree: measured over all five nodes, the number of anchors whose two neighbours are joined by a real edge is `0`. Replacing the projection's edge rule with `edge.from === resolved.anchorId || edge.to === resolved.anchorId` — which drops exactly the edges D2 says are drawn — left all 13 tests **green**. The test that claimed the property is renamed to what it actually proves (no endpoint off view, a grandchild is not a neighbour), and a four-node witness graph built through `buildViewModel` now pins the rule. That witness is not evidence about ATLAS content and is never rendered; it exists because the real snapshot cannot express this case at all.
2. **The order test's anchor could not see an identifier sort.** For anchor `DELIVERY` the view-model order and the identifier order coincide, so re-sorting the projected nodes by `node_id` left all 13 tests **green** — under a test named "not insertion or identifier accident". Measured per anchor, only the root and `…14680066` distinguish the two orders. The test now asserts over the root as well, *and* asserts that the root still distinguishes them, so a later change to the graph or to the node ordering cannot quietly disarm it again.
3. **The purity guard was narrower than its own name.** `'Date.'` does not match `new Date()`, and no token in the list matched a `node:` import, so both a clock and an IO import passed a guard named "no clock, randomness or DOM". The denylist now names the clock, randomness, DOM and IO routes explicitly. It stays a raw substring scan over the whole source, comments included — strictly weaker than the comment-stripping scanner Task 2 built for `gesture.mjs`, and it fails closed on a comment that happens to contain a token. Unifying the two guards behind one shared helper is **deferred, not silently carried**. — **Superseded by the second review of Task 3 below.** "Deferred" was the wrong call and the sentence "it fails closed on a comment that happens to contain a token" understated the cost in one direction while hiding a hole in the other: the re-spelled list turns four ordinary prose comments red on a byte-identical pure module, and is blind to `const clock = Date` + `clock.now()`, to `navigator.userAgent`, to `queueMicrotask` and to `eval`, all four of which Task 2's list names on a word boundary. Both directions are measured below; the guard is now one shared helper.

4. **`normalizeView`'s non-object guard was never exercised.** Deleting it left every test green, and without the guard `applyView(vm, null)` **throws a TypeError** instead of returning a refusal — a crash at a seam D4/D5 require to fail closed with a value. A test now pins that every non-object descriptor is refused as a value. **Corrected 2026-08-19 (second review of Task 3).** This bullet, and the comment it put into the test file, justified the guard as "the guard Task 4 leans on: a saved view is `JSON.parse` output, so `null`, an array, a string and a number are its realistic inputs". That justification is contradicted by this plan's own Task-4 block: `validateSavedView` refuses a non-object `view` with `E_SAVED_VIEW_INVALID` **before** it calls `normalizeView`, and then passes a freshly built object literal, never `JSON.parse` output. Every `normalizeView`/`applyView` call site in this plan was checked; none passes an unvalidated parsed value. The guard and its test are right and stay; only the reason was wrong, and it was load-bearing in the wrong direction — a Task-4 implementer who believed it could drop the `isObject(raw.view)` guard as redundant, at which point a non-object `view` returns `E_VIEW_MODE` (measured: `normalizeView(null)` → `{ok:false, code:'E_VIEW_MODE', reason:'view is not an object'}`), which Task 4's mapping converts to `E_SAVED_VIEW_MODE`, while D4's refusal table assigns "not an object" to `E_SAVED_VIEW_INVALID`. The user would be shown and read out the wrong refusal code. The claim now reads, here and in the test file, as defence in depth at a seam Task 4 also guards itself.

After the repair all 15 mutations fail the suite. One further mutation is recorded as **not** a defect: dropping the `Array.isArray` branch survives, and is an **equivalent mutant** — an array carries no `mode`, so it is refused by the very next check with the identical public outcome (`ok: false`, `E_VIEW_MODE`); only the internal reason string differs. Measured on all three of `[]`, `['overview']` and `[1, 2]`. No assertion was contorted to kill it.


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

// VIEW_MODES is exported with no production reader in the ten planned tasks:
// measured across the whole worktree, its only readers are `normalizeView`
// below and this task's own suite (Task 4 imports `normalizeView` and
// `E_VIEW_MODE`; Task 6 imports `DEFAULT_VIEW`, `applyView`, `isInView` and
// `viewCaption`). It is exported anyway so that a mode control enumerates the
// modes this build supports from here instead of re-spelling them in the shell,
// where the two lists could disagree. Keeping an export that only tests read is
// the same call Task 2 left open for `isPanning()`/`isClickSuppressed()`, and it
// is named as one open PO decision in the plan rather than settled here.
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

// Exactly what a consumer reads, and nothing else. The first draft also carried
// `anchorId` (a copy of `applied.view.anchorId`) and `complete` (a derived
// boolean); neither had a single reader in the slice, and an unread field is a
// field no test can pay for — both survived being mutated to a wrong value with
// the whole suite green. The anchor of an applied view is `applied.view.anchorId`.
function scopeOf(view, viewModel, nodes, edges) {
  return {
    mode: view.mode,
    shownNodes: nodes.length,
    totalNodes: viewModel.nodes.length,
    shownEdges: edges.length,
    totalEdges: viewModel.edges.length
  }
}

/**
 * Overview returns the view model ITSELF as `model` — the identity projection
 * copies nothing — while a neighbourhood returns a shallow copy carrying the
 * restricted `nodes` and `edges`. So `applied.model === viewModel` holds in one
 * mode and not in the other, and a caller that holds the result for the life of
 * a view must treat `model` as read-only: in overview, mutating it would be
 * mutating the canonical graph. Nothing in this slice mutates it.
 *
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

  // The spread carries the FULL-graph `adjacency` into a model whose `nodes`
  // are restricted, and that is deliberate — `neighboursOf` and the degree it
  // already computed are properties of the whole graph, not of this window onto
  // it. The cost is exact and must be paid by every caller: `selectFocus`
  // (view-model.mjs:234) decides `hasFocus` from `viewModel.adjacency.has(id)`,
  // so on THIS model it answers `hasFocus: true` for a node the view does not
  // draw. Measured on the accepted snapshot with anchor 22478849 and the node
  // 15073290 that the view excludes: `selectFocus(applied.model, 15073290)` is
  // `{hasFocus: true}` while `isInView(applied, 15073290)` is `false`, and
  // feeding that focus state to `buildScene` (scene.mjs:277,
  // `tabbable: focusState.hasFocus ? focusState.focusId === node.node_id : ...`)
  // produces a scene with **tabbable count 0** and every node `dim` — the
  // roving tabindex loses its only entry and the stage cannot be reached from
  // the keyboard at all, which is the failure D3 exists to prevent.
  //
  // `isInView` below is the predicate that closes it: a shell must not hand
  // `selectFocus` an id this view does not draw. The coupling is pinned in
  // test/atlas40-view-state.test.mjs, "the neighbourhood model keeps the full
  // adjacency, so selectFocus reports a focus this view does not draw", so a
  // later change that drops either side is a red suite rather than an
  // unreachable stage.
  return {
    ok: true,
    view: resolved,
    model: { ...viewModel, nodes, edges },
    scope: scopeOf(resolved, viewModel, nodes, edges)
  }
}

/**
 * True when this view actually draws the node. An unknown id is never in view,
 * and neither is anything at all when `applied` is a refusal: this module's
 * contract is that a refusal is a VALUE, so the one predicate it exports answers
 * one instead of throwing a TypeError at a caller that did not check `ok` first.
 */
export function isInView(applied, nodeId) {
  if (applied?.ok !== true) return false
  return applied.model.nodes.some((node) => node.node_id === nodeId)
}

/**
 * The sentence the shell shows and announces. It counts what is drawn against
 * what exists, so a scoped view can never read as "this is the whole graph".
 *
 * Both plurals agree with the number they follow, which is the TOTAL, not the
 * shown count: an anchor with no neighbours draws one node out of five and must
 * still read "1 of 5 nodes".
 *
 * The label clause refuses an empty string as well as a non-string. That is
 * unreachable today, and by a foreign invariant rather than by anything this
 * module controls: `view-model.mjs:38` defines `isText` as a non-empty string
 * and line 68 refuses any node whose `label` is not `isText`, so the shell's
 * anchorLabel() can only hand over a non-empty string or null. It is guarded and
 * pinned anyway, because the day that invariant moves this function would render
 * `Direct neighbourhood of “” — …` and nothing else would say so.
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
Expected: PASS, 19/19. (18/18 until the fourth review of Task 3 added the `selectFocus` coupling test — **Corrected 2026-08-20**.)

**Step 5: Commit**

```bash
git add viewer/atlas39/core/view-state.mjs test/atlas40-view-state.test.mjs \
        test/helpers/purity.mjs test/atlas40-gesture.test.mjs \
        docs/plans/2026-08-19-atlas-40-slice-2-deterministic-views.md
git commit -m "ATLAS-40: deterministic view state as a pure projection over the loaded snapshot"
```

**Corrected 2026-08-19 (second review of Task 3).** The `git add` gains the shared purity helper, the gesture suite that now imports it, and this plan document — the review that lifted the guard changed both Task-2 and Task-3 code blocks, which are those files verbatim, so the scope contract and the code it governs move together instead of drifting apart between two commits.

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
  IDENTITY_FIELDS,
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
// The purity guard is the shared one every pure-core suite is scanned with,
// imported rather than re-spelled — see the test at the bottom of this file.
import {
  stripComments,
  purityViolations,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'

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

test('the six identity fields carry the values the loaded graph really has', () => {
  // Capture and compare BOTH go through snapshotIdentity(), so the mapping from
  // the view model onto D4's six fields is symmetric, and no roundtrip, drift or
  // refusal test can see it. Measured: swapping the two sources inside
  // snapshotIdentity — `project_id: viewModel.id_scheme` and
  // `id_scheme: viewModel.project_id` — left this suite green at 15/15, exit 0,
  // while every stored record then carried
  // {"project_id":"projection-local/v1", ..., "id_scheme":"ATLAS"} and a later
  // drift would have been reported back to the user against the wrong field
  // name, which is the same false story as reporting the wrong refusal code.
  //
  // So the six values are pinned against the literals D4 documents, not read
  // back out of the same view model the implementation reads them from: doing
  // that is exactly what made the swap invisible.
  assert.deepEqual(sample().snapshot, {
    project_id: 'ATLAS',
    source_id: '14778372',
    contract_version: '1.0.0',
    id_scheme: 'projection-local/v1',
    node_count: 5,
    edge_count: 4
  })

  // Literals close the field-to-field swap, but on their own they re-open the
  // other half of the same question: an implementation that IGNORES its
  // argument passes them. Measured: replacing the whole body of
  // snapshotIdentity with exactly those six literals left the suite green at
  // exit 0, 16/16 — and under that mutant EVERY graph captures ATLAS's
  // identity, so restoreSavedView compares ATLAS's identity to itself and a
  // view captured against graph A restores into graph B with ok:true. That is
  // the cross-graph restore D4's identity check exists to prevent, and the
  // whole reason node_count/edge_count are part of the identity.
  //
  // So the six fields are read a second time off a synthetic view model that
  // differs in ALL SIX. It witnesses this module's mapping only; it is NOT
  // evidence about ATLAS content, the same convention Task 3's four-node
  // witness graph is written under.
  const other = {
    project_id: 'OTHER',
    source: { source_id: '99999999' },
    contract_version: '2.0.0',
    id_scheme: 'canonical/v1',
    counts: { nodes: 2, edges: 1 },
    // Both saved ids exist here, so a restore that got past the identity check
    // would answer ok:true rather than E_SAVED_VIEW_STALE_NODE — the failure
    // below has to be the one actually being pinned.
    adjacency: new Map([[DELIVERY, new Set([SPRINT])], [SPRINT, new Set([DELIVERY])]])
  }
  assert.deepEqual(
    captureSavedView({
      viewModel: other,
      view: { mode: 'neighbourhood', anchorId: DELIVERY },
      focusId: SPRINT,
      transform: { scale: 1, tx: 0, ty: 0 },
      viewport: VIEWPORT
    }).snapshot,
    {
      project_id: 'OTHER',
      source_id: '99999999',
      contract_version: '2.0.0',
      id_scheme: 'canonical/v1',
      node_count: 2,
      edge_count: 1
    }
  )

  const crossGraph = restoreSavedView(other, parseSavedView(serializeSavedView(sample())).value, VIEWPORT)
  assert.equal(crossGraph.ok, false, 'a view captured against one graph restored into another')
  assert.equal(crossGraph.code, E_SAVED_VIEW_SNAPSHOT)
})

test('serialising is byte-stable, so the same view always stores the same bytes', () => {
  const canonical = serializeSavedView(sample())
  assert.equal(serializeSavedView(sample()), canonical)

  // Key order must not depend on how the object was assembled, and nothing
  // outside the contract may reach storage.
  //
  // The first draft of this test built its "reordered" object with
  // JSON.parse(JSON.stringify(sample())), which PRESERVES key order — so it
  // reordered nothing, and replacing JSON.stringify(saved, KEY_ORDER) with a
  // plain JSON.stringify(saved) left this suite green at 14/14 (measured). The
  // replacer is the whole reason the stored bytes are a function of the view
  // alone, so it is pinned by an object that really is scrambled and really
  // does carry fields the contract does not name.
  const s = sample()
  const scrambled = {}
  scrambled.viewport = { height: s.viewport.height, width: s.viewport.width }
  scrambled.transform = { ty: s.transform.ty, tx: s.transform.tx, scale: s.transform.scale }
  scrambled.focus_id = s.focus_id
  scrambled.view = { anchor_id: s.view.anchor_id, mode: s.view.mode }
  scrambled.snapshot = {
    edge_count: s.snapshot.edge_count,
    node_count: s.snapshot.node_count,
    id_scheme: s.snapshot.id_scheme,
    contract_version: s.snapshot.contract_version,
    source_id: s.snapshot.source_id,
    project_id: s.snapshot.project_id
  }
  scrambled.saved_view_version = s.saved_view_version
  scrambled.stray_field = 'must not be persisted'
  scrambled.snapshot.stray_nested = 'must not be persisted either'

  // Without this the test could pass on an object that was never scrambled.
  assert.notEqual(JSON.stringify(scrambled), canonical, 'the scrambled object was not actually scrambled')
  assert.equal(serializeSavedView(scrambled), canonical)
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
  const parsed = () => parseSavedView(serializeSavedView(sample())).value
  const bound = restoreSavedView(vm, parsed(), { width: 1440, height: 900 })
  assert.equal(bound.ok, true)
  assert.deepEqual(bound.view, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(bound.focusId, SPRINT)
  // The transform is handed back unchanged; the shell clamps it to the world it
  // actually has. What must not happen is a silent claim that nothing changed.
  assert.equal(bound.viewportChanged, true)
  assert.deepEqual(bound.transform, { scale: 1.75, tx: -412, ty: -88 })

  // Either dimension alone is already a different stage. The first draft varied
  // both together, so comparing only the width survived mutation with the suite
  // green (measured) — and a stage that changed height alone would then have
  // been announced as an exact restore.
  assert.equal(
    restoreSavedView(vm, parsed(), { width: VIEWPORT.width, height: 900 }).viewportChanged,
    true,
    'a change in height alone was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: 1440, height: VIEWPORT.height }).viewportChanged,
    true,
    'a change in width alone was reported as an exact restore'
  )

  // Every case above restores into a LARGER stage, so the comparison was pinned
  // on both dimensions but not on its DIRECTION. Measured: replacing
  // `parsed.viewport.width !== viewport.width || parsed.viewport.height !==
  // viewport.height` with `<` in both halves left the suite green at exit 0,
  // 17/17, and a view saved at 1440x900 then restored at 1092x693 answered
  // {"ok":true,...,"viewportChanged":false}. Task 6 suppresses ' The stage is a
  // different size than when this view was saved, so the zoom and position were
  // re-fitted.' on exactly that flag, so the mutant announces a pixel-identical
  // restore across a viewport change — the overclaim D6 forbids in as many
  // words. A shrinking stage is the ordinary case (a sidebar opens, the window
  // is made smaller), so it is pinned per dimension, the same way growing is.
  const smaller = { width: 800, height: 500 }
  assert.equal(
    restoreSavedView(vm, parsed(), smaller).viewportChanged,
    true,
    'a restore into a smaller stage was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: VIEWPORT.width, height: smaller.height }).viewportChanged,
    true,
    'a stage that lost height alone was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: smaller.width, height: VIEWPORT.height }).viewportChanged,
    true,
    'a stage that lost width alone was reported as an exact restore'
  )
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

test('capture never writes a focus id that validate would refuse', () => {
  // The two sides of this module disagreed on the empty string: capture asked
  // `typeof focusId === 'string'`, which accepts '', while validate refuses ''
  // through `isText` — so capture could store a record this module can never
  // restore, and the user would get E_SAVED_VIEW_INVALID from a view the
  // workspace itself wrote. It is unreachable from the shell today, because
  // `state.focusId` is a node id or null, which is exactly why the agreement
  // needs a test rather than a comment: nothing else in this suite would notice
  // the two predicates drifting apart again.
  const saved = captureSavedView({
    viewModel: vm,
    view: { mode: 'overview', anchorId: null },
    focusId: '',
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  })
  assert.equal(saved.focus_id, null, 'capture stored a focus id validate refuses')
  const parsed = parseSavedView(serializeSavedView(saved))
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(parsed.value.focusId, null)
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

  // Every case above keeps every OTHER field valid, so none of them can tell
  // "version first" from "version last" — which is the ordering D4 requires in
  // bold, and this test's own title claims. Measured: moving the whole version
  // gate from the top of validateSavedView down to just above `const identity
  // = {}` left the suite green at 15/15, and under that mutant a record with a
  // bad version AND a missing snapshot came back E_SAVED_VIEW_INVALID — the
  // fields were interpreted first after all.
  //
  // The ordering is only visible on a record that is broken in BOTH ways at
  // once. An older build must say "I do not read this version", never report a
  // field it had no business interpreting: a version it cannot read is a
  // record whose field meanings it does not know.
  const brokenTwice = [
    { saved_view_version: 99 },
    { ...sample(), saved_view_version: 99, snapshot: undefined },
    { ...sample(), saved_view_version: 2, view: { mode: 'cluster', anchor_id: DELIVERY } },
    { ...sample(), saved_view_version: 0, transform: { scale: 0, tx: 'left', ty: 0 } }
  ]
  for (const raw of brokenTwice) {
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false)
    assert.equal(
      result.code,
      E_SAVED_VIEW_VERSION,
      `a field was interpreted before the version was checked: ${result.code}`
    )
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

test('a supported mode with a missing anchor is refused as malformed, not as a bad mode', () => {
  // `neighbourhood` IS a mode this build supports; what is unusable is the
  // anchor. Reporting E_SAVED_VIEW_MODE here would tell the user their saved
  // view came from another build — a different, and false, story. This is the
  // only case that separates the two codes, and it was untested: collapsing
  // `view.code === E_VIEW_MODE ? E_SAVED_VIEW_MODE : E_SAVED_VIEW_INVALID` to a
  // bare E_SAVED_VIEW_MODE left the suite green at 14/14 (measured).
  for (const anchor of [null, '', 42, undefined]) {
    const result = parseSavedView(JSON.stringify({ ...sample(), view: { mode: 'neighbourhood', anchor_id: anchor } }))
    assert.equal(result.ok, false, `anchor ${JSON.stringify(anchor)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `anchor ${JSON.stringify(anchor)}: ${result.code}`)
  }
})

test('a malformed shape is refused field by field', () => {
  // "Field by field" is the title, so EVERY guarded field gets its own row and
  // every dimension of a two-dimensional field gets its own. A table that
  // covers one representative per group leaves the rest fail-OPEN: measured on
  // the previous table, deleting any single one of `!isText(snapshot.source_id)`,
  // `!isText(snapshot.contract_version)`, `!isText(snapshot.id_scheme)`,
  // `!Number.isInteger(snapshot.edge_count)`, `!isFiniteNumber(t.ty)`,
  // `!isFiniteNumber(v.width)` or `!isFiniteNumber(v.height) || v.height <= 0`
  // left the suite green at exit 0, 16/16, while a record carrying
  // {"transform":{"scale":1.75,"tx":-412,"ty":"up"}} or
  // {"viewport":{"width":1092,"height":"tall"}} then parsed and restored
  // ok:true — the shell would apply a NaN translate, or accept a stage size it
  // cannot use, and announce a successful restore. Only `project_id` and
  // `node_count` were pinned, and they are exactly the two rows this table had.
  //
  // Every row above pinned the TYPE half of its guard and none pinned the
  // DOMAIN half, so the same wrong-refusal-code false story survived a second
  // time. Three mutants, each measured at exit 0, 17/17, with
  // `shasum -a 256 viewer/atlas39/core/saved-view.mjs` restored to
  // 07e4452ac4a373d9dd370ecf4d63491dcf89f2068788b77bc894f52a309be880 each time:
  //
  //   `const isText = (v) => typeof v === 'string'` — the `&& v.length > 0`
  //   deleted — lets a stored {"source_id": ""} parse, and restoreSavedView
  //   then answers {"ok":false,"code":"E_SAVED_VIEW_SNAPSHOT","reason":"the
  //   saved view was captured against a different graph (source_id was \"\",
  //   this graph has \"14778372\")"}: a malformed record reported as a
  //   re-scanned Confluence tree. The same mutant answers
  //   E_SAVED_VIEW_STALE_NODE for {"focus_id": ""} — a malformed record
  //   reported as a deleted page.
  //
  //   `!Number.isInteger(snapshot.node_count)` -> `typeof snapshot.node_count
  //   !== 'number'` lets node_count 5.5 parse and restore as
  //   E_SAVED_VIEW_SNAPSHOT "(node_count was 5.5, this graph has 5)"; the same
  //   for edge_count 4.5, "(edge_count was 4.5, this graph has 4)".
  //
  //   `raw.focus_id !== null` -> `raw.focus_id != null` lets a record with NO
  //   `focus_id` key at all parse ok:true and restore
  //   {"ok":true,...,"focusId":null} — a missing field silently defaulted,
  //   where D4's table assigns it to E_SAVED_VIEW_INVALID.
  //
  // So each guarded field now carries both halves: the wrong type AND the
  // wrong value of the right type.
  const base = sample()
  const mutations = [
    ['snapshot', undefined],
    ['snapshot', { ...base.snapshot, project_id: 42 }],
    ['snapshot', { ...base.snapshot, project_id: '' }],
    ['snapshot', { ...base.snapshot, source_id: 14778372 }],
    ['snapshot', { ...base.snapshot, source_id: '' }],
    ['snapshot', { ...base.snapshot, contract_version: 1 }],
    ['snapshot', { ...base.snapshot, contract_version: '' }],
    ['snapshot', { ...base.snapshot, id_scheme: null }],
    ['snapshot', { ...base.snapshot, id_scheme: '' }],
    ['snapshot', { ...base.snapshot, node_count: '5' }],
    ['snapshot', { ...base.snapshot, node_count: 5.5 }],
    ['snapshot', { ...base.snapshot, edge_count: '4' }],
    ['snapshot', { ...base.snapshot, edge_count: 4.5 }],
    ['view', undefined],
    ['focus_id', 42],
    ['focus_id', ''],
    // JSON.stringify drops an undefined value, so this row is a record with no
    // `focus_id` key at all — the case the strict `!== null` exists for.
    ['focus_id', undefined],
    ['transform', { scale: 0, tx: 0, ty: 0 }],
    ['transform', { scale: Number.NaN, tx: 0, ty: 0 }],
    ['transform', { scale: 1, tx: 'left', ty: 0 }],
    ['transform', { scale: 1, tx: 0, ty: 'up' }],
    ['transform', undefined],
    ['viewport', { width: 0, height: 693 }],
    ['viewport', { width: 'wide', height: 693 }],
    ['viewport', { width: 1092, height: 0 }],
    ['viewport', { width: 1092, height: 'tall' }],
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

    // Asking only whether the drifted field's NAME appears somewhere passes on
    // a reason that names every field. Measured: replacing the reason with the
    // constant string 'the saved view was captured against a different graph
    // (project_id source_id contract_version id_scheme node_count edge_count
    // differ)' left the suite green at exit 0, 16/16, and a node_count-only
    // drift was then reported to the user as all six fields differing. So the
    // reason must name exactly ONE identity field, and carry both of the values
    // it is contrasting — otherwise it is not a report about this drift.
    assert.deepEqual(
      IDENTITY_FIELDS.filter((field) => result.reason.includes(field)),
      [key],
      `the reason named the wrong set of identity fields: ${result.reason}`
    )
    assert.equal(
      result.reason.includes(JSON.stringify(value)),
      true,
      `the saved value is missing from the reason: ${result.reason}`
    )
    assert.equal(
      result.reason.includes(JSON.stringify(parsed.snapshot[key])),
      true,
      `this graph's value is missing from the reason: ${result.reason}`
    )
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

  // WHICH node is missing, not just that one is. The refusal's `what` label was
  // unpinned: measured on this module, swapping the loop's two rows to
  // `[['focus', parsed.view.anchorId], ['anchor', parsed.focusId]]` left this
  // suite at exit 0, 18/18, and a saved view whose FOCUS page had been deleted
  // then answered "the saved anchor node is not in this graph". Task 6 renders
  // `reason` verbatim into `#saved-view-state` and the live region, so the
  // mislabel sends the user to look for the wrong page — the same class of
  // false story as reporting the wrong refusal code, which this file already
  // pins twice.
  assert.match(
    anchorResult.reason,
    /saved anchor node/,
    `a stale ANCHOR was reported under the wrong label: ${anchorResult.reason}`
  )
  assert.match(
    focusResult.reason,
    /saved focus node/,
    `a stale FOCUS was reported under the wrong label: ${focusResult.reason}`
  )

  // The decisive property: a refusal must carry NO usable node of this graph.
  // If it did, the shell could restore "something close" and look successful.
  //
  // The scan is deliberately UNANCHORED. The first draft looked for `"<id>"`,
  // which only sees a node id that is a whole JSON string value, so an id named
  // in the refusal's prose was invisible to it — the one place a substitute is
  // most likely to be offered. Measured: rewriting the stale-node reason to
  // `the saved ${what} node is not in this graph; the nearest surviving page is
  // ${viewModel.nodes[0].node_id} - restore that one instead` left the suite
  // green at 15/15 while the refusal literally read "... the nearest surviving
  // page is ATLAS:confluence:14778372:14778372 - restore that one instead".
  // A substitute offered in prose is still a substitute.
  for (const result of [anchorResult, focusResult]) {
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
    for (const node of vm.nodes) {
      assert.equal(
        JSON.stringify(result).includes(node.node_id),
        false,
        `the refusal offered ${node.node_id} as a substitute`
      )
    }
  }
})

test('restoreSavedView answers a refusal when it is handed anything but a validated saved view', () => {
  // A refusal is a VALUE in this module, and the sibling pure module states the
  // same contract for `isInView` in view-state.mjs — it answers `false` on a
  // refusal "instead of throwing a TypeError at a caller that did not check ok
  // first". This module did the opposite. Measured before the guard:
  // restoreSavedView(vm, parseSavedView(text), viewport) — the whole parse
  // RESULT rather than its .value — raised `TypeError: Cannot read properties
  // of undefined (reading 'project_id')`, and so did the same call on a
  // refusal. Under D5 a saved view that does not apply must never tear the
  // stage down, so the wrong shape is refused rather than thrown.
  //
  // The first guard covered `parsed`, `parsed.snapshot` and `parsed.view` — 2
  // of the 4 objects this function dereferences — so the title above and the
  // module's own "anything else is refused as a value, never thrown" were still
  // false. Measured on that module: a record carrying this graph's six identity
  // values and a valid `view` but no `transform`/`viewport`, the same record
  // carrying `transform` but no `viewport`, and `restoreSavedView(vm, parsed)`
  // with the stage size omitted ALL raised `TypeError: Cannot read properties
  // of undefined (reading 'width')` at saved-view.mjs:242 — the identity and
  // stale-node checks pass first, so the guard never saw them. All four objects
  // are guarded now, and all three shapes are rows here.
  const complete = parseSavedView(serializeSavedView(sample())).value
  const wrong = [
    parseSavedView(serializeSavedView(sample())), // the {ok, value} envelope, not value
    parseSavedView('not json'), // a refusal
    null,
    undefined,
    'a string',
    {},
    { snapshot: sample().snapshot }, // an identity, but no view
    // The six clauses of the widened guard need six isolating rows, and the
    // rows above isolate only four: `parsed`, `viewport` (below), `transform`
    // and the record's own `viewport`. The two record fields the earlier rows
    // covered only INCIDENTALLY each get one here, because each was measured
    // individually fail-OPEN on the shipped module — deleted alone,
    // `node --test test/atlas40-saved-view.test.mjs` exited 0 at 18/18 both
    // times. Under the first mutant this row raises `TypeError: Cannot read
    // properties of undefined (reading 'project_id')` at the identity loop;
    // under the second the next row raises `... (reading 'anchorId')` at the
    // stale-node loop. Both are the D5 violation: a bad saved view tearing the
    // stage down instead of being refused as a value.
    { view: complete.view, focusId: null, transform: complete.transform, viewport: complete.viewport },
    { snapshot: complete.snapshot, focusId: null, transform: complete.transform, viewport: complete.viewport },
    // All three of these get PAST the identity and stale-node checks, which is
    // why they threw where the earlier rows refused. Each of the two remaining
    // record fields gets its own row, because a single row covering both leaves
    // the other clause fail-OPEN: measured on the repaired module, deleting
    // `!isObject(parsed.transform)` alone left the suite green at exit 0, 18/18
    // while the missing-viewport rows still caught the viewport clause, and
    // under that mutant a record with no `transform` restored ok:true carrying
    // `transform: undefined` — which the shell would hand straight to
    // clampTransform. The transform is never dereferenced here, so it does not
    // throw; it is handed on as an unusable value instead, which is the same
    // half-applied restore from the other direction.
    { snapshot: complete.snapshot, view: complete.view, focusId: null },
    {
      snapshot: complete.snapshot,
      view: complete.view,
      focusId: null,
      transform: { scale: 1, tx: 0, ty: 0 }
    },
    {
      snapshot: complete.snapshot,
      view: complete.view,
      focusId: null,
      viewport: { width: 1092, height: 693 }
    }
  ]
  for (const argument of wrong) {
    const result = restoreSavedView(vm, argument, VIEWPORT)
    assert.equal(result.ok, false, `${JSON.stringify(argument)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `${JSON.stringify(argument)}: ${result.code}`)
    // Nothing may be handed back that the shell could half-apply.
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
  }

  // The current stage size is the fourth dereferenced object, and it is the
  // caller's argument rather than the record's field, so it needs its own case:
  // a complete, valid saved view with no stage size to restore it into.
  for (const stage of [undefined, null, 'wide']) {
    const result = stage === undefined ? restoreSavedView(vm, complete) : restoreSavedView(vm, complete, stage)
    assert.equal(result.ok, false, `stage size ${JSON.stringify(stage)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `stage size ${JSON.stringify(stage)}: ${result.code}`)
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
  }
})

// This is the first pure-core module that legitimately imports another one, so
// it cannot be handed to the shared guard whole: that guard denies `import` and
// any module specifier outright, and reports ["import", "from '<specifier>'"] on
// the correct, pristine file.
//
// The plan's first draft answered that by re-spelling a raw whole-file
// `source.includes(token)` list — the exact pattern this repository had already
// measured and removed twice. Measured a third time, here, on this module: two
// ordinary comments turn it red on a byte-identically pure file ("documented in
// the runbook" hits `document`, "a window onto the graph" hits `window`), while
// `const clock = Date` + `clock.now()`, `navigator.userAgent`, `queueMicrotask`,
// `eval`, `crypto.getRandomValues`, `setTimeout`, `performance.now`,
// `globalThis` and a dynamic `import('node:fs')` every one of them pass it.
//
// So the carve-out is narrowed to the one import instead of widened to a weaker
// guard: that exact statement must appear exactly once, and the WHOLE shared
// guard — `import` and MODULE_SPECIFIER included — then runs over everything
// else. A second import, static or dynamic, is still caught.
const ALLOWED_IMPORT = "import { normalizeView, E_VIEW_MODE } from './view-state.mjs'"

test('the module carries no storage, clock, randomness or DOM, and imports only the view state', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/saved-view.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function captureSavedView/, 'the comment strip removed captureSavedView')
  assert.match(code, /export function serializeSavedView/, 'the comment strip removed serializeSavedView')
  assert.match(code, /export function parseSavedView/, 'the comment strip removed parseSavedView')
  assert.match(code, /export function validateSavedView/, 'the comment strip removed validateSavedView')
  assert.match(code, /export function restoreSavedView/, 'the comment strip removed restoreSavedView')

  assert.equal(
    code.split(ALLOWED_IMPORT).length - 1,
    1,
    'saved-view.mjs no longer imports exactly the view state, exactly once'
  )
  const body = code.replace(ALLOWED_IMPORT, '')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(body.includes(forbidden), false, `saved-view.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${forbidden}\\b`),
      `saved-view.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(body, MODULE_SPECIFIER, 'saved-view.mjs imports from a second module specifier')
  assert.deepEqual(purityViolations(body), [], 'the purity rules disagree with each other')
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

/**
 * The identity fields a saved view must match to be restorable.
 *
 * Exported with no PRODUCTION reader, measured across the whole worktree and
 * the ten planned tasks: the only readers of this list and of
 * `validateSavedView` are this module and this task's own suite, which imports
 * IDENTITY_FIELDS to assert that a drift refusal names exactly one of them
 * (Task 6 imports SAVED_VIEW_VERSION, captureSavedView, serializeSavedView,
 * parseSavedView, restoreSavedView and E_SAVED_VIEW_STORAGE, and nothing else).
 * That is the wording view-state.mjs uses for `VIEW_MODES` — "its only readers
 * are `normalizeView` below and this task's own suite" — and it is used here
 * because the earlier "no importing reader" went stale the moment the suite
 * started importing this list. They are exported anyway so that a caller which
 * already holds a parsed record — the shell re-checking a restore after a
 * re-scan — can name the identity from here rather than re-spelling six field
 * names where the two lists could disagree. This is the same open call Task 2
 * left for `isPanning()` and Task 3 for `VIEW_MODES`, and it is named as one PO
 * decision rather than settled here.
 */
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
    // `isText`, not `typeof focusId === 'string'`: validateSavedView refuses an
    // empty focus id through isText, so a bare typeof check here would let
    // capture write a record that this module can never restore.
    focus_id: isText(focusId) ? focusId : null,
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
      // `saved_view_version` is deliberately NOT carried into the validated
      // value. It could only ever be SAVED_VIEW_VERSION — every other value was
      // refused by the version gate above — so it would be a constant with no
      // reader, and an unread field is a field no test can pay for: the rule
      // view-state.mjs states where it deleted `anchorId` and `complete`.
      // Measured before it was dropped: replacing it with `saved_view_version:
      // 99` left this suite green at exit 0, 16/16.
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
 * @param {object} parsed the `value` of a successful parseSavedView(); anything
 *        else is refused as a value, never thrown
 * @param {{width:number,height:number}} viewport the stage size right now; a
 *        missing or non-object one is refused as a value too, never thrown
 * @returns {{ok:true, view:object, focusId:(string|null), transform:object, viewportChanged:boolean}
 *          |{ok:false, code:string, reason:string}}
 */
export function restoreSavedView(viewModel, parsed, viewport) {
  // A refusal is a VALUE in this module, so being handed the wrong shape is
  // answered rather than thrown at a caller that did not read `ok` first — the
  // same contract `isInView` states in view-state.mjs. The concrete mistake is
  // passing the whole parseSavedView RESULT instead of its `.value`: both a
  // success envelope and a refusal carry no `snapshot`, and both used to raise
  // `TypeError: Cannot read properties of undefined (reading 'project_id')`
  // (measured) — which D5 forbids, because a bad saved view must never tear the
  // stage down.
  //
  // EVERY object this function dereferences is named here, not only the two the
  // envelope mistake happens to miss. Measured on the narrower guard, which
  // covered `parsed`, `parsed.snapshot` and `parsed.view` alone: a record
  // carrying this graph's six identity values and a valid `view` but no
  // `transform`/`viewport`, the same record carrying `transform` but no
  // `viewport`, and a call with the third argument omitted ALL still raised
  // `TypeError: Cannot read properties of undefined (reading 'width')` at the
  // viewportChanged comparison below — the identity and stale-node checks pass
  // first, so the guard never saw them. A doc that says "refused as a value,
  // never thrown" while three reachable shapes throw is the overclaim, so the
  // guard is widened rather than the sentence narrowed.
  //
  // The reason is user-facing prose like every other reason in this module:
  // the shell renders it verbatim into the saved-view state line and into the
  // live-region announcement, so a reason that names an internal function would
  // read like a stack trace to a user.
  if (
    !isObject(parsed) ||
    !isObject(parsed.snapshot) ||
    !isObject(parsed.view) ||
    !isObject(parsed.transform) ||
    !isObject(parsed.viewport) ||
    !isObject(viewport)
  ) {
    return refusal(
      E_SAVED_VIEW_INVALID,
      'the saved view is incomplete, or the stage size to restore it into is unknown'
    )
  }

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
Expected: PASS, 18/18.

**Corrected 2026-08-19 (review of Task 4).** Four defects in this task were measured and repaired; the test block above is the repaired one, and the expected count moved from 14 to 15.

1. **The purity guard was the raw whole-file substring list this plan had already measured and removed twice.** §2 names `test/helpers/purity.mjs` as "the one purity guard every pure-core suite is scanned with", and this task's test did not use it — so that clause of the scope contract was false as written. Measured on this module, the list `['localStorage','sessionStorage','Date.','Math.random','document','window','fetch(']` fails in both directions. On a byte-identically pure file the comment `// The trade-off is documented in the runbook.` fires `document` and `// A saved view is a window onto one moment of the graph.` fires `window`; meanwhile `const clock = Date` + `clock.now()`, `navigator.userAgent`, `queueMicrotask(fn)`, `eval(s)`, `crypto.getRandomValues(...)`, `setTimeout(...)`, `performance.now()`, `globalThis.x` and `import('node:fs')` all pass it — nine real impurities, zero hits.

   The shared guard could not simply replace it, which is why the first draft reached for a weaker list: `saved-view.mjs` is the first pure-core module that legitimately imports another one, and `purityViolations()` denies `import` and `MODULE_SPECIFIER` outright, returning `["import","from '<specifier>'"]` on the correct, pristine file. The repair narrows the carve-out instead of widening the guard — the exact statement `import { normalizeView, E_VIEW_MODE } from './view-state.mjs'` must appear exactly once, and the whole shared guard then runs over everything else, so a second import, static or dynamic, is still caught. Verified: all nine impurities above, plus a second static import, a `localStorage` read and a `document.title` read, each turn the suite red; all four prose probes that broke the old list leave it green.

2. **The byte-stability test reordered nothing.** It built its "reordered" object with `JSON.parse(JSON.stringify(sample()))`, which preserves key order. Measured: replacing `JSON.stringify(saved, KEY_ORDER)` with a plain `JSON.stringify(saved)` left the suite green at 14/14 — so `KEY_ORDER`, the whole reason the stored bytes are a function of the view alone, was unpinned. The test now inserts every key in reverse order and smuggles two stray fields, asserts the scramble really is one, and is red under that mutation.

3. **The one branch separating `E_SAVED_VIEW_MODE` from `E_SAVED_VIEW_INVALID` was untested.** No case exercised a *supported* mode with an unusable anchor, so collapsing `view.code === E_VIEW_MODE ? E_SAVED_VIEW_MODE : E_SAVED_VIEW_INVALID` to a bare `E_SAVED_VIEW_MODE` left the suite green at 14/14 — a saved `neighbourhood` view carrying `"anchor_id": 42` would then have been reported as coming from another build. Task 3's suite had already flagged this seam and cited D4's table from the other side; the new test pins it from this one, over `null`, `''`, `42` and a missing field.

4. **`viewportChanged` was pinned on both dimensions at once.** The only re-fit case varied 1092×693 to 1440×900, so comparing width alone survived with the suite green at 14/14, and a stage that changed height only would have been announced as an exact restore. The test now adds a height-only and a width-only case.

Two things that are **not** defects, recorded because they were checked rather than assumed:

- `restoreSavedView` uses `viewModel.adjacency.has(id)` as its node-existence test, and that is sound: `view-model.mjs:130` seeds the adjacency map from `nodes`, not from edges, so a degree-0 node is a key and cannot be mistaken for a deleted one. It is also the idiom `view-model.mjs:235` itself uses for `known`.
- `IDENTITY_FIELDS` and `validateSavedView` are exported with no **production** reader — measured across the whole worktree and all ten planned tasks (Task 6 imports `SAVED_VIEW_VERSION`, `captureSavedView`, `serializeSavedView`, `parseSavedView`, `restoreSavedView` and `E_SAVED_VIEW_STORAGE`, and nothing else). Following the call Task 2 left open for `isPanning()` and Task 3 for `VIEW_MODES`, they are kept and the implementation now says so where they are declared, instead of reading as though something consumed them. Named as one open PO decision, not settled here. **Corrected 2026-08-19 (fifth review of Task 4):** this bullet and the doc comment above `IDENTITY_FIELDS` both said "with no *importing* reader", which the fourth review's own finding-11 repair made false in the same round — `test/atlas40-saved-view.test.mjs` imports `IDENTITY_FIELDS` and reads it to assert that a drift refusal names exactly one identity field. The wording is now the one `viewer/atlas39/core/view-state.mjs:23-31` already used for `VIEW_MODES` ("its only readers are `normalizeView` below and this task's own suite"), which stays true with a suite that imports it.

**Corrected 2026-08-19 (second review of Task 4).** Two further defects were measured in the test block above, and it is the repaired one. Both are unpinned invariants, not wrong behaviour: `shasum -a 256 viewer/atlas39/core/saved-view.mjs` is `550fddafb8056d79724e4770e8522b4612e32b94fbad337dd33b9987e70e7b75` before and after this round, and the expected count stays at 15, because both repairs are assertions added to tests that already existed.

5. **D4's version gate was pinned on its code but not on its order.** D4 requires `saved_view_version` to be "checked **first**, before any field is read", and the test was named for it — `an unsupported version is refused before any field is interpreted` — but every case it ran varied `saved_view_version` alone while every other field stayed valid, so it could not tell "version first" from "version last". Measured: moving the whole version-gate block from the top of `validateSavedView` down to just above `const identity = {}` left the suite **green at 15/15, exit 0**, and under that mutant `parseSavedView(JSON.stringify({ saved_view_version: 99 }))` returned `E_SAVED_VIEW_INVALID` where the pristine module returns `E_SAVED_VIEW_VERSION` — the fields were interpreted before the version after all. The ordering is only visible on a record broken in *both* ways at once, so the test now parses four of those (a bad version with a missing snapshot, with an unsupported mode, with an unusable transform, and a bare `{saved_view_version: 99}`) and asserts `E_SAVED_VIEW_VERSION` for each. Under the same mutant the suite is now **red, exit 1, pass 14 / fail 1**, on `a field was interpreted before the version was checked: E_SAVED_VIEW_INVALID`.

6. **The COUNTEREXAMPLE's node-id scan was quote-anchored, so a substitute offered in prose was invisible to it.** The scan asked whether the serialised refusal contains `"<node_id>"` *with* the surrounding quotes, which only matches a node id that is a whole JSON string value — while the refusal's `reason` is the one field where a substitute would actually be offered. Measured: rewriting the stale-node reason to name `viewModel.nodes[0].node_id` as "the nearest surviving page … restore that one instead" left the suite **green at 15/15, exit 0**, while the refusal literally read `the saved anchor node is not in this graph; the nearest surviving page is ATLAS:confluence:14778372:14778372 - restore that one instead` — real node ids present in the refusal: `["ATLAS:confluence:14778372:14778372"]`, real node ids as quoted values: `[]`. The test's own comment states the property ("a refusal must carry NO usable node of this graph"), so the scan is now unanchored. Under the same mutant the suite is **red, exit 1, pass 14 / fail 1**, on `the refusal offered ATLAS:confluence:14778372:14778372 as a substitute`; on the pristine module it stays green at 15/15.

**Corrected 2026-08-19 (third review of Task 4).** One further defect was measured in the test block above, and it is the repaired one. It is an unpinned invariant, not wrong behaviour: `shasum -a 256 viewer/atlas39/core/saved-view.mjs` is `550fddafb8056d79724e4770e8522b4612e32b94fbad337dd33b9987e70e7b75` before and after this round, unchanged since the first review. The expected count moves from 15 to 16, because this repair is a new test rather than an assertion bolted onto an existing one: the property it pins matches no title already in the file, and filing it under one of them would be the "the title promises X while the assertions measure Y" defect the earlier rounds of this task were themselves correcting.

7. **`snapshotIdentity()`'s mapping onto D4's six fields was unpinned.** Capture and compare both go through `snapshotIdentity`, so the mapping is symmetric and no roundtrip, drift or refusal assertion can see it: the roundtrip tests stay green because the same wrong mapping is applied on both sides, and the per-field drift test only asserts that *some* value differs and that the key name appears in the reason. Measured: swapping the two sources in `viewer/atlas39/core/saved-view.mjs:snapshotIdentity` — `project_id: viewModel.id_scheme` and `id_scheme: viewModel.project_id` — left the suite **green at 15/15, exit 0**, while `captureSavedView(...).snapshot` then read `{"project_id":"projection-local/v1","source_id":"14778372","contract_version":"1.0.0","id_scheme":"ATLAS","node_count":5,"edge_count":4}` instead of the pristine `{"project_id":"ATLAS","source_id":"14778372","contract_version":"1.0.0","id_scheme":"projection-local/v1","node_count":5,"edge_count":4}` — D4's example exactly. Under that mutant every stored record carries the wrong value under each of those two keys, and `restoreSavedView`'s snapshot refusal names the wrong field back to the user (`project_id was … this graph has …` for a drift that is really the id scheme) — the same class as the already-repaired `E_SAVED_VIEW_MODE` vs `E_SAVED_VIEW_INVALID` seam, which is a defect because it tells the user a different, false story. The new test pins the six values against the literals D4 documents rather than reading the expectation back out of the same view model the implementation reads it from, which is what made the swap invisible. Under the same mutant the suite is **red, exit 1, pass 15 / fail 1**, on `the six identity fields carry the values the loaded graph really has`; the counts-swapped mutant (`node_count: viewModel.counts.edges`, `edge_count: viewModel.counts.nodes`) is likewise **red, exit 1, pass 15 / fail 1**; on the pristine module the suite is green at **16/16, exit 0**.

**Corrected 2026-08-19 (fourth review of Task 4).** Six further defects were measured and repaired; the test block AND the implementation block above are the repaired ones. Four are guards that fail **open**, one is an implementation that could ignore its argument, one is a refusal that could name every field, one is a field with no reader, and one is a shape that threw instead of answering. The expected count moves from 16 to 17 — one repair is a new test, the rest are assertions and rows added to tests that already existed — and `shasum -a 256 viewer/atlas39/core/saved-view.mjs` moves from `550fddafb8056d79724e4770e8522b4612e32b94fbad337dd33b9987e70e7b75` to `07e4452ac4a373d9dd370ecf4d63491dcf89f2068788b77bc894f52a309be880`, because two of the repairs change the module. Every mutant below was staged with `git add` before the mutation and restored with `git checkout --` to a `shasum -a 256` equal to the pristine hash; the "after" column is the same mutant re-run against the repaired files.

8. **Four of the shape guards failed open, and the table that was titled "field by field" carried one row per group.** **Corrected 2026-08-19 (fifth review of Task 4):** the heading said "Seven", the enumeration that follows it listed ` || v.width <= 0` among the mutants that "left the suite green at exit 0, 16/16 before this round", and commit `27235b0`'s message says "Seven shape guards" and then enumerates eight items. All three are wrong, and the plan is the document this PR's scope proof is measured against, so they are corrected here rather than left standing. Re-measured in a throwaway detached worktree at the pre-repair commit `ceffb3e` (`git worktree add --detach`, removed afterwards; the slice-2 worktree's `git status --porcelain` was empty at the moment that worktree was removed, so nothing of this measurement leaked into it), with `git checkout --` restoring `viewer/atlas39/core/saved-view.mjs` to `shasum -a 256` `550fddafb8056d79724e4770e8522b4612e32b94fbad337dd33b9987e70e7b75` after every mutant: the suite at `ceffb3e` is **exit 0, tests 16 / pass 16 / fail 0**; dropping ` || v.width <= 0` is **exit 1, tests 16 / pass 15 / fail 1** — it was *already* pinned by the row `['viewport', { width: 0, height: 693 }]` that table carried, which this item's own closing sentence states; while dropping ` || !isFiniteNumber(t.ty)`, ` || !isFiniteNumber(v.width)`, ` || !isFiniteNumber(v.height)` and ` || v.height <= 0` are each **exit 0, tests 16 / pass 16 / fail 0**. So **four** shape clauses failed open, not seven, and with item 9's four identity clauses — each re-measured at `ceffb3e` as exit 0, 16/16 — the round's real total is **eight**. The corrected enumeration: each mutant below, applied alone to `validateSavedView`, left the suite **green at exit 0, 16/16** before this round and is **red at exit 1, pass 16 / fail 1** after it: dropping ` || !isFiniteNumber(t.ty)`, dropping ` || !isFiniteNumber(v.height) || v.height <= 0`, dropping either half of that pair on its own, and dropping ` || !isFiniteNumber(v.width)`. Under the `t.ty` mutant a stored `{"transform":{"scale":1.75,"tx":-412,"ty":"up"}}` parsed and `restoreSavedView` answered `{"ok":true,…,"transform":{"scale":1.75,"tx":-412,"ty":"up"}}` — the shell would apply a NaN translate and announce a successful restore, against this module's own "never partially applied, never adapted". Under the height mutants both `{"viewport":{"width":1092,"height":"tall"}}` and `{"viewport":{"width":1092,"height":0}}` parsed and restored `ok:true` with `viewportChanged:true`, so a record whose stage size is unusable was reported as a re-fit rather than refused. The one-dimension-only blindness the third review of Task 3 repaired for the viewportChanged **comparison** had been left in place on the **validation**. The table now carries `['transform', { scale: 1, tx: 0, ty: 'up' }]`, `['viewport', { width: 'wide', height: 693 }]`, `['viewport', { width: 1092, height: 0 }]` and `['viewport', { width: 1092, height: 'tall' }]`. Note that `!isFiniteNumber(v.width)` alone was **also** unpinned — `['viewport', { width: 0, height: 693 }]` still refuses through `v.width <= 0` — so the non-numeric width row is part of this repair even though only the height half was reported.

9. **Four of the six snapshot-identity type guards failed open, and each one made the module tell the user a false story.** Dropping any single one of `!isText(snapshot.source_id)`, `!isText(snapshot.contract_version)`, `!isText(snapshot.id_scheme)` or `!Number.isInteger(snapshot.edge_count)` left the suite **green at exit 0, 16/16**; all four are now **red at exit 1, pass 16 / fail 1**. Measured verbatim under the `edge_count` mutant: `{"edge_count":"4"}` parsed, and `restoreSavedView` returned `{"ok":false,"code":"E_SAVED_VIEW_SNAPSHOT","reason":"the saved view was captured against a different graph (edge_count was \"4\", this graph has 4)"}` — a malformed record reported as a re-scanned Confluence tree, the same wrong-code class as findings 3 and 7 above. The two that were pinned, `project_id` and `node_count`, were exactly the two rows the table had. It now carries one row per identity field.

10. **`snapshotIdentity()` could ignore its argument entirely.** Finding 7 traded "read back out of the same view model" for six literals, which closes a field-to-field swap but re-opens "does not read the view model at all": replacing the whole body of `snapshotIdentity` with the six literals `'ATLAS' / '14778372' / '1.0.0' / 'projection-local/v1' / 5 / 4` left the suite **green at exit 0, 16/16**. Under that mutant every graph captures ATLAS's identity and `restoreSavedView` compares ATLAS's identity to itself, so a view captured against graph A restores into graph B with `ok:true` — the cross-graph restore D4's identity check exists to prevent, and the whole reason `node_count`/`edge_count` are part of the identity. The repair is the idiom this branch already uses (Task 3's four-node witness, and D2's correction): the six fields are read a second time off a synthetic view model that differs in **all six** — `{ project_id: 'OTHER', source: { source_id: '99999999' }, contract_version: '2.0.0', id_scheme: 'canonical/v1', counts: { nodes: 2, edges: 1 }, adjacency: … }` — and a view captured against `vm` is asserted refused `E_SAVED_VIEW_SNAPSHOT` when restored against it. The witness's adjacency deliberately contains both saved node ids, so under the mutant the restore really does answer `ok:true` rather than `E_SAVED_VIEW_STALE_NODE`: the failure the assertion sees is the one being pinned. All six values differ on purpose rather than only four: with the two shared values a *partial* literal mutant (`contract_version: '1.0.0'`, `id_scheme: 'projection-local/v1'` hard-coded, the other four still read) would have survived; measured against the repaired suite it is **red at exit 1, pass 16 / fail 1**. The test says in place that the witness is not evidence about ATLAS content.

11. **The per-field drift test asked only whether the field's NAME appears somewhere in the reason.** `assert.match(result.reason, new RegExp(key))` passes on a reason that names every field: replacing the reason with the constant `'the saved view was captured against a different graph (project_id source_id contract_version id_scheme node_count edge_count differ)'` left the suite **green at exit 0, 16/16**, and a `node_count`-only drift was then reported to the user as all six fields differing. The test now asserts that the reason names **exactly one** identity field — `IDENTITY_FIELDS.filter((field) => result.reason.includes(field))` deep-equals `[key]` — and that it carries both JSON-serialised values it is contrasting. Under the same mutant the suite is **red at exit 1, pass 16 / fail 1**.

12. **`saved_view_version` in the value `validateSavedView` returns had no reader, and was dropped.** Replacing it with `saved_view_version: 99` left the suite **green at exit 0, 16/16**. It could only ever be `SAVED_VIEW_VERSION` — every other value is refused by the version gate above it — so it was a constant no consumer reads: `restoreSavedView` never reads it, Task 6 imports only `SAVED_VIEW_VERSION`, `captureSavedView`, `serializeSavedView`, `parseSavedView`, `restoreSavedView` and `E_SAVED_VIEW_STORAGE` and passes `parsed.value` straight through, and `grep -rn saved_view_version` over the worktree finds no other reader. This is the rule `viewer/atlas39/core/view-state.mjs` states where it deleted `anchorId` and `complete` for the same reason. The captured record still carries the field — that one is the contract on disk, and is pinned by the version-gate tests.

13. **`restoreSavedView` threw instead of answering when handed a parse RESULT rather than its `.value`.** Measured: `restoreSavedView(vm, parseSavedView(text), viewport)` raised `TypeError: Cannot read properties of undefined (reading 'project_id')`, and so did the same call on a refusal. The sibling pure module does the opposite for `isInView` (`if (applied?.ok !== true) return false`, with a comment saying it answers "instead of throwing a TypeError at a caller that did not check `ok` first"), and D5 requires a bad saved view never to tear the stage down. One guard clause now refuses the wrong shape as a value, `E_SAVED_VIEW_INVALID`, and the new test — the one test this round adds — covers the `{ok, value}` envelope, a refusal, `null`, `undefined`, a string, `{}` and an identity with no view, and asserts no `view`/`focusId`/`transform` comes back. Deleting the guard makes the suite **red at exit 1, pass 16 / fail 1**.

Bookkeeping: the only fixed count this plan states for this suite is the `Expected: PASS` line above, corrected here from 16 to 17. The slice-wide gates at Task 8 are stated as bounds — "greater than 408" tests and "greater than 131" checks — so they need no correction. Measured after this round in this worktree: `npm run check` exits **0**, `tests 467 / pass 467 / fail 0`, `VALIDATION PASSED`, **131** validator checks (the validator additions belong to Task 7, which has not run yet).

**Corrected 2026-08-19 (fifth review of Task 4).** Six further defects were measured and repaired; the test block AND the implementation block above are the repaired ones. Two are guards or comparisons that fail **open**, one is a guard whose stated contract covered half the objects it dereferences, one is a refusal reason that reads like a stack trace where the shell shows it to a user, one is a doc comment that went stale inside the round that made it stale, and one is capture and validate disagreeing about the empty string. The expected count moves from 17 to 18 — one repair is a new test, the rest are rows and assertions added to tests that already existed — and `shasum -a 256 viewer/atlas39/core/saved-view.mjs` moves from `07e4452ac4a373d9dd370ecf4d63491dcf89f2068788b77bc894f52a309be880` to `c9ba1e87fd45c16831a6b71e7d92dca697d16ff54584a77714ffaf4dffefbde4`, because four of the repairs change the module. Every mutant below was staged with `git add` before the mutation and restored with `git checkout --` to a `shasum -a 256` equal to the pristine hash, which was **printed and compared after every single restore**, and the whole nine-mutant battery was re-run end to end against the final `c9ba1e87…` module rather than carried over from an earlier draft of it. That is the fourth review's protocol with one addition, measured the hard way in this round: `git checkout --` restores from the INDEX, so an unstaged repair is silently thrown away by the very command that is supposed to undo the mutant. It happened once here, was caught by the hash line, and the repairs were re-applied and verified byte-identical (`b6faca4024983aa1e15b23454dd9824c786b5249aa6b81b294806d4f06ad8a5e` before and after the re-application) before any further measurement was taken.

14. **`viewportChanged` was pinned on both dimensions but not on the comparison's DIRECTION.** All three "changed" cases restored into a *larger* stage — 1440×900, 1092×900 and 1440×693 against a saved 1092×693 — so a one-sided comparison survived them. Measured: replacing `parsed.viewport.width !== viewport.width || parsed.viewport.height !== viewport.height` with `<` in both halves left the suite **green at exit 0, tests 17 / pass 17 / fail 0**. Under that mutant a view saved at 1440×900 and restored at 1092×693 answers `{"ok":true,…,"viewportChanged":false}`, and Task 6 suppresses `' The stage is a different size than when this view was saved, so the zoom and position were re-fitted.'` on exactly that flag — the pixel-identical overclaim D6 forbids in as many words. This is the third instalment of the defect class the first review (finding 4) and the fourth review (finding 8) already corrected on the other two axes, so it is closed per dimension rather than with a single row: a both-smaller restore (800×500), a height-only-smaller restore and a width-only-smaller restore. Under the same mutant the suite is now **red at exit 1, tests 18 / pass 17 / fail 1**.

15. **The table titled "a malformed shape is refused field by field" pinned the TYPE half of every guard and the DOMAIN half of none.** Each mutant below produced the wrong-refusal-code false story that findings 3, 7 and 9 of this task were already repaired for, and each left the suite **green at exit 0, tests 17 / pass 17 / fail 0**, with the module restored to `07e4452a…` each time:
    - `const isText = (v) => typeof v === 'string'`, the ` && v.length > 0` deleted — a stored `"source_id": ""` then parses and `restoreSavedView` answers `{"ok":false,"code":"E_SAVED_VIEW_SNAPSHOT","reason":"the saved view was captured against a different graph (source_id was \"\", this graph has \"14778372\")"}`, a malformed record reported as a re-scanned Confluence tree; and a stored `"focus_id": ""` comes back `E_SAVED_VIEW_STALE_NODE`, a malformed record reported as a deleted page.
    - `!Number.isInteger(snapshot.node_count)` → `typeof snapshot.node_count !== 'number'` — `node_count: 5.5` parses and restores as `E_SAVED_VIEW_SNAPSHOT` `"(node_count was 5.5, this graph has 5)"`; the same mutation on `edge_count` gives `"(edge_count was 4.5, this graph has 4)"`. Both halves were measured, because the two clauses are separate and pinning one says nothing about the other.
    - `raw.focus_id !== null` → `raw.focus_id != null` — a record with **no** `focus_id` key parses `ok:true` and restores `{"ok":true,…,"focusId":null}`, silently defaulting a missing field that D4's table assigns to `E_SAVED_VIEW_INVALID`.

    The table now carries the domain row for every guarded field, not only the three the mutants named: `project_id: ''`, `source_id: ''`, `contract_version: ''`, `id_scheme: ''`, `node_count: 5.5`, `edge_count: 4.5`, `['focus_id', '']` and `['focus_id', undefined]` (`JSON.stringify` drops an undefined value, so that row really is a record with no `focus_id` key). One row per field is the rule this table was already corrected to in finding 9; pinning `isText` through `source_id` alone would leave the other three text clauses individually mutable. Under the three mutants above the suite is now **red at exit 1** — `pass 16 / fail 2` for the `isText` mutant, which also breaks finding 19's capture test, and `pass 17 / fail 1` for the other three.

16. **The guard added for finding 13 covered 2 of the 4 objects `restoreSavedView` dereferences, so its stated contract was still false and the `TypeError` it exists to stop was still reachable.** Measured on the pristine module `07e4452a…`: `restoreSavedView(vm, { snapshot: <this graph's six identity values>, view: { mode: 'overview', anchorId: null }, focusId: null }, viewport)` raised `TypeError: Cannot read properties of undefined (reading 'width')` at `saved-view.mjs:242`; so did the same record carrying `transform` but no `viewport`; and so did `restoreSavedView(vm, parsed)` with the third argument omitted, at `saved-view.mjs:242`. The identity and stale-node checks pass on those shapes, so the guard never saw them. The JSDoc said "anything else is refused as a value, never thrown" and the test was titled "restoreSavedView answers a refusal when it is handed anything but a validated saved view" — both claiming more than the code showed, and D5's "a bad saved view must never tear the stage down" is what the guard is for. The guard is widened to `!isObject(parsed) || !isObject(parsed.snapshot) || !isObject(parsed.view) || !isObject(parsed.transform) || !isObject(parsed.viewport) || !isObject(viewport)`, and each of the three added clauses is pinned by its own row, because a single row covering two of them leaves the third fail-open: measured on the repaired module with only the two missing-`viewport` rows present, deleting `!isObject(parsed.transform)` alone left the suite **green at exit 0, 18/18**, and under it a record with no `transform` restored `ok:true` carrying `transform: undefined`, which the shell hands straight to `clampTransform`. With the third row (`viewport` present, `transform` absent) added, deleting any one of the three clauses is **red at exit 1, tests 18 / pass 17 / fail 1**. The omitted stage size is covered by its own loop over `undefined`, `null` and `'wide'`, because it is the caller's argument rather than a field of the record.

17. **The refusal reason named an internal function where the shell shows it to a user.** `'restoreSavedView was not given a validated saved view'` is rendered verbatim by Task 6 into `#saved-view-state` as `` `${reason} (${code})` `` and into the live-region announcement (`Saved view refused. ${reason}. ${code}. Nothing on the stage was changed.`), while every other reason in this module is user-facing prose — "no saved view is stored", "the saved transform is not a usable transform". It is unreachable from Task 6's call site today, so the cost is consistency rather than a wrong answer, but it was the one string in the file a user could be shown that reads like a stack trace. It is now `'the saved view is incomplete, or the stage size to restore it into is unknown'`, which names both causes the widened guard covers.

18. **The `IDENTITY_FIELDS` doc comment went stale inside the round that made it stale.** It said the list is "exported with no *importing* reader … read only from inside this module", while finding 11's repair in the same round made `test/atlas40-saved-view.test.mjs` import `IDENTITY_FIELDS` and read it. Both the comment and the fourth review's non-defect bullet above now use the wording `viewer/atlas39/core/view-state.mjs:23-31` already used for `VIEW_MODES` — "no **production** reader … its only readers are this module and this task's own suite" — which stays true with a suite that imports it. No behaviour changes; this is the plan's and the module's own prose being made to match what was measured.

19. **`captureSavedView` could write a record `validateSavedView` refuses.** Capture asked `typeof focusId === 'string'`, which accepts `''`; validate refuses `''` through `isText`. So a capture of an empty focus id produces a stored record that this module can never restore, and the user would be shown `E_SAVED_VIEW_INVALID` for a view the workspace itself wrote. It is unreachable from the shell today — `state.focusId` is a node id or `null` — which is why it needed a test rather than a comment: nothing else in the suite would notice the two predicates drifting apart again. Capture now uses `isText(focusId) ? focusId : null`, and the one new test this round adds, `capture never writes a focus id that validate would refuse`, is **red at exit 1, tests 18 / pass 17 / fail 1** under the old predicate. This is the same predicate the empty-string rows in finding 15 turn on, and both sides were decided together.

Bookkeeping: the only fixed count this plan states for this suite is the `Expected: PASS` line above, corrected here from 17 to 18. The slice-wide gates at Task 8 stay bounds and need no correction. Measured after this round in this worktree: `node --test test/atlas40-saved-view.test.mjs` exits **0**, `tests 18 / pass 18 / fail 0`; `npm run check` exits **0**, `tests 468 / pass 468 / fail 0`, `VALIDATION PASSED`, **131** validator checks (the validator additions belong to Task 7, which has not run yet).

**Corrected 2026-08-20 (sixth review of Task 4).** Two guards and one label in the module were still unpinned. Only the test block above changed — `shasum -a 256 test/atlas40-saved-view.test.mjs` = `40d6d562bb91d7499abdaa0501fe48cf05f93def6ff693ca4d32155abc96e6ac` — and `shasum -a 256 viewer/atlas39/core/saved-view.mjs` is `c9ba1e87fd45c16831a6b71e7d92dca697d16ff54584a77714ffaf4dffefbde4` before and after, unchanged since the fifth review. Still **18** tests; the repair is two rows and two assertions inside tests that already existed, so the `Expected: PASS` line above stays at 18/18.

The widened restore guard has **six** clauses (`viewer/atlas39/core/saved-view.mjs:234-241`) and the `wrong` row list isolated only four. Each of the two remaining clauses was measured individually fail-**open**, deleted alone against the shipped module and the shipped suite:

| Mutation | Before this round | After this round |
| --- | --- | --- |
| delete `!isObject(parsed.snapshot) \|\|` (`:236`) | exit **0**, `tests 18 / pass 18 / fail 0` | exit **1**, `pass 17 / fail 1`, `TypeError: Cannot read properties of undefined (reading 'project_id')` |
| delete `!isObject(parsed.view) \|\|` (`:237`) | exit **0**, `tests 18 / pass 18 / fail 0` | exit **1**, `pass 17 / fail 1`, `TypeError: Cannot read properties of undefined (reading 'anchorId')` |
| swap the `what` labels at `:260` to `[['focus', parsed.view.anchorId], ['anchor', parsed.focusId]]` | exit **0**, `tests 18 / pass 18 / fail 0` | exit **1**, `pass 17 / fail 1`, `a stale ANCHOR was reported under the wrong label: the saved focus node is not in this graph, and no other node is substituted for it` |

The first two are the D5 violation this task has now measured five times over: a bad saved view tearing the stage down instead of being refused as a value. Closure is two rows in `wrong`, one per clause, each carrying every OTHER field so the clause under test is the only one that can fire.

The third is a different failure and needed naming. The refusal's `what` label is user-facing: Task 6 renders `reason` verbatim into `#saved-view-state` and the live region, so a saved view whose FOCUS page was deleted would tell the user "the saved **anchor** node is not in this graph" and send them to look for the wrong page — the same class of false story as reporting the wrong refusal code, which this file already pins twice. Closure is one `assert.match` per case, `/saved anchor node/` and `/saved focus node/`.

Every mutant was applied by an exact single-occurrence string replacement that refuses when the needle count is not 1, and restored by copying back a pristine copy whose `shasum -a 256` was printed and compared to `c9ba1e87…` after every restore — never `git checkout --`, and never an empty `diff`.

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
import {
  stripComments,
  purityViolations,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'

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

  // The single-row sentence is a TEMPLATE, not a constant that happens to be
  // right for the accepted snapshot. Every other single-row assertion in this
  // file reads the real graph, where the honest answer IS "parent_of
  // (explicit)", so none of them can tell the two apart. Measured on the shipped
  // module: replacing the template with the literal 'Every relation drawn here
  // is parent_of (explicit); all are drawn with the same stroke.' survived the
  // whole suite at exit 0, 13/13, and then answered a links_to/derived model
  // with that same sentence verbatim — slice 1's fixed rows, moved out of the
  // rows and into the sentence, which is the AC7 defect this suite exists to
  // prevent. The relation-type half is reachable with real data
  // (view-model.mjs:81 admits any non-empty relation_type); the origin half is
  // not today (view-model.mjs:87 refuses any origin but 'explicit'). Both are
  // pinned, so neither can be frozen into the sentence.
  const other = buildEdgeLegend(synthetic([
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'links_to', origin: 'derived' }
  ]))
  assert.equal(
    edgeLegendNote(other),
    'Every relation drawn here is links_to (derived); all are drawn with the same stroke.'
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
  assert.equal(legend.empty, false)
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

  // Two entries can only ever ask the comparator about ONE of its two null
  // branches, and V8 asks this pair through the `b.depth === null` branch alone:
  // measured, `if (a.depth === null) return b.depth === null ? 0 : 1` mutated to
  // `: -1` — a comparator that then contradicts itself — still yields [4, null]
  // here and survived the whole suite at exit 0, 12/12. It is not academic. The
  // same mutant reorders a realistic set: node order [2, null, 0, 1] came out
  // [0, 1, null, 2] and [0, 1, 2, null] came out [null, 0, 1, 2], putting
  // unrooted pages in the middle of the hierarchy rows and, in the second case,
  // above the root. So the rule is pinned over a set big enough to reach both
  // branches, from two different node orders, to also show the result does not
  // depend on the order the nodes happen to arrive in.
  const mk = (depth, i) => ({
    node_id: `n${i}`, source_ref: String(i), label: `n${i}`, depth, degree: 0, provenance: null
  })
  for (const order of [[2, null, 0, 1], [0, 1, 2, null], [null, 2, 0, 1]]) {
    const ordered = buildDepthLegend(synthetic([], order.map(mk)))
    assert.deepEqual(
      ordered.entries.map((e) => e.depth),
      [0, 1, 2, null],
      `node order ${JSON.stringify(order)} changed the hierarchy rows`
    )
  }

  // What the hierarchy group does NOT distinguish, pinned rather than left to be
  // discovered while wiring the shell: the token ladder collapses every depth
  // >= 3 onto `--depth-n`, so a graph deeper than three levels shows several
  // differently-labelled rows carrying an IDENTICAL swatch — which would imply a
  // per-level colour the stage does not draw, the same overclaim the edge legend
  // refuses for itself through `distinguishesTypes` and `edgeLegendNote`. No
  // flag is returned for it, because the fact is already in the rows; this is
  // the derivation a shell caption uses, asserted so the route stays open. D7
  // records the limitation and assigns the sentence to the shell.
  const deep = buildDepthLegend(synthetic([], [0, 1, 2, 3, 4, 5].map(mk)))
  assert.deepEqual(
    deep.entries.map((e) => e.token),
    ['--depth-0', '--depth-1', '--depth-2', '--depth-n', '--depth-n', '--depth-n']
  )
  assert.deepEqual(
    deep.entries.map((e) => depthCaption(e.depth)),
    ['Root', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5']
  )
  assert.equal(new Set(deep.entries.map((e) => e.token)).size, 4, 'the depth ladder no longer collapses')
  // On the accepted snapshot nothing shares a swatch, which is why nothing is
  // wrong today and why only a deeper graph can witness the limitation.
  const real = buildDepthLegend(vm)
  assert.equal(new Set(real.entries.map((e) => e.token)).size, real.entries.length)

  // The grouping key is the depth VALUE, and that was the only claim in this
  // module argued in a comment instead of measured: `const key = node.depth`
  // mutated to `const key = String(node.depth)` scored exit 0, 13/13, and so
  // did `JSON.stringify(node.depth)`. The reason recorded for leaving it open —
  // that pinning it would need a synthetic node whose shape the model does not
  // permit — is contradicted by this same suite one function up, where `origin:
  // 'derived'` (:76, :127) and `origin: 'v2|explicit'` (:247) are used for
  // exactly that purpose against a loader that refuses any origin but
  // 'explicit' (view-model.mjs:87). A key that is injective only for the values
  // the loader happens to produce is not an injective key; it is an untested
  // one.
  //
  // The row COUNT is the assertion, not the sorted depths: a string depth makes
  // `a.depth - b.depth` NaN, so the order of such rows is not a property worth
  // pinning. Measured: 4 rows on the shipped module, 2 on the
  // `String(node.depth)` mutant, which now exits 1 at 12/13 on `actual: 2,
  // expected: 4`. What it does NOT close, stated rather than left to be
  // rediscovered: `JSON.stringify(node.depth)` still exits 0 at 13/13, because
  // over these four values it is injective too (`1` / `"1"` / `null` /
  // `"null"`). It merges a different pair — `NaN` with `null` — which is not
  // pinned here, because a NaN depth has no caption or token of its own and
  // pinning it would assert a shape this module has never had to answer for.
  assert.equal(
    buildDepthLegend(synthetic([], [mk(1, 0), mk('1', 1), mk(null, 2), mk('null', 3)])).entries.length,
    4,
    'the depth key converted to text and merged values that are not equal'
  )

  // A graph with no nodes states that it has no hierarchy rather than showing a
  // row. `empty` is part of the contract the shell reads, and nothing else in
  // this file asked for it: `empty: entries.length === 0` mutated to
  // `empty: false` survived at exit 0, 12/12.
  const none = buildDepthLegend(synthetic([], []))
  assert.deepEqual(none.entries, [])
  assert.equal(none.empty, true)
})

test('two relation kinds that differ only across the key boundary stay two rows', () => {
  // buildEdgeLegend groups on a composite key. A key that JOINS the two fields
  // on a separator is injective only while no value can contain that separator,
  // and two separators have now been measured against that claim:
  //
  //   - `|`: on the pair below the rows do not merely merge — ONE row is
  //     reported, `parent_of|v2 (explicit)` with count 2, attributing a relation
  //     kind to an edge that does not have it.
  //   - NUL: the module joined on `\u0000` and its comment claimed a relation
  //     type containing it could not collide with a different pair. That claim
  //     was false, and this test could not see it because it probed `|` only.
  //     Measured on the shipped module, with [NUL] for the byte:
  //     `parent_of[NUL]v2 / explicit` and `parent_of / v2[NUL]explicit` produced
  //     ONE row, `{relationType:'parent_of[NUL]v2', origin:'explicit',
  //     count:2}`, total 2 — the same fabrication, performed with the separator
  //     the comment named as the guard.
  //
  // The key is the JSON text of the pair now, so both are asserted: no separator
  // can come back without one of them going red.
  const NUL = String.fromCharCode(0)
  for (const separator of ['|', NUL]) {
    const legend = buildEdgeLegend(synthetic([
      { edge_id: '1', from: 'a', to: 'b', relation_type: `parent_of${separator}v2`, origin: 'explicit' },
      { edge_id: '2', from: 'a', to: 'b', relation_type: 'parent_of', origin: `v2${separator}explicit` }
    ]))
    assert.deepEqual(
      legend.entries,
      [
        { relationType: 'parent_of', origin: `v2${separator}explicit`, count: 1 },
        { relationType: `parent_of${separator}v2`, origin: 'explicit', count: 1 }
      ],
      `a ${JSON.stringify(separator)} separator collapsed two relation kinds into one row`
    )
    assert.equal(legend.total, 2)
  }

  // JSON text has a boundary of its own — the `","` between the two fields — and
  // the difference is that it is ESCAPED inside a value instead of being
  // forgeable. A relation type that spells that boundary literally must still not
  // merge with the pair it would forge; under a naive `a + '","' + b` join both
  // edges below produce the identical key `parent_of","explicit","x`.
  const forged = buildEdgeLegend(synthetic([
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'parent_of","explicit', origin: 'x' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'explicit","x' }
  ]))
  assert.deepEqual(
    forged.entries,
    [
      { relationType: 'parent_of', origin: 'explicit","x', count: 1 },
      { relationType: 'parent_of","explicit', origin: 'x', count: 1 }
    ],
    'the JSON key boundary was forged from inside a value'
  )
  assert.equal(forged.total, 2)
})

test('relation types are echoed exactly, never normalised or prettified', () => {
  const odd = 'parent_of/v2 (draft)'
  const legend = buildEdgeLegend(synthetic([{ edge_id: '1', from: 'a', to: 'b', relation_type: odd, origin: 'explicit' }]))
  assert.equal(legend.entries[0].relationType, odd)
})

// The purity guard is the shared one every pure-core suite is scanned with,
// imported rather than re-spelled. The plan's Task 5 drafted a private
// `source.includes(token)` list over the RAW file instead, and that draft could
// never pass: the module's own comment "deliberately not localeCompare" turns
// its own denylist red on a byte-identically pure file. Measured at 10/11
// before this repair, failing on `legend.mjs references localeCompare`.
const ALLOWED_IMPORT = "import { depthTokenName } from './scene.mjs'"

/**
 * Two rules that belong to THIS module and to no shared denylist, so they are
 * spelled here: D7 fixes the legend's order in code units, never in the process
 * locale's collation, and the legend returns data for the shell to place through
 * `textContent` rather than markup of its own. Both are checked over the
 * comment-free code, so the comment that explains the first may name it.
 */
const LEGEND_FORBIDDEN = ['localeCompare', 'innerHTML']

test('the module carries no clock, randomness or DOM, imports only the scene, and never localeCompare', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/legend.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function buildEdgeLegend/, 'the comment strip removed buildEdgeLegend')
  assert.match(code, /export function edgeLegendNote/, 'the comment strip removed edgeLegendNote')
  assert.match(code, /export function buildDepthLegend/, 'the comment strip removed buildDepthLegend')
  assert.match(code, /export function depthCaption/, 'the comment strip removed depthCaption')

  // The carve-out is narrowed to the one import rather than widened to a weaker
  // guard: that exact statement must appear exactly once, and the WHOLE shared
  // guard — `import` and MODULE_SPECIFIER included — then runs over everything
  // else, so a second import, static or dynamic, is still caught.
  assert.equal(
    code.split(ALLOWED_IMPORT).length - 1,
    1,
    'legend.mjs no longer imports exactly the depth token function, exactly once'
  )
  const body = code.replace(ALLOWED_IMPORT, '')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(body.includes(forbidden), false, `legend.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${forbidden}\\b`),
      `legend.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(body, MODULE_SPECIFIER, 'legend.mjs imports from a second module specifier')
  assert.deepEqual(purityViolations(body), [], 'the purity rules disagree with each other')
  for (const forbidden of LEGEND_FORBIDDEN) {
    assert.equal(body.includes(forbidden), false, `legend.mjs references ${forbidden}`)
  }
})

test('the encoding token the legend names is the token the stage really strokes a relation with', () => {
  // The legend states a token by NAME, and the shell paints its swatch with it.
  // Nothing else in this slice pins that name: D8's parity work covers the DEPTH
  // ladder only, so a repointed edge colour would leave the legend describing a
  // stroke the stage no longer draws — the swatch-drifts-from-the-stroke defect
  // D8 exists to prevent, one token over.
  //
  // Both drawing paths are pinned, because the stage has two: the WebGL renderer
  // strokes an idle relation with `palette.edgeIdle` (render-webgl.mjs:221-222),
  // which resolvePalette reads from the token named here, and the SVG/golden path
  // takes `.a39-edge { stroke: … }` from stage.css. Both files are on the
  // must-not-change list for this slice, so this reads them and changes nothing.
  const legend = buildEdgeLegend(vm)
  const sceneSource = readFileSync(join(repoRoot, 'viewer/atlas39/core/scene.mjs'), 'utf8')
  const edgeIdle = /\bedgeIdle:\s*'([^']+)'/.exec(sceneSource)
  assert.notEqual(edgeIdle, null, 'scene.mjs no longer resolves an `edgeIdle` palette entry')
  assert.equal(
    legend.encodingToken,
    edgeIdle[1],
    'the legend names a token the WebGL stage does not stroke an idle relation with'
  )

  const stageCss = readFileSync(join(repoRoot, 'viewer/atlas39/stage.css'), 'utf8')
  const edgeRule = /\.a39-edge\s*\{[^}]*\}/.exec(stageCss)
  assert.notEqual(edgeRule, null, 'stage.css no longer carries an .a39-edge rule')
  assert.match(
    edgeRule[0],
    new RegExp(`stroke:\\s*var\\(${legend.encodingToken}\\)`),
    'the legend names a token the SVG stage does not stroke a relation with'
  )
})
```

**Corrected 2026-08-20 (fourth review of Task 5).** The depth grouping key's injectivity was argued in a comment and pinned by nothing, and the reason this plan recorded for leaving it that way was false. Still **13** tests — the repair is one assertion added to `an absent depth is never displayed, and unrooted nodes sort last` — and both blocks above are the repaired files: the suite at `4e9991e9ffd72b2cf4b658bf5b0a7d1890e5f2476f1299f06d89722f8c8d12d0`, the module at `e96d5a24b46cb815cfdca775444617f7e15dc43fa30bc1ddcee7c7399f882504` (comment only; no statement changed).

Re-measured on the shipped module `2a11b70f57fe3bbb2591d692af50e3461d7db02e7865617f159269e7200838c9`: `const key = node.depth` → `const key = String(node.depth)` exits **0** at `tests 13 / pass 13 / fail 0`, and so does `JSON.stringify(node.depth)`. So the first row of the third review's mutation table below — *"nothing — it must stay green | exit 0, 13/13"* — recorded a surviving mutant as an intended outcome.

**The justification for that row is contradicted by this same suite.** The paragraph under that table reads "the only way to pin it would be a synthetic node whose shape the model does not permit". Synthetic shapes the model does not permit are exactly what this file already uses one function up, and for exactly this purpose: `origin: 'derived'` at `test/atlas40-legend.test.mjs:76` and `:127`, and `origin: 'v2|explicit'` at `:247`, against a loader that refuses any origin but `'explicit'` (`viewer/atlas39/core/view-model.mjs:87`). A key that is injective only over the values the loader happens to produce is an untested key, not an injective one.

Closure is one assertion, over four synthetic nodes with depths `1`, `'1'`, `null`, `'null'`, asserting the row COUNT — not the sorted depths, because a string depth makes `a.depth - b.depth` NaN and the resulting order is not a property worth pinning. Measured after the repair:

| Mutation | Must go red | Measured |
| --- | --- | --- |
| *(none — the shipped module)* | — | exit **0**, 13/13 |
| `const key = node.depth` → `const key = String(node.depth)` | `an absent depth is never displayed, and unrooted nodes sort last` | exit **1**, 12/13, `actual: 2, expected: 4` |
| `const key = node.depth` → `const key = JSON.stringify(node.depth)` | **nothing — it stays green** | exit **0**, 13/13 |

The third row is recorded rather than closed, and with its reason stated instead of asserted: `JSON.stringify` is injective over those four values too, so this assertion cannot tell it from the shipped key. It merges a different pair, `NaN` with `null`, and that is left unpinned because a NaN depth has no caption or token of its own — pinning it would assert a shape this module has never had to answer for. That is a narrower claim than the row it replaces, and it is the whole claim. The module's comment now points at the test instead of arguing for itself. Every mutation was restored and re-verified with `shasum -a 256` equal to `2a11b70f…` before the next measurement, never with an empty `diff`.

**Corrected 2026-08-19 (third review of Task 5).** Still **13** tests, and **the suite did not change**: `cmp` between the block above and `test/atlas40-legend.test.mjs` reports no difference, both at `78201206a2bbd828dfcf9f6d752c91fdb7ac9f02a5a535e24804f06d16982524`. **The module changed** — one statement and two comment blocks — and the module block below is the shipped file verbatim at `2a11b70f57fe3bbb2591d692af50e3461d7db02e7865617f159269e7200838c9`, verified with `cmp`, never with an empty `diff`. Four defects, each measured against the module the previous round shipped, `d6100b077e95615b151333670f7211390e0d3908c7085e4139014aee0f616a4a`:

1. **The JSDoc written last round to name the `total` ambiguity claimed a consumer that does not exist, and the reason given for declining the rename rested on the same false premise.** The comment read "a shell caption reads them side by side" and item 4 below gave "Task 6's spec below already reads this contract" as the reason not to rename. Measured: `grep -rnE 'legend\.total|edgeLegend\.total' --exclude-dir=.git --exclude-dir=node_modules --exclude='*.md' .` returns exactly four hits, all assertions in `test/atlas40-legend.test.mjs` (`:43`, `:92`, `:138`, `:257`). Task 6's `paintLegend` reads `.entries` and `.empty` and passes the object to `edgeLegendNote`; it never reads `.total`. Task 7's contract assertions and Task 8's runbook do not mention it either. Overclaiming a reader is the defect class this module's own header says it exists to refuse — "never claim more than the code can show" — one function down from the note that refuses it. The comment now states "no reader today", and because `total` is itself an unread returned fact the open-decision inventory at the `EDGE_ENCODING_TOKEN` declaration is corrected from **three** items to four: the same YAGNI argument that rejected a `sharedToken` field applies to a field already in the return, so it is named in the decision rather than exempt from it. The field is kept, not deleted, because deleting it would take the four assertions with it; which branch the PO takes is the open decision, not this round's to settle.
2. **The depth grouping key converted to a string before comparing, which is strictly less injective than the value it converts.** `const key = String(node.depth)` collapses `depth: 1` onto `depth: '1'` and `null` onto `'null'`. Measured on the module last round shipped, over four nodes with those four depths: **two** rows, `[{"depth":1,"token":"--depth-1","count":2},{"depth":null,"token":"--depth-none","count":2}]` — the same one-fabricated-row-per-collision defect the round removed from the *edge* key one function up, left standing in the depth key. `const key = node.depth` is behaviour-identical for the `number|null` the model guarantees, because `Map` compares with SameValueZero, and on the same four nodes it now returns four rows. It also removes the three-line comment that existed only to argue the conversion was safe. Not reachable through the loader — `buildViewModel` computes `depth` itself — so this is a simplification and a removed collision, not a shipped defect.
3. **The JSON key's injectivity was stated in this plan without its scope.** Item 2 below said the key "has no forgeable boundary" full stop; it is injective over pairs of *strings*, which is what the module's own comment says and what the loader guarantees. `JSON.stringify` serialises `undefined` as `null`, so `relation_type: undefined` and `relation_type: null` share the key `[null,"explicit"]` and produce one row. The scope clause and the measurement are now in item 2.
4. **D7's new requirement had no landing site, so the overclaim it was written to prevent would have shipped anyway.** D7 says the hierarchy limitation is not returned as a flag and that **Task 6 must say it**. Measured before this round: `grep -n 'share one colour'` over this plan returned exactly two hits — D7 and the module's own comment — while Task 6's `paintLegend` ended at `dom.legendDepth.replaceChildren(depthRows)`, its `index.html` block gave the Hierarchy group no note element, its `dom` map had no entry for one, Task 7 asserted only `id="legend-edges"` and `id="legend-depth"`, and Task 8's runbook described the group without the limit. A decision recorded in the audited scope contract with nothing downstream able to execute it is not a decision that shipped. Task 6 now creates `#legend-depth-note` (reusing `.a39-legend-note`, so no CSS change), maps it as `dom.legendDepthNote`, and derives the sentence in `paintLegend` from `new Set(depthLegend.entries.map((e) => e.token)).size < depthLegend.entries.length` — so it appears only when the swatches really do collapse, and stays empty on the accepted three-level snapshot. Task 7 asserts the element and the derivation; Task 8's runbook states the limit and the note's wording.

| Mutation | Must go red | Measured |
| --- | --- | --- |
| `const key = node.depth` → `const key = String(node.depth)` (the removed conversion) | ~~**nothing — it must stay green**~~ → **`an absent depth is never displayed, and unrooted nodes sort last`** — *Corrected 2026-08-20 (fourth review of Task 5)* | exit 0, 13/13 as measured then; exit **1**, 12/13 after the repair above |
| `token: depthTokenName(node.depth)` → `token: '--depth-0'` (re-measured on the new key) | `the hierarchy legend shows the depths that really occur…` **and** `an absent depth is never displayed…` | exit 1, 11/13 |
| `total: model.edges.length` → `total: 0` | four assertions across three tests | exit 1, 10/13 |

The first row is recorded rather than closed by a test, and the reason is the same one the previous round recorded for its own equivalent row: a string `depth` cannot reach `buildDepthLegend` through the shell, because `buildViewModel` computes `depth` itself, so the only way to pin it would be a synthetic node whose shape the model does not permit. **Corrected 2026-08-20 (fourth review of Task 5).** That reason is false, and this file refutes it: synthetic shapes the model does not permit are what `test/atlas40-legend.test.mjs:76`, `:127` and `:247` already use to pin the EDGE key against origins `viewer/atlas39/core/view-model.mjs:87` refuses. The row is closed by an assertion now — see the fourth-review note above the third review's block, which also states the one mutant that assertion still does not isolate. The last row is the honest counterweight to the first defect above: `total` has no production reader, but it is pinned by four assertions, so "delete the field" is a real cost and belongs to the PO decision rather than to this round.

**Corrected 2026-08-19 (second review of Task 5).** Still **13** tests (13 before, 13 after) carrying **7** more assertions — 49 to 56, measured with `grep -c 'assert\.'` — across two widened tests and one that was renamed and rewritten (`…across the separator…` became `…across the key boundary…`). **The module changed too**, and its only non-comment change is the two grouping keys: `/usr/bin/diff` between the previous module and this one, filtered to the lines that are not comments, prints exactly two removals and two additions — the NUL-joined edge key against `JSON.stringify([edge.relation_type, edge.origin])`, and the depth ternary against `String(node.depth)`. Everything else that moved in it is comment. Both blocks in this task are the shipped files verbatim: the suite at `78201206a2bbd828dfcf9f6d752c91fdb7ac9f02a5a535e24804f06d16982524` and the module at `d6100b077e95615b151333670f7211390e0d3908c7085e4139014aee0f616a4a`. The five findings below were each measured on the module the previous round shipped, `82a42c70d2d79a9aea201c2b1c564d1408647ddad7f57680441520aa41b1173c`, and every mutation was restored and re-verified with `shasum -a 256`, never with an empty `diff`.

1. **The legend's user-facing sentence was not pinned as a template, and a surviving mutant turns it into a fixed string.** Replacing the template `Every relation drawn here is ${only.relationType} (${only.origin}); …` with the literal `Every relation drawn here is parent_of (explicit); …` scored **exit 0, 13/13**, and `edgeLegendNote(buildEdgeLegend({edges:[{relation_type:'links_to', origin:'derived', …}]}))` then returned `"Every relation drawn here is parent_of (explicit); all are drawn with the same stroke."` verbatim. That is exactly the AC7 defect this suite exists to prevent — slice 1's fixed rows, which happened to be accurate at five nodes, moved out of the rows and into the sentence — and `legend.mjs` names that pattern in its own header as the thing it fixes. The rows were pinned against invention; the **note** was not, because the only single-row note assertion read the real snapshot, where the honest answer is `parent_of (explicit)` anyway, so it could not tell a template from a constant. The relation-type half is reachable with real data (`view-model.mjs:81` requires only `isText(edge.relation_type)`); the origin half is not today (`view-model.mjs:87` refuses any origin but `'explicit'`). One assertion over a `links_to`/`derived` model pins both halves.
2. **The NUL separator's comment claimed a property the key did not have, and the previous round's repair could not see it.** The key was `${relation_type}\u0000${origin}` under a comment saying a relation type containing the separator "cannot collide with a different (type, origin) pair". Measured on that module: `relation_type: 'parent_of<NUL>v2', origin: 'explicit'` and `relation_type: 'parent_of', origin: 'v2<NUL>explicit'` produced **ONE** row, `{relationType:'parent_of<NUL>v2', origin:'explicit', count:2}`, total 2 — the same fabrication the previous round's new test was written to prevent, performed **with the separator itself**, and invisible to that test because it probed `|`. Not reachable through the real path (`view-model.mjs:87`), so this was a false claim rather than a shipped defect. The claim is made true instead of narrowed: the key is now `JSON.stringify([edge.relation_type, edge.origin])`, which has no forgeable boundary **between two strings**, because every quote and backslash inside a value is escaped. The test now asserts both separators and a value that spells the JSON boundary `","` literally. **Corrected 2026-08-19 (third review of Task 5):** that sentence stated the injectivity without its scope, and the scope is real in one direction the NUL join did not lose. `JSON.stringify` serialises `undefined` as `null`, so `relation_type: undefined` and `relation_type: null` produce the identical key `[null,"explicit"]`. Measured on the shipped module: one row for the two edges — `[{"origin":"explicit","count":2}]` with the `undefined` edge first, `[{"relationType":null,"origin":"explicit","count":2}]` with the `null` edge first — `total=2` either way, and the same holds for the origin field (`[{"relationType":"parent_of","count":2}]`, `total=2`). The NUL join kept them apart (`undefined\0explicit` vs `null\0explicit`). Unreachable through the loader, which requires `isText(edge.relation_type)` at `view-model.mjs:81` and refuses any origin but `'explicit'` at `:87`, and the module's own comment is already scoped to "distinct pairs of strings"; this sentence is now scoped to match it.
3. **The hierarchy group stated no limit of its own.** Recorded as a decision under **D7** above rather than discovered during Task 6, with the six-level measurement, and pinned by test.
4. **`legend.total` and `scope.totalEdges` spell "total" for different quantities.** Measured on the SPRINT neighbourhood: `scope = {shownNodes:2, totalNodes:5, shownEdges:1, totalEdges:4}` while `buildEdgeLegend(applied.model).total = 1` — so `legend.total === scope.shownEdges`. The behaviour was already pinned; only the name was ambiguous. The field is **not** renamed, and the `@returns` JSDoc now states which quantity it is, with the measurement. **Corrected 2026-08-19 (third review of Task 5):** the heading of this item said "and Task 6 reads both objects", and the JSDoc written for it claimed "a shell caption reads them side by side" and gave "Task 6's spec below already reads this contract" as the reason not to rename. Both are false as measured. `grep -rnE 'legend\.total|edgeLegend\.total' --exclude-dir=.git --exclude-dir=node_modules --exclude='*.md' .` returns exactly four hits, all assertions in `test/atlas40-legend.test.mjs` (`:43`, `:92`, `:138`, `:257`); Task 6's `paintLegend` below reads `.entries` and `.empty` and hands the object to `edgeLegendNote`, and reads `.total` nowhere; Task 7's contract assertions and Task 8's runbook do not mention it. So the decline rests on a wrong fact, and `total` is itself an unread returned fact — the same YAGNI argument used against a `sharedToken` field in item 3 applies to a field already in the return. Both statements are corrected to "no reader today", and `total` joins the open-decision inventory in item 5 below rather than being quietly exempt from it.
5. **`EDGE_ENCODING_TOKEN` has no importer.** Measured across the whole worktree, excluding `.git` and `node_modules`: its only occurrences are the declaration, its use inside the same module, and this plan. Task 6 below re-spells `var(--line-strong)` in shell CSS for the edge swatch instead of reading the name from here. This is the **third** unread export in the slice, after `VIEW_MODES` (Task 3) and `isPanning()`/`isClickSuppressed()` (Task 2), and it is **one open PO decision covering all of them**, not one each: keep them, so the shell reads each of these facts from one source instead of re-spelling it, or delete them with the assertions that read them. The module records the open decision at the declaration, as Task 3 does. **Corrected 2026-08-19 (third review of Task 5):** this item cited "its use at `legend.mjs:60` inside the same module". That was true of the module the previous round measured, `82a42c70…`, and is not true of the module this paragraph names by hash — `grep -n EDGE_ENCODING_TOKEN viewer/atlas39/core/legend.mjs` prints `46` and `88` there, and line 60 is ` */`. The line number is dropped rather than re-pinned, because it is the third time it would have to move. The inventory also **undercounted**: `buildEdgeLegend`'s `total` field is a fourth unread fact of exactly this kind (item 4), so "all three" is now "all of them" and the module names `total` in the same comment.

| Mutation | Must go red | Measured |
| --- | --- | --- |
| note template → the fixed literal `'… parent_of (explicit) …'` | `the legend does not claim an encoding the stage does not draw` | exit 1, 12/13 |
| `JSON.stringify([type, origin])` → `\u0000` join | `two relation kinds that differ only across the key boundary stay two rows` | exit 1, 12/13 |
| `JSON.stringify([type, origin])` → `\|` join | same test | exit 1, 12/13 |
| `JSON.stringify([type, origin])` → naive `["${type}","${origin}"]` join | same test | exit 1, 12/13 |
| `token: depthTokenName(node.depth)` → `token: '--depth-0'` | `the hierarchy legend shows the depths that really occur…` **and** `an absent depth is never displayed…` | exit 1, 11/13 |
| `String(node.depth)` → the removed `depth === null ? 'none'` ternary | **nothing — it must stay green** | exit 0, 13/13 |

The last row is the point of the fourth repair rather than a coverage gap: `String(null)` is `'null'`, which no numeric depth can spell, so the ternary guarded nothing while reading as though it guarded something. It is removed and the reason is written at the line. **Superseded 2026-08-19 (third review of Task 5):** the rows above were measured against the module this round shipped, `d6100b07…`, and the `String(node.depth)` key they name is gone — it converted before comparing, which is strictly *less* injective than the value itself, and the third-review block above carries the replacement and its own measurements.

No **must-not-change** file was mutated this round. After the battery the module is back at `d6100b077e95615b151333670f7211390e0d3908c7085e4139014aee0f616a4a` — printed by the battery after every row — and `git status --porcelain` lists only this task's own files.

**Corrected 2026-08-19 (review of Task 5).** The block above is the shipped file verbatim, at **13** tests rather than the 11 the first draft carried. **The module below did not change in that round** — it was shipped byte-for-byte as this plan spelled it, at `82a42c70d2d79a9aea201c2b1c564d1408647ddad7f57680441520aa41b1173c`. **That is no longer the file below:** the second review recorded above changed two statements in it, and the module block now carries `d6100b077e95615b151333670f7211390e0d3908c7085e4139014aee0f616a4a`. Four repairs to the suite, each answering a measurement:

1. **The draft's purity test could not pass against the draft's own module.** It was a raw whole-file `source.includes(token)` list whose tokens included `localeCompare`, and the module's own comment explains the rule it follows by naming it — "deliberately not localeCompare". Measured on the plan's two blocks written out untouched: exit 1, **10/11**, failing `legend.mjs references localeCompare`. So Step 4's "PASS, 11/11" was not reachable from Step 1 and Step 3 as written, and this is the fourth time this repository has measured the same raw-substring pattern: §2 names `test/helpers/purity.mjs` as "the one purity guard every pure-core suite is scanned with", and Tasks 2, 3 and 4 each removed a re-spelling of it. The draft's list was also blind in the other direction — it names neither `import` nor MODULE_SPECIFIER, nor `fetch`, `setTimeout`, `crypto`, `eval`, `process`, `globalThis`, `navigator`, `performance` or `localStorage`. The repair is Task 4's, unchanged in shape: strip the comments with the shared scanner, allow the one import statement exactly once, run the whole shared guard over everything else, and keep `localeCompare` and `innerHTML` as this module's own two extra rules — checked over the **code**, so the comment that explains the first may name it. Measured after the repair: the shared guard returns `[]` on the module body.
2. **The composite key's separator was unpinned, and a mutant fabricates a relation kind.** `\u0000` changed to `|` survived at exit 0, 12/12. On two edges that differ only across the separator it does not merely merge two rows — it reports **one** row, `parent_of|v2 (explicit)`, with `count: 2`, attributing a relation kind to an edge that does not have it. The module's comment claimed the separator prevented exactly this; nothing could lose the claim. One test closes it. **Superseded by the second review above:** that test probed `|` only, and the module's claim about its own separator was false in the same way — the NUL pair collided into one fabricated row on the very module this round shipped. The key is the JSON text of the pair now, and both separators are asserted.
3. **Two entries cannot reach both halves of the depth comparator.** `if (a.depth === null) return b.depth === null ? 0 : 1` mutated to `: -1` — leaving a comparator that contradicts itself — still yields `[4, null]` for the file's two-node case and survived at exit 0, 12/12, because V8 asks that pair through the `b.depth === null` branch alone. It is not academic: the same mutant sorts node order `[2, null, 0, 1]` to `[0, 1, null, 2]` and `[0, 1, 2, null]` to `[null, 0, 1, 2]`, putting unrooted pages in the middle of the hierarchy rows and, in the second case, above the root. Pinned over a four-depth set from three different node orders, which also shows the result does not depend on the order nodes arrive in.
4. **`buildDepthLegend`'s `empty` was returned but never read.** `empty: entries.length === 0` mutated to `empty: false` survived at exit 0, 12/12. It is part of the contract Task 6 reads. Two assertions close it.

One test was **added** beyond the draft's scope, for a claim the slice makes and nothing pinned: `the encoding token the legend names is the token the stage really strokes a relation with`. The legend states `--line-strong` by name and Task 6 paints its swatch with it, but D8's parity work covers the **depth** ladder only — a repointed edge colour would leave the legend describing a stroke the stage no longer draws, which is the swatch-drifts-from-the-stroke defect D8 exists to prevent, one token over. Both drawing paths are pinned by reading, and changing, nothing: `scene.mjs:131` `edgeIdle: '--line-strong'`, which `render-webgl.mjs:221-222` strokes idle **and** dim relations with, and `stage.css:37` `.a39-edge { stroke: var(--line-strong) }` for the SVG/golden path. D7's claim that the only per-edge variation is the focus highlight was verified against those same three lines rather than assumed.

| Mutation | Must go red | Measured |
| --- | --- | --- |
| `\u0000` → `\|` (key separator) — **superseded, see the second review above** | `two relation kinds that differ only across the separator stay two rows` (since renamed) | exit 1, 12/13 |
| `empty: entries.length === 0` → `empty: false` | `an absent depth is never displayed, and unrooted nodes sort last` | exit 1, 12/13 |
| `if (a.depth === null) return … : 1` → `: -1` | `an absent depth is never displayed, and unrooted nodes sort last` | exit 1, 12/13 |
| `if (b.depth === null) return -1` → `return 1` | `an absent depth is never displayed, and unrooted nodes sort last` | exit 1, 12/13 |
| `byCodeUnit` → `a.localeCompare(b)` | `the module carries no clock, randomness or DOM, imports only the scene, and never localeCompare` | exit 1, 12/13 |
| `depthCaption` drops the `Root` branch | `the hierarchy legend shows the depths that really occur, with the token that is really stroked` | exit 1, 12/13 |
| `EDGE_ENCODING_TOKEN` → `'--accent'` | both encoding tests | exit 1, 11/13 |
| `distinguishesTypes: false` → `true` | `the legend does not claim an encoding the stage does not draw` | exit 1, 12/13 |
| `scene.mjs` `edgeIdle` → `'--accent'` | `the encoding token the legend names is the token the stage really strokes a relation with` | exit 1, 12/13 |
| `stage.css` `.a39-edge` stroke → `var(--accent)` | `the encoding token the legend names is the token the stage really strokes a relation with` | exit 1, 12/13 |

Every row was restored and re-verified with `shasum -a 256`, never with an empty `diff`. The two rows that mutate a **must-not-change** file did so as a measurement only: `viewer/atlas39/core/scene.mjs` is back at `caadfe9f29cff846b39b6babae98e4af522411891b7e2811392c0e46fa228a8c` and `viewer/atlas39/stage.css` at `061e1426bb6cc3423e1dfd396183a11c9ce9aeaee11e5d69379d12885ee71483`, the hashes recorded before the round, and neither appears in `git status --porcelain`.

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

// The design token every explicit relation is actually stroked with.
//
// Exported with no production reader. Measured across the whole worktree,
// excluding .git and node_modules: the only occurrences of this name are this
// declaration, its use in buildEdgeLegend below, and the plan. Task 6 imports
// buildEdgeLegend, edgeLegendNote, buildDepthLegend and depthCaption, and paints
// the edge swatch from a re-spelled `var(--line-strong)` in shell CSS instead of
// reading the name from here — so the token the legend NAMES and the token the
// swatch USES are two independent spellings of one claim. It is exported anyway
// so that pair can be collapsed onto one source. Keeping an export only tests
// read is the same call Task 2 left open for isPanning()/isClickSuppressed(),
// Task 3 for VIEW_MODES, and this module for buildEdgeLegend's `total` field
// below — which no consumer reads either; the four are named in the plan as ONE
// open PO decision rather than settled here.
export const EDGE_ENCODING_TOKEN = '--line-strong'

/**
 * @param {object} model a view model, or the projected model of a view
 * @returns {{entries:Array, total:number, distinguishesTypes:boolean,
 *            encodingToken:string, empty:boolean}}
 *
 * `total` counts the edges this model DRAWS. On a neighbourhood that is
 * `applyView(...).scope.shownEdges`, never `scope.totalEdges` — measured on the
 * SPRINT neighbourhood of the accepted snapshot, scope
 * `{shownNodes:2, totalNodes:5, shownEdges:1, totalEdges:4}` against
 * `buildEdgeLegend(applied.model).total === 1`. `scope` spells "total" for the
 * other quantity, which is why this one is named here — but no consumer reads
 * it today: Task 6's paintLegend renders the per-row counts and hands this whole
 * object to edgeLegendNote, and reads `total` nowhere, so the only reads
 * anywhere outside .git and node_modules are four assertions in
 * test/atlas40-legend.test.mjs. It is therefore the fourth unread fact this
 * slice leaves to the one open PO decision recorded above.
 */
export function buildEdgeLegend(model) {
  const counts = new Map()
  for (const edge of model.edges) {
    // The key is the JSON text of the PAIR, not the two fields joined on a
    // separator. A joined key is injective only while no value can contain the
    // separator, and the NUL this used to join on did not have that property
    // either. Measured on the shipped module, with [NUL] standing for the byte:
    // `parent_of[NUL]v2 / explicit` and `parent_of / v2[NUL]explicit` produced
    // ONE row, `{relationType:'parent_of[NUL]v2', origin:'explicit', count:2}`,
    // total 2 — the exact fabrication the separator comment claimed to prevent,
    // performed with the separator itself. JSON.stringify escapes every quote
    // and backslash inside a value, so distinct pairs of strings always produce
    // distinct key text and no value can forge the boundary between the two.
    const key = JSON.stringify([edge.relation_type, edge.origin])
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
 *
 * What this group does NOT distinguish, written here because the edge legend
 * states its own limit and this one must not be discovered while wiring the
 * shell: depthTokenName collapses every depth >= 3 onto `--depth-n`, so a graph
 * deeper than three levels produces several differently-labelled rows carrying
 * an IDENTICAL swatch. Measured on a six-level graph — `Root -> --depth-0`,
 * `Level 1 -> --depth-1`, `Level 2 -> --depth-2`, `Level 3 -> --depth-n`,
 * `Level 4 -> --depth-n`, `Level 5 -> --depth-n`: 4 distinct tokens over 6 rows.
 * Nothing is wrong on the accepted snapshot, which is three levels deep and
 * gives every row its own token. No flag is returned for it, because the fact is
 * already in the rows — a shell that must say "Level 3 and deeper share one
 * colour" derives it from `new Set(entries.map((e) => e.token)).size <
 * entries.length` rather than from a field only tests would read. D7 records the
 * limitation and assigns the sentence to the shell.
 */
export function buildDepthLegend(model) {
  const counts = new Map()
  for (const node of model.nodes) {
    // The depth itself, not its text. `String(node.depth)` grouped `1` with
    // `'1'` and `null` with `'null'` — one fabricated row each, measured — while
    // Map's SameValueZero keeps every value apart for free. That used to be an
    // argument in this comment and nothing else, and an argument is not a
    // guard: the conversion could be put back and the suite stayed green at
    // exit 0, 13/13. It is a test now — test/atlas40-legend.test.mjs, in "an
    // absent depth is never displayed, and unrooted nodes sort last", over four
    // synthetic nodes with depths `1`, `'1'`, `null` and `'null'`, asserting 4
    // rows. Synthetic on purpose: the loader computes `depth` itself, and the
    // edge key one function up is pinned the same way against origins
    // view-model.mjs:87 refuses.
    const key = node.depth
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
Expected: PASS, 13/13.

**Step 5: Counterexample proof (do not commit the mutation)**

```bash
# stage first: Step 5 runs before Step 6's commit, so without this the file is
# untracked and both the restore and its check below are vacuous
git add viewer/atlas39/core/legend.mjs test/atlas40-legend.test.mjs
shasum -a 256 viewer/atlas39/core/legend.mjs           # record the pristine hash

# hardcode a row the graph does not contain
perl -0pi -e "s/  const entries = \[\.\.\.counts\.values\(\)\]\.sort\(/  counts.set('X', { relationType: 'similar_to', origin: 'inferred', count: 1 })\n  const entries = [...counts.values()].sort(/" viewer/atlas39/core/legend.mjs
node --test test/atlas40-legend.test.mjs; echo "MUTANT EXIT=$?"
git checkout -- viewer/atlas39/core/legend.mjs
node --test test/atlas40-legend.test.mjs; echo "RESTORED EXIT=$?"
shasum -a 256 viewer/atlas39/core/legend.mjs           # must equal the pristine hash
```

Expected: `MUTANT EXIT=1` failing at least
`COUNTEREXAMPLE: a relation type that is not in the graph is never displayed`,
then `RESTORED EXIT=0` and the same `shasum` as before the mutation. Record verbatim.

**Corrected 2026-08-19 (review of Task 2).** This step carried the same defect as Task 2's Step 5 and is repaired the same way: `git checkout -- <untracked path>` fails and leaves the mutation in place, and `git diff --stat` over an untracked path prints an empty result that reads as confirmation while proving nothing. Tasks 3 and 4 do **not** need this enabler — their Step 5 is the plain commit, with no mutation to restore from.

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
    <p class="a39-legend-note" id="legend-depth-note"></p>
  </section>
```

Notes that matter:
- The legend loses `aria-hidden="true"`. AC7 asks for a *visible* legend; a legend hidden from assistive technology is visible to some users only.
- `#legend-depth-note` is the Hierarchy group's own limitation, which **D7 assigns to this task**: `depthTokenName` collapses every depth from 3 onward onto `--depth-n`, so on a graph deeper than three levels differently-labelled rows carry an identical swatch. It reuses `.a39-legend-note`, so it needs no new CSS, and `paintLegend` fills it only when the rows really do share a token — on the accepted three-level snapshot it stays empty. **Added 2026-08-19 (third review of Task 5):** D7 stated the requirement and this task had nowhere to put it.
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
  legendDepth: el('legend-depth'),
  legendDepthNote: el('legend-depth-note')
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
  // What the Hierarchy group does NOT distinguish, said by the shell because D7
  // assigns the sentence here: depthTokenName collapses every depth from 3
  // onward onto `--depth-n`, so on a deeper graph differently-labelled rows
  // carry an identical swatch. Derived from the rows themselves rather than from
  // a flag, so it can only appear when it is true — on the accepted three-level
  // snapshot every row has its own token and this stays empty.
  const sharedSwatch =
    new Set(depthLegend.entries.map((e) => e.token)).size < depthLegend.entries.length
  dom.legendDepthNote.textContent = sharedSwatch ? 'Level 3 and deeper share one colour.' : ''
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

**Corrected 2026-08-19 (second review of Task 2).** The first draft of this replacement kept slice 1's `if (event.target.closest?.('.a39-stage-controls')) return` at the top of the `pointerdown` handler. D9's own correction above proves that line is dead: `index.html:58-60` makes `.a39-stage-controls` a *sibling* of `#stage-host`, so a pointer event on the controls never reaches a listener bound to `dom.stageHost` at all. Carrying provably dead code into new code, in the same document that proves it dead, is not defensiveness — it is a false hint to the next reader that the controls are reachable here. It is dropped. The live occurrence stays where it is load-bearing: `app.mjs:542`, in the `keydown` path, whose listener sits on `dom.stage`, the common ancestor of both — and that is the occurrence Task 7's `assert.match(app, /event\.target\.closest\?\.\('\.a39-stage-controls'\)/)` matches, so dropping the dead copy does not turn that assertion red. Should the markup ever nest the controls inside `#stage-host`, the guard returns together with a test that shows it firing.

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
  // D7 assigns the Hierarchy group's own limitation to this shell: rows whose
  // swatches collapse onto one token must say so. Without a landing site the
  // decision would stand in the scope contract with nothing implementing it, so
  // both the element and the derivation are asserted rather than the wording
  // alone — a note that is never written is indistinguishable from no note.
  assert.match(html, /id="legend-depth-note"/)
  assert.match(app, /new Set\(depthLegend\.entries\.map\(\(e\) => e\.token\)\)\.size < depthLegend\.entries\.length/)
  assert.match(app, /dom\.legendDepthNote\.textContent = sharedSwatch \? 'Level 3 and deeper share one colour\.' : ''/)
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

That group has one limit of its own, and it says so rather than leaving it to be
inferred from the swatches: `core/scene.mjs` collapses every depth from 3 onward
onto a single token, so on a graph deeper than three levels differently-labelled
rows carry an identical colour. When that happens the group carries the note
“Level 3 and deeper share one colour.”; the accepted snapshot is three levels
deep, every row there has its own token, and the note is empty.

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
| 25 | the **second** stale-suppression route (added by the Task-2 review, D9): drag across the threshold with a **touch** pointer (`touch-action: none` is set at `shell.css:329`, so the browser may or may not synthesise a click), release with `pointerup`, then activate a *different* node button **from the keyboard** (Tab to it, press Enter — no `pointerdown` precedes that click, so the `pointerdown` re-arm cannot mask a stale flag). Assert the keyboard-activated node becomes focused. Report which of the two happened: the click was swallowed (a second real route, to be repaired by keying the disarm on the invariant rather than on `pointercancel`), or it was not (the pan's own `pointerup` click spent the suppression as designed). **Measure it; do not assume either outcome.** |

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

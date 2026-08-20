// ATLAS-40: the interaction model of the WebGL workspace.
//
// Two halves. The first is real behaviour: search is a pure function over the
// real accepted projection, so what a user types and what gets focused can be
// asserted exactly. The second half is the shell wiring — the part that only
// exists as browser code — checked the same way ATLAS-39 checks its shell,
// because the alternative is a headless-browser dependency this repository has
// deliberately never taken. The headed acceptance run is what proves the wiring
// actually fires; these tests are what stop it being silently removed.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import { matchNodes, searchAnnouncement } from '../viewer/atlas39/core/search.mjs'
import { stripComments } from './helpers/purity.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const VIEWER = join(repoRoot, 'viewer/atlas39')
const EVIDENCE_DIR = join(repoRoot, 'docs/evidence/atlas-65')
const read = (name) => readFileSync(join(VIEWER, name), 'utf8')

const app = read('app.mjs')
const html = read('index.html')
const shellCss = read('shell.css')

const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'provenance.json'), 'utf8'))
const viewModel = buildViewModel(snapshot, provenance)

/* ---------- search over the real projection ---------- */

test('searching a real page title focuses that page', () => {
  const result = matchNodes(viewModel, 'Sprint 2')
  assert.equal(result.active, true)
  assert.equal(result.matches.length, 1)
  assert.equal(result.firstMatchId, 'ATLAS:confluence:14778372:22478849')
  assert.equal(result.matches[0].label, 'Sprint 2 – Visible Real Semantic Atlas – Sprint Plan')
  assert.match(searchAnnouncement(result), /^1 node matches "sprint 2"\./)
})

test('search is case-insensitive and also matches the Confluence page id', () => {
  assert.equal(matchNodes(viewModel, 'atlas single source').firstMatchId, 'ATLAS:confluence:14778372:14778372')
  assert.equal(matchNodes(viewModel, 'ATLAS SINGLE SOURCE').firstMatchId, 'ATLAS:confluence:14778372:14778372')
  // The real Confluence page id, which is how an operator reading a URL searches.
  const byId = matchNodes(viewModel, '15073290')
  assert.equal(byId.matches.length, 1)
  assert.equal(byId.matches[0].source_ref, '15073290')
})

test('a search matching several pages focuses the highest one in the hierarchy', () => {
  // Four of the five real titles start with a digit pair; "1" appears in several.
  const result = matchNodes(viewModel, 'a')
  assert.ok(result.matches.length > 1)
  const order = viewModel.nodes.map((n) => n.node_id)
  assert.equal(result.firstMatchId, result.matches[0].node_id)
  assert.equal(
    order.indexOf(result.firstMatchId),
    Math.min(...result.matches.map((n) => order.indexOf(n.node_id))),
    'the first match must be the first in view-model (hierarchy) order'
  )
})

test('clearing the search returns to the neutral all-nodes state', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const result = matchNodes(viewModel, empty)
    assert.equal(result.active, false, 'an empty query is neutral, not a failed search')
    assert.equal(result.matches.length, 5)
    assert.equal(result.firstMatchId, null, 'clearing must not focus anything')
    assert.equal(searchAnnouncement(result), 'Search cleared. Showing all nodes.')
  }
})

test('a search that matches nothing is an explicit, distinguishable state', () => {
  const result = matchNodes(viewModel, 'kubernetes')
  assert.equal(result.active, true, 'a no-match search is NOT the neutral state')
  assert.equal(result.matches.length, 0)
  assert.equal(result.firstMatchId, null)
  assert.equal(result.matchIds.size, 0)
  assert.equal(searchAnnouncement(result), 'No node matches "kubernetes".')
})

test('search never invents a match', () => {
  // No fuzzy matching: a page that is not in the real projection cannot be
  // "close enough" to one that is.
  for (const query of ['Sprint 3', 'ATLAS Singel Source', '99999999', 'confluence.com']) {
    assert.equal(matchNodes(viewModel, query).matches.length, 0, `${query} produced a match`)
  }
})

/* ---------- the shell wires WebGL, not SVG ---------- */

test('the shell imports the WebGL renderer and no longer imports the SVG one', () => {
  assert.match(app, /import \{ createWebglStage[^}]*\} from '\.\/core\/render-webgl\.mjs'/)
  assert.match(app, /import \{ buildScene, projectScene, resolvePalette \} from '\.\/core\/scene\.mjs'/)
  assert.equal(/from '\.\/core\/render-svg\.mjs'/.test(app), false, 'the SVG renderer is still on the shell path')
  assert.equal(/from '\.\/core\/stage-mount\.mjs'/.test(app), false, 'the SVG mount guard is still on the shell path')
  // The view model and the layout are shared by both renderers and must stay.
  assert.match(app, /from '\.\/core\/view-model\.mjs'/)
  assert.match(app, /from '\.\/core\/layout\.mjs'/)
})

test('the canvas is created by the shell and reports which context it got', () => {
  assert.match(app, /document\.createElement\('canvas'\)/)
  assert.match(app, /canvas\.dataset\.renderer = stage\.contextType/)
  assert.match(app, /dom\.statRenderer\.textContent/)
  assert.match(html, /id="stat-renderer"/)
  assert.match(shellCss, /\.a39-canvas\s*\{/)
})

test('the canvas carries no semantics and the overlay carries all of them', () => {
  assert.match(app, /canvas\.setAttribute\('aria-hidden', 'true'\)/)
  assert.match(app, /overlay\.setAttribute\('role', 'group'\)/)
  assert.match(app, /overlay\.setAttribute\('aria-label', 'Graph nodes'\)/)
  // Each node is a real button with a real accessible name and pressed state.
  assert.match(app, /button\.setAttribute\('aria-label', node\.ariaLabel\)/)
  assert.match(app, /button\.setAttribute\('aria-pressed', node\.state === 'focus' \? 'true' : 'false'\)/)
  assert.match(app, /button\.tabIndex = node\.tabbable \? 0 : -1/)
})

test('the accessible overlay is reconciled, not rebuilt, so focus survives', () => {
  // Rebuilding the buttons on every pan would drop keyboard focus mid-gesture.
  assert.match(app, /nodeButtons\.get\(node\.nodeId\)/)
  assert.match(app, /nodeButtons\.set\(node\.nodeId, entry\)/)
  assert.match(app, /nodeButtons\.get\(state\.focusId\)\?\.button\.focus\(\)/)
})

test('zoom, pan and reset are all reachable without a mouse', () => {
  for (const key of ["'+'", "'='", "'-'", "'0'"]) {
    assert.ok(app.includes(`case ${key}:`), `no keyboard handler for ${key}`)
  }
  assert.match(app, /event\.shiftKey/, 'no keyboard pan')
  assert.match(app, /addEventListener\('keydown', onStageKeydown\)/)
  for (const id of ['zoom-in', 'zoom-out', 'reset-view']) {
    assert.match(html, new RegExp(`id="${id}"`), `no ${id} control`)
  }
  assert.match(html, /id="zoom-level"/)
  assert.match(html, /aria-label="Zoom and focus controls"/)
})

test('zoom and pan are pointer interactions with a real transform behind them', () => {
  assert.match(app, /addEventListener\('wheel'/)
  assert.match(app, /\{ passive: false \}/, 'the wheel handler must be able to preventDefault')
  assert.match(app, /addEventListener\('pointerdown'/)
  assert.match(app, /addEventListener\('pointermove'/)
  assert.match(app, /addEventListener\('pointerup'/)
  assert.match(app, /addEventListener\('pointercancel'/, 'an interrupted drag must not leave the stage panning')
  assert.match(app, /setPointerCapture/)
  assert.match(app, /zoomAt\(state\.transform/)
  assert.match(app, /panBy\(state\.transform/)
  assert.match(app, /resetTransform\(state\.world\)/)
})

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

test('the favicon is inline and uses real design-token colours', () => {
  // A favicon cannot read CSS custom properties, so its colours are literals.
  // They must still be colours the design system actually defines.
  assert.match(html, /<link rel="icon" href="data:image\/svg\+xml,/)
  const tokens = readFileSync(join(VIEWER, 'tokens.css'), 'utf8')
  const defined = new Set((tokens.match(/#[0-9a-f]{6}\b/gi) || []).map((c) => c.toLowerCase()))
  const used = [...html.matchAll(/%23([0-9a-f]{6})\b/gi)].map((m) => `#${m[1].toLowerCase()}`)
  assert.ok(used.length > 0, 'the favicon should carry colours')
  for (const colour of used) {
    assert.equal(defined.has(colour), true, `${colour} is not a colour defined in tokens.css`)
  }
})

test('a pan gesture repaints the stage only, never the navigator', () => {
  // A full render() on every pointermove would rebuild the navigator list and
  // destroy focus inside it while the user is panning.
  const applyTransform = /function applyTransform\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(applyTransform, 'applyTransform is missing')
  assert.match(applyTransform, /paintStage\(\)/)
  assert.equal(/\brender\(\)/.test(applyTransform), false, 'applyTransform must not run the full render')
})

test('search is wired to focus, to reset and to a visible no-match state', () => {
  assert.match(app, /matchNodes\(state\.viewModel, state\.filter\)/)
  assert.match(app, /searchAnnouncement\(result\)/)
  assert.match(app, /if \(event\.key === 'Enter'\)/)
  assert.match(app, /clearSearch\(\)/)
  assert.match(app, /dom\.filter\.setAttribute\('aria-invalid'/)
  assert.match(app, /dom\.body\.dataset\.search/)
  assert.match(shellCss, /\.a39-filter\[aria-invalid="true"\]/)
  assert.match(html, /aria-invalid="false"/)
  assert.match(html, /id="filter-hint"/)
})

test('every renderer and scene failure is a visible, coded failure state', () => {
  for (const code of [
    'E_SNAPSHOT_UNAVAILABLE',
    'E_VIEW_MODEL_INVALID',
    'E_STAGE_SCENE_REFUSED',
    'E_WEBGL_UNAVAILABLE',
    'E_WEBGL_CONTEXT_LOST',
    'E_PALETTE_INVALID'
  ]) {
    assert.ok(app.includes(code), `no failure path reports ${code}`)
  }
  assert.match(app, /sceneViolation\(projected\)/)
  assert.match(app, /Renderer unavailable/)
  assert.match(app, /Renderer stopped/)
  assert.match(app, /Nothing is substituted for the missing data/)
})

test('a failure tears the renderer down instead of leaving a stale frame behind', () => {
  const showFailure = /function showFailure\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(showFailure)
  assert.match(showFailure, /state\.stage\?\.dispose\(\)/)
  assert.match(showFailure, /nodeButtons\.clear\(\)/)
  assert.match(showFailure, /dom\.stageHost\.replaceChildren\(panel\)/)
  assert.match(showFailure, /dataset\.stage = 'failed'/)
  // Every interactive control is disabled: a failed stage must not offer zoom.
  // The array literal is the LIST, not the action, so the loop body is pinned
  // beside it: measured with app.mjs:166 changed from
  // `if (control) control.disabled = true` to `= false`, this assertion alone
  // stayed green while a torn-down stage still offered Zoom and Reset view. The
  // slice-2 test 'a failed stage offers no view, no saved view and no legend'
  // extracts the same showFailure and closes the same mutant, so this line is
  // what stops this test's own claim depending on that sibling existing.
  assert.match(showFailure, /dom\.zoomIn, dom\.zoomOut, dom\.resetView/)
  assert.match(showFailure, /if \(control\) control\.disabled = true/)
})

test('the shell never falls back to another renderer when WebGL is unavailable', () => {
  // The refusal text has to say so, because "no graph" with no explanation is
  // indistinguishable from "this project has no graph".
  assert.match(app, /a substitute renderer would not be the graph you asked for/)
  // And there is genuinely no second drawing path to fall back to.
  assert.equal(/getContext\('2d'\)/.test(app), false)
  assert.equal(app.includes('renderStage'), false)
})

test('the stage settles into exactly one observable outcome', () => {
  assert.match(app, /dom\.body\.dataset\.stage = 'ready'/)
  assert.match(app, /dom\.body\.dataset\.stage = 'failed'/)
})

/* ---------- ATLAS-40 slice 2: views, saved views, legend ---------- */

test('the shell routes the stage through the view-state projection, not the raw graph', () => {
  assert.match(app, /from '\.\/core\/view-state\.mjs'/)
  assert.match(app, /function resolveDisplayed\(\)/)
  assert.match(app, /computeLayout\(model, viewport\)/)
  assert.match(app, /buildScene\(model, layout, selectFocus\(model, state\.focusId\)\)/)
  // The canonical view model is not rewritten by a view.
  assert.equal(/state\.viewModel\s*=\s*applyView/.test(app), false)
  // resolveDisplayed's fallback is unreachable while every assignment to
  // state.view goes through a validated path, which is exactly why it has to be
  // VISIBLE if it is ever reached: a quiet return to Overview would look like
  // the user's own choice. Deleting the announce() leaves `function
  // resolveDisplayed()` intact, so the assertion has to name the sentence.
  // Measured: shipped=true, announce-deleted mutant=false.
  assert.match(app, /announce\(`That view could not be shown: \$\{applied\.reason\}\. Showing the whole graph instead\.`\)/)
  // The two assertions above are the presence of a projection, not the use of
  // one, and neither this suite nor the repository validator saw the difference
  // until it was measured. Two mutations, each keeping the import, the `function
  // resolveDisplayed()` declaration and every comment in this file byte-identical:
  //
  //   state.displayed = { ...applied, model: state.viewModel }
  //     — `scope` still reports the RESTRICTED counts, so #view-readout says
  //       "2 of 5 pages" while all five nodes are on the stage.
  //   const applied = applyView(state.viewModel, DEFAULT_VIEW)
  //     — the Neighbourhood button becomes inert; every mode draws the whole graph.
  //
  // Measured on both, before these lines existed: `npm run check` at
  // `VALIDATION PASSED / 146` with `✓ the workspace shell draws a view projection
  // rather than the raw graph` printed, and the suites at their control score. So
  // the projection is asserted on the CODE of the function that performs it: it
  // must be applied to the LIVE view rather than to a constant, and its result
  // must be stored unmodified, because rewriting `model` on the way into
  // state.displayed is what puts a caption and a stage into disagreement.
  const resolveDisplayed = /function resolveDisplayed\(\)[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(resolveDisplayed, 'resolveDisplayed is missing')
  // Over the COMMENT-FREE source, for the reason test/helpers/purity.mjs gives:
  // this function's own comments name `state.view` and `DEFAULT_VIEW`, so a raw
  // scan would be satisfied by the prose that documents the code.
  const resolveDisplayedCode = stripComments(resolveDisplayed)
  assert.match(resolveDisplayedCode, /const applied = applyView\(state\.viewModel, state\.view\)/)
  assert.match(resolveDisplayedCode, /^\s*state\.displayed = applied$/m)
})

test('both view modes are reachable, labelled and reflected in the controls', () => {
  for (const id of ['view-overview', 'view-neighbourhood', 'view-readout']) {
    assert.match(html, new RegExp(`id="${id}"`), `no ${id}`)
  }
  assert.match(html, /aria-label="Graph views"/)
  assert.match(app, /dom\.viewOverview\.setAttribute\('aria-pressed'/)
  assert.match(app, /dom\.viewNeighbourhood\.setAttribute\('aria-pressed'/)
  assert.match(app, /viewCaption\(state\.displayed\.scope, anchorLabel\(\)\)/)
  // The control that REPORTS the active mode must not be the one control the
  // user cannot operate. Disabling it on `state.focusId === null` alone left it
  // aria-pressed AND disabled after click-node -> Neighbourhood -> Clear focus,
  // and a restored saved view carrying `focus_id: null` reaches the same state.
  // See the second Task 6 correction of 2026-08-20.
  assert.match(app, /dom\.viewNeighbourhood\.disabled = state\.focusId === null && state\.view\.anchorId === null/)
  assert.match(app, /const anchorId = state\.focusId \?\? state\.view\.anchorId/)
})

test('a focus that the current view does not draw returns to the whole graph, and says so', () => {
  const setFocus = /function setFocus\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(setFocus, 'setFocus is missing')
  assert.match(setFocus, /leavesView\(state\.view, nodeId\)/)
  assert.match(setFocus, /Left the focused view/)
  // Clearing the focus does NOT widen the view, so the sentence must describe
  // the view that is on the stage. Slice 1's 'Focus cleared. Showing the whole
  // graph.' contradicted #view-readout as soon as a neighbourhood was shown,
  // and only the assistive-technology user got the wrong one. The caption
  // itself is announced, so the two cannot drift apart. See the second Task 6
  // correction of 2026-08-20.
  assert.match(setFocus, /announce\(`Focus cleared\. \$\{viewCaption\(state\.displayed\.scope, anchorLabel\(\)\)\}`\)/)
  assert.equal(/Focus cleared\. Showing the whole graph\./.test(app), false)
  // The predicate itself, and the fact that it is the ONE place the invariant
  // lives: a second, re-spelled copy is how the two could drift apart.
  assert.match(app, /function leavesView\(view, nodeId\)/)
  assert.match(app, /return !isInView\(applyView\(state\.viewModel, view\), nodeId\)/)
  // And EVERY writer of the pair goes through it, setView included. It was the
  // one writer of state.view that did not, so the invariant held on the focus
  // side only, by the accident of who calls it: neither shipped caller can leave
  // a focus outside the new view, but a third would, and that is the "0 nodes
  // are in the tab order" scene core/scene-guard.mjs refuses. Measured on the
  // third caller: tabbable nodes 0 before, 1 after. Widening back to Overview is
  // NOT the answer here — the view is what the user just asked for — so the
  // unseeable selection goes, and is announced. See the fifth Task 6 correction.
  const setView = /function setView\(next\) \{[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(setView, 'setView is missing')
  assert.match(setView, /const droppedFocus = leavesView\(applied\.view, state\.focusId\)/)
  assert.match(setView, /if \(droppedFocus\) state\.focusId = null/)
  assert.match(setView, /The focused page is not drawn by this view, so the focus was cleared\./)
})

test('a restored saved view can never focus a node its own view does not draw', () => {
  // restoreSavedView proves anchor and focus are nodes of THIS graph; it cannot
  // prove the focus is one the saved view draws, because that is a fact about
  // the projection. Feeding such a pair to buildScene produces a scene with
  // nothing in the tab order, which core/scene-guard.mjs refuses as
  // E_STAGE_SCENE_REFUSED — a torn-down stage over a saved view, which D5
  // forbids. Stored text is untrusted, so the guard is not optional.
  const restore = /function onRestoreView\([\s\S]*?\n\}\n/.exec(app)?.[0]
  assert.ok(restore, 'onRestoreView is missing')
  assert.match(restore, /const leftView = leavesView\(bound\.view, bound\.focusId\)/)
  assert.match(restore, /state\.view = leftView \? \{ \.\.\.DEFAULT_VIEW \} : bound\.view/)
  assert.match(restore, /The saved focus is not drawn by the saved view/)
})

test('keyboard traversal walks the view that is actually drawn', () => {
  const stepFocus = /function stepFocus\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(stepFocus)
  assert.match(stepFocus, /state\.displayed\.model\.nodes/)
  // Home/End are the same gesture under the same rule. Walking the full graph
  // there stepped straight out of the view — measured in the neighbourhood of
  // ATLAS:confluence:14778372:14778372, the End target was the sprint plan with
  // isInView false. See the third Task 6 correction of 2026-08-20.
  assert.match(app, /setFocus\(state\.displayed\.model\.nodes\[0\]\.node_id, \{ center: true \}\)/)
  assert.match(app, /setFocus\(state\.displayed\.model\.nodes\.at\(-1\)\.node_id, \{ center: true \}\)/)
  assert.equal(/state\.viewModel\.nodes\[0\]\.node_id/.test(app), false)
  assert.equal(/state\.viewModel\.nodes\.at\(-1\)\.node_id/.test(app), false)
})

test('a search that leaves the view says so, and the focus is centred against the view it landed in', () => {
  // D3's "the view returns to Overview AND SAYS SO" on the quiet path.
  // announce() assigns dom.live.textContent, so a sentence emitted inside
  // setFocus would be overwritten by runSearch's own one line later and never
  // reach the live-region user. setFocus returns it; the caller prefixes it.
  // One spelling of the sentence, in setFocus.
  const setFocus = /function setFocus\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(setFocus)
  assert.match(setFocus, /const scopeSentence = leftView \? 'Left the focused view\. ' : ''/)
  assert.match(setFocus, /if \(quiet\) return scopeSentence/)
  const runSearch = /function runSearch\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(runSearch, 'runSearch is missing')
  assert.match(runSearch, /scopeSentence = setFocus\(result\.firstMatchId, \{ moveStageFocus: false, quiet: true, center: true \}\)/)
  assert.match(runSearch, /announce\(`\$\{scopeSentence\}\$\{searchAnnouncement\(result\)\}`\)/)
  // And the centring reads the layout render() just produced, not the layout of
  // the view that was left — paintStage lays out the PROJECTED model, so the
  // previous layout does not contain a node that arrived from outside it.
  //
  // Compared on the CODE, not on the English. setFocus carries a comment that
  // contains the literal text `render()` ABOVE the centring block — the comment
  // that documents this very repair — so `indexOf('render()')` over the raw
  // source finds the comment first and the comparison holds even when the CALL
  // has moved back below the block. Measured on that mutant: raw indexOf
  // passes: true, stripComments indexOf passes: false.
  //
  // The PRESENCE of the call is asserted before the ordering, because the
  // comparison alone passes VACUOUSLY without it: `indexOf` answers -1 for an
  // absent call, and -1 is smaller than every real index. Measured on the
  // deletion of the `render()` call at app.mjs:844 with the comment untouched —
  // `indexOf render()=-1 | indexOf placements.find=515 | assertion passes:
  // true`, and `npm test` at `tests 497 / pass 497 / fail 0`. Renaming it
  // (`render()` -> `paintEverything()`) scored the same. That mutant is strictly
  // worse than the ordering defect this was written for: setFocus would stop
  // repainting altogether — no focus ring, no view projection, no navigator
  // update — with the whole contract green.
  //
  // The presence is matched on a WORD BOUNDARY, not as a substring, which is
  // the idiom already used at :203, in the test
  // 'a pan gesture repaints the stage only, never the navigator'.
  // `'rerender()'.includes('render()')` is true, so the substring form is
  // satisfied by any identifier that merely ENDS in render. Measured on that
  // mutant — setFocus's call replaced by a call to a new no-op
  // `function rerender() {}` — the two shell suites scored
  // `tests 55 / pass 55 / fail 0` with setFocus never repainting at all.
  //
  // The ORDERING comparison locates the call the same way, for one reason only:
  // two spellings of one token in adjacent lines is something the next reader
  // has to re-derive. It closes no hole the presence assertion above leaves
  // open — that one runs first, so a `rerender()`-only setFocus is already RED
  // before this line is reached.
  const setFocusCode = stripComments(setFocus)
  assert.ok(/\brender\(\)/.test(setFocusCode), 'setFocus no longer repaints before centring')
  assert.ok(
    setFocusCode.search(/\brender\(\)/) < setFocusCode.indexOf('state.layout.placements.find'),
    'the centring block still reads the layout of the view that was left'
  )
  assert.match(setFocus, /applyTransform\(centerOn\(state\.transform, placement\.x, placement\.y, state\.world\)\)/)
})

test('the saved view is versioned, probed storage, and refuses without touching the stage', () => {
  assert.match(app, /from '\.\/core\/saved-view\.mjs'/)
  assert.match(app, /const SAVED_VIEW_KEY = `atlas40\.saved-view\.v\$\{SAVED_VIEW_VERSION\}`/)
  // A store that merely exists is not a store that works.
  assert.match(app, /function openStore\(\)/)
  assert.match(app, /store\.setItem\(probe, '1'\)/)
  // …and a store that is writable is not a store that is readable. The one
  // storage read that runs BEFORE anything is drawn is inside a try: a throw
  // there sits between openStore() and render() in a bare-called async boot(),
  // so it takes the whole workspace down with no graph, no failure panel and
  // data-stage neither `ready` nor `failed`. Measured on the bare-getItem
  // mutant: shipped=true, mutant=false. See the fourth Task 6 correction.
  assert.match(app, /try \{\n\s*state\.savedViewPresent = typeof state\.store\.getItem\(SAVED_VIEW_KEY\) === 'string'\n\s*\} catch \{/)
  // BOTH refusals are `refused`. A store the browser withheld outright fell
  // through to `none` — the value onClearSavedView writes to mean "confirmed
  // absent" — so the harder refusal was rendered in the same muted colour as
  // "No saved view.", while onSaveView reported the identical condition as
  // `refused`. Measured on the store-refused mutant: shipped=true, mutant=false.
  // See the fifth Task 6 correction of 2026-08-20.
  assert.match(app, /state\.store === null \|\| storeRefusedRead \? 'refused' : state\.savedViewPresent \? 'saved' : 'none'/)
  // Every saved-view handler answers a null store LOUDLY, onClearSavedView
  // included — it is the one that used to return in silence, and its button is
  // disabled while the store is null, so nothing else would catch a relapse.
  // Measured on the silent-return mutant: shipped=true, mutant=false.
  assert.match(app, /refuseSavedView\(E_SAVED_VIEW_STORAGE, 'This browser did not allow the workspace to clear a saved view'\)/)
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
  // Matched on the assignment TARGET, not on the whole expression: the applied
  // value is `leftView ? { ...DEFAULT_VIEW } : bound.view` (see the guard above).
  const firstAssignment = restore.indexOf('state.view =')
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
  // The LEVEL is derived as well as the condition. A constant sentence is right
  // only while depthTokenName happens to collapse at 3; a ladder that collapsed
  // at 2 would fire the note and name the wrong level, which is slice 1's fixed
  // rows moved out of the rows and into the sentence. Measured on a hypothetical
  // ladder that collapses at 2: derived="Level 2 and deeper share one colour.",
  // constant="Level 3 and deeper share one colour." See the fifth Task 6
  // correction of 2026-08-20.
  //
  // Read off the COMMENT-FREE source, exactly like the negative below and for
  // the same house-style reason, because a POSITIVE that reads raw text is
  // satisfied by a comment that quotes the declaration it is about — and this
  // branch writes comments that do precisely that. Measured on the mutant: the
  // whole `sharedFrom` derivation deleted from paintLegend, quoted verbatim in
  // a `//` comment in its place and `dom.legendDepthNote.textContent = ''` left
  // behind, so D7's hierarchy-limitation sentence is never rendered under any
  // graph — against raw `app` the two lines below scored
  // `tests 55 / pass 55 / fail 0`, and these two assertions are the only gate
  // this shell has for that sentence.
  const appCode = stripComments(app)
  assert.match(appCode, /const sharedFrom = depthLegend\.entries\.find\(\(e\) => depthTokenCounts\.get\(e\.token\) > 1\) \?\? null/)
  assert.match(appCode, /sharedFrom === null \? '' : `\$\{depthCaption\(sharedFrom\.depth\)\} and deeper share one colour\.`/)
  // In ANY quoting. Pinning the single-quoted spelling alone let the same
  // constant come back as a double-quoted string or a backtick template, which
  // is the identical defect written differently.
  // Over the COMMENT-FREE source, for the reason test/helpers/purity.mjs
  // exists at all: this branch's house style is long comments that quote the
  // exact wording they forbid, and app.mjs:633 already carries
  // `'Level 3 and deeper'` in one — one clause short of tripping this. Applied
  // to the raw text the guard fires on prose: measured with only the comment
  // `// The constant this replaced read "Level 3 and deeper share one colour."
  // and` inserted above app.mjs:640, code untouched and correct, this test
  // scored `tests 55 / pass 54 / fail 1`. It loses no power — measured on the
  // real code mutant, `const HIERARCHY_NOTE = "Level 3 and deeper share one
  // colour."` beside the derived template, stripComments(app) is still true.
  assert.equal(
    /['"`]Level 3 and deeper share one colour\.['"`]/.test(appCode),
    false,
    'the level is hardcoded again'
  )
  // AC7 asks for a VISIBLE legend, so it is no longer hidden from assistive tech.
  const legend = /<section class="a39-legend"[\s\S]*?<\/section>/.exec(html)?.[0]
  assert.ok(legend, 'the legend section is missing')
  assert.equal(/aria-hidden/.test(legend), false, 'the legend is hidden from assistive technology')
  // The container's name covers BOTH groups, and each group carries a role that
  // may be named at all: ARIA 1.2 prohibits naming role `generic`, so
  // aria-labelledby on a bare <div> exposes no name while reading as if it did.
  assert.match(legend, /<section class="a39-legend" aria-label="Graph legend">/)
  assert.match(legend, /id="legend-edges" role="group" aria-labelledby="legend-title"/)
  assert.match(legend, /id="legend-depth" role="group" aria-labelledby="legend-depth-title"/)
  assert.match(legend, />Edge legend</)
})

test('legend text reaches the DOM only through textContent', () => {
  const paintLegend = /function paintLegend\(\)[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(paintLegend)
  assert.equal(/innerHTML|insertAdjacentHTML|outerHTML/.test(paintLegend), false)
  assert.match(paintLegend, /text\.textContent = `\$\{entry\.relationType\} · \$\{entry\.origin\} \(\$\{entry\.count\}\)`/)
  // The only style property assigned is a depth token, behind an allowlist.
  assert.match(paintLegend, /DEPTH_TOKEN\.test\(entry\.token\)/)
  // …and the swatch is CREATED inside that branch rather than merely left
  // uncoloured outside it. A swatch built first and only conditionally coloured
  // keeps the base `.a39-swatch` border, `var(--depth-n)`, which asserts the
  // depth-n colour for a row that is not depth-n — and that degraded form still
  // contains the substring on the line above, so the assertion has to reach the
  // structure. Measured on it: shipped=true, mutant=false.
  assert.match(paintLegend, /if \(DEPTH_TOKEN\.test\(entry\.token\)\) \{\n\s*const swatch = document\.createElement\('span'\)/)
  // One sentence for an empty edge legend, not two: the row that used to read
  // 'No relations in this view.' is gone, and core/legend.mjs's own
  // 'This view draws no relations.' reaches #legend-note. See the fourth Task 6
  // correction.
  assert.equal(/No relations in this view\./.test(app), false)
})

/**
 * Every rule in `css` that really targets `className`, as comment-free rule
 * text. Not one literal spelling of a selector: anchored on `.a39-legend {` the
 * countercheck below saw exactly one rule and was blind to every other form the
 * same declaration can take — measured with the 960px block's last rule
 * re-spelled `.a39-legend, .a39-header .a39-chips {`, keeping `display: none;`,
 * the legend is hidden below 960px and the two shell suites scored
 * `tests 55 / pass 55 / fail 0`.
 *
 * So the rules are selected the way a browser selects them. CSS comments go
 * first, because a declaration QUOTED in prose is not a declaration and the
 * `.a39-legend` rules carry `position: absolute` and `display: none` inside
 * their own comments. That stripper is a regex and cannot tell `/*` inside a CSS
 * string from a comment delimiter; measured over the whole of shell.css, the
 * only two lines where a quote is followed by either sequence are :249 and :487,
 * and both are prose INSIDE a comment, so no string value carries one today.
 *
 * Then the selector list is split on `,`, and a selector counts only when its
 * SUBJECT — the last compound, after the final combinator — carries `className`
 * as a whole class, which is what keeps `.a39-legend-note` and
 * `.a39-legend .a39-legend-note` (whose subject is the note) out of the
 * `a39-legend` set and puts them both in the `a39-legend-note` one.
 *
 * `[^}]*` for the body, never `[\s\S]*?`: the lazy form crosses a rule's closing
 * brace, so a declaration would still be read after it moved into a later rule.
 * Here each rule is a separate string, so a declaration that moves moves WITH
 * its rule. Nesting is not a special case for the same reason — `[^{}]` on both
 * sides matches innermost blocks only, so a rule inside an `@media` block is
 * selected exactly like a top-level one.
 */
const rulesWithSubject = (css, className) => {
  const subject = new RegExp(`\\.${className}(?![\\w-])`)
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((rule) => rule[1].split(',').some((one) => subject.test(one.trim().split(/[\s>+~]+/).pop())))
    .map((rule) => `${rule[1].trim()} {${rule[2]}}`)
}

test('the legend survives the responsive countercheck instead of disappearing', () => {
  // A legend that vanishes below 960px cannot satisfy AC7 at the smaller
  // accepted viewport, so it is laid out compactly rather than hidden.
  const small = /@media \(max-width: 960px\)[\s\S]*?\n\}\n/.exec(shellCss)?.[0]
  assert.ok(small, 'the 960px breakpoint is missing')

  // The two negatives read the WHOLE stylesheet, not the 960px block. Scoped to
  // that block they were defeated by one media query over: measured with
  // `.a39-legend { display: none; }` appended inside `@media (max-width: 1200px)`
  // at shell.css:680-682 and nothing else changed, the base
  // `.a39-legend { display: flex }` at shell.css:454 loses on source order at
  // equal (0,1,0) specificity and the 960px block declares no `display` at all,
  // so the legend is hidden at BOTH breakpoints — the exact AC7 regression these
  // lines exist to prevent — and the two shell suites scored
  // `tests 55 / pass 55 / fail 0`.
  //
  // Neither invariant needs the cascade reasoned about, because neither
  // declaration can be made harmless by one: `display: none` cannot be
  // overridden back into visibility by any rule that does not itself declare
  // `display`, and `position: static` cannot be overridden back into a
  // positioned box by any rule that does not itself declare `position`. A later
  // rule that DOES re-declare one would turn these RED — a false alarm, which is
  // the safe direction, and not the silent hole a scoped read is.
  //
  // The `position` half is whole-file truthful because the box it would fall
  // behind is there at every width: shell.css carries exactly two rules whose
  // subject is `.a39-stage-host` — :324-330, which is `position: absolute;
  // inset: 0`, and :332-334, which declares `cursor` alone — and neither sits in
  // a media query, so the stage host is positioned and full-bleed at every
  // width, with `paintStage` sizing the opaque canvas to the whole viewport
  // (app.mjs:482-483). `z-index` applies to positioned elements only, so an
  // in-flow legend paints underneath that canvas — hidden again, by a second
  // mechanism. See the Task 6 correction of 2026-08-20.
  const allLegendRules = rulesWithSubject(shellCss, 'a39-legend')
  assert.ok(allLegendRules.length > 0, 'nothing in shell.css styles the legend at all')
  for (const rule of allLegendRules) {
    assert.equal(/display:\s*none/.test(rule), false, `the legend is hidden: ${rule}`)
    assert.equal(/position:\s*static/.test(rule), false, `an in-flow legend paints under the canvas: ${rule}`)
  }

  // The positives are read off the same derivation, restricted to the 960px
  // block because that is the width they are a claim about. Over the raw block
  // text they were satisfied by a COMMENT: this branch's house style is long
  // comments that quote the exact declaration they are about, and both of these
  // declarations sit in a rule that already carries such a comment. Measured on
  // the mutants — `flex-direction: row;` deleted from the 960px `.a39-legend`
  // rule and quoted in a comment inside that same rule
  // (`grep -c 'flex-direction: row;' viewer/atlas39/shell.css` = 0, so the
  // legend keeps `flex-direction: column` from :459 and is a tall vertical stack
  // spanning left+right rather than the compact strip), and `max-width: 100%;`
  // deleted from `.a39-legend .a39-legend-note` and quoted the same way
  // (`grep -c 'max-width: 100%;'` = 0, so per CSS Flexbox §9.2 the note goes
  // back to sharing a row) — both scored `tests 55 / pass 55 / fail 0`.
  //
  // `some` over the block's rules rather than one named rule: a declaration on
  // any rule whose subject is the legend applies to the legend at this width,
  // which is the claim being made, and it is the browser's own reading.
  const legendRules = rulesWithSubject(small, 'a39-legend')
  assert.ok(legendRules.length > 0, 'the 960px block no longer styles the legend at all')
  assert.ok(
    legendRules.some((rule) => /bottom: var\(--s4\)/.test(rule)),
    'the legend is no longer anchored to the bottom of the stage below 960px'
  )
  assert.ok(
    legendRules.some((rule) => /flex-direction: row/.test(rule)),
    'the legend is no longer laid out as a compact strip below 960px'
  )
  // The note's row break only exists if the 46ch max-width clamp is lifted: per
  // CSS Flexbox §9.2 the hypothetical main size is the flex base size clamped by
  // the used max main size, so `flex-basis: 100%` alone left the note sharing a
  // row. See the Step 2 correction of 2026-08-20 (third review of Task 6).
  const legendNoteRules = rulesWithSubject(small, 'a39-legend-note')
  assert.ok(legendNoteRules.length > 0, 'the 960px block no longer styles the legend note at all')
  assert.ok(
    legendNoteRules.some((rule) => /max-width: 100%/.test(rule)),
    'the 46ch clamp is not lifted, so the note shares a row instead of taking one'
  )
})

test('a failed stage offers no view, no saved view and no legend', () => {
  const showFailure = /function showFailure\([\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(showFailure)
  assert.match(showFailure, /dom\.viewOverview, dom\.viewNeighbourhood, dom\.saveViewBtn, dom\.restoreViewBtn, dom\.clearSavedViewBtn/)
  // …and the LIST is not the action. Pinning the array literal alone said
  // nothing about what the loop under it does: measured with app.mjs:166
  // changed from `if (control) control.disabled = true` to `= false`, the two
  // shell suites scored `tests 55 / pass 55 / fail 0` and the whole suite
  // `tests 497 / pass 497 / fail 0`, while a torn-down stage still offered Save
  // view, Restore view, Clear saved view, Zoom and Reset. The slice-1 assertion
  // in 'a failure tears the renderer down instead of leaving a stale frame
  // behind' extracts the same showFailure and pins its own slice of the same
  // array the same way, so this one line closes that mutant for both.
  assert.match(showFailure, /if \(control\) control\.disabled = true/)
  // All FIVE legend/view lines, not the first one. The test's name claims no
  // view and no legend survives the failure; pinning `#legend-edges` alone made
  // it claim more than it checked. Measured on the deletion of
  // `dom.legendDepth?.replaceChildren()` from showFailure (verified gone,
  // `grep -c` = 0): the two shell suites scored `tests 55 / pass 55 / fail 0`
  // and the whole suite `tests 497 / pass 497 / fail 0`, while the Hierarchy
  // swatches kept explaining a graph that is no longer drawn after an
  // onContextLost failure — the same failure path, the sibling element, as the
  // `#saved-view-state` repair asserted below.
  assert.match(showFailure, /dom\.legendEdges\?\.replaceChildren\(\)/)
  assert.match(showFailure, /dom\.legendDepth\?\.replaceChildren\(\)/)
  assert.match(
    showFailure,
    /if \(dom\.legendNote\) dom\.legendNote\.textContent = 'No graph is drawn, so there is nothing to explain\.'/
  )
  assert.match(showFailure, /if \(dom\.legendDepthNote\) dom\.legendDepthNote\.textContent = ''/)
  assert.match(showFailure, /if \(dom\.viewReadout\) dom\.viewReadout\.textContent = '—'/)
  // …and no saved-view claim survives the failure either. showFailure is not
  // only a boot path — onContextLost calls it long after a save or a restore,
  // and #saved-view-state then still read `Restored.` beside a disabled Save
  // button. See the fifth Task 6 correction of 2026-08-20.
  assert.match(showFailure, /if \(dom\.savedViewState\) dom\.savedViewState\.textContent = ''/)
  assert.match(showFailure, /delete dom\.body\.dataset\.savedView/)
})

test('the new controls cannot swallow the graph arrow keys', () => {
  // onStageKeydown skips .a39-stage-controls; the view group carries that class
  // on purpose, so arrow keys on its buttons are never hijacked into traversal.
  assert.match(html, /class="a39-stage-controls a39-view-controls"/)
  assert.match(app, /event\.target\.closest\?\.\('\.a39-stage-controls'\)/)
})

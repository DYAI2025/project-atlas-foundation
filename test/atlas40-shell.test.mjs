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
  assert.match(html, /aria-label="Graph view controls"/)
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
  const wirePointer = /function wirePointer\(\)[\s\S]*?\n\}/.exec(app)?.[0]
  assert.ok(wirePointer, 'wirePointer is missing')
  assert.match(wirePointer, /DRAG_THRESHOLD/)
  assert.match(wirePointer, /suppressClick = true/)
  assert.match(wirePointer, /addEventListener\('click',[\s\S]*?\}, true\)/, 'the click guard must run in the capture phase')
  assert.equal(
    /pointerdown'[\s\S]{0,400}closest\?\.\('\.a39-gnode'\)/.test(wirePointer),
    false,
    'pointerdown must no longer refuse to start a pan on a node'
  )
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
  assert.match(showFailure, /dom\.zoomIn, dom\.zoomOut, dom\.resetView/)
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

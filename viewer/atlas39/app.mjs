// ATLAS-39 workspace shell, ATLAS-40 renderer — browser wiring only.
//
// This module deliberately contains NO graph logic. Everything that decides
// what the graph is, where it sits, how it is transformed and how it looks lives
// in ./core/, which is loaded byte-identically by `node --test`. What is left
// here is the part a test cannot meaningfully own: fetching, canvas setup,
// events and focus movement.
//
// ATLAS-40 changed exactly one thing about that arrangement: the stage is now
// drawn by core/render-webgl.mjs into a real WebGL canvas instead of by
// core/render-svg.mjs into SVG markup. Everything the shell is responsible for —
// the navigator, the evidence inspector, the keyboard model, the failure states,
// the provenance honesty rules — is unchanged in intent.
//
// The canvas is `aria-hidden`. All graph semantics live in a DOM overlay of real
// <button> elements, one per node, positioned and sized from the SAME projected
// scene the GPU draws. A WebGL surface must never cost a keyboard user the
// graph, and a hit target must never disagree with the highlight the user sees.
//
// Three rules this file must never break:
//   1. If the snapshot cannot be loaded or is refused by the view model, the
//      shell shows a failure state. It never falls back to a fixture, a cached
//      graph or an empty stage that would read as "this project has no graph".
//   2. If the renderer cannot start, or the scene is not drawable, that is also
//      a visible failure — not a quiet downgrade to some other renderer that
//      would look like success.
//   3. Missing provenance is displayed as missing.

import { buildViewModel, selectFocus } from './core/view-model.mjs'
import { computeLayout } from './core/layout.mjs'
import { buildScene, projectScene, resolvePalette } from './core/scene.mjs'
import { sceneViolation } from './core/scene-guard.mjs'
import { createWebglStage, E_WEBGL_UNAVAILABLE, E_WEBGL_CONTEXT_LOST } from './core/render-webgl.mjs'
import { matchNodes, searchAnnouncement } from './core/search.mjs'
import { clampTransform, resetTransform, zoomAt, panBy, centerOn, isDefaultView } from './core/transform.mjs'
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

const el = (id) => document.getElementById(id)

const dom = {
  body: document.body,
  stage: el('stage'),
  stageHost: el('stage-host'),
  nodelist: el('nodelist'),
  filter: el('filter'),
  inspectorBody: el('inspector-body'),
  inspectorToggle: el('inspector-toggle'),
  clearFocus: el('clear-focus'),
  zoomIn: el('zoom-in'),
  zoomOut: el('zoom-out'),
  resetView: el('reset-view'),
  zoomLevel: el('zoom-level'),
  live: el('live'),
  chipProject: el('chip-project'),
  chipSource: el('chip-source'),
  statCounts: el('stat-counts'),
  statContract: el('stat-contract'),
  statScheme: el('stat-scheme'),
  statRenderer: el('stat-renderer'),
  statProvenance: el('stat-provenance'),
  statGenerated: el('stat-generated'),
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
}

const state = {
  viewModel: null,
  focusId: null,
  filter: '',
  restoreStageFocus: false,
  transform: { scale: 1, tx: 0, ty: 0 },
  world: { width: 1440, height: 900 },
  layout: null,
  stage: null,
  canvas: null,
  overlay: null,
  palette: null,
  failed: false,
  // Which projection of the loaded graph is on the stage, and the applied
  // result of it. `displayed` is derived — resolveDisplayed() is the only
  // writer — so nothing else may set it and nothing may read `view` to decide
  // what is drawn.
  view: { ...DEFAULT_VIEW },
  displayed: null,
  // localStorage only once it has been proved writable; null when the browser
  // refused. The saved-view controls read this, not `window.localStorage`.
  store: null,
  savedViewPresent: false
}

/** Live DOM handles for the overlay buttons, keyed by node id. */
const nodeButtons = new Map()

const PROVENANCE_TEXT = {
  complete: 'complete',
  partial: 'partial — some pages missing',
  unavailable: 'unavailable'
}

const ZOOM_STEP = 1.25
const WHEEL_SENSITIVITY = 0.0015
const PAN_STEP = 60

/**
 * The live region. It obeys the SAME rule every visible surface obeys: it never
 * describes a stage that is no longer drawn.
 *
 * That rule reached the visible surfaces first and stopped at this one. Every
 * state-changing handler announces AFTER render(), and render() can tear the
 * stage down in the middle of the handler — paintStage()'s try/catch around
 * `state.stage.draw` calls showFailure('Renderer failed', …) and returns false.
 * An unconditional write here then replaced showFailure's own announcement with
 * the handler's success sentence, so the ONE channel an assistive-technology
 * user has ended up claiming the opposite of what every sighted surface said.
 * Measured headed on the accepted snapshot, with a GL context that starts fine
 * and throws from drawArrays later:
 *
 *   restore  data-stage=failed, #saved-view-state="", #view-readout="—",
 *            legend emptied — live region: "Saved view restored. Direct
 *            neighbourhood of “…” — 2 of 5 nodes, 1 of 4 relations."
 *   setView  data-stage=failed, #view-readout="—" — live region: "Direct
 *            neighbourhood of “…” — 2 of 5 nodes, 1 of 4 relations."
 *   setFocus data-stage=failed, #view-readout="—" — live region: "… focused.
 *            Level 2. 1 direct relation."
 *
 * A restore shown as successful when the system refused it is precisely what
 * rule 2 in this file's header forbids. The guard lives here rather than at the
 * five call sites because a sixth call site would have to remember it, and this
 * is the only line that writes the region.
 */
function announce(message) {
  // A refused stage has already had its say through announceFailure below, and
  // nothing a handler was about to claim about the graph is true any more.
  if (state.failed) return
  dom.live.textContent = message
}

/**
 * The failure channel. Unconditional by design: showFailure sets state.failed
 * before it speaks, so routing it through announce() would silence the very
 * sentence that is true. It is also what makes a SECOND failure audible.
 */
function announceFailure(message) {
  dom.live.textContent = message
}

function showFailure(headline, detail, code) {
  state.failed = true
  // The renderer is torn down explicitly: leaving a live GL context behind a
  // failure panel is how a stale, success-looking frame survives a refusal.
  state.stage?.dispose()
  state.stage = null
  state.canvas = null
  state.overlay = null
  nodeButtons.clear()

  const panel = document.createElement('div')
  panel.className = 'a39-failure'
  const title = document.createElement('h2')
  title.textContent = headline
  const text = document.createElement('p')
  text.textContent = detail
  panel.append(title, text)
  if (code) {
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    panel.append(codeEl)
  }
  const note = document.createElement('p')
  note.textContent = 'No graph is drawn. Nothing is substituted for the missing data.'
  panel.append(note)

  dom.stageHost.replaceChildren(panel)
  dom.nodelist.replaceChildren(Object.assign(document.createElement('li'), {
    className: 'a39-empty',
    textContent: 'Navigator unavailable — no valid snapshot.'
  }))
  dom.inspectorBody.replaceChildren(Object.assign(document.createElement('p'), {
    className: 'a39-placeholder',
    textContent: 'No snapshot loaded.'
  }))
  for (const control of [
    dom.clearFocus, dom.filter, dom.zoomIn, dom.zoomOut, dom.resetView,
    dom.viewOverview, dom.viewNeighbourhood, dom.saveViewBtn, dom.restoreViewBtn, dom.clearSavedViewBtn
  ]) {
    if (control) control.disabled = true
  }
  // A legend explains what is drawn. Nothing is drawn, so it must not keep
  // explaining the graph that was there a moment ago.
  dom.legendEdges?.replaceChildren()
  dom.legendDepth?.replaceChildren()
  if (dom.legendNote) dom.legendNote.textContent = 'No graph is drawn, so there is nothing to explain.'
  if (dom.legendDepthNote) dom.legendDepthNote.textContent = ''
  if (dom.viewReadout) dom.viewReadout.textContent = '—'
  // #saved-view-state is #view-readout's sibling in the same group and the
  // fourth line of this block. showFailure is not only a boot path: onContextLost
  // calls it long after a successful save or restore, and the line then still
  // read `Restored.` or `Saved: Direct neighbourhood of “…” — 4 of 5 nodes, 3 of
  // 4 relations.` beside a disabled Save button, with body[data-saved-view]
  // still standing — a claim about a stage that is no longer drawn. Every
  // saved-view control above is disabled, so there is nothing left for the line
  // to qualify; it says nothing rather than something stale, exactly as
  // #legend-depth-note does one line up.
  if (dom.savedViewState) dom.savedViewState.textContent = ''
  delete dom.body.dataset.savedView
  dom.body.dataset.stage = 'failed'
  announceFailure(`${headline} ${detail}`)
}

/* ---------- status bar ---------- */

function paintStatus() {
  const vm = state.viewModel
  dom.chipProject.textContent = vm.project_id
  dom.chipSource.textContent = vm.source.source_id
  dom.statCounts.textContent = `${vm.counts.nodes} nodes · ${vm.counts.edges} relations`
  dom.statContract.textContent = `gbrain-read/v${vm.contract_version}`
  dom.statScheme.textContent = vm.id_scheme
  dom.statProvenance.textContent = PROVENANCE_TEXT[vm.provenanceStatus]
  dom.statProvenance.dataset.state = vm.provenanceStatus
  dom.statGenerated.textContent = vm.provenanceGeneratedAt ?? 'unknown'
}

/* ---------- navigator ---------- */

function paintNavigator() {
  const vm = state.viewModel
  const result = matchNodes(vm, state.filter)
  const visible = result.matches

  dom.nodelist.replaceChildren()
  if (visible.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'a39-empty'
    empty.textContent = 'No node matches this search.'
    dom.nodelist.append(empty)
    return
  }

  let lastDepth = Symbol('none')
  for (const node of visible) {
    if (node.depth !== lastDepth) {
      lastDepth = node.depth
      const group = document.createElement('li')
      group.className = 'a39-group a39-label'
      group.textContent = depthCaption(node.depth)
      dom.nodelist.append(group)
    }
    const item = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'a39-nodeitem'
    button.dataset.nodeId = node.node_id
    if (node.node_id === state.focusId) button.setAttribute('aria-current', 'true')
    const label = document.createElement('span')
    label.textContent = node.label
    const meta = document.createElement('span')
    meta.className = 'a39-nodeitem-meta'
    meta.textContent = `page ${node.source_ref} · ${node.degree} ${node.degree === 1 ? 'relation' : 'relations'}`
    button.append(label, meta)
    button.addEventListener('click', () => setFocus(node.node_id, { moveStageFocus: false, center: true }))
    item.append(button)
    dom.nodelist.append(item)
  }
}

/* ---------- inspector ---------- */

function fact(list, term, value) {
  const dt = document.createElement('dt')
  dt.textContent = term
  const dd = document.createElement('dd')
  if (value instanceof Node) dd.append(value)
  else dd.textContent = value
  list.append(dt, dd)
}

function paintInspector() {
  const vm = state.viewModel
  const node = vm.nodes.find((n) => n.node_id === state.focusId)
  if (!node) {
    dom.inspectorBody.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'a39-placeholder',
      textContent: 'No node focused. Choose one in the navigator, or press Enter on a node in the graph.'
    }))
    return
  }

  const frag = document.createDocumentFragment()
  const title = document.createElement('h3')
  title.className = 'a39-node-title'
  title.textContent = node.label
  frag.append(title)

  const facts = document.createElement('dl')
  facts.className = 'a39-facts'
  fact(facts, 'Confluence page id', node.source_ref)
  fact(facts, 'Hierarchy', depthCaption(node.depth))

  if (node.provenance) {
    fact(facts, 'Revision', `v${node.provenance.version}`)
    fact(facts, 'Captured at', node.provenance.captured_at)
    const url = node.provenance.confluence_url
    if (typeof url === 'string' && /^https:\/\//i.test(url)) {
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noreferrer noopener'
      link.textContent = url
      fact(facts, 'Source', link)
    } else {
      fact(facts, 'Source', url ?? 'not recorded')
    }
  }
  fact(facts, 'Projection-local id', node.node_id)
  frag.append(facts)

  if (!node.provenance) {
    const note = document.createElement('p')
    note.className = 'a39-note'
    note.textContent = vm.provenanceStatus === 'unavailable'
      ? 'Provenance sidecar unavailable — revision and source URL are not shown because they are not known.'
      : 'This node has no entry in the provenance sidecar — revision and source URL are not shown because they are not known.'
    frag.append(note)
  }

  const neighbours = vm.nodes.filter((n) => vm.adjacency.get(node.node_id).has(n.node_id))
  const heading = document.createElement('h3')
  heading.className = 'a39-node-title'
  heading.style.fontSize = 'var(--fs-body)'
  heading.textContent = `Direct relations (${neighbours.length})`
  frag.append(heading)

  if (neighbours.length === 0) {
    frag.append(Object.assign(document.createElement('p'), {
      className: 'a39-placeholder',
      textContent: 'none'
    }))
  } else {
    const list = document.createElement('ul')
    list.className = 'a39-neighbours'
    for (const neighbour of neighbours) {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'a39-nodeitem'
      button.dataset.nodeId = neighbour.node_id
      button.textContent = neighbour.label
      button.addEventListener('click', () => setFocus(neighbour.node_id, { moveStageFocus: false, center: true }))
      item.append(button)
      list.append(item)
    }
    frag.append(list)
  }

  dom.inspectorBody.replaceChildren(frag)
}

/* ---------- stage surface ---------- */

function stageViewport() {
  const rect = dom.stage.getBoundingClientRect()
  return {
    width: Math.max(320, Math.round(rect.width) || 1440),
    height: Math.max(280, Math.round(rect.height) || 900)
  }
}

/**
 * Creates the WebGL canvas and the accessible overlay that sits on top of it.
 * Throws whatever createWebglStage() throws; the caller turns that into the
 * visible failure state.
 */
function createSurface() {
  const canvas = document.createElement('canvas')
  canvas.className = 'a39-canvas'
  // The canvas carries no semantics at all: everything a screen reader or a
  // keyboard needs is in the overlay below.
  canvas.setAttribute('aria-hidden', 'true')

  const overlay = document.createElement('div')
  overlay.className = 'a39-overlay'
  overlay.setAttribute('role', 'group')
  overlay.setAttribute('aria-label', 'Graph nodes')

  dom.stageHost.replaceChildren(canvas, overlay)

  const stage = createWebglStage(canvas, {
    onContextLost: (code) => {
      showFailure(
        'Renderer stopped',
        'The browser released the WebGL context for the graph stage, so what is on screen can no longer be trusted to be the real graph. Reload to rebuild it.',
        code ?? E_WEBGL_CONTEXT_LOST
      )
    }
  })

  state.canvas = canvas
  state.overlay = overlay
  state.stage = stage
  // Reported in the status bar and readable by an acceptance run: a claim that
  // the stage is WebGL should be checkable from outside the application.
  canvas.dataset.renderer = stage.contextType
  dom.statRenderer.textContent = stage.contextType === 'webgl2' ? 'WebGL 2' : 'WebGL 1'
  return stage
}

/**
 * Reconciles the overlay buttons with the projected scene. Buttons are reused
 * across renders rather than rebuilt, because rebuilding them would silently
 * drop keyboard focus on every pan, zoom and selection.
 *
 * Nothing here goes through an HTML sink: element creation, `textContent` and a
 * fixed set of attributes only. A Confluence page title can therefore never
 * become markup, which is the property the ATLAS-39 mount guard protected when
 * the renderer's product was a markup string.
 */
function syncOverlay(scene) {
  const seen = new Set()

  for (const node of scene.nodes) {
    seen.add(node.nodeId)
    let entry = nodeButtons.get(node.nodeId)
    if (!entry) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'a39-gnode'
      button.dataset.nodeId = node.nodeId
      const label = document.createElement('span')
      label.className = 'a39-gnode-label'
      // The label is decoration for assistive technology: the button's
      // aria-label already carries the full title plus its hierarchy and degree,
      // so exposing the visible span again would read the node out twice.
      label.setAttribute('aria-hidden', 'true')
      button.append(label)
      button.addEventListener('click', () => setFocus(node.nodeId))
      state.overlay.append(button)
      entry = { button, label }
      nodeButtons.set(node.nodeId, entry)
    }

    const { button, label } = entry
    button.className = `a39-gnode is-${node.state}`
    button.dataset.depth = node.depth === null ? 'none' : String(node.depth)
    button.setAttribute('aria-label', node.ariaLabel)
    button.setAttribute('aria-pressed', node.state === 'focus' ? 'true' : 'false')
    button.setAttribute('title', node.label)
    button.tabIndex = node.tabbable ? 0 : -1
    button.style.setProperty('--gx', `${node.x}px`)
    button.style.setProperty('--gy', `${node.y}px`)
    button.style.setProperty('--gr', `${node.hitR}px`)
    button.style.setProperty('--lx', `${node.labelX - node.x}px`)
    button.style.setProperty('--ly', `${node.labelY - node.y}px`)
    button.style.setProperty('--lw', `${node.labelMaxWidth}px`)
    button.dataset.anchor = node.anchor
    label.textContent = node.label
  }

  for (const [nodeId, entry] of nodeButtons) {
    if (seen.has(nodeId)) continue
    entry.button.remove()
    nodeButtons.delete(nodeId)
  }
}

function paintZoomReadout() {
  dom.zoomLevel.textContent = `${Math.round(state.transform.scale * 100)}%`
  dom.resetView.disabled = isDefaultView(state.transform)
}

function paintStage() {
  // The DISPLAYED model, not the whole graph: a view restricts which nodes and
  // edges reach the layout and the scene, and nothing else about them.
  const model = state.displayed.model
  const viewport = stageViewport()
  const layout = computeLayout(model, viewport)
  state.layout = layout
  state.world = { width: layout.width, height: layout.height }
  state.transform = clampTransform(state.transform, state.world)

  // selectFocus is given the SAME model buildScene is given. Handing it the
  // full view model instead would report a focus on a node this view does not
  // draw, and buildScene would then mark every node `dim` with nothing in the
  // tab order — a stage no keyboard user could reach. leavesView() below is
  // what keeps state.focusId inside state.view so this call cannot do that.
  const scene = buildScene(model, layout, selectFocus(model, state.focusId))
  const projected = projectScene(scene, state.transform)

  const violation = sceneViolation(projected)
  if (violation) {
    showFailure(
      'Stage refused',
      `The renderer produced a scene the shell will not draw: ${violation}.`,
      'E_STAGE_SCENE_REFUSED'
    )
    return false
  }

  // The canvas is sized in CSS pixels to the exact viewport the layout was
  // computed for, so world coordinates and canvas coordinates are the same
  // numbers and no hidden scaling can creep between them.
  state.canvas.style.width = `${viewport.width}px`
  state.canvas.style.height = `${viewport.height}px`
  state.overlay.style.width = `${viewport.width}px`
  state.overlay.style.height = `${viewport.height}px`

  try {
    state.stage.resize(viewport.width, viewport.height, window.devicePixelRatio)
    state.stage.draw(projected, state.palette)
  } catch (error) {
    showFailure(
      'Renderer failed',
      `The WebGL stage could not draw the graph: ${error.message}`,
      error.code ?? E_WEBGL_UNAVAILABLE
    )
    return false
  }

  syncOverlay(projected)
  paintZoomReadout()

  if (state.restoreStageFocus) {
    state.restoreStageFocus = false
    nodeButtons.get(state.focusId)?.button.focus()
  }
  return true
}

/* ---------- views, saved view and legend ---------- */

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

/**
 * True when `view` would not draw `nodeId` — the one predicate that keeps a
 * focus and the view it is shown in consistent, and therefore the one thing
 * standing between this shell and the scene `paintStage` describes: a focus
 * outside the displayed model makes `selectFocus` report `hasFocus: true`
 * (applyView keeps the FULL-graph adjacency by design, view-state.mjs), which
 * makes `buildScene` mark every node `dim` with nothing in the tab order, which
 * `core/scene-guard.mjs` then refuses as E_STAGE_SCENE_REFUSED — tearing the
 * stage down over a UI state, which is exactly what a saved view must never do.
 *
 * Both writers of `state.focusId` go through it: setFocus and onRestoreView.
 * An unresolvable view answers `true`, because isInView() answers false for a
 * refusal — so an anchor this graph does not contain widens to Overview rather
 * than silently keeping a focus nothing draws.
 */
function leavesView(view, nodeId) {
  if (nodeId === null || view.mode === 'overview') return false
  return !isInView(applyView(state.viewModel, view), nodeId)
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
  dom.legendEdges.replaceChildren(edgeRows)
  // An empty edge legend is said ONCE. This used to append a row reading "No
  // relations in this view." as well, so the same fact arrived twice in two
  // different wordings, which reads as two separate facts. The sentence that
  // survives is the module's, because core/legend.mjs owns and pins it
  // (test/atlas40-legend.test.mjs), and the note is the element that already
  // exists to say what the rows cannot.
  dom.legendNote.textContent = edgeLegendNote(edgeLegend)

  const depthLegend = buildDepthLegend(model)
  const depthRows = document.createDocumentFragment()
  for (const entry of depthLegend.entries) {
    const row = document.createElement('div')
    row.className = 'a39-legend-row'
    const text = document.createElement('span')
    text.textContent = `${depthCaption(entry.depth)} (${entry.count})`
    // The swatch is painted from the same token the renderer strokes the disc
    // with. The allowlist keeps that assignment mechanically safe — and a token
    // outside it gets NO swatch at all rather than the base `.a39-swatch`
    // border, which is `var(--depth-n)` (shell.css, the `.a39-swatch` rule):
    // drawing it would assert the depth-n colour for a row that is not depth-n.
    // Unreachable today, because depthTokenName returns only the five admitted
    // tokens and test/atlas40-scene.test.mjs pins that table — which is exactly
    // why it must fail closed instead of degrading if the ladder ever changes.
    if (DEPTH_TOKEN.test(entry.token)) {
      const swatch = document.createElement('span')
      swatch.className = 'a39-swatch'
      swatch.style.borderColor = `var(${entry.token})`
      row.append(swatch, text)
    } else {
      row.append(text)
    }
    depthRows.append(row)
  }
  dom.legendDepth.replaceChildren(depthRows)
  // What the Hierarchy group does NOT distinguish, said by the shell because D7
  // assigns the sentence here: depthTokenName collapses every depth from 3
  // onward onto `--depth-n`, so on a deeper graph differently-labelled rows
  // carry an identical swatch. Derived from the rows themselves rather than from
  // a flag, so it can only appear when it is true — on the accepted three-level
  // snapshot every row has its own token and this stays empty.
  //
  // The LEVEL is derived too, not written into the sentence. A constant reading
  // 'Level 3 and deeper' was right only because depthTokenName happens to
  // collapse at 3 today; a ladder that collapsed at 2 would have fired this note
  // and named the wrong level — slice 1's fixed rows, moved out of the rows and
  // into the sentence, which is the exact shape Task 5 removed from
  // edgeLegendNote one module over. The first row whose token another row also
  // carries is where the collapse starts, and entries arrive depth-ascending
  // (core/legend.mjs, buildDepthLegend's sort).
  const depthTokenCounts = new Map()
  for (const entry of depthLegend.entries) {
    depthTokenCounts.set(entry.token, (depthTokenCounts.get(entry.token) ?? 0) + 1)
  }
  const sharedFrom = depthLegend.entries.find((e) => depthTokenCounts.get(e.token) > 1) ?? null
  dom.legendDepthNote.textContent =
    sharedFrom === null ? '' : `${depthCaption(sharedFrom.depth)} and deeper share one colour.`
}

function paintViewControls() {
  const scope = state.displayed.scope
  dom.viewOverview.setAttribute('aria-pressed', String(scope.mode === 'overview'))
  dom.viewNeighbourhood.setAttribute('aria-pressed', String(scope.mode === 'neighbourhood'))
  // Unavailable only when there is no node to anchor on at all. Disabling it on
  // `state.focusId === null` alone left the button `aria-pressed="true"` AND
  // `disabled` — measured after click-node → "Neighbourhood" → "Clear focus" —
  // i.e. the control that reports the mode on the stage was the one control the
  // user could not operate. The Overview button stays clickable while pressed
  // and re-asserts its mode; this one now behaves the same way, anchoring on the
  // focus or, when the focus was cleared under a neighbourhood, on the anchor
  // already drawn.
  dom.viewNeighbourhood.disabled = state.focusId === null && state.view.anchorId === null
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
  // The third writer of state.view, and until now the one that did not consult
  // leavesView — so the invariant that predicate documents ("a focus and the
  // view it is shown in stay consistent") held on the focus side only, by the
  // accident of who calls this. Neither shipped caller can reach it:
  // #view-overview widens to a view that draws everything, and
  // #view-neighbourhood anchors on `state.focusId ?? state.view.anchorId`, so
  // the focus is either the anchor itself or null. A third caller would leave
  // state.focusId outside state.displayed.model, which is the "0 nodes are in
  // the tab order, expected exactly 1" path in core/scene-guard.mjs that tears
  // the stage down with E_STAGE_SCENE_REFUSED — what D5 forbids. Widening back
  // to Overview is not the symmetric answer here, because the view is the thing
  // the user just asked for; the unseeable selection is what goes, and it is
  // announced rather than dropped in silence.
  const droppedFocus = leavesView(applied.view, state.focusId)
  if (droppedFocus) state.focusId = null
  state.view = applied.view
  render()
  announce(
    (droppedFocus ? 'The focused page is not drawn by this view, so the focus was cleared. ' : '') +
      viewCaption(state.displayed.scope, anchorLabel())
  )
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
  // The saved-view contract checks that anchor and focus are BOTH nodes of this
  // graph; it does not check that the focus is one the saved view draws, and it
  // cannot, because that is a fact about the projection rather than about the
  // record. Stored text is untrusted — validating it is why parseSavedView
  // exists — so the same guard setFocus uses runs here too.
  const leftView = leavesView(bound.view, bound.focusId)

  state.view = leftView ? { ...DEFAULT_VIEW } : bound.view
  state.focusId = bound.focusId
  state.restoreStageFocus = false
  state.transform = clampTransform(bound.transform, state.world)
  dom.body.dataset.savedView = 'restored'
  // The VISIBLE line said a flat 'Restored.' on both sides of the branch above,
  // so when the saved view was discarded the sighted user read a restoration
  // that did not happen — 'Restored.' beside an Overview readout, with the
  // stored record naming a neighbourhood. Measured headed on the accepted
  // snapshot, record {mode:'neighbourhood', anchor_id:…:22478849,
  // focus_id:…:14778372}: #saved-view-state "Restored.",
  // body[data-saved-view]=restored, #view-readout "Overview — 5 of 5 nodes,
  // 4 of 4 relations.", while the live region alone carried "…The saved focus
  // is not drawn by the saved view, so the whole graph is shown instead."
  //
  // That is the mirror image of the setFocus defect this slice already
  // corrected, where only the assistive-technology user got the wrong sentence;
  // here only the sighted user did. Both channels now name the same outcome.
  // The re-fit case is deliberately NOT added here: D6 assigns that sentence to
  // the announcement, and the visible line is not making a claim about it.
  dom.savedViewState.textContent = leftView
    ? 'Restored without the saved view: its focus is not drawn by it.'
    : 'Restored.'
  render()
  announce(
    `Saved view restored. ${viewCaption(state.displayed.scope, anchorLabel())}` +
      (leftView
        ? ' The saved focus is not drawn by the saved view, so the whole graph is shown instead.'
        : '') +
      (bound.viewportChanged
        ? ' The stage is a different size than when this view was saved, so the zoom and position were re-fitted.'
        : '')
  )
}

function onClearSavedView() {
  if (state.store === null) {
    // The same condition onSaveView and onRestoreView refuse loudly. The button
    // is disabled while the store is null, so this is unreachable today — but a
    // silent return here would be the one saved-view path that answers a user
    // action with nothing, and a false hint that silence is acceptable in this
    // family of handlers.
    refuseSavedView(E_SAVED_VIEW_STORAGE, 'This browser did not allow the workspace to clear a saved view')
    return
  }
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

function render() {
  if (state.failed) return
  resolveDisplayed()
  // A refused stage has already painted the failure state over every region;
  // repainting the navigator and inspector on top of it would re-introduce
  // exactly the "there is a graph here" impression the refusal exists to deny.
  if (!paintStage()) return
  paintNavigator()
  paintInspector()
  paintLegend()
  paintViewControls()
  dom.clearFocus.disabled = state.focusId === null
}

/**
 * True when the node currently sits outside the stage box. Used to decide
 * whether focusing it should move the view: recentring on every arrow key would
 * make traversal lurch about at the default zoom, while never recentring would
 * let a search focus a node the user cannot see.
 */
function isOffStage(placement) {
  const margin = 48
  const x = placement.x * state.transform.scale + state.transform.tx
  const y = placement.y * state.transform.scale + state.transform.ty
  return x < margin || y < margin || x > state.world.width - margin || y > state.world.height - margin
}

function setFocus(nodeId, { moveStageFocus = true, quiet = false, center = false } = {}) {
  const vm = state.viewModel
  const known = vm.nodes.some((n) => n.node_id === nodeId)
  // Focusing a node the current view does not draw would leave the user with a
  // selection they cannot see — the same defect as losing the graph — and it
  // would hand paintStage a focus outside its model, which is the 0-tabbable
  // scene described there. The view returns to the whole graph, and says so.
  const leftView = known && leavesView(state.view, nodeId)
  if (leftView) state.view = { ...DEFAULT_VIEW }
  state.focusId = known ? nodeId : null
  state.restoreStageFocus = known && moveStageFocus

  render()

  // Focusing a node that the current pan has pushed off screen is the same
  // defect as losing the graph, so a focus that came from the navigator or from
  // a search brings the node back into view — but only when it actually needs
  // it.
  //
  // This runs AFTER render(), against the layout render() just produced. Slice 1
  // could read state.layout first because the layout always held every node;
  // paintStage now lays out the DISPLAYED model, so the previous view's layout
  // does not contain a node that arrived from outside it — measured on the
  // accepted snapshot at 1092x693 with anchor ATLAS:confluence:14778372:14778372:
  // 4 of 5 nodes placed, and `placements.find(p => p.node_id === SPRINT)` is
  // `undefined`, so the centring was skipped in exactly the case it exists for.
  // At scale 2.5 that node projects to {x: 3.5, y: 35.25} in a 1092x693 stage —
  // off stage by isOffStage's own 48px margin, focused and unreachable.
  if (known && center && !state.failed && state.layout) {
    const placement = state.layout.placements.find((p) => p.node_id === nodeId)
    if (placement && isOffStage(placement)) {
      applyTransform(centerOn(state.transform, placement.x, placement.y, state.world))
    }
  }

  // D3's "the view returns to the whole graph AND SAYS SO" is a fact the caller
  // may have to announce itself: announce() overwrites the live region
  // (app.mjs, `dom.live.textContent = message`), so a sentence emitted here on
  // the quiet path would be replaced by the caller's own one line later and
  // never reach the user. It is returned instead of being spelled a second time
  // at the call site, so the two cannot drift apart.
  const scopeSentence = leftView ? 'Left the focused view. ' : ''
  if (quiet) return scopeSentence
  if (!known) {
    // Slice 1 could say "Showing the whole graph" here because one view existed.
    // Slice 2 made `state.view` independent of `state.focusId`, and clearing the
    // focus deliberately does NOT widen the view — so that sentence became a
    // sometimes-lie: measured after click-node → "Neighbourhood" → "Clear
    // focus" on the accepted snapshot, `state.view` stays
    // `{mode:'neighbourhood', anchorId:'ATLAS:confluence:14778372:14778372'}`,
    // 4 of 5 nodes are drawn, and #view-readout says so while the live region
    // claimed the whole graph. Only the assistive-technology user got the wrong
    // one. The readout's own sentence is announced instead, so the two cannot
    // disagree.
    announce(`Focus cleared. ${viewCaption(state.displayed.scope, anchorLabel())}`)
    return scopeSentence
  }
  const node = vm.nodes.find((n) => n.node_id === nodeId)
  announce(
    `${scopeSentence}${node.label} focused. ` +
    `${depthCaption(node.depth)}. ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}.`
  )
  return scopeSentence
}

/* ---------- zoom and pan ---------- */

// Zoom and pan change the view, never the selection or the node set, so they
// repaint the stage alone. Running the full render() here would rebuild the
// navigator list on every pointermove — which is both wasteful and a real
// accessibility bug, because it would destroy focus inside the navigator while
// the user is panning.
function applyTransform(next, message) {
  state.transform = clampTransform(next, state.world)
  if (!paintStage()) return
  if (message) announce(message)
}

function zoomBy(factor, anchor) {
  const point = anchor ?? { x: state.world.width / 2, y: state.world.height / 2 }
  applyTransform(zoomAt(state.transform, factor, point.x, point.y, state.world))
}

function stagePoint(event) {
  const rect = dom.stageHost.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/* ---------- events ---------- */

function stepFocus(delta) {
  // The order that is DRAWN. Walking the full graph here would step onto a node
  // the current view hides and kick the view back to Overview on every second
  // arrow press.
  const order = state.displayed.model.nodes.map((n) => n.node_id)
  const current = order.indexOf(state.focusId)
  const next = current === -1
    ? (delta > 0 ? 0 : order.length - 1)
    : (current + delta + order.length) % order.length
  setFocus(order[next], { center: true })
}

function onStageKeydown(event) {
  // The stage controls are ordinary buttons inside the stage region; arrow keys
  // pressed on them must not be hijacked into graph traversal.
  if (event.target.closest?.('.a39-stage-controls')) return
  const host = event.target.closest?.('.a39-gnode')

  switch (event.key) {
    case 'Enter':
    case ' ':
      if (!host) return
      event.preventDefault()
      setFocus(host.dataset.nodeId)
      return
    case 'ArrowRight':
    case 'ArrowDown':
      event.preventDefault()
      if (event.shiftKey) {
        applyTransform(panBy(state.transform, event.key === 'ArrowRight' ? -PAN_STEP : 0, event.key === 'ArrowDown' ? -PAN_STEP : 0, state.world))
        return
      }
      stepFocus(1)
      return
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()
      if (event.shiftKey) {
        applyTransform(panBy(state.transform, event.key === 'ArrowLeft' ? PAN_STEP : 0, event.key === 'ArrowUp' ? PAN_STEP : 0, state.world))
        return
      }
      stepFocus(-1)
      return
    // Home/End are keyboard traversal too, so they walk the same order the
    // arrows do — the DISPLAYED one. Walking the full graph here stepped
    // straight out of the view: measured on the accepted snapshot in the
    // neighbourhood of ATLAS:confluence:14778372:14778372, `End` targeted
    // "Sprint 2 – Visible Real Semantic Atlas – Sprint Plan", `isInView` false,
    // so one key press widened the view back to Overview. Announced, so nothing
    // was misleading — but it made the two halves of the same gesture disagree.
    case 'Home':
      event.preventDefault()
      setFocus(state.displayed.model.nodes[0].node_id, { center: true })
      return
    case 'End':
      event.preventDefault()
      setFocus(state.displayed.model.nodes.at(-1).node_id, { center: true })
      return
    case '+':
    case '=':
      event.preventDefault()
      zoomBy(ZOOM_STEP)
      announce(`Zoom ${Math.round(state.transform.scale * 100)} percent.`)
      return
    case '-':
    case '_':
      event.preventDefault()
      zoomBy(1 / ZOOM_STEP)
      announce(`Zoom ${Math.round(state.transform.scale * 100)} percent.`)
      return
    case '0':
      event.preventDefault()
      applyTransform(resetTransform(state.world), 'View reset to the default zoom and position.')
      return
    case 'Escape':
      if (state.focusId === null) return
      event.preventDefault()
      setFocus(null)
      dom.stage.focus()
  }
}

function runSearch() {
  const result = matchNodes(state.viewModel, state.filter)
  dom.body.dataset.search = !result.active ? 'idle' : result.matches.length === 0 ? 'nomatch' : 'match'
  dom.filter.setAttribute('aria-invalid', result.active && result.matches.length === 0 ? 'true' : 'false')
  // Search runs over the WHOLE graph (D3), so a match can land outside the
  // current view and widen it back to Overview. That scope change has to be
  // announced here: setFocus is quiet on this path because this function makes
  // the announcement, and announce() overwrites the live region — a sentence
  // from setFocus would be replaced by the search sentence one line later and
  // the live-region user would lose the whole scope silently.
  let scopeSentence = ''
  if (result.firstMatchId) {
    scopeSentence = setFocus(result.firstMatchId, { moveStageFocus: false, quiet: true, center: true })
  }
  announce(`${scopeSentence}${searchAnnouncement(result)}`)
}

function syncSearchState() {
  state.filter = dom.filter.value
  const result = matchNodes(state.viewModel, state.filter)
  dom.body.dataset.search = !result.active ? 'idle' : result.matches.length === 0 ? 'nomatch' : 'match'
  dom.filter.setAttribute('aria-invalid', result.active && result.matches.length === 0 ? 'true' : 'false')
  paintNavigator()
}

function clearSearch() {
  dom.filter.value = ''
  syncSearchState()
  announce('Search cleared. Showing all nodes.')
}

function wirePointer() {
  dom.stageHost.addEventListener('wheel', (event) => {
    event.preventDefault()
    // deltaMode 1 is lines, 2 is pages; normalising keeps the gesture consistent
    // between a mouse wheel and a trackpad.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.world.height : 1
    zoomBy(Math.exp(-event.deltaY * unit * WHEEL_SENSITIVITY), stagePoint(event))
  }, { passive: false })

  // A pan may begin anywhere on the stage, including on top of a node. Refusing
  // to pan from a node looks harmless at the default zoom and is unusable once
  // zoomed in, where a single node can cover most of the stage and every drag
  // starts on one. The click that focuses a node is protected by a movement
  // threshold instead: below it the gesture is a click, above it it is a pan and
  // the click is swallowed.
  //
  // The state machine itself lives in core/gesture.mjs, where a `node --test`
  // suite can drive it. Kept here it could only ever be asserted as source text,
  // which is what let a stale click suppression survive a pointercancel.
  const gesture = createDragGesture()

  // Capture phase, so this runs before the node button's own click handler.
  //
  // The DOM event is forwarded as-is here too: `consumeClick` reads `detail` to
  // tell a click a pointer produced (click count >= 1) from one nothing
  // produced (0, because HTML's "fire a synthetic pointer event" — the
  // algorithm behind `element.click()` and behind a keyboard activation — never
  // initialises it). Only the former can be the tail of a pan, so only the
  // former may spend the suppression.
  //
  // On this stage the reachable non-pointer route is a click dispatched by
  // script or by assistive technology, not the keyboard: onStageKeydown
  // preventDefaults Enter and Space over a node, so the button's activation
  // behaviour — and with it any click — never runs. Measured headed 2026-08-20.
  dom.stageHost.addEventListener('click', (event) => {
    if (!gesture.consumeClick(event)) return
    event.stopPropagation()
    event.preventDefault()
  }, true)

  // The DOM event is forwarded as-is: the module reads `buttons` to refuse a
  // step with no button held, and a synthetic record without it would be
  // refused rather than trusted.
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

function wireEvents() {
  dom.stage.addEventListener('keydown', onStageKeydown)
  wirePointer()

  dom.clearFocus.addEventListener('click', () => setFocus(null))
  dom.zoomIn.addEventListener('click', () => {
    zoomBy(ZOOM_STEP)
    announce(`Zoom ${Math.round(state.transform.scale * 100)} percent.`)
  })
  dom.zoomOut.addEventListener('click', () => {
    zoomBy(1 / ZOOM_STEP)
    announce(`Zoom ${Math.round(state.transform.scale * 100)} percent.`)
  })
  dom.resetView.addEventListener('click', () => {
    applyTransform(resetTransform(state.world), 'View reset to the default zoom and position.')
  })

  dom.viewOverview.addEventListener('click', () => setView({ ...DEFAULT_VIEW }))
  dom.viewNeighbourhood.addEventListener('click', () => {
    // The focus is the anchor. When the focus was cleared while a neighbourhood
    // is on the stage — or a restored saved view carries `focus_id: null`
    // (saved-view.mjs admits it) — the anchor already drawn is re-asserted,
    // which is exactly what the Overview button does in its own mode. So an
    // enabled control always has something to do and always announces the
    // result; it is never an enabled button that silently does nothing.
    const anchorId = state.focusId ?? state.view.anchorId
    if (anchorId === null) return
    setView({ mode: 'neighbourhood', anchorId })
  })
  dom.saveViewBtn.addEventListener('click', onSaveView)
  dom.restoreViewBtn.addEventListener('click', onRestoreView)
  dom.clearSavedViewBtn.addEventListener('click', onClearSavedView)

  dom.filter.addEventListener('input', syncSearchState)
  // The native clear affordance of <input type="search"> fires `search`, not
  // `input`, in some engines; wiring both means the reset path is the same one.
  dom.filter.addEventListener('search', () => {
    syncSearchState()
    if (state.filter.trim() === '') announce('Search cleared. Showing all nodes.')
  })
  dom.filter.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      runSearch()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      clearSearch()
    }
  })

  dom.inspectorToggle.addEventListener('click', () => {
    const open = dom.body.dataset.inspector !== 'open'
    dom.body.dataset.inspector = open ? 'open' : 'closed'
    dom.inspectorToggle.setAttribute('aria-expanded', String(open))
  })

  let frame = 0
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!state.failed) paintStage()
    })
  })
}

/* ---------- boot ---------- */

async function loadJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} responded ${response.status}`)
  return response.json()
}

async function boot() {
  let snapshot
  try {
    snapshot = await loadJson('/graph-snapshot.json')
  } catch (error) {
    showFailure(
      'Snapshot unavailable',
      `The workspace could not load the graph snapshot: ${error.message}`,
      'E_SNAPSHOT_UNAVAILABLE'
    )
    return
  }

  // Provenance is a sidecar: its absence degrades the evidence panel, it does
  // not invalidate the graph. It is reported as unavailable, never invented.
  let provenance = null
  try {
    provenance = await loadJson('/provenance.json')
  } catch {
    provenance = null
  }

  try {
    state.viewModel = buildViewModel(snapshot, provenance)
  } catch (error) {
    showFailure(
      'Snapshot refused',
      'The snapshot loaded but violates the gbrain-read/v1 graph contract, so it is not rendered.',
      error.code ?? 'E_VIEW_MODEL_INVALID'
    )
    return
  }

  // Colour lives in tokens.css and nowhere else, including for the GPU.
  try {
    const computed = getComputedStyle(document.documentElement)
    state.palette = resolvePalette((token) => computed.getPropertyValue(token))
  } catch (error) {
    showFailure(
      'Design tokens unreadable',
      `The stage cannot be painted because its design tokens did not resolve: ${error.message}`,
      error.code ?? 'E_PALETTE_INVALID'
    )
    return
  }

  try {
    createSurface()
  } catch (error) {
    showFailure(
      'Renderer unavailable',
      'The graph stage needs WebGL and this browser did not provide it. The graph is not drawn in any other form, because a substitute renderer would not be the graph you asked for.',
      error.code ?? E_WEBGL_UNAVAILABLE
    )
    return
  }

  state.transform = resetTransform(state.world)
  paintStatus()

  // Whether a saved view can be stored at all is a property of the browser, not
  // of the graph, so it is settled once here and reported as it is. A workspace
  // that offered "Save view" and then did nothing would be the quiet failure
  // this slice exists to remove.
  state.store = openStore()
  // openStore() proves the store is WRITABLE, which is not the same as
  // readable: an engine that accepts the probe write and refuses getItem gets a
  // store back and then throws on this read. That throw sits between
  // openStore() and wireEvents()/render() inside a boot() that is called bare,
  // so it would take the whole workspace down silently — no graph, no
  // showFailure panel, data-stage neither `ready` nor `failed`, which is the
  // quiet dead workspace the comment above says this slice exists to remove.
  // onRestoreView refuses the identical `state.store.getItem(SAVED_VIEW_KEY)`
  // call with E_SAVED_VIEW_STORAGE rather than letting it escape; so does this.
  let storeRefusedRead = false
  if (state.store !== null) {
    try {
      state.savedViewPresent = typeof state.store.getItem(SAVED_VIEW_KEY) === 'string'
    } catch {
      storeRefusedRead = true
    }
  }
  // A store the browser refused OUTRIGHT is `refused` for the same reason a
  // refused read is: `none` means "confirmed absent", which is what
  // onClearSavedView writes after really clearing the slot, and neither refusal
  // can back that claim. It is also the harder of the two — no view can be
  // saved at all — and `body[data-saved-view="refused"] .a39-saved-view-state`
  // (shell.css) is the one rule that marks a refusal visually, so leaving this
  // branch out rendered the worse case in the same muted colour as the benign
  // "No saved view." onSaveView refuses the identical `state.store === null`
  // through refuseSavedView, which writes `refused`; one file must not report
  // one fact two ways.
  dom.body.dataset.savedView =
    state.store === null || storeRefusedRead ? 'refused' : state.savedViewPresent ? 'saved' : 'none'
  dom.savedViewState.textContent = state.store === null
    ? 'This browser did not allow the workspace to store a saved view.'
    : storeRefusedRead
      ? 'This browser did not allow the workspace to read a saved view.'
      : state.savedViewPresent ? 'A saved view is stored.' : 'No saved view.'

  wireEvents()
  render()
  if (state.failed) return
  // A definite, observable outcome. An acceptance run must be able to wait for
  // "the stage settled" instead of sleeping and hoping, and the two possible
  // values are the two honest ones: it drew, or it refused.
  dom.body.dataset.stage = 'ready'
  announce(`Graph loaded. ${state.viewModel.counts.nodes} nodes, ${state.viewModel.counts.edges} relations. Rendered with ${state.stage.contextType}.`)
}

boot()

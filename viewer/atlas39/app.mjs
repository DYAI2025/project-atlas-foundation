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
  statGenerated: el('stat-generated')
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
  failed: false
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

function announce(message) {
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
  for (const control of [dom.clearFocus, dom.filter, dom.zoomIn, dom.zoomOut, dom.resetView]) {
    if (control) control.disabled = true
  }
  dom.body.dataset.stage = 'failed'
  announce(`${headline} ${detail}`)
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

function levelCaption(depth) {
  if (depth === null) return 'No hierarchy path'
  return depth === 0 ? 'Root' : `Level ${depth}`
}

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
      group.textContent = levelCaption(node.depth)
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
  fact(facts, 'Hierarchy', levelCaption(node.depth))

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
  const vm = state.viewModel
  const viewport = stageViewport()
  const layout = computeLayout(vm, viewport)
  state.layout = layout
  state.world = { width: layout.width, height: layout.height }
  state.transform = clampTransform(state.transform, state.world)

  const scene = buildScene(vm, layout, selectFocus(vm, state.focusId))
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

function render() {
  if (state.failed) return
  // A refused stage has already painted the failure state over every region;
  // repainting the navigator and inspector on top of it would re-introduce
  // exactly the "there is a graph here" impression the refusal exists to deny.
  if (!paintStage()) return
  paintNavigator()
  paintInspector()
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
  state.focusId = known ? nodeId : null
  state.restoreStageFocus = known && moveStageFocus

  // Focusing a node that the current pan has pushed off screen is the same
  // defect as losing the graph, so a focus that came from the navigator or from
  // a search brings the node back into view — but only when it actually needs it.
  if (known && center && state.layout) {
    const placement = state.layout.placements.find((p) => p.node_id === nodeId)
    if (placement && isOffStage(placement)) {
      state.transform = centerOn(state.transform, placement.x, placement.y, state.world)
    }
  }

  render()
  if (quiet) return
  if (!known) {
    announce('Focus cleared. Showing the whole graph.')
    return
  }
  const node = vm.nodes.find((n) => n.node_id === nodeId)
  announce(`${node.label} focused. ${levelCaption(node.depth)}. ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}.`)
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
  const vm = state.viewModel
  const order = vm.nodes.map((n) => n.node_id)
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
    case 'Home':
      event.preventDefault()
      setFocus(state.viewModel.nodes[0].node_id, { center: true })
      return
    case 'End':
      event.preventDefault()
      setFocus(state.viewModel.nodes.at(-1).node_id, { center: true })
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
  if (result.firstMatchId) {
    setFocus(result.firstMatchId, { moveStageFocus: false, quiet: true, center: true })
  }
  announce(searchAnnouncement(result))
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
  const DRAG_THRESHOLD = 4
  let gesture = null
  let suppressClick = false

  // Capture phase, so this runs before the node button's own click handler.
  dom.stageHost.addEventListener('click', (event) => {
    if (!suppressClick) return
    suppressClick = false
    event.stopPropagation()
    event.preventDefault()
  }, true)

  dom.stageHost.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (event.target.closest?.('.a39-stage-controls')) return
    suppressClick = false
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false }
  })

  dom.stageHost.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.id) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (!gesture.panning) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      gesture.panning = true
      suppressClick = true
      dom.stageHost.setPointerCapture?.(event.pointerId)
      dom.body.dataset.panning = 'true'
    }
    gesture.x = event.clientX
    gesture.y = event.clientY
    applyTransform(panBy(state.transform, dx, dy, state.world))
  })

  const endPan = (event) => {
    if (!gesture || event.pointerId !== gesture.id) return
    if (gesture.panning) dom.stageHost.releasePointerCapture?.(gesture.id)
    gesture = null
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

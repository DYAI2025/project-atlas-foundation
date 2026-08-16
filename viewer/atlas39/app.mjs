// ATLAS-39 workspace shell — browser wiring only.
//
// This module deliberately contains NO graph logic. Everything that decides
// what the graph is, where it sits and how it looks lives in ./core/, which is
// loaded byte-identically by `node --test`. What is left here is the part a
// test cannot meaningfully own: fetching, mounting, events and focus movement.
//
// Two rules this file must never break:
//   1. If the snapshot cannot be loaded or is refused by the view model, the
//      shell shows a failure state. It never falls back to a fixture, a cached
//      graph or an empty stage that would read as "this project has no graph".
//   2. Missing provenance is displayed as missing.

import { buildViewModel, selectFocus } from './core/view-model.mjs'
import { computeLayout } from './core/layout.mjs'
import { renderStage } from './core/render-svg.mjs'

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
  live: el('live'),
  chipProject: el('chip-project'),
  chipSource: el('chip-source'),
  statCounts: el('stat-counts'),
  statContract: el('stat-contract'),
  statScheme: el('stat-scheme'),
  statProvenance: el('stat-provenance'),
  statGenerated: el('stat-generated')
}

const state = {
  viewModel: null,
  focusId: null,
  filter: '',
  restoreStageFocus: false
}

const PROVENANCE_TEXT = {
  complete: 'complete',
  partial: 'partial — some pages missing',
  unavailable: 'unavailable'
}

function announce(message) {
  dom.live.textContent = message
}

function showFailure(headline, detail, code) {
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
  dom.clearFocus.disabled = true
  dom.filter.disabled = true
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
  const needle = state.filter.trim().toLowerCase()
  const visible = needle === ''
    ? vm.nodes
    : vm.nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.source_ref.includes(needle))

  dom.nodelist.replaceChildren()
  if (visible.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'a39-empty'
    empty.textContent = 'No node matches this filter.'
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
    button.addEventListener('click', () => setFocus(node.node_id, { moveStageFocus: false }))
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
      button.addEventListener('click', () => setFocus(neighbour.node_id, { moveStageFocus: false }))
      item.append(button)
      list.append(item)
    }
    frag.append(list)
  }

  dom.inspectorBody.replaceChildren(frag)
}

/* ---------- stage ---------- */

function stageViewport() {
  const rect = dom.stage.getBoundingClientRect()
  return {
    width: Math.max(320, Math.round(rect.width) || 1440),
    height: Math.max(280, Math.round(rect.height) || 900)
  }
}

function paintStage() {
  const vm = state.viewModel
  const layout = computeLayout(vm, stageViewport())
  dom.stageHost.innerHTML = renderStage(vm, layout, selectFocus(vm, state.focusId), {})
  if (state.restoreStageFocus) {
    state.restoreStageFocus = false
    dom.stageHost.querySelector('.a39-node[tabindex="0"]')?.focus()
  }
}

function render() {
  paintStage()
  paintNavigator()
  paintInspector()
  dom.clearFocus.disabled = state.focusId === null
}

function setFocus(nodeId, { moveStageFocus = true, quiet = false } = {}) {
  const vm = state.viewModel
  const known = vm.nodes.some((n) => n.node_id === nodeId)
  state.focusId = known ? nodeId : null
  state.restoreStageFocus = known && moveStageFocus
  render()
  if (quiet) return
  if (!known) {
    announce('Focus cleared. Showing the whole graph.')
    return
  }
  const node = vm.nodes.find((n) => n.node_id === nodeId)
  announce(`${node.label} focused. ${levelCaption(node.depth)}. ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}.`)
}

/* ---------- events ---------- */

function stepFocus(delta) {
  const vm = state.viewModel
  const order = vm.nodes.map((n) => n.node_id)
  const current = order.indexOf(state.focusId)
  const next = current === -1
    ? (delta > 0 ? 0 : order.length - 1)
    : (current + delta + order.length) % order.length
  setFocus(order[next])
}

function onStageKeydown(event) {
  const host = event.target.closest?.('.a39-node')
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
      stepFocus(1)
      return
    case 'ArrowLeft':
    case 'ArrowUp':
      event.preventDefault()
      stepFocus(-1)
      return
    case 'Home':
      event.preventDefault()
      setFocus(state.viewModel.nodes[0].node_id)
      return
    case 'End':
      event.preventDefault()
      setFocus(state.viewModel.nodes.at(-1).node_id)
      return
    case 'Escape':
      if (state.focusId === null) return
      event.preventDefault()
      setFocus(null)
      dom.stage.focus()
  }
}

function wireEvents() {
  dom.stageHost.addEventListener('click', (event) => {
    const host = event.target.closest?.('.a39-node')
    if (host) setFocus(host.dataset.nodeId)
  })
  dom.stageHost.addEventListener('keydown', onStageKeydown)

  dom.clearFocus.addEventListener('click', () => setFocus(null))

  dom.filter.addEventListener('input', () => {
    state.filter = dom.filter.value
    paintNavigator()
  })

  dom.inspectorToggle.addEventListener('click', () => {
    const open = dom.body.dataset.inspector !== 'open'
    dom.body.dataset.inspector = open ? 'open' : 'closed'
    dom.inspectorToggle.setAttribute('aria-expanded', String(open))
  })

  let frame = 0
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => paintStage())
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

  paintStatus()
  wireEvents()
  render()
  announce(`Graph loaded. ${state.viewModel.counts.nodes} nodes, ${state.viewModel.counts.edges} relations.`)
}

boot()

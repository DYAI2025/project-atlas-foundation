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
  // This is the guard Task 4 leans on: a saved view arrives as the output of
  // JSON.parse, where null, an array, a string and a number are the realistic
  // inputs. Every refusal in this slice is a VALUE — a TypeError here would be
  // a crash at the one seam that exists to fail closed.
  for (const descriptor of [null, undefined, [], ['overview'], 'overview', 42, true]) {
    const result = applyView(vm, descriptor)
    assert.equal(result.ok, false, `${JSON.stringify(descriptor)} was accepted`)
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
  const forbiddenTokens = [
    // clock
    'Date.', 'Date(', 'performance.', 'setTimeout', 'setInterval',
    // randomness
    'Math.random', 'crypto',
    // DOM
    'document', 'window', 'localStorage',
    // IO and the ambient routes that reach all three around the tokens above
    'fetch(', 'node:', 'require(', 'process.', 'globalThis'
  ]
  for (const forbidden of forbiddenTokens) {
    assert.equal(source.includes(forbidden), false, `view-state.mjs references ${forbidden}`)
  }
})

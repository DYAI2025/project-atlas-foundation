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

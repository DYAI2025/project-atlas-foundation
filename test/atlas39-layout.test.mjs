// ATLAS-39: the layout is deliberately a deterministic radial hierarchy, not a
// force simulation. A force layout would move on every reload, which would make
// the golden visual verification meaningless and would quietly consume the
// ATLAS-40 renderer scope. Every coordinate here is a pure function of the
// snapshot plus the viewport, quantised to integers so the golden output cannot
// drift on floating-point noise between platforms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const readEvidence = (name) => JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8'))
const realViewModel = () => buildViewModel(readEvidence('graph-snapshot.json'), readEvidence('provenance.json'))

const VIEWPORT = { width: 1440, height: 900 }
const ROOT = 'ATLAS:confluence:14778372:14778372'
const SPRINT = 'ATLAS:confluence:14778372:22478849'

test('every node is placed exactly once', () => {
  const vm = realViewModel()
  const layout = computeLayout(vm, VIEWPORT)
  assert.equal(layout.placements.length, 5)
  assert.deepEqual(
    layout.placements.map((p) => p.node_id).slice().sort(),
    vm.nodes.map((n) => n.node_id).slice().sort()
  )
})

test('the layout is deterministic — repeated runs are identical', () => {
  const a = computeLayout(realViewModel(), VIEWPORT)
  const b = computeLayout(realViewModel(), VIEWPORT)
  assert.deepEqual(b.placements, a.placements)
  assert.deepEqual(b.rings, a.rings)
})

test('all coordinates are integers so the golden output cannot drift on rounding', () => {
  const layout = computeLayout(realViewModel(), VIEWPORT)
  for (const p of layout.placements) {
    assert.equal(Number.isInteger(p.x), true, `${p.node_id} x=${p.x}`)
    assert.equal(Number.isInteger(p.y), true, `${p.node_id} y=${p.y}`)
    assert.equal(Number.isInteger(p.r), true, `${p.node_id} r=${p.r}`)
  }
  for (const ring of layout.rings) assert.equal(Number.isInteger(ring.radius), true)
})

test('the single hierarchy root sits at the centre of the stage', () => {
  const layout = computeLayout(realViewModel(), VIEWPORT)
  const root = layout.placements.find((p) => p.node_id === ROOT)
  assert.equal(root.x, layout.center.x)
  assert.equal(root.y, layout.center.y)
  assert.equal(root.depth, 0)
})

test('nodes of the same depth share one ring radius', () => {
  const layout = computeLayout(realViewModel(), VIEWPORT)
  const depthOne = layout.placements.filter((p) => p.depth === 1)
  assert.equal(depthOne.length, 3)
  assert.equal(new Set(depthOne.map((p) => p.ringRadius)).size, 1)
  const depthTwo = layout.placements.filter((p) => p.depth === 2)
  assert.equal(depthTwo.length, 1)
  assert.ok(depthTwo[0].ringRadius > depthOne[0].ringRadius, 'deeper nodes must sit further out')
  // The declared ring radius must actually describe where the node was drawn;
  // integer quantisation is allowed to move it by at most one pixel.
  for (const p of layout.placements.filter((q) => q.ringRadius > 0)) {
    const measured = Math.hypot(p.x - layout.center.x, p.y - layout.center.y)
    assert.ok(Math.abs(measured - p.ringRadius) <= 1, `${p.node_id} measured ${measured} vs ${p.ringRadius}`)
  }
})

test('rings are reported so the stage can draw the hierarchy as space', () => {
  const layout = computeLayout(realViewModel(), VIEWPORT)
  assert.deepEqual(layout.rings.map((r) => r.depth), [1, 2])
  assert.ok(layout.rings[0].radius < layout.rings[1].radius)
})

test('node size grows with degree so the hub reads as the hub', () => {
  const layout = computeLayout(realViewModel(), VIEWPORT)
  const size = (id) => layout.placements.find((p) => p.node_id === id).r
  assert.ok(size(ROOT) > size(SPRINT))
})

test('every placed node stays inside the stage bounds', () => {
  for (const viewport of [VIEWPORT, { width: 1024, height: 768 }, { width: 640, height: 520 }]) {
    const layout = computeLayout(realViewModel(), viewport)
    for (const p of layout.placements) {
      assert.ok(p.x - p.r >= 0 && p.x + p.r <= viewport.width, `${p.node_id} out of bounds in x`)
      assert.ok(p.y - p.r >= 0 && p.y + p.r <= viewport.height, `${p.node_id} out of bounds in y`)
    }
  }
})

test('a narrower viewport rescales without reordering the ring', () => {
  const wide = computeLayout(realViewModel(), VIEWPORT)
  const narrow = computeLayout(realViewModel(), { width: 900, height: 700 })
  const angularOrder = (layout) =>
    layout.placements
      .filter((p) => p.depth === 1)
      .slice()
      .sort((a, b) => Math.atan2(a.y - layout.center.y, a.x - layout.center.x) - Math.atan2(b.y - layout.center.y, b.x - layout.center.x))
      .map((p) => p.node_id)
  assert.deepEqual(angularOrder(narrow), angularOrder(wide))
})

test('a node with no hierarchy path is placed on the explicit unrooted ring', () => {
  const snapshot = readEvidence('graph-snapshot.json')
  snapshot.edges = snapshot.edges.filter((e) => e.to !== SPRINT)
  const vm = buildViewModel(snapshot, readEvidence('provenance.json'))
  const layout = computeLayout(vm, VIEWPORT)
  const orphan = layout.placements.find((p) => p.node_id === SPRINT)
  assert.equal(orphan.depth, null)
  assert.equal(orphan.unrooted, true)
  assert.equal(layout.rings.at(-1).unrooted, true)
})

test('a single-node graph degrades to a centred node without dividing by zero', () => {
  const vm = buildViewModel(
    {
      contract_version: '1.0.0',
      project_id: 'ATLAS',
      id_scheme: 'projection-local/v1',
      canonical_entity_ids: false,
      source: { source_kind: 'confluence', source_id: '14778372' },
      nodes: [{ node_id: 'ATLAS:confluence:14778372:1', source_ref: '1', label: 'only' }],
      edges: []
    },
    null
  )
  const layout = computeLayout(vm, VIEWPORT)
  assert.equal(layout.placements.length, 1)
  assert.equal(layout.placements[0].x, layout.center.x)
  assert.equal(Number.isFinite(layout.placements[0].y), true)
})

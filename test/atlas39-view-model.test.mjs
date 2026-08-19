// ATLAS-39: the workspace view model is the single place where the accepted
// gbrain-read/v1 snapshot becomes something a UI can draw. It is deliberately
// pure and fail-closed: every structural defect that the shell would otherwise
// have to paper over becomes a thrown E_VIEW_MODEL_INVALID, and missing
// provenance is represented as missing — never inferred, never back-filled.
// The fixtures here are the REAL committed ATLAS-65 evidence, not synthetic data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, neighboursOf, selectFocus } from '../viewer/atlas39/core/view-model.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const readEvidence = (name) => JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8'))
const realSnapshot = () => readEvidence('graph-snapshot.json')
const realProvenance = () => readEvidence('provenance.json')

const ROOT = 'ATLAS:confluence:14778372:14778372'
const SPRINT = 'ATLAS:confluence:14778372:22478849'
const DELIVERY = 'ATLAS:confluence:14778372:15171611'

test('builds from the real committed ATLAS-65 evidence', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  assert.equal(vm.project_id, 'ATLAS')
  assert.equal(vm.source.source_kind, 'confluence')
  assert.equal(vm.source.source_id, '14778372')
  assert.equal(vm.id_scheme, 'projection-local/v1')
  assert.equal(vm.canonical_entity_ids, false)
  assert.equal(vm.counts.nodes, 5)
  assert.equal(vm.counts.edges, 4)
})

test('derives hierarchy depth from explicit parent_of edges only', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  const depth = (id) => vm.nodes.find((n) => n.node_id === id).depth
  assert.equal(depth(ROOT), 0)
  assert.equal(depth('ATLAS:confluence:14778372:14680066'), 1)
  assert.equal(depth('ATLAS:confluence:14778372:15073290'), 1)
  assert.equal(depth(DELIVERY), 1)
  assert.equal(depth(SPRINT), 2)
  assert.equal(vm.counts.maxDepth, 2)
})

test('a node reachable by no parent_of edge keeps depth null instead of a guessed level', () => {
  const snapshot = realSnapshot()
  snapshot.edges = snapshot.edges.filter((e) => e.to !== SPRINT)
  const vm = buildViewModel(snapshot, realProvenance())
  assert.equal(vm.nodes.find((n) => n.node_id === SPRINT).depth, null)
})

test('degree counts every incident edge', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  const degree = (id) => vm.nodes.find((n) => n.node_id === id).degree
  assert.equal(degree(ROOT), 3)
  assert.equal(degree(DELIVERY), 2)
  assert.equal(degree(SPRINT), 1)
})

test('neighbours resolve in both edge directions', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  assert.deepEqual([...neighboursOf(vm, SPRINT)], [DELIVERY])
  assert.equal(neighboursOf(vm, ROOT).size, 3)
  assert.equal(neighboursOf(vm, 'not-a-node').size, 0)
})

test('provenance is merged onto nodes by source_ref', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  const root = vm.nodes.find((n) => n.node_id === ROOT)
  assert.equal(vm.provenanceStatus, 'complete')
  assert.equal(root.provenance.version, 3)
  assert.equal(root.provenance.confluence_url, 'https://dyai2026.atlassian.net/wiki/spaces/PRODUKTMAN/pages/14778372')
  assert.equal(vm.provenanceGeneratedAt, '2026-08-14T22:48:03.379Z')
})

test('absent provenance is reported as unavailable, never fabricated', () => {
  const vm = buildViewModel(realSnapshot(), null)
  assert.equal(vm.provenanceStatus, 'unavailable')
  assert.equal(vm.provenanceGeneratedAt, null)
  for (const n of vm.nodes) assert.equal(n.provenance, null)
})

test('a provenance sidecar missing one page yields partial status and a null on that node', () => {
  const provenance = realProvenance()
  provenance.pages = provenance.pages.filter((p) => p.page_id !== '22478849')
  const vm = buildViewModel(realSnapshot(), provenance)
  assert.equal(vm.provenanceStatus, 'partial')
  assert.equal(vm.nodes.find((n) => n.node_id === SPRINT).provenance, null)
  assert.notEqual(vm.nodes.find((n) => n.node_id === ROOT).provenance, null)
})

test('a malformed snapshot is refused, not rendered', () => {
  for (const mutate of [
    (s) => { delete s.nodes },
    (s) => { s.nodes = 'not-an-array' },
    (s) => { s.canonical_entity_ids = true },
    (s) => { s.id_scheme = 'canonical/v9' },
    (s) => { s.contract_version = '2.0.0' },
    (s) => { delete s.source }
  ]) {
    const snapshot = realSnapshot()
    mutate(snapshot)
    assert.throws(() => buildViewModel(snapshot, realProvenance()), (e) => e.code === 'E_VIEW_MODEL_INVALID')
  }
})

test('a dangling edge endpoint is refused', () => {
  const snapshot = realSnapshot()
  snapshot.edges[0].to = 'ATLAS:confluence:14778372:999999999'
  assert.throws(() => buildViewModel(snapshot, realProvenance()), (e) => e.code === 'E_VIEW_MODEL_INVALID')
})

test('an inferred edge is refused — the shell never displays a generated relation', () => {
  const snapshot = realSnapshot()
  snapshot.edges[0].origin = 'inferred'
  assert.throws(() => buildViewModel(snapshot, realProvenance()), (e) => e.code === 'E_VIEW_MODEL_INVALID')
})

test('a duplicate node_id is refused', () => {
  const snapshot = realSnapshot()
  snapshot.nodes.push({ ...snapshot.nodes[0] })
  assert.throws(() => buildViewModel(snapshot, realProvenance()), (e) => e.code === 'E_VIEW_MODEL_INVALID')
})

test('node order is derived from the data, not from input order', () => {
  const forward = buildViewModel(realSnapshot(), realProvenance())
  const shuffled = realSnapshot()
  shuffled.nodes.reverse()
  shuffled.edges.reverse()
  const reversed = buildViewModel(shuffled, realProvenance())
  assert.deepEqual(reversed.nodes.map((n) => n.node_id), forward.nodes.map((n) => n.node_id))
  assert.deepEqual(reversed.edges.map((e) => e.edge_id), forward.edges.map((e) => e.edge_id))
})

test('focus selection separates focus, neighbours and the rest', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  const focus = selectFocus(vm, DELIVERY)
  assert.equal(focus.focusId, DELIVERY)
  assert.equal(focus.neighbourIds.size, 2)
  assert.ok(focus.neighbourIds.has(ROOT))
  assert.ok(focus.neighbourIds.has(SPRINT))
  assert.equal(focus.hasFocus, true)
})

test('an unknown or absent focus id yields the neutral overview state', () => {
  const vm = buildViewModel(realSnapshot(), realProvenance())
  for (const id of [null, undefined, 'nope']) {
    const focus = selectFocus(vm, id)
    assert.equal(focus.hasFocus, false)
    assert.equal(focus.focusId, null)
    assert.equal(focus.neighbourIds.size, 0)
  }
})

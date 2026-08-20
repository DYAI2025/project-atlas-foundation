// ATLAS-40 slice 2 repair: the graph fingerprint that makes a saved view's
// identity about CONTENT rather than about cardinality.
//
// The property under test is two-sided and both sides matter. Too weak and a
// moved page restores as if nothing had changed — the defect this module was
// written for. Too strong and an edited page title refuses a restore that is in
// fact perfectly reproducible, which trains a user to ignore the refusal. So
// every input is pinned as an input, and every deliberate NON-input is pinned
// as a non-input.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import {
  graphFingerprint,
  canonicalGraphString,
  GRAPH_FINGERPRINT_ALGORITHM
} from '../viewer/atlas39/core/graph-fingerprint.mjs'
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

// A witness graph, not a claim about ATLAS content: it exists so the properties
// below can be stated on a shape small enough to read.
const witness = () => ({
  nodes: [{ node_id: 'n1' }, { node_id: 'n2' }, { node_id: 'n3' }],
  edges: [
    { edge_id: 'e1', from: 'n1', to: 'n2', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'e2', from: 'n1', to: 'n3', relation_type: 'parent_of', origin: 'explicit' }
  ]
})
const changed = (mutate) => {
  const model = witness()
  mutate(model)
  return graphFingerprint(model) !== graphFingerprint(witness())
}

test('the accepted ATLAS snapshot has a pinned fingerprint', () => {
  // A literal, so a change to the construction is a red test rather than a
  // silently different value that still "looks deterministic". Every saved view
  // ever written by this build carries exactly this string.
  assert.equal(graphFingerprint(vm), 'fnv1a128/1:4a04facb97b5b1340f2bf40a280a8b3c')
})

test('the algorithm names itself, so a future construction cannot look like a match', () => {
  assert.equal(GRAPH_FINGERPRINT_ALGORITHM, 'fnv1a128/1')
  assert.equal(graphFingerprint(vm).startsWith(`${GRAPH_FINGERPRINT_ALGORITHM}:`), true)
  // 128 bits as hex, after the algorithm tag and its colon.
  assert.match(graphFingerprint(vm), /^fnv1a128\/1:[0-9a-f]{32}$/)
})

test('the same graph fingerprints the same, every time', () => {
  assert.equal(new Set([graphFingerprint(vm), graphFingerprint(vm), graphFingerprint(vm)]).size, 1)
  assert.equal(graphFingerprint(witness()), graphFingerprint(witness()))
})

test('the fingerprint does not depend on node or edge order', () => {
  const reversed = witness()
  reversed.nodes.reverse()
  reversed.edges.reverse()
  assert.equal(graphFingerprint(reversed), graphFingerprint(witness()))

  const real = JSON.parse(JSON.stringify({ nodes: vm.nodes, edges: vm.edges }))
  real.nodes.reverse()
  real.edges = [real.edges[2], real.edges[0], real.edges[3], real.edges[1]]
  assert.equal(graphFingerprint(real), graphFingerprint(vm))
})

test('node membership is bound', () => {
  assert.equal(changed((m) => m.nodes.pop()), true, 'a removed node did not change the fingerprint')
  assert.equal(changed((m) => m.nodes.push({ node_id: 'n4' })), true, 'an added node did not change it')
  assert.equal(changed((m) => { m.nodes[0].node_id = 'renamed' }), true, 'a renamed node id did not change it')
})

test('edge endpoints, relation type and origin are all bound', () => {
  assert.equal(changed((m) => { m.edges[0].to = 'n3' }), true, 'a moved edge target did not change it')
  assert.equal(changed((m) => { m.edges[0].from = 'n2' }), true, 'a moved edge source did not change it')
  assert.equal(changed((m) => { m.edges[0].relation_type = 'relates_to' }), true, 'relation_type is not bound')
  assert.equal(changed((m) => { m.edges[0].origin = 'inferred' }), true, 'origin is not bound')
  assert.equal(changed((m) => m.edges.pop()), true, 'a removed edge did not change it')
})

test('a re-parent is caught even when the edge keeps its identifier', () => {
  // The realistic re-scan: Confluence moves a page, the projection keeps the
  // same edge_id, only `from` moves. If the fingerprint read edge_id instead of
  // the endpoints, this is the case it would miss.
  const moved = witness()
  moved.edges[1].from = 'n2'
  assert.notEqual(graphFingerprint(moved), graphFingerprint(witness()))
  assert.equal(moved.edges[1].edge_id, witness().edges[1].edge_id, 'the edge_id was supposed to stay put')
})

test('presentation facts are deliberately NOT bound', () => {
  // Binding these would refuse a restore that is perfectly reproducible. A
  // retitled page is the same graph for the purpose of resolving a view, and
  // depth and degree are derived from the edges that ARE bound.
  assert.equal(changed((m) => { m.nodes[0].label = 'Renamed page' }), false, 'label must not be bound')
  assert.equal(changed((m) => { m.nodes[0].depth = 99 }), false, 'depth must not be bound')
  assert.equal(changed((m) => { m.nodes[0].degree = 99 }), false, 'degree must not be bound')
  assert.equal(changed((m) => { m.nodes[0].provenance = { page: 'x' } }), false, 'provenance must not be bound')
  assert.equal(changed((m) => { m.edges[0].edge_id = 'zzz' }), false, 'edge_id must not be bound')
})

test('a permutation of the same edges is the SAME graph, not a different one', () => {
  // Both edges leave n1, so exchanging their targets produces the identical
  // edge multiset. Refusing a restore here would be a false alarm: nothing a
  // view can resolve to has changed. This is the boundary between "order does
  // not matter" and "content does".
  const permuted = witness()
  const first = permuted.edges[0].to
  permuted.edges[0].to = permuted.edges[1].to
  permuted.edges[1].to = first
  assert.equal(graphFingerprint(permuted), graphFingerprint(witness()))
})

test('framing is injective, so no separator can be smuggled through a field', () => {
  // A plain separator would let two different graphs spell the same string.
  // This is not hypothetical in this codebase: the edge legend shipped with
  // exactly this defect across its relation_type/origin key boundary.
  const a = canonicalGraphString({ nodes: [{ node_id: 'a:b' }, { node_id: 'c' }], edges: [] })
  const b = canonicalGraphString({ nodes: [{ node_id: 'a' }, { node_id: 'b:c' }], edges: [] })
  assert.notEqual(a, b)

  const one = canonicalGraphString({
    nodes: [], edges: [{ from: 'x', to: 'y', relation_type: 'p_of', origin: 'ex' }]
  })
  const two = canonicalGraphString({
    nodes: [], edges: [{ from: 'x', to: 'y', relation_type: 'p', origin: '_ofex' }]
  })
  assert.notEqual(one, two)

  // And a value that merely PRINTS like a string cannot frame like that string.
  assert.notEqual(
    canonicalGraphString({ nodes: [{ node_id: '7' }], edges: [] }),
    canonicalGraphString({ nodes: [{ node_id: 7 }], edges: [] })
  )
})

test('a malformed model cannot fingerprint as a genuinely empty graph', () => {
  const empty = graphFingerprint({ nodes: [], edges: [] })
  assert.notEqual(graphFingerprint({}), empty)
  assert.notEqual(graphFingerprint({ nodes: [] }), empty)
  assert.notEqual(graphFingerprint({ edges: [] }), empty)
  // and it answers rather than throwing, the way every refusal in the
  // saved-view contract is a value.
  assert.equal(typeof graphFingerprint(null), 'string')
  assert.equal(typeof graphFingerprint(undefined), 'string')
})

test('the canonical string states what is bound, so the hash is not the only witness', () => {
  // A hash test alone cannot tell "relation_type is an input" from
  // "relation_type is ignored and something else happened to change".
  const canonical = canonicalGraphString(witness())
  for (const bound of ['n1', 'n2', 'n3', 'parent_of', 'explicit']) {
    assert.equal(canonical.includes(bound), true, `${bound} is not in the canonical string`)
  }
  for (const unbound of ['e1', 'e2']) {
    assert.equal(canonical.includes(unbound), false, `${unbound} leaked into the canonical string`)
  }
})

test('the module carries no clock, randomness or DOM, sorts by code unit, and imports nothing', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/graph-fingerprint.mjs'), 'utf8')
  const code = stripComments(source)
  assert.match(code, /export function graphFingerprint/, 'the comment strip removed graphFingerprint')
  assert.match(code, /export function canonicalGraphString/, 'the comment strip removed canonicalGraphString')

  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(code.includes(forbidden), false, `graph-fingerprint.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(code, new RegExp(`\\b${forbidden}\\b`), `it references the bare identifier ${forbidden}`)
  }
  // This module is the strict case: unlike every other pure core module it has
  // no allowed import at all, so the shared guard runs over it unmodified.
  assert.doesNotMatch(code, MODULE_SPECIFIER, 'graph-fingerprint.mjs imports from a module specifier')
  assert.deepEqual(purityViolations(code), [], 'the purity rules disagree with each other')

  // Locale-dependent ordering would make the same graph fingerprint differently
  // in two browsers, which is the one way a fingerprint can be worse than none.
  assert.equal(code.includes('localeCompare'), false, 'it sorts by locale')
})

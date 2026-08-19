// ATLAS-40 slice 2 / AC7: a legend that explains only what is really drawn.
//
// Slice 1 shipped three fixed rows of markup — "Root / Level 1 / Level 2". At
// five real nodes it happened to be accurate. It was still a claim the
// application could not lose: a snapshot with four levels, with unrooted pages,
// or with no hierarchy at all would have produced the same three rows.
//
// The accepted snapshot contains exactly ONE kind of relation: parent_of /
// explicit. The legend for it must therefore have exactly one row, and this
// suite exists mostly to prove the legend can say less than it does today.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import { applyView } from '../viewer/atlas39/core/view-state.mjs'
import { depthTokenName } from '../viewer/atlas39/core/scene.mjs'
import { buildEdgeLegend, edgeLegendNote, buildDepthLegend, depthCaption } from '../viewer/atlas39/core/legend.mjs'
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

const SPRINT = 'ATLAS:confluence:14778372:22478849'

/** A synthetic model, used ONLY to prove the legend follows the data it is given. */
const synthetic = (edges, nodes = vm.nodes) => ({ ...vm, nodes, edges })

test('the real accepted snapshot yields exactly one edge legend row', () => {
  const legend = buildEdgeLegend(vm)
  assert.equal(legend.entries.length, 1)
  assert.deepEqual(legend.entries[0], { relationType: 'parent_of', origin: 'explicit', count: 4 })
  assert.equal(legend.total, 4)
  assert.equal(legend.empty, false)
})

test('COUNTEREXAMPLE: a relation type that is not in the graph is never displayed', () => {
  const legend = buildEdgeLegend(vm)
  const shown = JSON.stringify(legend.entries)
  for (const invented of [
    'similar_to', 'related_to', 'mentions', 'links_to', 'derived_from',
    'inferred', 'mutual_knn', 'cluster_of', 'sibling_of', 'references'
  ]) {
    assert.equal(shown.includes(invented), false, `the legend invented ${invented}`)
  }
  // And nothing but the origin the contract admits.
  for (const entry of legend.entries) assert.equal(entry.origin, 'explicit')
})

test('the legend follows the data: a model with more types shows exactly those types', () => {
  const model = synthetic([
    { edge_id: 'c', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'a', from: 'a', to: 'b', relation_type: 'zzz_last', origin: 'explicit' },
    { edge_id: 'b', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'explicit' },
    { edge_id: 'd', from: 'a', to: 'b', relation_type: 'aaa_first', origin: 'explicit' }
  ])
  const legend = buildEdgeLegend(model)
  assert.deepEqual(legend.entries.map((e) => e.relationType), ['aaa_first', 'parent_of', 'zzz_last'])
  assert.deepEqual(legend.entries.map((e) => e.count), [1, 2, 1])
})

test('ordering is deterministic and independent of edge order', () => {
  const edges = [
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'b_type', origin: 'explicit' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'a_type', origin: 'explicit' },
    { edge_id: '3', from: 'a', to: 'b', relation_type: 'a_type', origin: 'derived' }
  ]
  const forward = buildEdgeLegend(synthetic(edges)).entries
  const backward = buildEdgeLegend(synthetic(edges.slice().reverse())).entries
  assert.deepEqual(forward, backward, 'insertion order changed the legend')
  // relationType first, then origin — both in code-unit order.
  assert.deepEqual(
    forward.map((e) => `${e.relationType}/${e.origin}`),
    ['a_type/derived', 'a_type/explicit', 'b_type/explicit']
  )
})

test('a view with no relations says so, and shows no row at all', () => {
  const legend = buildEdgeLegend(synthetic([]))
  assert.deepEqual(legend.entries, [])
  assert.equal(legend.empty, true)
  assert.equal(legend.total, 0)
  assert.equal(edgeLegendNote(legend), 'This view draws no relations.')
})

test('the legend does not claim an encoding the stage does not draw', () => {
  const one = buildEdgeLegend(vm)
  assert.equal(one.distinguishesTypes, false)
  assert.equal(one.encodingToken, '--line-strong')
  assert.equal(
    edgeLegendNote(one),
    'Every relation drawn here is parent_of (explicit); all are drawn with the same stroke.'
  )
  const many = buildEdgeLegend(synthetic([
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'x', origin: 'explicit' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'y', origin: 'explicit' }
  ]))
  assert.equal(
    edgeLegendNote(many),
    'All relation types are drawn with the same stroke; the stage does not tell them apart visually.'
  )
})

test('the legend describes the view on the stage, not the whole snapshot', () => {
  const applied = applyView(vm, { mode: 'neighbourhood', anchorId: SPRINT })
  const legend = buildEdgeLegend(applied.model)
  assert.equal(legend.total, 1, 'the legend counted edges that are not drawn')
  assert.equal(legend.entries[0].count, 1)
})

test('the hierarchy legend shows the depths that really occur, with the token that is really stroked', () => {
  const legend = buildDepthLegend(vm)
  assert.deepEqual(legend.entries.map((e) => e.depth), [0, 1, 2])
  assert.deepEqual(legend.entries.map((e) => e.count), [1, 3, 1])
  for (const entry of legend.entries) {
    assert.equal(entry.token, depthTokenName(entry.depth), 'the swatch token is not the stroked token')
  }
  assert.deepEqual(legend.entries.map((e) => depthCaption(e.depth)), ['Root', 'Level 1', 'Level 2'])
  assert.equal(legend.empty, false)
})

test('an absent depth is never displayed, and unrooted nodes sort last', () => {
  const nodes = [
    { node_id: 'a', source_ref: '1', label: 'a', depth: null, degree: 0, provenance: null },
    { node_id: 'b', source_ref: '2', label: 'b', depth: 4, degree: 0, provenance: null }
  ]
  const legend = buildDepthLegend(synthetic([], nodes))
  assert.deepEqual(legend.entries.map((e) => e.depth), [4, null])
  assert.deepEqual(legend.entries.map((e) => e.token), ['--depth-n', '--depth-none'])
  assert.deepEqual(legend.entries.map((e) => depthCaption(e.depth)), ['Level 4', 'No hierarchy path'])
  // Root / Level 1 / Level 2 are not in this graph and must not appear.
  const shown = JSON.stringify(legend.entries.map((e) => depthCaption(e.depth)))
  for (const absent of ['Root', 'Level 1', 'Level 2']) {
    assert.equal(shown.includes(absent), false, `the legend invented "${absent}"`)
  }

  // Two entries can only ever ask the comparator about ONE of its two null
  // branches, and V8 asks this pair through the `b.depth === null` branch alone:
  // measured, `if (a.depth === null) return b.depth === null ? 0 : 1` mutated to
  // `: -1` — a comparator that then contradicts itself — still yields [4, null]
  // here and survived the whole suite at exit 0, 12/12. It is not academic. The
  // same mutant reorders a realistic set: node order [2, null, 0, 1] came out
  // [0, 1, null, 2] and [0, 1, 2, null] came out [null, 0, 1, 2], putting
  // unrooted pages in the middle of the hierarchy rows and, in the second case,
  // above the root. So the rule is pinned over a set big enough to reach both
  // branches, from two different node orders, to also show the result does not
  // depend on the order the nodes happen to arrive in.
  const mk = (depth, i) => ({
    node_id: `n${i}`, source_ref: String(i), label: `n${i}`, depth, degree: 0, provenance: null
  })
  for (const order of [[2, null, 0, 1], [0, 1, 2, null], [null, 2, 0, 1]]) {
    const ordered = buildDepthLegend(synthetic([], order.map(mk)))
    assert.deepEqual(
      ordered.entries.map((e) => e.depth),
      [0, 1, 2, null],
      `node order ${JSON.stringify(order)} changed the hierarchy rows`
    )
  }

  // A graph with no nodes states that it has no hierarchy rather than showing a
  // row. `empty` is part of the contract the shell reads, and nothing else in
  // this file asked for it: `empty: entries.length === 0` mutated to
  // `empty: false` survived at exit 0, 12/12.
  const none = buildDepthLegend(synthetic([], []))
  assert.deepEqual(none.entries, [])
  assert.equal(none.empty, true)
})

test('two relation kinds that differ only across the separator stay two rows', () => {
  // buildEdgeLegend groups on a composite key, and the key's separator is the
  // one character a relation type must not be able to forge. The module joins on
  // NUL for that reason; nothing in the plan's suite could lose it. Measured:
  // the separator changed from `\u0000` to `|` survived at exit 0, 12/12, and on
  // the two edges below it does not merely merge the rows — it reports ONE row,
  // `parent_of|v2 (explicit)`, with count 2, attributing a relation kind to an
  // edge that does not have it. That is the invention AC7 exists to prevent,
  // so the property is asserted rather than left to a comment.
  const legend = buildEdgeLegend(synthetic([
    { edge_id: '1', from: 'a', to: 'b', relation_type: 'parent_of|v2', origin: 'explicit' },
    { edge_id: '2', from: 'a', to: 'b', relation_type: 'parent_of', origin: 'v2|explicit' }
  ]))
  assert.deepEqual(legend.entries, [
    { relationType: 'parent_of', origin: 'v2|explicit', count: 1 },
    { relationType: 'parent_of|v2', origin: 'explicit', count: 1 }
  ])
  assert.equal(legend.total, 2)
})

test('relation types are echoed exactly, never normalised or prettified', () => {
  const odd = 'parent_of/v2 (draft)'
  const legend = buildEdgeLegend(synthetic([{ edge_id: '1', from: 'a', to: 'b', relation_type: odd, origin: 'explicit' }]))
  assert.equal(legend.entries[0].relationType, odd)
})

// The purity guard is the shared one every pure-core suite is scanned with,
// imported rather than re-spelled. The plan's Task 5 drafted a private
// `source.includes(token)` list over the RAW file instead, and that draft could
// never pass: the module's own comment "deliberately not localeCompare" turns
// its own denylist red on a byte-identically pure file. Measured at 10/11
// before this repair, failing on `legend.mjs references localeCompare`.
const ALLOWED_IMPORT = "import { depthTokenName } from './scene.mjs'"

/**
 * Two rules that belong to THIS module and to no shared denylist, so they are
 * spelled here: D7 fixes the legend's order in code units, never in the process
 * locale's collation, and the legend returns data for the shell to place through
 * `textContent` rather than markup of its own. Both are checked over the
 * comment-free code, so the comment that explains the first may name it.
 */
const LEGEND_FORBIDDEN = ['localeCompare', 'innerHTML']

test('the module carries no clock, randomness or DOM, imports only the scene, and never localeCompare', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/legend.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function buildEdgeLegend/, 'the comment strip removed buildEdgeLegend')
  assert.match(code, /export function edgeLegendNote/, 'the comment strip removed edgeLegendNote')
  assert.match(code, /export function buildDepthLegend/, 'the comment strip removed buildDepthLegend')
  assert.match(code, /export function depthCaption/, 'the comment strip removed depthCaption')

  // The carve-out is narrowed to the one import rather than widened to a weaker
  // guard: that exact statement must appear exactly once, and the WHOLE shared
  // guard — `import` and MODULE_SPECIFIER included — then runs over everything
  // else, so a second import, static or dynamic, is still caught.
  assert.equal(
    code.split(ALLOWED_IMPORT).length - 1,
    1,
    'legend.mjs no longer imports exactly the depth token function, exactly once'
  )
  const body = code.replace(ALLOWED_IMPORT, '')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(body.includes(forbidden), false, `legend.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${forbidden}\\b`),
      `legend.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(body, MODULE_SPECIFIER, 'legend.mjs imports from a second module specifier')
  assert.deepEqual(purityViolations(body), [], 'the purity rules disagree with each other')
  for (const forbidden of LEGEND_FORBIDDEN) {
    assert.equal(body.includes(forbidden), false, `legend.mjs references ${forbidden}`)
  }
})

test('the encoding token the legend names is the token the stage really strokes a relation with', () => {
  // The legend states a token by NAME, and the shell paints its swatch with it.
  // Nothing else in this slice pins that name: D8's parity work covers the DEPTH
  // ladder only, so a repointed edge colour would leave the legend describing a
  // stroke the stage no longer draws — the swatch-drifts-from-the-stroke defect
  // D8 exists to prevent, one token over.
  //
  // Both drawing paths are pinned, because the stage has two: the WebGL renderer
  // strokes an idle relation with `palette.edgeIdle` (render-webgl.mjs:221-222),
  // which resolvePalette reads from the token named here, and the SVG/golden path
  // takes `.a39-edge { stroke: … }` from stage.css. Both files are on the
  // must-not-change list for this slice, so this reads them and changes nothing.
  const legend = buildEdgeLegend(vm)
  const sceneSource = readFileSync(join(repoRoot, 'viewer/atlas39/core/scene.mjs'), 'utf8')
  const edgeIdle = /\bedgeIdle:\s*'([^']+)'/.exec(sceneSource)
  assert.notEqual(edgeIdle, null, 'scene.mjs no longer resolves an `edgeIdle` palette entry')
  assert.equal(
    legend.encodingToken,
    edgeIdle[1],
    'the legend names a token the WebGL stage does not stroke an idle relation with'
  )

  const stageCss = readFileSync(join(repoRoot, 'viewer/atlas39/stage.css'), 'utf8')
  const edgeRule = /\.a39-edge\s*\{[^}]*\}/.exec(stageCss)
  assert.notEqual(edgeRule, null, 'stage.css no longer carries an .a39-edge rule')
  assert.match(
    edgeRule[0],
    new RegExp(`stroke:\\s*var\\(${legend.encodingToken}\\)`),
    'the legend names a token the SVG stage does not stroke a relation with'
  )
})

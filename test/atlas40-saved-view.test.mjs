// ATLAS-40 slice 2: saving and restoring a view without lying about it.
//
// The whole point of this module is what it REFUSES. A saved view that is
// restored into a graph it was not captured against, or onto a node that no
// longer exists, would look exactly like a successful restore — the stage would
// draw something plausible and the user would believe it is what they saved.
// So every mismatch is a coded refusal that changes nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel } from '../viewer/atlas39/core/view-model.mjs'
import {
  SAVED_VIEW_VERSION,
  IDENTITY_FIELDS,
  captureSavedView,
  serializeSavedView,
  parseSavedView,
  restoreSavedView,
  E_SAVED_VIEW_INVALID,
  E_SAVED_VIEW_VERSION,
  E_SAVED_VIEW_MODE,
  E_SAVED_VIEW_SNAPSHOT,
  E_SAVED_VIEW_STALE_NODE
} from '../viewer/atlas39/core/saved-view.mjs'
// Imported for exactly one assertion in counterexample 2. Re-deriving an
// edge_id is unavoidable there — it is what keeps Graph C contract valid — so
// the test has to show that the edge_id is not what the fingerprint reacted to.
import { canonicalGraphString } from '../viewer/atlas39/core/graph-fingerprint.mjs'
// The purity guard is the shared one every pure-core suite is scanned with,
// imported rather than re-spelled — see the test at the bottom of this file.
import {
  stripComments,
  purityViolations,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'
// The repository's own graph contract, imported rather than re-spelled: a
// counterexample is only evidence if the graph it is built from is one this
// repository would actually accept. `composeEdgeId` is the single source of the
// edge-identity derivation, so a mutated fixture cannot drift from the rule the
// validator enforces. Precedent: test/atlas65-snapshot.test.mjs imports the same
// module for the same reason.
import {
  validateSnapshot,
  composeEdgeId,
  EDGE_ORIGINS
} from '../src/gbrain-read-contract/validate.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE = join(repoRoot, 'docs/evidence/atlas-65')
const snapshot = JSON.parse(readFileSync(join(EVIDENCE, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE, 'provenance.json'), 'utf8'))
const vm = buildViewModel(snapshot, provenance)

const ROOT = 'ATLAS:confluence:14778372:14778372'
const DELIVERY = 'ATLAS:confluence:14778372:15171611'
const SPRINT = 'ATLAS:confluence:14778372:22478849'
const VIEWPORT = { width: 1092, height: 693 }

const sample = () =>
  captureSavedView({
    viewModel: vm,
    view: { mode: 'neighbourhood', anchorId: DELIVERY },
    focusId: SPRINT,
    transform: { scale: 1.75, tx: -412, ty: -88 },
    viewport: VIEWPORT
  })

const GOVERNANCE = 'ATLAS:confluence:14778372:14680066'

/**
 * Re-derives every edge_id from the contract's own composition rule and restores
 * the contract's edge order, so a mutated fixture stays a graph the repository
 * accepts.
 *
 * WHY THIS EXISTS. The first counterexample in this suite moved an edge's `from`
 * and deliberately left `edge_id` alone, which made the changed field maximally
 * visible but made Graph B a document `validateSnapshot()` rejects with
 * E_ID_DERIVATION — and a graph the contract refuses cannot demonstrate what the
 * saved-view identity protects in production. Endpoints are composed from the
 * endpoint nodes' `source_ref`, never from their `node_id`, because that is what
 * composeEdgeId() is fed everywhere else in the repository.
 */
const rederiveEdgeIdentity = (raw) => {
  const refById = new Map(raw.nodes.map((node) => [node.node_id, node.source_ref]))
  raw.edges = raw.edges
    .map((edge) => ({
      ...edge,
      edge_id: composeEdgeId(
        raw.project_id,
        raw.source.source_kind,
        raw.source.source_id,
        edge.relation_type,
        refById.get(edge.from),
        refById.get(edge.to)
      )
    }))
    .sort((a, b) => (a.edge_id < b.edge_id ? -1 : a.edge_id > b.edge_id ? 1 : 0))
  return raw
}

/** The saved view every counterexample below is captured against Graph A with. */
const capturedAgainstA = () =>
  parseSavedView(
    serializeSavedView(
      captureSavedView({
        viewModel: vm,
        view: { mode: 'neighbourhood', anchorId: DELIVERY },
        focusId: SPRINT,
        transform: { scale: 1.75, tx: -412, ty: -88 },
        viewport: VIEWPORT
      })
    )
  ).value

/** The seven-field identity of an arbitrary graph, read the way capture reads it. */
const identityOf = (viewModel) =>
  captureSavedView({
    viewModel,
    view: { mode: 'overview', anchorId: null },
    focusId: null,
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  }).snapshot

test('the contract version is pinned and carried in every saved view', () => {
  assert.equal(SAVED_VIEW_VERSION, 2)
  assert.equal(sample().saved_view_version, 2)
})

test('a saved view carries UI state and identity only — never the graph', () => {
  const saved = sample()
  assert.deepEqual(Object.keys(saved).sort(), ['focus_id', 'saved_view_version', 'snapshot', 'transform', 'view', 'viewport'])
  const text = serializeSavedView(saved)
  // No node label, no page title, no edge, no provenance may be persisted: the
  // graph always comes from the snapshot the workspace loaded.
  for (const node of vm.nodes) assert.equal(text.includes(node.label), false, `${node.label} was persisted`)
  for (const edge of vm.edges) assert.equal(text.includes(edge.edge_id), false, `${edge.edge_id} was persisted`)
  assert.equal(text.includes('provenance'), false)
})

test('the seven identity fields carry the values the loaded graph really has', () => {
  // Capture and compare BOTH go through snapshotIdentity(), so the mapping from
  // the view model onto D4's six fields is symmetric, and no roundtrip, drift or
  // refusal test can see it. Measured: swapping the two sources inside
  // snapshotIdentity — `project_id: viewModel.id_scheme` and
  // `id_scheme: viewModel.project_id` — left this suite green at 15/15, exit 0,
  // while every stored record then carried
  // {"project_id":"projection-local/v1", ..., "id_scheme":"ATLAS"} and a later
  // drift would have been reported back to the user against the wrong field
  // name, which is the same false story as reporting the wrong refusal code.
  //
  // So the six values are pinned against the literals D4 documents, not read
  // back out of the same view model the implementation reads them from: doing
  // that is exactly what made the swap invisible.
  assert.deepEqual(sample().snapshot, {
    project_id: 'ATLAS',
    source_id: '14778372',
    contract_version: '1.0.0',
    id_scheme: 'projection-local/v1',
    node_count: 5,
    edge_count: 4,
    // Pinned as a literal for the same reason as the six above: reading it back
    // out of the view model the implementation reads it from is exactly what
    // made the field-swap invisible. This is the fingerprint of the accepted
    // ATLAS snapshot, and it changes only when that snapshot's nodes, edge
    // endpoints, relation types or origins change.
    graph_fingerprint: 'fnv1a128/1:4a04facb97b5b1340f2bf40a280a8b3c'
  })

  // Literals close the field-to-field swap, but on their own they re-open the
  // other half of the same question: an implementation that IGNORES its
  // argument passes them. Measured: replacing the whole body of
  // snapshotIdentity with exactly those six literals left the suite green at
  // exit 0, 16/16 — and under that mutant EVERY graph captures ATLAS's
  // identity, so restoreSavedView compares ATLAS's identity to itself and a
  // view captured against graph A restores into graph B with ok:true. That is
  // the cross-graph restore D4's identity check exists to prevent, and the
  // whole reason node_count/edge_count are part of the identity.
  //
  // So the six fields are read a second time off a synthetic view model that
  // differs in ALL SIX. It witnesses this module's mapping only; it is NOT
  // evidence about ATLAS content, the same convention Task 3's four-node
  // witness graph is written under.
  const other = {
    project_id: 'OTHER',
    source: { source_id: '99999999' },
    contract_version: '2.0.0',
    id_scheme: 'canonical/v1',
    counts: { nodes: 2, edges: 1 },
    // Both saved ids exist here, so a restore that got past the identity check
    // would answer ok:true rather than E_SAVED_VIEW_STALE_NODE — the failure
    // below has to be the one actually being pinned.
    adjacency: new Map([[DELIVERY, new Set([SPRINT])], [SPRINT, new Set([DELIVERY])]]),
    // The fingerprint reads real content, so the witness graph has to carry
    // some: two nodes and the one edge its counts above already claim.
    nodes: [{ node_id: DELIVERY }, { node_id: SPRINT }],
    edges: [{ from: DELIVERY, to: SPRINT, relation_type: 'parent_of', origin: 'explicit' }]
  }
  assert.deepEqual(
    captureSavedView({
      viewModel: other,
      view: { mode: 'neighbourhood', anchorId: DELIVERY },
      focusId: SPRINT,
      transform: { scale: 1, tx: 0, ty: 0 },
      viewport: VIEWPORT
    }).snapshot,
    {
      project_id: 'OTHER',
      source_id: '99999999',
      contract_version: '2.0.0',
      id_scheme: 'canonical/v1',
      node_count: 2,
      edge_count: 1,
      graph_fingerprint: 'fnv1a128/1:f80e4e13c769b771cbe5da1c8fd24c61'
    }
  )

  const crossGraph = restoreSavedView(other, parseSavedView(serializeSavedView(sample())).value, VIEWPORT)
  assert.equal(crossGraph.ok, false, 'a view captured against one graph restored into another')
  assert.equal(crossGraph.code, E_SAVED_VIEW_SNAPSHOT)
})

test('serialising is byte-stable, so the same view always stores the same bytes', () => {
  const canonical = serializeSavedView(sample())
  assert.equal(serializeSavedView(sample()), canonical)

  // Key order must not depend on how the object was assembled, and nothing
  // outside the contract may reach storage.
  //
  // The first draft of this test built its "reordered" object with
  // JSON.parse(JSON.stringify(sample())), which PRESERVES key order — so it
  // reordered nothing, and replacing JSON.stringify(saved, KEY_ORDER) with a
  // plain JSON.stringify(saved) left this suite green at 14/14 (measured). The
  // replacer is the whole reason the stored bytes are a function of the view
  // alone, so it is pinned by an object that really is scrambled and really
  // does carry fields the contract does not name.
  const s = sample()
  const scrambled = {}
  scrambled.viewport = { height: s.viewport.height, width: s.viewport.width }
  scrambled.transform = { ty: s.transform.ty, tx: s.transform.tx, scale: s.transform.scale }
  scrambled.focus_id = s.focus_id
  scrambled.view = { anchor_id: s.view.anchor_id, mode: s.view.mode }
  scrambled.snapshot = {
    // Scrambled position on purpose: the replacer, not the assembly order, is
    // what decides where the fingerprint lands in the stored bytes.
    graph_fingerprint: s.snapshot.graph_fingerprint,
    edge_count: s.snapshot.edge_count,
    node_count: s.snapshot.node_count,
    id_scheme: s.snapshot.id_scheme,
    contract_version: s.snapshot.contract_version,
    source_id: s.snapshot.source_id,
    project_id: s.snapshot.project_id
  }
  scrambled.saved_view_version = s.saved_view_version
  scrambled.stray_field = 'must not be persisted'
  scrambled.snapshot.stray_nested = 'must not be persisted either'

  // Without this the test could pass on an object that was never scrambled.
  assert.notEqual(JSON.stringify(scrambled), canonical, 'the scrambled object was not actually scrambled')
  assert.equal(serializeSavedView(scrambled), canonical)
})

test('roundtrip: capture -> serialise -> parse -> restore reproduces the view exactly', () => {
  const parsed = parseSavedView(serializeSavedView(sample()))
  assert.equal(parsed.ok, true, parsed.reason)
  const bound = restoreSavedView(vm, parsed.value, VIEWPORT)
  assert.equal(bound.ok, true, bound.reason)
  assert.deepEqual(bound.view, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(bound.focusId, SPRINT)
  assert.deepEqual(bound.transform, { scale: 1.75, tx: -412, ty: -88 })
  assert.equal(bound.viewportChanged, false)
})

test('restoring the same saved view repeatedly gives the identical result every time', () => {
  const text = serializeSavedView(sample())
  const first = restoreSavedView(vm, parseSavedView(text).value, VIEWPORT)
  for (let i = 0; i < 5; i += 1) {
    const again = restoreSavedView(vm, parseSavedView(text).value, VIEWPORT)
    assert.deepEqual(again, first, `restore ${i} differed`)
  }
})

test('a different stage size restores the same logical view and admits the re-fit', () => {
  const parsed = () => parseSavedView(serializeSavedView(sample())).value
  const bound = restoreSavedView(vm, parsed(), { width: 1440, height: 900 })
  assert.equal(bound.ok, true)
  assert.deepEqual(bound.view, { mode: 'neighbourhood', anchorId: DELIVERY })
  assert.equal(bound.focusId, SPRINT)
  // The transform is handed back unchanged; the shell clamps it to the world it
  // actually has. What must not happen is a silent claim that nothing changed.
  assert.equal(bound.viewportChanged, true)
  assert.deepEqual(bound.transform, { scale: 1.75, tx: -412, ty: -88 })

  // Either dimension alone is already a different stage. The first draft varied
  // both together, so comparing only the width survived mutation with the suite
  // green (measured) — and a stage that changed height alone would then have
  // been announced as an exact restore.
  assert.equal(
    restoreSavedView(vm, parsed(), { width: VIEWPORT.width, height: 900 }).viewportChanged,
    true,
    'a change in height alone was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: 1440, height: VIEWPORT.height }).viewportChanged,
    true,
    'a change in width alone was reported as an exact restore'
  )

  // Every case above restores into a LARGER stage, so the comparison was pinned
  // on both dimensions but not on its DIRECTION. Measured: replacing
  // `parsed.viewport.width !== viewport.width || parsed.viewport.height !==
  // viewport.height` with `<` in both halves left the suite green at exit 0,
  // 17/17, and a view saved at 1440x900 then restored at 1092x693 answered
  // {"ok":true,...,"viewportChanged":false}. Task 6 suppresses ' The stage is a
  // different size than when this view was saved, so the zoom and position were
  // re-fitted.' on exactly that flag, so the mutant announces a pixel-identical
  // restore across a viewport change — the overclaim D6 forbids in as many
  // words. A shrinking stage is the ordinary case (a sidebar opens, the window
  // is made smaller), so it is pinned per dimension, the same way growing is.
  const smaller = { width: 800, height: 500 }
  assert.equal(
    restoreSavedView(vm, parsed(), smaller).viewportChanged,
    true,
    'a restore into a smaller stage was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: VIEWPORT.width, height: smaller.height }).viewportChanged,
    true,
    'a stage that lost height alone was reported as an exact restore'
  )
  assert.equal(
    restoreSavedView(vm, parsed(), { width: smaller.width, height: VIEWPORT.height }).viewportChanged,
    true,
    'a stage that lost width alone was reported as an exact restore'
  )
})

test('an overview saved view needs no anchor and restores to overview', () => {
  const saved = captureSavedView({
    viewModel: vm,
    view: { mode: 'overview', anchorId: null },
    focusId: null,
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  })
  const bound = restoreSavedView(vm, parseSavedView(serializeSavedView(saved)).value, VIEWPORT)
  assert.equal(bound.ok, true)
  assert.deepEqual(bound.view, { mode: 'overview', anchorId: null })
  assert.equal(bound.focusId, null)
})

test('capture never writes a focus id that validate would refuse', () => {
  // The two sides of this module disagreed on the empty string: capture asked
  // `typeof focusId === 'string'`, which accepts '', while validate refuses ''
  // through `isText` — so capture could store a record this module can never
  // restore, and the user would get E_SAVED_VIEW_INVALID from a view the
  // workspace itself wrote. It is unreachable from the shell today, because
  // `state.focusId` is a node id or null, which is exactly why the agreement
  // needs a test rather than a comment: nothing else in this suite would notice
  // the two predicates drifting apart again.
  const saved = captureSavedView({
    viewModel: vm,
    view: { mode: 'overview', anchorId: null },
    focusId: '',
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  })
  assert.equal(saved.focus_id, null, 'capture stored a focus id validate refuses')
  const parsed = parseSavedView(serializeSavedView(saved))
  assert.equal(parsed.ok, true, parsed.reason)
  assert.equal(parsed.value.focusId, null)
})

test('nothing stored, empty storage or non-JSON is a refusal, not a crash', () => {
  for (const text of [null, undefined, '', '   ', '{', 'not json', '[]', '"a string"', '7']) {
    const result = parseSavedView(text)
    assert.equal(result.ok, false, `${JSON.stringify(text)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID)
    assert.equal('value' in result, false)
  }
})

test('an unsupported version is refused before any field is interpreted', () => {
  for (const version of [0, 1, 3, 99, '2', null, undefined]) {
    const raw = { ...sample(), saved_view_version: version }
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false, `version ${JSON.stringify(version)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_VERSION)
  }

  // Every case above keeps every OTHER field valid, so none of them can tell
  // "version first" from "version last" — which is the ordering D4 requires in
  // bold, and this test's own title claims. Measured: moving the whole version
  // gate from the top of validateSavedView down to just above `const identity
  // = {}` left the suite green at 15/15, and under that mutant a record with a
  // bad version AND a missing snapshot came back E_SAVED_VIEW_INVALID — the
  // fields were interpreted first after all.
  //
  // The ordering is only visible on a record that is broken in BOTH ways at
  // once. An older build must say "I do not read this version", never report a
  // field it had no business interpreting: a version it cannot read is a
  // record whose field meanings it does not know.
  const brokenTwice = [
    { saved_view_version: 99 },
    { ...sample(), saved_view_version: 99, snapshot: undefined },
    { ...sample(), saved_view_version: 3, view: { mode: 'cluster', anchor_id: DELIVERY } },
    { ...sample(), saved_view_version: 0, transform: { scale: 0, tx: 'left', ty: 0 } }
  ]
  for (const raw of brokenTwice) {
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false)
    assert.equal(
      result.code,
      E_SAVED_VIEW_VERSION,
      `a field was interpreted before the version was checked: ${result.code}`
    )
  }
})

test('an unsupported view mode is refused explicitly, never downgraded to overview', () => {
  const raw = sample()
  for (const mode of ['cluster', 'timeline', 'minimap', '', null]) {
    const result = parseSavedView(JSON.stringify({ ...raw, view: { mode, anchor_id: DELIVERY } }))
    assert.equal(result.ok, false, `mode ${JSON.stringify(mode)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_MODE)
    assert.equal(JSON.stringify(result).includes('overview'), false, 'the refusal fell back to overview')
  }
})

test('a supported mode with a missing anchor is refused as malformed, not as a bad mode', () => {
  // `neighbourhood` IS a mode this build supports; what is unusable is the
  // anchor. Reporting E_SAVED_VIEW_MODE here would tell the user their saved
  // view came from another build — a different, and false, story. This is the
  // only case that separates the two codes, and it was untested: collapsing
  // `view.code === E_VIEW_MODE ? E_SAVED_VIEW_MODE : E_SAVED_VIEW_INVALID` to a
  // bare E_SAVED_VIEW_MODE left the suite green at 14/14 (measured).
  for (const anchor of [null, '', 42, undefined]) {
    const result = parseSavedView(JSON.stringify({ ...sample(), view: { mode: 'neighbourhood', anchor_id: anchor } }))
    assert.equal(result.ok, false, `anchor ${JSON.stringify(anchor)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `anchor ${JSON.stringify(anchor)}: ${result.code}`)
  }
})

test('a malformed shape is refused field by field', () => {
  // "Field by field" is the title, so EVERY guarded field gets its own row and
  // every dimension of a two-dimensional field gets its own. A table that
  // covers one representative per group leaves the rest fail-OPEN: measured on
  // the previous table, deleting any single one of `!isText(snapshot.source_id)`,
  // `!isText(snapshot.contract_version)`, `!isText(snapshot.id_scheme)`,
  // `!Number.isInteger(snapshot.edge_count)`, `!isFiniteNumber(t.ty)`,
  // `!isFiniteNumber(v.width)` or `!isFiniteNumber(v.height) || v.height <= 0`
  // left the suite green at exit 0, 16/16, while a record carrying
  // {"transform":{"scale":1.75,"tx":-412,"ty":"up"}} or
  // {"viewport":{"width":1092,"height":"tall"}} then parsed and restored
  // ok:true — the shell would apply a NaN translate, or accept a stage size it
  // cannot use, and announce a successful restore. Only `project_id` and
  // `node_count` were pinned, and they are exactly the two rows this table had.
  //
  // Every row above pinned the TYPE half of its guard and none pinned the
  // DOMAIN half, so the same wrong-refusal-code false story survived a second
  // time. Three mutants, each measured at exit 0, 17/17, with
  // `shasum -a 256 viewer/atlas39/core/saved-view.mjs` restored to
  // 07e4452ac4a373d9dd370ecf4d63491dcf89f2068788b77bc894f52a309be880 each time:
  //
  //   `const isText = (v) => typeof v === 'string'` — the `&& v.length > 0`
  //   deleted — lets a stored {"source_id": ""} parse, and restoreSavedView
  //   then answers {"ok":false,"code":"E_SAVED_VIEW_SNAPSHOT","reason":"the
  //   saved view was captured against a different graph (source_id was \"\",
  //   this graph has \"14778372\")"}: a malformed record reported as a
  //   re-scanned Confluence tree. The same mutant answers
  //   E_SAVED_VIEW_STALE_NODE for {"focus_id": ""} — a malformed record
  //   reported as a deleted page.
  //
  //   `!Number.isInteger(snapshot.node_count)` -> `typeof snapshot.node_count
  //   !== 'number'` lets node_count 5.5 parse and restore as
  //   E_SAVED_VIEW_SNAPSHOT "(node_count was 5.5, this graph has 5)"; the same
  //   for edge_count 4.5, "(edge_count was 4.5, this graph has 4)".
  //
  //   `raw.focus_id !== null` -> `raw.focus_id != null` lets a record with NO
  //   `focus_id` key at all parse ok:true and restore
  //   {"ok":true,...,"focusId":null} — a missing field silently defaulted,
  //   where D4's table assigns it to E_SAVED_VIEW_INVALID.
  //
  // So each guarded field now carries both halves: the wrong type AND the
  // wrong value of the right type.
  const base = sample()
  const mutations = [
    ['snapshot', undefined],
    ['snapshot', { ...base.snapshot, project_id: 42 }],
    ['snapshot', { ...base.snapshot, project_id: '' }],
    ['snapshot', { ...base.snapshot, source_id: 14778372 }],
    ['snapshot', { ...base.snapshot, source_id: '' }],
    ['snapshot', { ...base.snapshot, contract_version: 1 }],
    ['snapshot', { ...base.snapshot, contract_version: '' }],
    ['snapshot', { ...base.snapshot, id_scheme: null }],
    ['snapshot', { ...base.snapshot, id_scheme: '' }],
    ['snapshot', { ...base.snapshot, node_count: '5' }],
    ['snapshot', { ...base.snapshot, node_count: 5.5 }],
    ['snapshot', { ...base.snapshot, edge_count: '4' }],
    ['snapshot', { ...base.snapshot, edge_count: 4.5 }],
    ['view', undefined],
    ['focus_id', 42],
    ['focus_id', ''],
    // JSON.stringify drops an undefined value, so this row is a record with no
    // `focus_id` key at all — the case the strict `!== null` exists for.
    ['focus_id', undefined],
    ['transform', { scale: 0, tx: 0, ty: 0 }],
    ['transform', { scale: Number.NaN, tx: 0, ty: 0 }],
    ['transform', { scale: 1, tx: 'left', ty: 0 }],
    ['transform', { scale: 1, tx: 0, ty: 'up' }],
    ['transform', undefined],
    ['viewport', { width: 0, height: 693 }],
    ['viewport', { width: 'wide', height: 693 }],
    ['viewport', { width: 1092, height: 0 }],
    ['viewport', { width: 1092, height: 'tall' }],
    ['viewport', undefined]
  ]
  for (const [key, value] of mutations) {
    const raw = { ...base, [key]: value }
    const result = parseSavedView(JSON.stringify(raw))
    assert.equal(result.ok, false, `${key}=${JSON.stringify(value)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `${key}: ${result.code}`)
  }
})

test('a saved view from a different graph is refused, per identity field', () => {
  // The six CARDINAL fields are reported with their two values. The seventh,
  // graph_fingerprint, is asserted separately below, because it is the one
  // field whose values are meaningless to a reader and is deliberately
  // reported differently. Pinning that exception here is what stops it from
  // being read as an oversight.
  const parsed = parseSavedView(serializeSavedView(sample())).value
  const fields = {
    project_id: 'OTHER',
    source_id: '99999999',
    contract_version: '2.0.0',
    id_scheme: 'canonical/v1',
    node_count: 6,
    edge_count: 3
  }
  for (const [key, value] of Object.entries(fields)) {
    const drifted = { ...parsed, snapshot: { ...parsed.snapshot, [key]: value } }
    const result = restoreSavedView(vm, drifted, VIEWPORT)
    assert.equal(result.ok, false, `${key} drift was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_SNAPSHOT)

    // Asking only whether the drifted field's NAME appears somewhere passes on
    // a reason that names every field. Measured: replacing the reason with the
    // constant string 'the saved view was captured against a different graph
    // (project_id source_id contract_version id_scheme node_count edge_count
    // differ)' left the suite green at exit 0, 16/16, and a node_count-only
    // drift was then reported to the user as all six fields differing. So the
    // reason must name exactly ONE identity field, and carry both of the values
    // it is contrasting — otherwise it is not a report about this drift.
    assert.deepEqual(
      IDENTITY_FIELDS.filter((field) => result.reason.includes(field)),
      [key],
      `the reason named the wrong set of identity fields: ${result.reason}`
    )
    assert.equal(
      result.reason.includes(JSON.stringify(value)),
      true,
      `the saved value is missing from the reason: ${result.reason}`
    )
    assert.equal(
      result.reason.includes(JSON.stringify(parsed.snapshot[key])),
      true,
      `this graph's value is missing from the reason: ${result.reason}`
    )
  }

  // The seventh field. It refuses the same way and names itself the same way,
  // but it must NOT print its two values: they are 43-character hashes that
  // tell a reader nothing, and a refusal a user cannot read is a refusal that
  // gets ignored. Asserting the absence is what keeps a later 'make it
  // consistent with the other six' change from dumping them.
  const drifted = {
    ...parsed,
    snapshot: { ...parsed.snapshot, graph_fingerprint: 'fnv1a128/1:00000000000000000000000000000000' }
  }
  const result = restoreSavedView(vm, drifted, VIEWPORT)
  assert.equal(result.ok, false, 'a fingerprint drift was accepted')
  assert.equal(result.code, E_SAVED_VIEW_SNAPSHOT)
  assert.deepEqual(
    IDENTITY_FIELDS.filter((field) => result.reason.includes(field)),
    ['graph_fingerprint'],
    `the reason named the wrong set of identity fields: ${result.reason}`
  )
  assert.equal(
    result.reason.includes('fnv1a128'),
    false,
    `the refusal printed a raw fingerprint: ${result.reason}`
  )
})

test('COUNTEREXAMPLE: a stale node id is refused and is never mapped onto another node', () => {
  const parsed = parseSavedView(serializeSavedView(sample())).value

  const staleAnchor = { ...parsed, view: { mode: 'neighbourhood', anchorId: `${DELIVERY}-deleted` } }
  const anchorResult = restoreSavedView(vm, staleAnchor, VIEWPORT)
  assert.equal(anchorResult.ok, false)
  assert.equal(anchorResult.code, E_SAVED_VIEW_STALE_NODE)

  const staleFocus = { ...parsed, focusId: 'ATLAS:confluence:14778372:00000000' }
  const focusResult = restoreSavedView(vm, staleFocus, VIEWPORT)
  assert.equal(focusResult.ok, false)
  assert.equal(focusResult.code, E_SAVED_VIEW_STALE_NODE)

  // WHICH node is missing, not just that one is. The refusal's `what` label was
  // unpinned: measured on this module, swapping the loop's two rows to
  // `[['focus', parsed.view.anchorId], ['anchor', parsed.focusId]]` left this
  // suite at exit 0, 18/18, and a saved view whose FOCUS page had been deleted
  // then answered "the saved anchor node is not in this graph". Task 6 renders
  // `reason` verbatim into `#saved-view-state` and the live region, so the
  // mislabel sends the user to look for the wrong page — the same class of
  // false story as reporting the wrong refusal code, which this file already
  // pins twice.
  assert.match(
    anchorResult.reason,
    /saved anchor node/,
    `a stale ANCHOR was reported under the wrong label: ${anchorResult.reason}`
  )
  assert.match(
    focusResult.reason,
    /saved focus node/,
    `a stale FOCUS was reported under the wrong label: ${focusResult.reason}`
  )

  // The decisive property: a refusal must carry NO usable node of this graph.
  // If it did, the shell could restore "something close" and look successful.
  //
  // The scan is deliberately UNANCHORED. The first draft looked for `"<id>"`,
  // which only sees a node id that is a whole JSON string value, so an id named
  // in the refusal's prose was invisible to it — the one place a substitute is
  // most likely to be offered. Measured: rewriting the stale-node reason to
  // `the saved ${what} node is not in this graph; the nearest surviving page is
  // ${viewModel.nodes[0].node_id} - restore that one instead` left the suite
  // green at 15/15 while the refusal literally read "... the nearest surviving
  // page is ATLAS:confluence:14778372:14778372 - restore that one instead".
  // A substitute offered in prose is still a substitute.
  for (const result of [anchorResult, focusResult]) {
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
    for (const node of vm.nodes) {
      assert.equal(
        JSON.stringify(result).includes(node.node_id),
        false,
        `the refusal offered ${node.node_id} as a substitute`
      )
    }
  }
})

test('restoreSavedView answers a refusal when it is handed anything but a validated saved view', () => {
  // A refusal is a VALUE in this module, and the sibling pure module states the
  // same contract for `isInView` in view-state.mjs — it answers `false` on a
  // refusal "instead of throwing a TypeError at a caller that did not check ok
  // first". This module did the opposite. Measured before the guard:
  // restoreSavedView(vm, parseSavedView(text), viewport) — the whole parse
  // RESULT rather than its .value — raised `TypeError: Cannot read properties
  // of undefined (reading 'project_id')`, and so did the same call on a
  // refusal. Under D5 a saved view that does not apply must never tear the
  // stage down, so the wrong shape is refused rather than thrown.
  //
  // The first guard covered `parsed`, `parsed.snapshot` and `parsed.view` — 2
  // of the 4 objects this function dereferences — so the title above and the
  // module's own "anything else is refused as a value, never thrown" were still
  // false. Measured on that module: a record carrying this graph's six identity
  // values and a valid `view` but no `transform`/`viewport`, the same record
  // carrying `transform` but no `viewport`, and `restoreSavedView(vm, parsed)`
  // with the stage size omitted ALL raised `TypeError: Cannot read properties
  // of undefined (reading 'width')` at saved-view.mjs:242 — the identity and
  // stale-node checks pass first, so the guard never saw them. All four objects
  // are guarded now, and all three shapes are rows here.
  const complete = parseSavedView(serializeSavedView(sample())).value
  const wrong = [
    parseSavedView(serializeSavedView(sample())), // the {ok, value} envelope, not value
    parseSavedView('not json'), // a refusal
    null,
    undefined,
    'a string',
    {},
    { snapshot: sample().snapshot }, // an identity, but no view
    // The six clauses of the widened guard need six isolating rows, and the
    // rows above isolate only four: `parsed`, `viewport` (below), `transform`
    // and the record's own `viewport`. The two record fields the earlier rows
    // covered only INCIDENTALLY each get one here, because each was measured
    // individually fail-OPEN on the shipped module — deleted alone,
    // `node --test test/atlas40-saved-view.test.mjs` exited 0 at 18/18 both
    // times. Under the first mutant this row raises `TypeError: Cannot read
    // properties of undefined (reading 'project_id')` at the identity loop;
    // under the second the next row raises `... (reading 'anchorId')` at the
    // stale-node loop. Both are the D5 violation: a bad saved view tearing the
    // stage down instead of being refused as a value.
    { view: complete.view, focusId: null, transform: complete.transform, viewport: complete.viewport },
    { snapshot: complete.snapshot, focusId: null, transform: complete.transform, viewport: complete.viewport },
    // All three of these get PAST the identity and stale-node checks, which is
    // why they threw where the earlier rows refused. Each of the two remaining
    // record fields gets its own row, because a single row covering both leaves
    // the other clause fail-OPEN: measured on the repaired module, deleting
    // `!isObject(parsed.transform)` alone left the suite green at exit 0, 18/18
    // while the missing-viewport rows still caught the viewport clause, and
    // under that mutant a record with no `transform` restored ok:true carrying
    // `transform: undefined` — which the shell would hand straight to
    // clampTransform. The transform is never dereferenced here, so it does not
    // throw; it is handed on as an unusable value instead, which is the same
    // half-applied restore from the other direction.
    { snapshot: complete.snapshot, view: complete.view, focusId: null },
    {
      snapshot: complete.snapshot,
      view: complete.view,
      focusId: null,
      transform: { scale: 1, tx: 0, ty: 0 }
    },
    {
      snapshot: complete.snapshot,
      view: complete.view,
      focusId: null,
      viewport: { width: 1092, height: 693 }
    }
  ]
  for (const argument of wrong) {
    const result = restoreSavedView(vm, argument, VIEWPORT)
    assert.equal(result.ok, false, `${JSON.stringify(argument)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `${JSON.stringify(argument)}: ${result.code}`)
    // Nothing may be handed back that the shell could half-apply.
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
  }

  // The current stage size is the fourth dereferenced object, and it is the
  // caller's argument rather than the record's field, so it needs its own case:
  // a complete, valid saved view with no stage size to restore it into.
  for (const stage of [undefined, null, 'wide']) {
    const result = stage === undefined ? restoreSavedView(vm, complete) : restoreSavedView(vm, complete, stage)
    assert.equal(result.ok, false, `stage size ${JSON.stringify(stage)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID, `stage size ${JSON.stringify(stage)}: ${result.code}`)
    assert.equal('view' in result, false)
    assert.equal('focusId' in result, false)
    assert.equal('transform' in result, false)
  }
})

// This is the first pure-core module that legitimately imports another one, so
// it cannot be handed to the shared guard whole: that guard denies `import` and
// any module specifier outright, and reports ["import", "from '<specifier>'"] on
// the correct, pristine file.
//
// The plan's first draft answered that by re-spelling a raw whole-file
// `source.includes(token)` list — the exact pattern this repository had already
// measured and removed twice. Measured a third time, here, on this module: two
// ordinary comments turn it red on a byte-identically pure file ("documented in
// the runbook" hits `document`, "a window onto the graph" hits `window`), while
// `const clock = Date` + `clock.now()`, `navigator.userAgent`, `queueMicrotask`,
// `eval`, `crypto.getRandomValues`, `setTimeout`, `performance.now`,
// `globalThis` and a dynamic `import('node:fs')` every one of them pass it.
//
// So the carve-out is narrowed to the one import instead of widened to a weaker
// guard: that exact statement must appear exactly once, and the WHOLE shared
// guard — `import` and MODULE_SPECIFIER included — then runs over everything
// else. A second import, static or dynamic, is still caught.
const ALLOWED_IMPORTS = [
  "import { normalizeView, E_VIEW_MODE } from './view-state.mjs'",
  "import { graphFingerprint } from './graph-fingerprint.mjs'"
]

test('the module carries no storage, clock, randomness or DOM, and imports only the view state and the fingerprint', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/saved-view.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function captureSavedView/, 'the comment strip removed captureSavedView')
  assert.match(code, /export function serializeSavedView/, 'the comment strip removed serializeSavedView')
  assert.match(code, /export function parseSavedView/, 'the comment strip removed parseSavedView')
  assert.match(code, /export function validateSavedView/, 'the comment strip removed validateSavedView')
  assert.match(code, /export function restoreSavedView/, 'the comment strip removed restoreSavedView')

  for (const allowed of ALLOWED_IMPORTS) {
    assert.equal(
      code.split(allowed).length - 1,
      1,
      'saved-view.mjs no longer carries exactly once: ' + allowed
    )
  }
  let body = code
  for (const allowed of ALLOWED_IMPORTS) body = body.replace(allowed, '')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(body.includes(forbidden), false, `saved-view.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${forbidden}\\b`),
      `saved-view.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(body, MODULE_SPECIFIER, 'saved-view.mjs imports from a second module specifier')
  assert.deepEqual(purityViolations(body), [], 'the purity rules disagree with each other')
})

test('COUNTEREXAMPLE (contract-invalid construction): a graph that keeps all six cardinal fields but moves a page is refused', () => {
  // THE HOLE THIS CLOSES. Until the fingerprint, the saved-view identity was
  // six cardinal facts plus a check that the saved ids still resolve. Every one
  // of those can hold across a re-scan that MOVED a page: same project, same
  // source, same contract, same scheme, same node and edge counts, and both
  // saved ids still alive — and a different graph. The workspace would then
  // recompute a different direct neighbourhood and announce a successful
  // restore, which is the silent retargeting this whole module exists to
  // prevent, one level below where it was being checked.
  //
  // Graph B re-parents SPRINT from DELIVERY to GOVERNANCE. The edge's
  // `edge_id` is deliberately left untouched, so the ONLY changed fact in the
  // whole snapshot is that one edge's `from`.
  const rawB = JSON.parse(JSON.stringify(snapshot))
  const moved = rawB.edges.find((edge) => edge.to === SPRINT)
  assert.equal(moved.from, DELIVERY, 'the fixture no longer has SPRINT under DELIVERY')
  moved.from = GOVERNANCE
  const b = buildViewModel(rawB, provenance)

  // NAMED, NOT HIDDEN. This construction keeps the original `edge_id` so the
  // single changed fact is maximally visible — which also means Graph B here is
  // NOT a document the repository's contract accepts: the id no longer derives
  // from the endpoints it now joins. The finding is asserted rather than left
  // for a reviewer to discover, and the contract-VALID counterexamples below
  // carry the production evidence.
  //
  // Exactly one finding, not two: keeping the stale id is also what keeps the
  // edge ORDER valid, so `E_ORDER` is deliberately absent here and appears only
  // if a future edit re-derives the id without re-sorting.
  assert.deepEqual(
    validateSnapshot(rawB).map((error) => `${error.path} ${error.code}`),
    ['/snapshot/edges/3/edge_id E_ID_DERIVATION'],
    'this construction is no longer contract-invalid in the way the comment claims'
  )

  const saved = captureSavedView({
    viewModel: vm,
    view: { mode: 'neighbourhood', anchorId: DELIVERY },
    focusId: SPRINT,
    transform: { scale: 1.75, tx: -412, ty: -88 },
    viewport: VIEWPORT
  })
  const parsed = parseSavedView(serializeSavedView(saved)).value
  const identityOfB = captureSavedView({
    viewModel: b,
    view: { mode: 'overview', anchorId: null },
    focusId: null,
    transform: { scale: 1, tx: 0, ty: 0 },
    viewport: VIEWPORT
  }).snapshot

  // 1. Every field the OLD contract compared is identical, so the old contract
  //    had nothing left to refuse on. This is the assertion that makes the
  //    test load-bearing rather than a restatement of the new behaviour.
  const cardinal = IDENTITY_FIELDS.filter((field) => field !== 'graph_fingerprint')
  assert.equal(cardinal.length, 6)
  for (const field of cardinal) {
    assert.equal(
      parsed.snapshot[field],
      identityOfB[field],
      `${field} differs, so this counterexample is not testing what it claims`
    )
  }
  // 2. and both saved ids still resolve in B, so the stale-node check is silent too.
  assert.equal(b.adjacency.has(DELIVERY), true)
  assert.equal(b.adjacency.has(SPRINT), true)

  // 3. and yet the view the user saved resolves to something else in B.
  assert.deepEqual([...vm.adjacency.get(DELIVERY)].sort(), [ROOT, SPRINT].sort())
  assert.deepEqual([...b.adjacency.get(DELIVERY)].sort(), [ROOT])

  // 4. so it is refused, and the refusal carries no restorable state at all:
  //    a shell that read `view`/`focusId`/`transform` off a refusal would
  //    apply the saved view anyway.
  const refused = restoreSavedView(b, parsed, VIEWPORT)
  assert.equal(refused.ok, false, 'a moved page restored as if nothing had changed')
  assert.equal(refused.code, E_SAVED_VIEW_SNAPSHOT)
  assert.deepEqual(Object.keys(refused).sort(), ['code', 'ok', 'reason'])
  for (const leaked of ['view', 'focusId', 'transform']) {
    assert.equal(leaked in refused, false, `the refusal exposed ${leaked}`)
  }
  assert.equal(refused.reason.includes(DELIVERY), false, 'the refusal leaked a node id')
  assert.equal(refused.reason.includes(SPRINT), false, 'the refusal leaked a node id')

  // 5. and the same record still restores against the graph it was captured
  //    against — the repair refuses drift, not everything.
  const restored = [0, 1, 2].map(() => restoreSavedView(vm, parsed, VIEWPORT))
  assert.equal(restored[0].ok, true, restored[0].reason)
  assert.equal(restored[0].view.mode, 'neighbourhood')
  assert.equal(restored[0].view.anchorId, DELIVERY)
  assert.equal(restored[0].focusId, SPRINT)
  assert.deepEqual(restored[0].transform, { scale: 1.75, tx: -412, ty: -88 })
  // 6. and repeating it is idempotent, not merely successful twice.
  assert.deepEqual(restored[1], restored[0])
  assert.deepEqual(restored[2], restored[0])
})

test('CONTRACT-VALID COUNTEREXAMPLE 1 (topology): both graphs pass the gbrain-read/v1 contract, and the moved page is still refused', () => {
  // Graph A is the accepted evidence snapshot, unmodified.
  assert.deepEqual(validateSnapshot(snapshot), [], 'Graph A is not contract valid')

  // Graph B re-parents SPRINT from DELIVERY to GOVERNANCE and then re-derives the
  // edge identity and edge order the way the contract requires, so B is a graph
  // the repository would accept from a re-scan — not a fixture only this suite
  // tolerates.
  const rawB = rederiveEdgeIdentity(
    (() => {
      const g = JSON.parse(JSON.stringify(snapshot))
      const moved = g.edges.find((edge) => edge.to === SPRINT)
      assert.equal(moved.from, DELIVERY, 'the fixture no longer has SPRINT under DELIVERY')
      moved.from = GOVERNANCE
      return g
    })()
  )
  assert.deepEqual(validateSnapshot(rawB), [], 'Graph B is not contract valid')

  // The re-derivation really happened: the stale id is gone and the contract id
  // is present, so this is not the weak counterexample under a new name.
  const movedB = rawB.edges.find((edge) => edge.to === SPRINT)
  assert.equal(movedB.edge_id, 'ATLAS:confluence:14778372:parent_of:14680066:22478849')
  assert.equal(
    rawB.edges.some((edge) => edge.edge_id === 'ATLAS:confluence:14778372:parent_of:15171611:22478849'),
    false,
    'the stale edge_id survived the re-derivation'
  )

  const b = buildViewModel(rawB, provenance)
  const parsed = capturedAgainstA()
  const idB = identityOf(b)

  // 1. Every field the pre-fingerprint contract compared is identical.
  const cardinal = IDENTITY_FIELDS.filter((field) => field !== 'graph_fingerprint')
  assert.equal(cardinal.length, 6)
  for (const field of cardinal) {
    assert.equal(parsed.snapshot[field], idB[field], `${field} differs, so this is not testing what it claims`)
  }
  // 2. and the saved anchor and the saved focus both still exist in B.
  assert.equal(b.adjacency.has(DELIVERY), true, 'the saved anchor is not in Graph B')
  assert.equal(b.adjacency.has(SPRINT), true, 'the saved focus is not in Graph B')
  // 3. and yet the neighbourhood the user saved resolves to something else in B.
  assert.deepEqual([...vm.adjacency.get(DELIVERY)].sort(), [ROOT, SPRINT].sort())
  assert.deepEqual([...b.adjacency.get(DELIVERY)].sort(), [ROOT])
  // 4. so only the fingerprint can tell the two graphs apart.
  assert.notEqual(parsed.snapshot.graph_fingerprint, idB.graph_fingerprint)

  // 5. A -> B is refused, and the refusal exposes no restorable state at all.
  const refused = restoreSavedView(b, parsed, VIEWPORT)
  assert.equal(refused.ok, false, 'a moved page restored as if nothing had changed')
  assert.equal(refused.code, E_SAVED_VIEW_SNAPSHOT)
  assert.deepEqual(Object.keys(refused).sort(), ['code', 'ok', 'reason'])
  for (const leaked of ['view', 'focusId', 'transform']) {
    assert.equal(leaked in refused, false, `the refusal exposed ${leaked}`)
  }
  assert.equal(refused.reason.includes(DELIVERY), false, 'the refusal leaked a node id')
  assert.equal(refused.reason.includes(SPRINT), false, 'the refusal leaked a node id')

  // 6. A -> A still succeeds, and repeating it is idempotent rather than merely
  //    successful twice.
  const restored = [0, 1, 2].map(() => restoreSavedView(vm, parsed, VIEWPORT))
  assert.equal(restored[0].ok, true, restored[0].reason)
  assert.equal(restored[0].view.mode, 'neighbourhood')
  assert.equal(restored[0].view.anchorId, DELIVERY)
  assert.equal(restored[0].focusId, SPRINT)
  assert.deepEqual(restored[0].transform, { scale: 1.75, tx: -412, ty: -88 })
  assert.deepEqual(restored[1], restored[0])
  assert.deepEqual(restored[2], restored[0])
})

test('CONTRACT-VALID COUNTEREXAMPLE 2 (relation semantics): identical topology, one changed relation_type, still refused', () => {
  // Counterexample 1 changes an endpoint, so a fingerprint that bound only the
  // adjacency would already catch it. This one changes NOTHING a reader can see
  // in the adjacency: the same two nodes stay joined, and only the meaning of the
  // join changes. Nothing but relation_type being an input to the fingerprint can
  // refuse it, which is what makes this the sharper of the two.
  const rawC = rederiveEdgeIdentity(
    (() => {
      const g = JSON.parse(JSON.stringify(snapshot))
      const retyped = g.edges.find((edge) => edge.to === SPRINT)
      assert.equal(retyped.relation_type, 'parent_of')
      retyped.relation_type = 'links_to'
      return g
    })()
  )
  // relation_type is syntactically constrained but deliberately NOT an enum —
  // both the validator (validate.mjs, "Syntactically constrained, deliberately
  // NOT an enum") and the published schema ($defs.edge.relation_type, a bare
  // id_component with no enum) admit any identifier-safe token. So the CONTRACT
  // admits this graph.
  //
  // What this deliberately does NOT claim: that today's re-scan would produce
  // it. The only producer of a snapshot edge is src/atlas65/snapshot.mjs, which
  // emits the constant `parent_of` and drops every readback link that is not
  // one. This counterexample therefore proves the fingerprint holds for every
  // graph the contract admits, which is the surface the saved-view contract is
  // written against — not only for the narrower set the current importer emits.
  assert.deepEqual(validateSnapshot(rawC), [], 'Graph C is not contract valid')

  const c = buildViewModel(rawC, provenance)
  const parsed = capturedAgainstA()
  const idC = identityOf(c)

  const cardinal = IDENTITY_FIELDS.filter((field) => field !== 'graph_fingerprint')
  for (const field of cardinal) {
    assert.equal(parsed.snapshot[field], idC[field], `${field} differs, so this is not testing what it claims`)
  }
  assert.equal(c.adjacency.has(DELIVERY), true)
  assert.equal(c.adjacency.has(SPRINT), true)
  // Every node keeps exactly the neighbours it had in Graph A — same node set,
  // same adjacency AS SETS. The two documents are NOT byte-identical: keeping
  // Graph C contract valid forces the edge_id to be re-derived and the edge
  // order restored, and SPRINT's derived depth goes from 2 to null once its
  // only parent_of edge is re-typed. None of that is bound by the fingerprint,
  // which is the point — the sort below is what makes the comparison a
  // comparison of neighbourhoods rather than of insertion order.
  for (const node of vm.nodes) {
    assert.deepEqual(
      [...c.adjacency.get(node.node_id)].sort(),
      [...vm.adjacency.get(node.node_id)].sort(),
      `${node.node_id} has a different neighbourhood, so this is a topology change after all`
    )
  }
  assert.notEqual(parsed.snapshot.graph_fingerprint, idC.graph_fingerprint)

  // AND it reacted to the relation type, not to the edge_id that re-derivation
  // necessarily changed along with it. From the assertions above alone a reader
  // could not separate those two, because keeping Graph C contract valid is
  // exactly what forces the id to move. The fingerprint's own canonical string
  // settles it: no edge_id of either graph appears in it, while the relation
  // type and the origin both do.
  const canonicalA = canonicalGraphString(vm)
  for (const edge of [...vm.edges, ...c.edges]) {
    assert.equal(
      canonicalA.includes(edge.edge_id),
      false,
      `edge_id ${edge.edge_id} is bound by the fingerprint, so this test cannot attribute the refusal to relation_type`
    )
  }
  assert.equal(canonicalA.includes('parent_of'), true, 'the fingerprint does not bind relation_type')
  assert.equal(canonicalA.includes('explicit'), true, 'the fingerprint does not bind origin')

  const refused = restoreSavedView(c, parsed, VIEWPORT)
  assert.equal(refused.ok, false, 'a re-typed relation restored as if nothing had changed')
  assert.equal(refused.code, E_SAVED_VIEW_SNAPSHOT)
  assert.deepEqual(Object.keys(refused).sort(), ['code', 'ok', 'reason'])
  for (const leaked of ['view', 'focusId', 'transform']) {
    assert.equal(leaked in refused, false, `the refusal exposed ${leaked}`)
  }

  const restored = [0, 1, 2].map(() => restoreSavedView(vm, parsed, VIEWPORT))
  assert.equal(restored[0].ok, true, restored[0].reason)
  assert.deepEqual(restored[1], restored[0])
  assert.deepEqual(restored[2], restored[0])
})

test('a contract-valid ORIGIN counterexample is impossible under gbrain-read/v1, and that is asserted rather than assumed', () => {
  // `origin` IS an enum in the v1 contract — `explicit` and nothing else — so no
  // graph the repository accepts can differ from another only in origin. The
  // fingerprint binds origin anyway, for the day the enum widens. Saying "origin
  // is covered" without this assertion would be the overclaim; saying nothing
  // would leave a reader unable to tell a gap from a deliberate omission.
  assert.deepEqual(EDGE_ORIGINS, ['explicit'])
  const rawD = JSON.parse(JSON.stringify(snapshot))
  rawD.edges[0].origin = 'inferred'
  const codes = validateSnapshot(rawD).map((error) => error.code)
  assert.deepEqual(codes, ['E_ENUM'], 'the contract now admits a second origin; add the origin counterexample')
})

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
// The purity guard is the shared one every pure-core suite is scanned with,
// imported rather than re-spelled — see the test at the bottom of this file.
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

test('the contract version is pinned and carried in every saved view', () => {
  assert.equal(SAVED_VIEW_VERSION, 1)
  assert.equal(sample().saved_view_version, 1)
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

test('the six identity fields carry the values the loaded graph really has', () => {
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
    edge_count: 4
  })
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

test('nothing stored, empty storage or non-JSON is a refusal, not a crash', () => {
  for (const text of [null, undefined, '', '   ', '{', 'not json', '[]', '"a string"', '7']) {
    const result = parseSavedView(text)
    assert.equal(result.ok, false, `${JSON.stringify(text)} was accepted`)
    assert.equal(result.code, E_SAVED_VIEW_INVALID)
    assert.equal('value' in result, false)
  }
})

test('an unsupported version is refused before any field is interpreted', () => {
  for (const version of [0, 2, 99, '1', null, undefined]) {
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
    { ...sample(), saved_view_version: 2, view: { mode: 'cluster', anchor_id: DELIVERY } },
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
  const base = sample()
  const mutations = [
    ['snapshot', undefined],
    ['snapshot', { ...base.snapshot, project_id: 42 }],
    ['snapshot', { ...base.snapshot, node_count: '5' }],
    ['view', undefined],
    ['focus_id', 42],
    ['transform', { scale: 0, tx: 0, ty: 0 }],
    ['transform', { scale: Number.NaN, tx: 0, ty: 0 }],
    ['transform', { scale: 1, tx: 'left', ty: 0 }],
    ['transform', undefined],
    ['viewport', { width: 0, height: 693 }],
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
    assert.match(result.reason, new RegExp(key))
  }
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
const ALLOWED_IMPORT = "import { normalizeView, E_VIEW_MODE } from './view-state.mjs'"

test('the module carries no storage, clock, randomness or DOM, and imports only the view state', () => {
  const source = readFileSync(join(repoRoot, 'viewer/atlas39/core/saved-view.mjs'), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it was
  // meant to leave standing — one probe per region of the module.
  assert.match(code, /export function captureSavedView/, 'the comment strip removed captureSavedView')
  assert.match(code, /export function serializeSavedView/, 'the comment strip removed serializeSavedView')
  assert.match(code, /export function parseSavedView/, 'the comment strip removed parseSavedView')
  assert.match(code, /export function validateSavedView/, 'the comment strip removed validateSavedView')
  assert.match(code, /export function restoreSavedView/, 'the comment strip removed restoreSavedView')

  assert.equal(
    code.split(ALLOWED_IMPORT).length - 1,
    1,
    'saved-view.mjs no longer imports exactly the view state, exactly once'
  )
  const body = code.replace(ALLOWED_IMPORT, '')
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

// ATLAS-40 core / slice 2: the saved-view contract.
//
// A saved view is a small, explicitly versioned record of UI state — which
// view, anchored where, focused on what, at which transform, captured at which
// stage size. It carries NO graph: the graph always comes from the snapshot the
// workspace loaded, so restoring can never resurrect a stale copy of the data.
//
// Restoring is fail-closed in a specific way. A saved view that does not fit the
// loaded snapshot is REFUSED with a code and a reason. It is never adapted,
// never partially applied, and never mapped onto whichever node happens to be
// nearest. A silently retargeted view is worse than no saved view at all,
// because the user would believe they are looking at the thing they saved.
//
// The refusal is a value, not a thrown error, and it does NOT tear the stage
// down: the loaded graph is still real and still drawn. That is the difference
// between "this snapshot cannot be trusted" — a stage failure — and "this saved
// view does not apply here".
//
// Pure: no IO, no clock, no randomness, no DOM, no storage. The shell owns the
// storage, because storage can fail and a pure module has nowhere to say so.

import { normalizeView, E_VIEW_MODE } from './view-state.mjs'

export const SAVED_VIEW_VERSION = 1

export const E_SAVED_VIEW_INVALID = 'E_SAVED_VIEW_INVALID'
export const E_SAVED_VIEW_VERSION = 'E_SAVED_VIEW_VERSION'
export const E_SAVED_VIEW_MODE = 'E_SAVED_VIEW_MODE'
export const E_SAVED_VIEW_SNAPSHOT = 'E_SAVED_VIEW_SNAPSHOT'
export const E_SAVED_VIEW_STALE_NODE = 'E_SAVED_VIEW_STALE_NODE'
/** Raised by the shell, not here: storage is the one part this module cannot own. */
export const E_SAVED_VIEW_STORAGE = 'E_SAVED_VIEW_STORAGE'

/**
 * The identity fields a saved view must match to be restorable.
 *
 * Exported with no importing reader, measured across the whole worktree and the
 * ten planned tasks: `validateSavedView` and this list are both read only from
 * inside this module (Task 6 imports SAVED_VIEW_VERSION, captureSavedView,
 * serializeSavedView, parseSavedView, restoreSavedView and E_SAVED_VIEW_STORAGE,
 * and nothing else). They are exported anyway so that a caller which already
 * holds a parsed record — the shell re-checking a restore after a re-scan — can
 * name the identity from here rather than re-spelling six field names where the
 * two lists could disagree. This is the same open call Task 2 left for
 * `isPanning()` and Task 3 for `VIEW_MODES`, and it is named as one PO decision
 * rather than settled here.
 */
export const IDENTITY_FIELDS = Object.freeze([
  'project_id',
  'source_id',
  'contract_version',
  'id_scheme',
  'node_count',
  'edge_count'
])

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.length > 0
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const refusal = (code, reason) => ({ ok: false, code, reason })

function snapshotIdentity(viewModel) {
  return {
    project_id: viewModel.project_id,
    source_id: viewModel.source.source_id,
    contract_version: viewModel.contract_version,
    id_scheme: viewModel.id_scheme,
    node_count: viewModel.counts.nodes,
    edge_count: viewModel.counts.edges
  }
}

/**
 * @returns {object} the saved-view record, ready to serialise
 */
export function captureSavedView({ viewModel, view, focusId, transform, viewport }) {
  return {
    saved_view_version: SAVED_VIEW_VERSION,
    snapshot: snapshotIdentity(viewModel),
    view: { mode: view.mode, anchor_id: view.anchorId ?? null },
    focus_id: typeof focusId === 'string' ? focusId : null,
    transform: { scale: transform.scale, tx: transform.tx, ty: transform.ty },
    viewport: { width: viewport.width, height: viewport.height }
  }
}

// A replacer array both fixes key order and drops anything not in the contract,
// so the stored bytes are a function of the view alone.
const KEY_ORDER = [
  'saved_view_version',
  'snapshot', ...IDENTITY_FIELDS,
  'view', 'mode', 'anchor_id',
  'focus_id',
  'transform', 'scale', 'tx', 'ty',
  'viewport', 'width', 'height'
]

/** Byte-stable serialisation. The same view always stores the same string. */
export function serializeSavedView(saved) {
  return JSON.stringify(saved, KEY_ORDER)
}

/**
 * @param {string|null|undefined} text whatever storage handed back
 * @returns {{ok:true, value:object}|{ok:false, code:string, reason:string}}
 */
export function parseSavedView(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return refusal(E_SAVED_VIEW_INVALID, 'no saved view is stored')
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return refusal(E_SAVED_VIEW_INVALID, `the saved view is not valid JSON: ${error.message}`)
  }
  return validateSavedView(raw)
}

/** @returns {{ok:true, value:object}|{ok:false, code:string, reason:string}} */
export function validateSavedView(raw) {
  if (!isObject(raw)) return refusal(E_SAVED_VIEW_INVALID, 'the saved view is not an object')

  // Version first. An unsupported version must not be read field by field and
  // partially understood — that is how a future field silently becomes a
  // different view in an older build.
  if (raw.saved_view_version !== SAVED_VIEW_VERSION) {
    return refusal(
      E_SAVED_VIEW_VERSION,
      `unsupported saved view version ${JSON.stringify(raw.saved_view_version)}; this workspace reads version ${SAVED_VIEW_VERSION}`
    )
  }

  const snapshot = raw.snapshot
  if (
    !isObject(snapshot) ||
    !isText(snapshot.project_id) ||
    !isText(snapshot.source_id) ||
    !isText(snapshot.contract_version) ||
    !isText(snapshot.id_scheme) ||
    !Number.isInteger(snapshot.node_count) ||
    !Number.isInteger(snapshot.edge_count)
  ) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved view carries no usable snapshot identity')
  }

  if (!isObject(raw.view)) return refusal(E_SAVED_VIEW_INVALID, 'the saved view carries no view')
  const view = normalizeView({ mode: raw.view.mode, anchorId: raw.view.anchor_id ?? null })
  if (!view.ok) {
    return refusal(view.code === E_VIEW_MODE ? E_SAVED_VIEW_MODE : E_SAVED_VIEW_INVALID, view.reason)
  }

  if (raw.focus_id !== null && !isText(raw.focus_id)) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved focus is not a node id')
  }

  const t = raw.transform
  if (!isObject(t) || !isFiniteNumber(t.scale) || t.scale <= 0 || !isFiniteNumber(t.tx) || !isFiniteNumber(t.ty)) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved transform is not a usable transform')
  }

  const v = raw.viewport
  if (!isObject(v) || !isFiniteNumber(v.width) || v.width <= 0 || !isFiniteNumber(v.height) || v.height <= 0) {
    return refusal(E_SAVED_VIEW_INVALID, 'the saved stage size is not a usable size')
  }

  const identity = {}
  for (const key of IDENTITY_FIELDS) identity[key] = snapshot[key]

  return {
    ok: true,
    value: {
      // `saved_view_version` is deliberately NOT carried into the validated
      // value. It could only ever be SAVED_VIEW_VERSION — every other value was
      // refused by the version gate above — so it would be a constant with no
      // reader, and an unread field is a field no test can pay for: the rule
      // view-state.mjs states where it deleted `anchorId` and `complete`.
      // Measured before it was dropped: replacing it with `saved_view_version:
      // 99` left this suite green at exit 0, 16/16.
      snapshot: identity,
      view: view.view,
      focusId: raw.focus_id ?? null,
      transform: { scale: t.scale, tx: t.tx, ty: t.ty },
      viewport: { width: v.width, height: v.height }
    }
  }
}

/**
 * Binds a validated saved view to the graph that is actually loaded.
 *
 * @param {object} viewModel from buildViewModel()
 * @param {object} parsed the `value` of a successful parseSavedView(); anything
 *        else is refused as a value, never thrown
 * @param {{width:number,height:number}} viewport the stage size right now
 * @returns {{ok:true, view:object, focusId:(string|null), transform:object, viewportChanged:boolean}
 *          |{ok:false, code:string, reason:string}}
 */
export function restoreSavedView(viewModel, parsed, viewport) {
  // A refusal is a VALUE in this module, so being handed the wrong shape is
  // answered rather than thrown at a caller that did not read `ok` first — the
  // same contract `isInView` states in view-state.mjs. The concrete mistake is
  // passing the whole parseSavedView RESULT instead of its `.value`: both a
  // success envelope and a refusal carry no `snapshot`, and both used to raise
  // `TypeError: Cannot read properties of undefined (reading 'project_id')`
  // (measured) — which D5 forbids, because a bad saved view must never tear the
  // stage down.
  if (!isObject(parsed) || !isObject(parsed.snapshot) || !isObject(parsed.view)) {
    return refusal(E_SAVED_VIEW_INVALID, 'restoreSavedView was not given a validated saved view')
  }

  const identity = snapshotIdentity(viewModel)
  for (const key of IDENTITY_FIELDS) {
    if (parsed.snapshot[key] !== identity[key]) {
      return refusal(
        E_SAVED_VIEW_SNAPSHOT,
        `the saved view was captured against a different graph (${key} was ${JSON.stringify(parsed.snapshot[key])}, this graph has ${JSON.stringify(identity[key])})`
      )
    }
  }

  // A node id that is no longer in the graph is refused — never resolved to a
  // neighbour, a prefix match or the nearest surviving page.
  for (const [what, id] of [['anchor', parsed.view.anchorId], ['focus', parsed.focusId]]) {
    if (id !== null && !viewModel.adjacency.has(id)) {
      return refusal(
        E_SAVED_VIEW_STALE_NODE,
        `the saved ${what} node is not in this graph, and no other node is substituted for it`
      )
    }
  }

  return {
    ok: true,
    view: parsed.view,
    focusId: parsed.focusId,
    // Handed back unchanged; the shell clamps it to the world it actually has.
    transform: parsed.transform,
    // Mode, anchor and focus restore exactly. The zoom and position restore
    // exactly only when the stage is the same size, so the difference is
    // reported rather than presented as pixel-identical.
    viewportChanged: parsed.viewport.width !== viewport.width || parsed.viewport.height !== viewport.height
  }
}

// ATLAS-40 core / slice 2: which part of the real graph is on the stage.
//
// A "view" here is strictly a PROJECTION over the snapshot that is already
// loaded. It adds no relationship, infers nothing, names no cluster and knows
// no taxonomy: the canonical relation-type catalogue is still an open ATLAS
// question, and a viewer that invented one would be putting a decision on
// screen that nobody has made.
//
// Two modes, both derived from data that is literally in the snapshot:
//
//   overview       every node and every edge of the loaded graph
//   neighbourhood  one real node, plus the nodes its EXPLICIT edges reach, plus
//                  every explicit edge whose BOTH endpoints are in that set
//
// The projected model keeps the node facts of the full graph — depth, degree,
// provenance and the adjacency the inspector reads — because those are facts
// about the page, not about the view. Restricting them would make the inspector
// under-report a page's real relations, which is the same class of lie as
// drawing an edge that is not there.
//
// Pure: no IO, no clock, no randomness, no DOM.

// VIEW_MODES is exported with no production reader in the ten planned tasks:
// measured across the whole worktree, its only readers are `normalizeView`
// below and this task's own suite (Task 4 imports `normalizeView` and
// `E_VIEW_MODE`; Task 6 imports `DEFAULT_VIEW`, `applyView`, `isInView` and
// `viewCaption`). It is exported anyway so that a mode control enumerates the
// modes this build supports from here instead of re-spelling them in the shell,
// where the two lists could disagree. Keeping an export that only tests read is
// the same call Task 2 left open for `isPanning()`/`isClickSuppressed()`, and it
// is named as one open PO decision in the plan rather than settled here.
export const VIEW_MODES = Object.freeze(['overview', 'neighbourhood'])
export const DEFAULT_VIEW = Object.freeze({ mode: 'overview', anchorId: null })

export const E_VIEW_MODE = 'E_VIEW_MODE'
export const E_VIEW_ANCHOR = 'E_VIEW_ANCHOR'

const refusal = (code, reason) => ({ ok: false, code, reason })

/**
 * Validates a view descriptor against the modes this build supports, without
 * looking at any graph. An unknown mode is refused, never coerced to overview:
 * a view from another build must not come back as a different view that happens
 * to render.
 *
 * @returns {{ok:true, view:{mode:string, anchorId:(string|null)}}|{ok:false, code:string, reason:string}}
 */
export function normalizeView(view) {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) {
    return refusal(E_VIEW_MODE, 'view is not an object')
  }
  if (!VIEW_MODES.includes(view.mode)) {
    return refusal(E_VIEW_MODE, `unsupported view mode ${JSON.stringify(view.mode)}`)
  }
  if (view.mode === 'overview') return { ok: true, view: { mode: 'overview', anchorId: null } }
  if (typeof view.anchorId !== 'string' || view.anchorId.length === 0) {
    return refusal(E_VIEW_ANCHOR, 'a neighbourhood view has no anchor node')
  }
  return { ok: true, view: { mode: 'neighbourhood', anchorId: view.anchorId } }
}

// Exactly what a consumer reads, and nothing else. The first draft also carried
// `anchorId` (a copy of `applied.view.anchorId`) and `complete` (a derived
// boolean); neither had a single reader in the slice, and an unread field is a
// field no test can pay for — both survived being mutated to a wrong value with
// the whole suite green. The anchor of an applied view is `applied.view.anchorId`.
function scopeOf(view, viewModel, nodes, edges) {
  return {
    mode: view.mode,
    shownNodes: nodes.length,
    totalNodes: viewModel.nodes.length,
    shownEdges: edges.length,
    totalEdges: viewModel.edges.length
  }
}

/**
 * Overview returns the view model ITSELF as `model` — the identity projection
 * copies nothing — while a neighbourhood returns a shallow copy carrying the
 * restricted `nodes` and `edges`. So `applied.model === viewModel` holds in one
 * mode and not in the other, and a caller that holds the result for the life of
 * a view must treat `model` as read-only: in overview, mutating it would be
 * mutating the canonical graph. Nothing in this slice mutates it.
 *
 * @param {object} viewModel from buildViewModel()
 * @param {{mode:string, anchorId:(string|null)}} view
 * @returns {{ok:true, view:object, model:object, scope:object}
 *          |{ok:false, code:string, reason:string}}
 */
export function applyView(viewModel, view) {
  const normalized = normalizeView(view)
  if (!normalized.ok) return normalized
  const resolved = normalized.view

  if (resolved.mode === 'overview') {
    return {
      ok: true,
      view: resolved,
      model: viewModel,
      scope: scopeOf(resolved, viewModel, viewModel.nodes, viewModel.edges)
    }
  }

  if (!viewModel.adjacency.has(resolved.anchorId)) {
    // Refused, never silently retargeted. An anchor the graph does not contain
    // must not become "the closest node we do have" — the user would believe
    // they are looking at the thing they asked for.
    return refusal(E_VIEW_ANCHOR, `the anchor node ${JSON.stringify(resolved.anchorId)} is not in this graph`)
  }

  const inView = new Set([resolved.anchorId, ...viewModel.adjacency.get(resolved.anchorId)])
  // View-model order is preserved by construction: filter never reorders.
  const nodes = viewModel.nodes.filter((node) => inView.has(node.node_id))
  // Every explicit edge whose BOTH endpoints are shown — including an edge
  // between two neighbours. That edge is real and both of its ends are on
  // screen; hiding it would draw a graph the snapshot does not contain either.
  const edges = viewModel.edges.filter((edge) => inView.has(edge.from) && inView.has(edge.to))

  // The spread carries the FULL-graph `adjacency` into a model whose `nodes`
  // are restricted, and that is deliberate — `neighboursOf` and the degree it
  // already computed are properties of the whole graph, not of this window onto
  // it. The cost is exact and must be paid by every caller: `selectFocus`
  // (view-model.mjs:234) decides `hasFocus` from `viewModel.adjacency.has(id)`,
  // so on THIS model it answers `hasFocus: true` for a node the view does not
  // draw. Measured on the accepted snapshot with anchor 22478849 and the node
  // 15073290 that the view excludes: `selectFocus(applied.model, 15073290)` is
  // `{hasFocus: true}` while `isInView(applied, 15073290)` is `false`, and
  // feeding that focus state to `buildScene` (scene.mjs:277,
  // `tabbable: focusState.hasFocus ? focusState.focusId === node.node_id : ...`)
  // produces a scene with **tabbable count 0** and every node `dim` — the
  // roving tabindex loses its only entry and the stage cannot be reached from
  // the keyboard at all, which is the failure D3 exists to prevent.
  //
  // `isInView` below is the predicate that closes it: a shell must not hand
  // `selectFocus` an id this view does not draw. The coupling is pinned in
  // test/atlas40-view-state.test.mjs, "the neighbourhood model keeps the full
  // adjacency, so selectFocus reports a focus this view does not draw", so a
  // later change that drops either side is a red suite rather than an
  // unreachable stage.
  return {
    ok: true,
    view: resolved,
    model: { ...viewModel, nodes, edges },
    scope: scopeOf(resolved, viewModel, nodes, edges)
  }
}

/**
 * True when this view actually draws the node. An unknown id is never in view,
 * and neither is anything at all when `applied` is a refusal: this module's
 * contract is that a refusal is a VALUE, so the one predicate it exports answers
 * one instead of throwing a TypeError at a caller that did not check `ok` first.
 */
export function isInView(applied, nodeId) {
  if (applied?.ok !== true) return false
  return applied.model.nodes.some((node) => node.node_id === nodeId)
}

/**
 * The sentence the shell shows and announces. It counts what is drawn against
 * what exists, so a scoped view can never read as "this is the whole graph".
 *
 * Both plurals agree with the number they follow, which is the TOTAL, not the
 * shown count: an anchor with no neighbours draws one node out of five and must
 * still read "1 of 5 nodes".
 *
 * The label clause refuses an empty string as well as a non-string. That is
 * unreachable today, and by a foreign invariant rather than by anything this
 * module controls: `view-model.mjs:38` defines `isText` as a non-empty string
 * and line 68 refuses any node whose `label` is not `isText`, so the shell's
 * anchorLabel() can only hand over a non-empty string or null. It is guarded and
 * pinned anyway, because the day that invariant moves this function would render
 * `Direct neighbourhood of “” — …` and nothing else would say so.
 */
export function viewCaption(scope, anchorLabel = null) {
  const nodes = `${scope.shownNodes} of ${scope.totalNodes} ${scope.totalNodes === 1 ? 'node' : 'nodes'}`
  const edges = `${scope.shownEdges} of ${scope.totalEdges} ${scope.totalEdges === 1 ? 'relation' : 'relations'}`
  if (scope.mode === 'overview') return `Overview — ${nodes}, ${edges}.`
  const of = typeof anchorLabel === 'string' && anchorLabel.length > 0 ? ` of “${anchorLabel}”` : ''
  return `Direct neighbourhood${of} — ${nodes}, ${edges}.`
}

// ATLAS-40 core: search over the real projection.
//
// ATLAS-39 filtered the navigator list inline in app.mjs. That was adequate when
// the only consumer was a list, but ATLAS-40 has three — the navigator, the
// stage focus that a search now drives, and the live-region announcement — and
// three copies of "does this node match" is three chances to disagree about what
// the user searched for. So matching is one pure function, and the shell asks it.
//
// Matching is deliberately literal: a case-insensitive substring of the page
// title, or of the Confluence page id. No fuzzy matching, no ranking heuristic,
// no stemming. A semantic atlas whose search quietly decides that a page the
// user did not type is "close enough" is a tool that cannot be trusted to say
// what is really in the graph.
//
// Pure: no IO, no clock, no randomness, no DOM.

/**
 * @param {object} viewModel from buildViewModel()
 * @param {string} query the raw contents of the search field
 * @returns {{query:string, active:boolean, matches:Array, matchIds:Set<string>, firstMatchId:string|null}}
 *   `active` is false for an empty query — that is the neutral "show everything"
 *   state, which is NOT the same as a query that matched nothing.
 */
export function matchNodes(viewModel, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  if (needle === '') {
    return {
      query: '',
      active: false,
      matches: viewModel.nodes,
      matchIds: new Set(viewModel.nodes.map((n) => n.node_id)),
      firstMatchId: null
    }
  }
  // View-model order, so the "first match" a search focuses is the highest one
  // in the hierarchy rather than an accident of identifier ordering.
  const matches = viewModel.nodes.filter(
    (node) => node.label.toLowerCase().includes(needle) || node.source_ref.toLowerCase().includes(needle)
  )
  return {
    query: needle,
    active: true,
    matches,
    matchIds: new Set(matches.map((n) => n.node_id)),
    firstMatchId: matches.length > 0 ? matches[0].node_id : null
  }
}

/**
 * The message the polite live region announces for a search result. Kept beside
 * the matcher so the count the user hears is the count the matcher produced.
 */
export function searchAnnouncement(result) {
  if (!result.active) return 'Search cleared. Showing all nodes.'
  if (result.matches.length === 0) return `No node matches "${result.query}".`
  const noun = result.matches.length === 1 ? 'node matches' : 'nodes match'
  return `${result.matches.length} ${noun} "${result.query}". ${result.matches[0].label} focused.`
}

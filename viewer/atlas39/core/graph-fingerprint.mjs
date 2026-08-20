// ATLAS-40 core / slice 2 repair: a deterministic fingerprint of the graph
// content a saved view was captured against.
//
// WHY THIS EXISTS. The saved-view identity used to be six cardinal facts —
// project, source, contract version, id scheme, node count, edge count — plus a
// separate check that the saved anchor and focus still resolve. Every one of
// those can hold while the graph the user saved has become a different graph:
// a re-scan that moves one page under a different parent keeps all six numbers
// and keeps both saved ids alive, and the workspace would then recompute a
// DIFFERENT direct neighbourhood and announce a successful restore. That is the
// silent retargeting the saved-view contract exists to prevent, one level
// deeper than it was checked.
//
// So the identity binds CONTENT, not cardinality: the complete node-id
// membership, every edge's endpoints, and every edge's relation type and
// origin. Anything that can change which nodes and relations a view resolves to
// changes the fingerprint.
//
// WHAT IT DELIBERATELY DOES NOT BIND. Labels, depth, degree and provenance are
// not inputs. A retitled Confluence page is the same graph for the purpose of
// resolving a view, and invalidating a saved view over an edited title would
// refuse a restore that is in fact perfectly reproducible. Depth and degree are
// derived from the edges that ARE bound, so binding them again would only add a
// second spelling of the same fact.
//
// NOT A HASH FOR SECURITY. This detects drift between two graphs the workspace
// itself produced; it is not a defence against an attacker choosing a colliding
// graph, and it must never be described as one. It is hand-rolled because every
// digest the platform offers is either asynchronous or forbidden to a pure core
// module, and a new dependency is out of scope for this repair.
//
// Pure: no clock, no randomness, no DOM, no storage, and — unlike every other
// core module — no imports at all, so the strictest form of the shared purity
// guard applies to it unmodified.

/** Names the construction below, so a future change to it can never look like a match. */
export const GRAPH_FINGERPRINT_ALGORITHM = 'fnv1a128/1'

// Code-unit order, never locale order: `localeCompare` is environment- and
// locale-dependent, so a fingerprint built on it would differ between two
// browsers reading the same graph. The same rule the legend and the view model
// are already written under.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Length-prefixed framing, so concatenation is injective.
 *
 * A plain separator cannot do this job: any separator character can also occur
 * inside a node id or a relation type, and then two different graphs can spell
 * the same joined string. That is not hypothetical in this codebase — the edge
 * legend had exactly this defect, where `parent_of<NUL>v2 / explicit` and
 * `parent_of / v2<NUL>explicit` collapsed into one row. Reading a framed field
 * needs no separator at all: take the length, then take that many units.
 *
 * A non-string is tagged `x` rather than `s`, so a value that merely PRINTS
 * like a string can never frame identically to that string. Nothing is thrown:
 * this module answers for whatever it is handed, the way every refusal in the
 * saved-view contract is a value.
 */
const field = (value) => {
  const text = typeof value === 'string' ? value : String(value)
  return `${typeof value === 'string' ? 's' : 'x'}${text.length}:${text}`
}

const FNV_PRIME_64 = 1099511628211n
const FNV_OFFSET_64 = 14695981039346656037n
// Golden-ratio odd constant. A second lane started from a different basis and
// fed the input in the opposite direction decorrelates the two 64-bit results,
// so the pair behaves like a wider digest than either lane alone.
const LANE_B_OFFSET_64 = 0x9e3779b97f4a7c15n
const MASK_64 = 0xffffffffffffffffn

/**
 * FNV-1a over UTF-16 code units, each fed as its low byte then its high byte,
 * so the result never depends on a text encoder being available.
 */
const fnv1a64 = (text, offset, forward) => {
  let hash = offset
  const size = text.length
  for (let index = 0; index < size; index += 1) {
    const code = text.charCodeAt(forward ? index : size - 1 - index)
    hash = ((hash ^ BigInt(code & 0xff)) * FNV_PRIME_64) & MASK_64
    hash = ((hash ^ BigInt(code >>> 8)) * FNV_PRIME_64) & MASK_64
  }
  return hash
}

const hex64 = (value) => value.toString(16).padStart(16, '0')

/**
 * The exact text the fingerprint is taken over. Exported so a test can assert
 * WHAT is bound rather than only that two hashes differ — a hash test alone
 * cannot tell "relation_type is an input" from "relation_type is ignored and
 * something else happened to change".
 *
 * Both lists are sorted here rather than trusted from the view model: the view
 * model's node order is depth-first and its edge order is by `edge_id`, both of
 * which are presentation decisions that could be changed without changing the
 * graph. Sorting on the bound content itself makes the fingerprint independent
 * of insertion order, of Map iteration order, and of any future re-ordering.
 *
 * An absent list is framed differently from an empty one, so a malformed view
 * model cannot fingerprint as a genuinely empty graph.
 */
export function canonicalGraphString(viewModel) {
  const nodes = Array.isArray(viewModel?.nodes) ? viewModel.nodes : null
  const edges = Array.isArray(viewModel?.edges) ? viewModel.edges : null

  const nodeIds = nodes === null ? [] : nodes.map((node) => field(node?.node_id)).sort(byCodeUnit)
  const edgeKeys =
    edges === null
      ? []
      : edges
          .map((edge) => field(edge?.from) + field(edge?.to) + field(edge?.relation_type) + field(edge?.origin))
          .sort(byCodeUnit)

  return (
    field(nodes === null ? 'nodes:absent' : `nodes:${nodeIds.length}`) +
    nodeIds.map(field).join('') +
    field(edges === null ? 'edges:absent' : `edges:${edgeKeys.length}`) +
    edgeKeys.map(field).join('')
  )
}

/**
 * A short, stable, locale-independent fingerprint of the graph content.
 *
 * Same graph -> same string, on any engine and in any insertion order. A change
 * to node membership, to an edge endpoint, to a relation type or to an origin
 * -> a different string.
 */
export function graphFingerprint(viewModel) {
  const canonical = canonicalGraphString(viewModel)
  const laneA = fnv1a64(canonical, FNV_OFFSET_64, true)
  const laneB = fnv1a64(canonical, LANE_B_OFFSET_64, false)
  return `${GRAPH_FINGERPRINT_ALGORITHM}:${hex64(laneA)}${hex64(laneB)}`
}

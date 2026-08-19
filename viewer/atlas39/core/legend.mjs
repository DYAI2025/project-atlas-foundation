// ATLAS-40 core / slice 2: the legend, derived from the graph on the stage.
//
// Slice 1 shipped a legend that read "Root / Level 1 / Level 2" as three fixed
// rows of markup. At five real nodes it happened to be accurate. It was still a
// claim the application could not lose: a snapshot with four levels, with
// unrooted pages, or with no hierarchy at all would have produced the same
// three rows, and nobody would have seen it go wrong.
//
// AC7 asks for a legend that explains the edge types and encodings ACTUALLY
// present, so:
//
//   - one entry per distinct (relation_type, origin) pair that really occurs;
//   - nothing for a type that does not occur — including one that occurred in a
//     different snapshot, or in the view the user was looking at a moment ago;
//   - a deterministic order that depends on neither insertion order, nor Map
//     iteration, nor the process locale;
//   - and an explicit statement of whether the stage distinguishes those types
//     visually. Right now it does not: every explicit relation is drawn with the
//     same idle stroke and the only per-edge variation is the focus highlight.
//     Claiming otherwise would be inventing an encoding.
//
// No enum, no catalogue, no inferred type, no cluster taxonomy. relation_type
// and origin are echoed exactly as the snapshot spells them.
//
// Pure: no IO, no clock, no randomness, no DOM.

import { depthTokenName } from './scene.mjs'

// Code-unit order, deliberately not localeCompare: the legend must not reorder
// itself because the process locale changed.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** The design token every explicit relation is actually stroked with. */
export const EDGE_ENCODING_TOKEN = '--line-strong'

/**
 * @param {object} model a view model, or the projected model of a view
 * @returns {{entries:Array, total:number, distinguishesTypes:boolean,
 *            encodingToken:string, empty:boolean}}
 */
export function buildEdgeLegend(model) {
  const counts = new Map()
  for (const edge of model.edges) {
    // A NUL separator, so a relation type containing the separator cannot
    // collide with a different (type, origin) pair.
    const key = `${edge.relation_type}\u0000${edge.origin}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { relationType: edge.relation_type, origin: edge.origin, count: 1 })
  }
  const entries = [...counts.values()].sort(
    (a, b) => byCodeUnit(a.relationType, b.relationType) || byCodeUnit(a.origin, b.origin)
  )
  return {
    entries,
    total: model.edges.length,
    // One stroke for every relation, so the legend must not imply the colours
    // tell the types apart.
    distinguishesTypes: false,
    encodingToken: EDGE_ENCODING_TOKEN,
    empty: entries.length === 0
  }
}

/** The sentence under the edge rows. It says only what is true of this view. */
export function edgeLegendNote(legend) {
  if (legend.empty) return 'This view draws no relations.'
  if (legend.entries.length === 1) {
    const only = legend.entries[0]
    return `Every relation drawn here is ${only.relationType} (${only.origin}); all are drawn with the same stroke.`
  }
  return 'All relation types are drawn with the same stroke; the stage does not tell them apart visually.'
}

/**
 * Hierarchy depths that really occur, each with the SAME token the renderer
 * strokes the disc with. This is NOT the ATLAS-40 edge legend and is headed as
 * hierarchy; it exists because depth is what the node colours encode, and an
 * unexplained colour is its own small lie.
 */
export function buildDepthLegend(model) {
  const counts = new Map()
  for (const node of model.nodes) {
    const key = node.depth === null ? 'none' : String(node.depth)
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { depth: node.depth, token: depthTokenName(node.depth), count: 1 })
  }
  const entries = [...counts.values()].sort((a, b) => {
    // Nodes with no hierarchy path sort last, together — the same rule the
    // layout uses to give them their own outermost ring.
    if (a.depth === null) return b.depth === null ? 0 : 1
    if (b.depth === null) return -1
    return a.depth - b.depth
  })
  return { entries, empty: entries.length === 0 }
}

/** The caption for a hierarchy depth. The one place this wording is decided. */
export function depthCaption(depth) {
  if (depth === null) return 'No hierarchy path'
  return depth === 0 ? 'Root' : `Level ${depth}`
}

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

// The design token every explicit relation is actually stroked with.
//
// Exported with no production reader. Measured across the whole worktree,
// excluding .git and node_modules: the only occurrences of this name are this
// declaration, its use in buildEdgeLegend below, and the plan. Task 6 imports
// buildEdgeLegend, edgeLegendNote, buildDepthLegend and depthCaption, and paints
// the edge swatch from a re-spelled `var(--line-strong)` in shell CSS instead of
// reading the name from here — so the token the legend NAMES and the token the
// swatch USES are two independent spellings of one claim. It is exported anyway
// so that pair can be collapsed onto one source. Keeping an export only tests
// read is the same call Task 2 left open for isPanning()/isClickSuppressed(),
// Task 3 for VIEW_MODES, and this module for buildEdgeLegend's `total` field
// below — which no consumer reads either; the four are named in the plan as ONE
// open PO decision rather than settled here.
export const EDGE_ENCODING_TOKEN = '--line-strong'

/**
 * @param {object} model a view model, or the projected model of a view
 * @returns {{entries:Array, total:number, distinguishesTypes:boolean,
 *            encodingToken:string, empty:boolean}}
 *
 * `total` counts the edges this model DRAWS. On a neighbourhood that is
 * `applyView(...).scope.shownEdges`, never `scope.totalEdges` — measured on the
 * SPRINT neighbourhood of the accepted snapshot, scope
 * `{shownNodes:2, totalNodes:5, shownEdges:1, totalEdges:4}` against
 * `buildEdgeLegend(applied.model).total === 1`. `scope` spells "total" for the
 * other quantity, which is why this one is named here — but no consumer reads
 * it today: Task 6's paintLegend renders the per-row counts and hands this whole
 * object to edgeLegendNote, and reads `total` nowhere, so the only reads
 * anywhere outside .git and node_modules are four assertions in
 * test/atlas40-legend.test.mjs. It is therefore the fourth unread fact this
 * slice leaves to the one open PO decision recorded above.
 */
export function buildEdgeLegend(model) {
  const counts = new Map()
  for (const edge of model.edges) {
    // The key is the JSON text of the PAIR, not the two fields joined on a
    // separator. A joined key is injective only while no value can contain the
    // separator, and the NUL this used to join on did not have that property
    // either. Measured on the shipped module, with [NUL] standing for the byte:
    // `parent_of[NUL]v2 / explicit` and `parent_of / v2[NUL]explicit` produced
    // ONE row, `{relationType:'parent_of[NUL]v2', origin:'explicit', count:2}`,
    // total 2 — the exact fabrication the separator comment claimed to prevent,
    // performed with the separator itself. JSON.stringify escapes every quote
    // and backslash inside a value, so distinct pairs of strings always produce
    // distinct key text and no value can forge the boundary between the two.
    const key = JSON.stringify([edge.relation_type, edge.origin])
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

/**
 * The sentence under the edge rows. It says only what is true of this view.
 *
 * Both branches make the SAME claim, and it is a claim about relation TYPES:
 * the stroke does not encode which type an edge is. Neither branch may claim
 * that every edge on the stage carries an identical stroke, because that is
 * false in the ordinary interaction state.
 *
 * The single-entry branch used to end `; all are drawn with the same stroke.`,
 * which is exactly that forbidden absolute — and the accepted snapshot carries
 * exactly one relation type, so the overreaching branch was the one that ships.
 * Measured through the shipped shell on the real snapshot, comparing the note
 * to the strokes core/render-webgl.mjs:219-222 actually produces:
 *
 *   nothing focused      edge states ["idle","idle","idle","idle"]
 *                        1 distinct stroke   (--line-strong @ 0.85, width 1.25)
 *   one node focused     edge states ["dim","dim","active","active"]
 *                        2 distinct strokes  (--line-strong @ 0.16, width 1.25
 *                                             and --accent @ 1, width 2)
 *
 * The legend swatch is `background: var(--line-strong)` at full opacity
 * (shell.css), so in the focused state it matched no edge on the stage at all
 * while the note asserted uniformity. AC7 admits only encodings actually
 * present; the focus highlight is not an encoding of the relation, it is an
 * encoding of the selection, and D7 already records that it is the only
 * per-edge variation. The sentence now says what the >= 2 branch below has
 * always said, so the two cannot disagree.
 */
export function edgeLegendNote(legend) {
  if (legend.empty) return 'This view draws no relations.'
  if (legend.entries.length === 1) {
    const only = legend.entries[0]
    return `Every relation drawn here is ${only.relationType} (${only.origin}); the stroke does not vary by relation type.`
  }
  return 'All relation types are drawn with the same stroke; the stage does not tell them apart visually.'
}

/**
 * Hierarchy depths that really occur, each with the SAME token the renderer
 * strokes the disc with. This is NOT the ATLAS-40 edge legend and is headed as
 * hierarchy; it exists because depth is what the node colours encode, and an
 * unexplained colour is its own small lie.
 *
 * What this group does NOT distinguish, written here because the edge legend
 * states its own limit and this one must not be discovered while wiring the
 * shell: depthTokenName collapses every depth >= 3 onto `--depth-n`, so a graph
 * deeper than three levels produces several differently-labelled rows carrying
 * an IDENTICAL swatch. Measured on a six-level graph — `Root -> --depth-0`,
 * `Level 1 -> --depth-1`, `Level 2 -> --depth-2`, `Level 3 -> --depth-n`,
 * `Level 4 -> --depth-n`, `Level 5 -> --depth-n`: 4 distinct tokens over 6 rows.
 * Nothing is wrong on the accepted snapshot, which is three levels deep and
 * gives every row its own token. No flag is returned for it, because the fact is
 * already in the rows — a shell that must say "Level 3 and deeper share one
 * colour" derives it from `new Set(entries.map((e) => e.token)).size <
 * entries.length` rather than from a field only tests would read. D7 records the
 * limitation and assigns the sentence to the shell.
 */
export function buildDepthLegend(model) {
  const counts = new Map()
  for (const node of model.nodes) {
    // The depth itself, not its text. `String(node.depth)` grouped `1` with
    // `'1'` and `null` with `'null'` — one fabricated row each, measured — while
    // Map's SameValueZero keeps every value apart for free. That used to be an
    // argument in this comment and nothing else, and an argument is not a
    // guard: the conversion could be put back and the suite stayed green at
    // exit 0, 13/13. It is a test now — test/atlas40-legend.test.mjs, in "an
    // absent depth is never displayed, and unrooted nodes sort last", over four
    // synthetic nodes with depths `1`, `'1'`, `null` and `'null'`, asserting 4
    // rows. Synthetic on purpose: the loader computes `depth` itself, and the
    // edge key one function up is pinned the same way against origins
    // view-model.mjs:87 refuses.
    const key = node.depth
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

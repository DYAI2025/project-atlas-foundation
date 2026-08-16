// ATLAS-39 core / 2 of 3: view model -> stage geometry.
//
// A deterministic radial hierarchy, on purpose. The obvious alternative — a
// force-directed simulation — was rejected for this ticket for two reasons:
// it moves on every reload, which makes a golden visual verification
// meaningless, and the real force/cluster engine is ATLAS-40 scope.
//
// Depth becomes distance from the centre, so the hierarchy is legible as space
// rather than as decoration. Every coordinate is quantised to an integer: the
// golden SVG is byte-compared in CI on a different platform than it was
// generated on, and integers remove any chance of floating-point drift between
// the two.
//
// Pure: no IO, no clock, no randomness.

const PADDING = 88 // room for labels and the focus halo outside the outermost ring
const MIN_NODE_RADIUS = 11
const DEGREE_STEP = 1.5
const DEGREE_CAP = 8
const ROOT_BONUS = 6
const TOP = -Math.PI / 2 // first node of every ring starts at twelve o'clock

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function nodeRadius(node) {
  const fromDegree = Math.min(node.degree, DEGREE_CAP) * DEGREE_STEP
  const fromRole = node.depth === 0 ? ROOT_BONUS : 0
  return Math.round(MIN_NODE_RADIUS + fromDegree + fromRole)
}

// Nodes are grouped into concentric levels: depth 0, depth 1, ... and finally
// the explicit "unrooted" level for nodes no parent_of edge reaches. Keeping
// unrooted nodes on their own outermost ring is an honesty requirement — they
// must not be mixed into a hierarchy level the data does not support.
function groupIntoLevels(nodes) {
  const byDepth = new Map()
  const unrooted = []
  for (const node of nodes) {
    if (node.depth === null) {
      unrooted.push(node)
      continue
    }
    if (!byDepth.has(node.depth)) byDepth.set(node.depth, [])
    byDepth.get(node.depth).push(node)
  }
  const levels = [...byDepth.keys()]
    .sort((a, b) => a - b)
    .map((depth) => ({ depth, unrooted: false, members: byDepth.get(depth).slice().sort((a, b) => byCodeUnit(a.node_id, b.node_id)) }))
  if (unrooted.length > 0) {
    levels.push({ depth: null, unrooted: true, members: unrooted.slice().sort((a, b) => byCodeUnit(a.node_id, b.node_id)) })
  }
  return levels
}

/**
 * @param {object} viewModel from buildViewModel()
 * @param {{width:number, height:number}} viewport stage size in CSS pixels
 * @returns {{center:{x:number,y:number}, radius:number, rings:Array, placements:Array,
 *            width:number, height:number}}
 */
export function computeLayout(viewModel, viewport) {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const center = { x: Math.round(width / 2), y: Math.round(height / 2) }
  const radius = Math.max(24, Math.round(Math.min(width, height) / 2) - PADDING)

  const levels = groupIntoLevels(viewModel.nodes)
  // A level occupies the centre only when it is a single node at depth 0 — a
  // lone hierarchy root. Everything else needs a ring of its own.
  const centred = levels.length > 0 && levels[0].depth === 0 && levels[0].members.length === 1 ? levels[0] : null
  const ringed = levels.filter((level) => level !== centred)
  const ringCount = ringed.length

  const rings = ringed.map((level, index) => ({
    depth: level.depth,
    unrooted: level.unrooted,
    radius: Math.round((radius * (index + 1)) / ringCount)
  }))

  const placements = []
  if (centred) {
    const node = centred.members[0]
    placements.push({
      node_id: node.node_id,
      label: node.label,
      depth: node.depth,
      degree: node.degree,
      unrooted: false,
      ringRadius: 0,
      x: center.x,
      y: center.y,
      r: nodeRadius(node)
    })
  }
  for (const [index, level] of ringed.entries()) {
    const ringRadius = rings[index].radius
    const count = level.members.length
    for (const [position, node] of level.members.entries()) {
      const angle = TOP + (2 * Math.PI * position) / count
      placements.push({
        node_id: node.node_id,
        label: node.label,
        depth: node.depth,
        degree: node.degree,
        unrooted: level.unrooted,
        ringRadius,
        x: Math.round(center.x + ringRadius * Math.cos(angle)),
        y: Math.round(center.y + ringRadius * Math.sin(angle)),
        r: nodeRadius(node)
      })
    }
  }

  placements.sort((a, b) => byCodeUnit(a.node_id, b.node_id))
  return { width, height, center, radius, rings, placements }
}

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

import { HIERARCHY_RELATION } from './view-model.mjs'

const PADDING = 96 // room for labels and the focus halo outside the outermost ring
const MIN_NODE_RADIUS = 13
const DEGREE_STEP = 1.8
const DEGREE_CAP = 8
const ROOT_BONUS = 7
const LABEL_GAP = 11 // distance from the node edge to the label
const ANCHOR_DEADZONE = 0.34 // |cos| below this reads as "above/below", not "beside"
const TOP = -Math.PI / 2 // first node of every ring starts at twelve o'clock

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function nodeRadius(node) {
  const fromDegree = Math.min(node.degree, DEGREE_CAP) * DEGREE_STEP
  const fromRole = node.depth === 0 ? ROOT_BONUS : 0
  return Math.round(MIN_NODE_RADIUS + fromDegree + fromRole)
}

// Labels are pushed radially outward from the centre and anchored towards the
// side they sit on. Parking every label directly under its node collides as
// soon as two nodes share a vertical band — which real Confluence titles, being
// long, do immediately. Pushing them outward uses the empty space the radial
// layout already creates.
function labelPlacement(x, y, r, center) {
  const dx = x - center.x
  const dy = y - center.y
  const distance = Math.hypot(dx, dy)
  if (distance === 0) {
    return { labelX: x, labelY: y + r + LABEL_GAP + 8, labelAnchor: 'middle' }
  }
  const ux = dx / distance
  const uy = dy / distance
  const reach = r + LABEL_GAP
  return {
    labelX: Math.round(x + ux * reach),
    // The vertical nudge puts the baseline on the visual centre line when the
    // label sits beside the node rather than above or below it.
    labelY: Math.round(y + uy * reach + (Math.abs(ux) > ANCHOR_DEADZONE ? 4 : uy > 0 ? 11 : -3)),
    labelAnchor: ux > ANCHOR_DEADZONE ? 'start' : ux < -ANCHOR_DEADZONE ? 'end' : 'middle'
  }
}

// Angles come from a radial sector walk, not from "next slot on this ring".
// Each subtree owns an angular sector proportional to the number of leaves
// below it, and a child is centred inside its parent's sector — so a child sits
// radially outward from its parent and its edge is a short spoke instead of a
// chord across the whole stage. This is a tree layout, not a force or cluster
// engine: it is a pure function of the parent_of edges.
function assignAngles(viewModel) {
  const children = new Map()
  for (const edge of viewModel.edges) {
    if (edge.relation_type !== HIERARCHY_RELATION) continue
    if (!children.has(edge.from)) children.set(edge.from, [])
    children.get(edge.from).push(edge.to)
  }
  for (const list of children.values()) list.sort(byCodeUnit)

  // Subtree leaf count, guarded against a cyclic parent_of chain.
  const weights = new Map()
  const weigh = (id, seen) => {
    if (weights.has(id)) return weights.get(id)
    if (seen.has(id)) return 1
    seen.add(id)
    const kids = children.get(id) ?? []
    const weight = kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + weigh(kid, seen), 0)
    seen.delete(id)
    weights.set(id, weight)
    return weight
  }

  const angles = new Map()
  const walk = (id, sectorStart, sectorWidth, seen) => {
    if (seen.has(id)) return
    seen.add(id)
    const kids = children.get(id) ?? []
    const total = kids.reduce((sum, kid) => sum + weigh(kid, new Set()), 0)
    if (total === 0) return
    let cursor = sectorStart
    for (const kid of kids) {
      const width = (sectorWidth * weigh(kid, new Set())) / total
      if (!angles.has(kid)) angles.set(kid, cursor + width / 2)
      walk(kid, cursor, width, seen)
      cursor += width
    }
  }

  const roots = viewModel.nodes.filter((n) => n.depth === 0).map((n) => n.node_id).sort(byCodeUnit)
  if (roots.length === 1) {
    walk(roots[0], TOP, 2 * Math.PI, new Set())
  } else {
    const total = roots.reduce((sum, id) => sum + weigh(id, new Set()), 0) || roots.length
    let cursor = TOP
    for (const id of roots) {
      const width = (2 * Math.PI * weigh(id, new Set())) / total
      angles.set(id, cursor + width / 2)
      walk(id, cursor, width, new Set())
      cursor += width
    }
  }
  return angles
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
    const r = nodeRadius(node)
    placements.push({
      node_id: node.node_id,
      label: node.label,
      depth: node.depth,
      degree: node.degree,
      unrooted: false,
      ringRadius: 0,
      x: center.x,
      y: center.y,
      r,
      ...labelPlacement(center.x, center.y, r, center)
    })
  }
  const angles = assignAngles(viewModel)
  for (const [index, level] of ringed.entries()) {
    const ringRadius = rings[index].radius
    const count = level.members.length
    for (const [position, node] of level.members.entries()) {
      // A hierarchy node inherits the angle of its subtree sector; an unrooted
      // node has no parent to point away from, so it falls back to an even
      // share of its own ring.
      const angle = angles.has(node.node_id)
        ? angles.get(node.node_id)
        : TOP + (2 * Math.PI * position) / count
      const x = Math.round(center.x + ringRadius * Math.cos(angle))
      const y = Math.round(center.y + ringRadius * Math.sin(angle))
      const r = nodeRadius(node)
      placements.push({
        node_id: node.node_id,
        label: node.label,
        depth: node.depth,
        degree: node.degree,
        unrooted: level.unrooted,
        ringRadius,
        x,
        y,
        r,
        ...labelPlacement(x, y, r, center)
      })
    }
  }

  placements.sort((a, b) => byCodeUnit(a.node_id, b.node_id))
  return { width, height, center, radius, rings, placements }
}

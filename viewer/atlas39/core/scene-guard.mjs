// ATLAS-40 core / 3 of 4: the last barrier between the scene and the screen.
//
// ATLAS-39 put an allowlist scan between the renderer and the live document
// because the renderer's product was a markup string, and a markup string is one
// regression away from being a script tag. A WebGL scene cannot be a script tag,
// so scanning it for `<script>` would be theatre. The property worth keeping is
// the other half of that gate: the shell draws exactly what the data supports,
// or it draws nothing and says so.
//
// So this module asks the questions that a WebGL stage genuinely can get wrong:
//
//   - is every coordinate a real number? A single NaN in a vertex buffer silently
//     removes a triangle on most drivers — a node vanishes and the graph still
//     looks fine, which is precisely the "success-looking wrong graph" the ATLAS
//     failure rules forbid;
//   - is every state name one the renderer has a colour for? An unknown state
//     would otherwise be painted as some default and read as a real state;
//   - is the interactive region the same circle as the painted halo? That is the
//     accepted ATLAS-39 defect, and an invariant is the only way to keep it
//     fixed;
//   - is exactly one node in the tab order? Zero strands the keyboard user, more
//     than one re-creates the tab tunnel the roving tabindex exists to prevent;
//   - is every label a plain string the overlay can hand to `textContent`?
//
// A finding is a REFUSAL, not a repair. Nothing is clamped, dropped or defaulted:
// the shell paints its failure panel, exactly like every other ATLAS gate.
//
// Pure: no IO, no clock, no randomness, no DOM.

import { NODE_STATES, EDGE_STATES } from './scene.mjs'

const NODE_STATE_SET = new Set(NODE_STATES)
const EDGE_STATE_SET = new Set(EDGE_STATES)
const ANCHORS = new Set(['start', 'middle', 'end'])

// C0 and C1 control characters. A Confluence page title has no legitimate
// reason to carry one, and a label that does has not survived the pipeline
// intact — including the tab and newline that would silently break the
// single-line overlay label into something the user cannot read.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * @param {object} scene the output of projectScene()
 * @returns {string|null} a human-readable reason to refuse, or null when the
 *   scene is fully drawable.
 */
export function sceneViolation(scene) {
  if (!isObject(scene)) return 'scene is not an object'
  for (const field of ['width', 'height']) {
    if (!isFiniteNumber(scene[field]) || scene[field] <= 0) {
      return `scene ${field} is not a positive number`
    }
  }
  if (!Array.isArray(scene.rings)) return 'scene rings is not an array'
  if (!Array.isArray(scene.edges)) return 'scene edges is not an array'
  if (!Array.isArray(scene.nodes)) return 'scene nodes is not an array'
  if (!isObject(scene.counts)) return 'scene counts is missing'
  if (scene.counts.nodes !== scene.nodes.length) {
    return `scene claims ${scene.counts.nodes} nodes but carries ${scene.nodes.length}`
  }
  if (scene.counts.edges !== scene.edges.length) {
    return `scene claims ${scene.counts.edges} edges but carries ${scene.edges.length}`
  }

  for (const [index, ring] of scene.rings.entries()) {
    if (!isObject(ring)) return `ring ${index} is not an object`
    for (const field of ['cx', 'cy', 'r']) {
      if (!isFiniteNumber(ring[field])) return `ring ${index} has a non-finite ${field}`
    }
    if (ring.r < 0) return `ring ${index} has a negative radius`
  }

  const edgeIds = new Set()
  for (const [index, edge] of scene.edges.entries()) {
    if (!isObject(edge)) return `edge ${index} is not an object`
    if (typeof edge.edgeId !== 'string' || edge.edgeId.length === 0) {
      return `edge ${index} has no edge id`
    }
    if (edgeIds.has(edge.edgeId)) return `duplicate edge id ${edge.edgeId}`
    edgeIds.add(edge.edgeId)
    if (!EDGE_STATE_SET.has(edge.state)) {
      return `edge ${edge.edgeId} has unknown state ${JSON.stringify(edge.state)}`
    }
    if (!Array.isArray(edge.points) || edge.points.length < 2) {
      return `edge ${edge.edgeId} has fewer than two points`
    }
    for (const [p, point] of edge.points.entries()) {
      if (!isObject(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        return `edge ${edge.edgeId} point ${p} is not a finite coordinate`
      }
    }
  }

  const nodeIds = new Set()
  let tabbable = 0
  for (const [index, node] of scene.nodes.entries()) {
    if (!isObject(node)) return `node ${index} is not an object`
    if (typeof node.nodeId !== 'string' || node.nodeId.length === 0) {
      return `node ${index} has no node id`
    }
    if (nodeIds.has(node.nodeId)) return `duplicate node id ${node.nodeId}`
    nodeIds.add(node.nodeId)

    for (const field of ['x', 'y', 'r', 'haloR', 'hitR', 'labelX', 'labelY', 'labelMaxWidth']) {
      if (!isFiniteNumber(node[field])) {
        return `node ${node.nodeId} has a non-finite ${field}`
      }
    }
    if (node.r <= 0) return `node ${node.nodeId} has a non-positive radius`
    if (node.haloR < node.r) return `node ${node.nodeId} has a halo smaller than its disc`
    // The ATLAS-39 defect, pinned as an invariant: what the user sees highlighted
    // and what answers a click must be the same circle.
    if (node.hitR !== node.haloR) {
      return `node ${node.nodeId} has a hit radius (${node.hitR}) that differs from its halo (${node.haloR})`
    }
    if (node.labelMaxWidth <= 0) return `node ${node.nodeId} has a non-positive label budget`

    if (!NODE_STATE_SET.has(node.state)) {
      return `node ${node.nodeId} has unknown state ${JSON.stringify(node.state)}`
    }
    if (!ANCHORS.has(node.anchor)) {
      return `node ${node.nodeId} has unknown label anchor ${JSON.stringify(node.anchor)}`
    }
    if (!(node.depth === null || (Number.isInteger(node.depth) && node.depth >= 0))) {
      return `node ${node.nodeId} has an invalid depth ${JSON.stringify(node.depth)}`
    }
    for (const field of ['label', 'ariaLabel']) {
      if (typeof node[field] !== 'string' || node[field].length === 0) {
        return `node ${node.nodeId} has no ${field}`
      }
      if (CONTROL_CHARS.test(node[field])) {
        return `node ${node.nodeId} has a control character in its ${field}`
      }
    }
    if (typeof node.tabbable !== 'boolean') {
      return `node ${node.nodeId} has a non-boolean tabbable flag`
    }
    if (node.tabbable) tabbable += 1
  }

  if (scene.nodes.length > 0 && tabbable !== 1) {
    return `${tabbable} nodes are in the tab order, expected exactly 1`
  }

  return null
}

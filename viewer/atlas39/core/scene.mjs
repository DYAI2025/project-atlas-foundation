// ATLAS-40 core / 2 of 4: view model + layout + focus + transform -> scene.
//
// THIS IS THE NEW RENDERER BOUNDARY. ATLAS-39 made that boundary a markup
// string, because an SVG renderer's product IS markup. A WebGL renderer's
// product is geometry, so the boundary here is a plain data scene: numbers,
// enumerated state names, and the node labels the accessible overlay will show.
//
//     buildScene(viewModel, layout, focusState) -> world scene
//     projectScene(scene, transform)            -> screen scene   <-- drawn + mounted
//
// The screen scene is what BOTH consumers read: core/render-webgl.mjs uploads it
// to the GPU, and the shell's accessible overlay positions its buttons from the
// very same numbers. That is deliberate. In ATLAS-39 the visible focus halo and
// the actual hit target were computed in two places and disagreed — the halo was
// visibly larger than the region that answered a click. Here `haloR` and `hitR`
// are the same field of the same object, so they cannot drift apart.
//
// Security note. The property ATLAS-39 protected was: nothing derived from
// Confluence data may become executable DOM. It survives this change by
// construction rather than by an allowlist scan, because there is no markup
// anywhere on this path — the GPU receives only floats, and the overlay receives
// strings that the shell assigns exclusively through `textContent` and a fixed
// set of attributes. core/scene-guard.mjs is the fail-closed gate that keeps
// that claim honest: a scene carrying anything unrenderable is refused, not
// drawn approximately.
//
// Pure: no IO, no clock, no randomness, no DOM, no WebGL.

/** Extra radius, in world units, between the node disc and its halo. */
export const HALO_GAP = 9
/**
 * Minimum screen radius of the interactive region. At the far end of zoom-out a
 * disc can become a few pixels across; a target that small is not operable, so
 * the halo AND the hit region are both floored here — together, never apart.
 */
export const MIN_HIT_SCREEN_R = 22
/** Fixed tessellation of the quadratic edge bow. Constant, so the scene is deterministic. */
export const EDGE_SEGMENTS = 24
/** Control-point offset as a fraction of edge length; matches the ATLAS-39 stage bow. */
const EDGE_BOW = 0.13
/** Keeps a label clear of the stage border. */
const LABEL_EDGE_PADDING = 12
const MIN_LABEL_WIDTH = 48

export const NODE_STATES = Object.freeze(['idle', 'focus', 'neighbour', 'dim'])
export const EDGE_STATES = Object.freeze(['idle', 'active', 'dim'])

export const E_PALETTE_INVALID = 'E_PALETTE_INVALID'

export class PaletteError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PaletteError'
    this.code = E_PALETTE_INVALID
  }
}

/* ---------- colour ---------- */

const HEX = /^#([0-9a-f]{3,8})$/i
const FUNCTIONAL = /^rgba?\(([^)]*)\)$/i

/**
 * Parses the colour notations tokens.css actually uses — #rgb, #rrggbb,
 * #rrggbbaa and rgb()/rgba() — into premultiplication-free [r,g,b,a] floats in
 * 0..1. Anything else returns null; the caller decides, and every caller in this
 * codebase decides to fail closed.
 *
 * @param {string} value
 * @returns {[number,number,number,number]|null}
 */
export function parseCssColor(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()

  const hex = HEX.exec(text)
  if (hex) {
    const digits = hex[1]
    const expand = (s) => parseInt(s.length === 1 ? s + s : s, 16) / 255
    if (digits.length === 3 || digits.length === 4) {
      const parts = digits.split('').map((d) => expand(d))
      return [parts[0], parts[1], parts[2], digits.length === 4 ? parts[3] : 1]
    }
    if (digits.length === 6 || digits.length === 8) {
      const pair = (i) => expand(digits.slice(i, i + 2))
      return [pair(0), pair(2), pair(4), digits.length === 8 ? pair(6) : 1]
    }
    return null
  }

  const fn = FUNCTIONAL.exec(text)
  if (!fn) return null
  // Both the legacy comma form and the modern space form, with an optional
  // slash-separated alpha.
  const parts = fn[1].replace(/\//g, ' ').split(/[\s,]+/).filter((p) => p.length > 0)
  if (parts.length < 3 || parts.length > 4) return null
  const channel = (raw) => {
    const percent = raw.endsWith('%')
    const n = Number.parseFloat(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(n)) return null
    return Math.min(1, Math.max(0, percent ? n / 100 : n / 255))
  }
  const rgb = [channel(parts[0]), channel(parts[1]), channel(parts[2])]
  if (rgb.some((c) => c === null)) return null
  let alpha = 1
  if (parts.length === 4) {
    const raw = parts[3]
    const percent = raw.endsWith('%')
    const n = Number.parseFloat(percent ? raw.slice(0, -1) : raw)
    if (!Number.isFinite(n)) return null
    alpha = Math.min(1, Math.max(0, percent ? n / 100 : n))
  }
  return [rgb[0], rgb[1], rgb[2], alpha]
}

/**
 * Every colour the WebGL stage paints, named by its design token. The renderer
 * owns no colour of its own: tokens.css stays the single source of truth, which
 * is the same rule ATLAS-39's stylesheets follow. A token that is missing or
 * unparseable is a broken design system, so it fails closed rather than
 * defaulting to some arbitrary pixel.
 *
 * @param {(name: string) => string} readVar resolves a CSS custom property
 * @returns {Record<string, [number,number,number,number]>}
 */
export function resolvePalette(readVar) {
  const wanted = {
    stageGlow: '--stage-glow',
    stageVoid: '--stage-void',
    ringStroke: '--ring-stroke',
    edgeIdle: '--line-strong',
    edgeActive: '--accent',
    discFill: '--surface-3',
    focusFill: '--accent-dim',
    focusStroke: '--accent',
    haloFocus: '--accent-soft',
    depth0: '--depth-0',
    depth1: '--depth-1',
    depth2: '--depth-2',
    depthN: '--depth-n',
    depthNone: '--depth-none'
  }
  const palette = {}
  const broken = []
  for (const [key, token] of Object.entries(wanted)) {
    const parsed = parseCssColor(readVar(token))
    if (!parsed) {
      broken.push(token)
      continue
    }
    palette[key] = parsed
  }
  if (broken.length > 0) {
    throw new PaletteError(`${E_PALETTE_INVALID}: unreadable design tokens ${broken.join(', ')}`)
  }
  return palette
}

/**
 * The name of the design token that a node disc at this depth is stroked with.
 * Exported so the legend can name a token instead of carrying its own list of
 * depth colours.
 *
 * HONEST SCOPE — this is NOT (yet) the single place the depth->colour decision
 * is written in this repository. Two hand-maintained copies of the same ladder
 * remain, and neither is derived from this function:
 *
 *   - `core/render-webgl.mjs` `nodeAppearance()` — the code that actually
 *     strokes the disc on the GPU — inlines the ladder as a chain of ternaries.
 *     That file is on the Slice-2 must-not-change list, so this commit may not
 *     delete the duplicate.
 *   - `stage.css:70-93` — the golden-SVG path — spells it a third time as
 *     `.a39-node[data-depth="0|1|2|none"]` rules over a `--depth-n` default.
 *
 * All three agree today. The WebGL copy is now pinned *against this function*
 * for every depth class: `test/atlas40-render-webgl.test.mjs` ("the depth
 * ladder the GPU is fed is the one `depthColor` computes") reads the stroke
 * colour back out of the uploaded vertex buffer and compares it to
 * `depthColor(palette, depth)`, so those two cannot diverge without a red test.
 * The CSS copy is weaker: `stage.css` is inlined verbatim into the committed
 * golden SVGs (`scripts/atlas39/render-golden.mjs:44-47`), so editing it moves
 * the golden bytes and trips that gate — which detects the edit, but never
 * compares it to this ladder. "Cannot drift by construction" would be an
 * overclaim; "cannot drift without a red test" is what is true of the renderer,
 * and "cannot change unnoticed" is what is true of the CSS.
 */
export function depthTokenName(depth) {
  if (depth === null) return '--depth-none'
  if (depth === 0) return '--depth-0'
  if (depth === 1) return '--depth-1'
  if (depth === 2) return '--depth-2'
  return '--depth-n'
}

/**
 * Which key of a resolved palette each depth token was read into. This is a
 * hand-written inverse of the `depth*` entries of `resolvePalette`'s `wanted`
 * map above — a fourth copy of the same five pairs, in the same file. Deriving
 * both from one shared table would delete the duplicate; that is deferred to
 * the task where the legend becomes the first production consumer of
 * `depthColor`, and until then the pairs are pinned by
 * `test/atlas40-scene.test.mjs` re-reading `tokens.css` by the token name.
 */
const DEPTH_PALETTE_KEY = Object.freeze({
  '--depth-0': 'depth0',
  '--depth-1': 'depth1',
  '--depth-2': 'depth2',
  '--depth-n': 'depthN',
  '--depth-none': 'depthNone'
})

/**
 * The colour a node disc at this depth is stroked with, resolved from the
 * palette. It has no production caller yet — the WebGL renderer computes the
 * same colour from its own inlined ladder (see `depthTokenName` above), and the
 * SVG/golden path takes it from `stage.css`. Until one of those consumes this
 * function it is the *reference* ladder that the others are tested against, not
 * the ladder they execute.
 *
 * Fails closed, like `resolvePalette`: a lookup that lands on no colour throws
 * `PaletteError` instead of returning `undefined`. Not reachable through this
 * module's own two tables today — it guards the next hand-edit of either of
 * them, and a caller that passes a palette this ladder cannot be resolved
 * against. A design system that lost a token must not paint a default pixel and
 * carry on.
 */
export function depthColor(palette, depth) {
  const token = depthTokenName(depth)
  const key = DEPTH_PALETTE_KEY[token]
  const colour = key === undefined ? undefined : palette?.[key]
  if (!colour) {
    throw new PaletteError(`${E_PALETTE_INVALID}: no palette colour for depth token ${token}`)
  }
  return colour
}

/* ---------- world scene ---------- */

function nodeState(focusState, nodeId) {
  if (!focusState.hasFocus) return 'idle'
  if (focusState.focusId === nodeId) return 'focus'
  if (focusState.neighbourIds.has(nodeId)) return 'neighbour'
  return 'dim'
}

function edgeState(focusState, edge) {
  if (!focusState.hasFocus) return 'idle'
  return edge.from === focusState.focusId || edge.to === focusState.focusId ? 'active' : 'dim'
}

/**
 * The scene in world (layout) coordinates. Independent of zoom and pan, so it is
 * rebuilt only when the graph or the focus actually changes.
 *
 * @param {object} viewModel from buildViewModel()
 * @param {object} layout from computeLayout()
 * @param {object} focusState from selectFocus()
 */
export function buildScene(viewModel, layout, focusState) {
  const placements = new Map(layout.placements.map((p) => [p.node_id, p]))

  // Node order is view-model order — hierarchy level first — so the overlay's
  // DOM order, the tab sequence and the navigator all walk the graph the same
  // way. This is the ATLAS-39 roving-tabindex model, unchanged.
  const nodes = viewModel.nodes.map((node, index) => {
    const placement = placements.get(node.node_id)
    const state = nodeState(focusState, node.node_id)
    const depthText = node.depth === null ? 'no hierarchy path' : `level ${node.depth}`
    return {
      nodeId: node.node_id,
      label: node.label,
      ariaLabel: `${node.label}, ${depthText}, ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}`,
      depth: node.depth,
      state,
      // Exactly one node is in the tab order at a time: the focused one, or the
      // first node when nothing is focused.
      tabbable: focusState.hasFocus ? focusState.focusId === node.node_id : index === 0,
      x: placement.x,
      y: placement.y,
      r: placement.r,
      labelX: placement.labelX,
      labelY: placement.labelY,
      anchor: placement.labelAnchor
    }
  })

  const edges = viewModel.edges.map((edge) => {
    const a = placements.get(edge.from)
    const b = placements.get(edge.to)
    return {
      edgeId: edge.edge_id,
      from: edge.from,
      to: edge.to,
      state: edgeState(focusState, edge),
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y
    }
  })

  return {
    width: layout.width,
    height: layout.height,
    center: { x: layout.center.x, y: layout.center.y },
    rings: layout.rings.map((ring) => ({
      cx: layout.center.x,
      cy: layout.center.y,
      r: ring.radius,
      unrooted: ring.unrooted === true
    })),
    edges,
    nodes,
    counts: { nodes: nodes.length, edges: edges.length }
  }
}

/* ---------- screen scene ---------- */

// The quadratic bow ATLAS-39 drew as an SVG `Q` command, tessellated into the
// point list a GPU can consume. Projection is affine, so bowing in screen space
// and bowing in world space produce the same curve; doing it here keeps the
// world scene free of anything zoom-dependent.
function bowPoints(ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  if (length === 0) return [{ x: ax, y: ay }, { x: bx, y: by }]
  const cx = (ax + bx) / 2 - dy * EDGE_BOW
  const cy = (ay + by) / 2 + dx * EDGE_BOW
  const points = []
  for (let i = 0; i <= EDGE_SEGMENTS; i += 1) {
    const t = i / EDGE_SEGMENTS
    const inv = 1 - t
    points.push({
      x: inv * inv * ax + 2 * inv * t * cx + t * t * bx,
      y: inv * inv * ay + 2 * inv * t * cy + t * t * by
    })
  }
  return points
}

/**
 * The width a label may occupy before it would run off the stage, given where it
 * sits and which way it is anchored.
 *
 * ATLAS-39 truncated every label at a fixed 26 characters and one label still
 * clipped by roughly 18px at 1440x900, because a character budget cannot know
 * how close to the border a label starts. This is the measurement that budget
 * was standing in for, so the overlay can clamp with real geometry instead.
 */
export function labelBudget(labelX, anchor, stageWidth) {
  const room = anchor === 'start'
    ? stageWidth - labelX - LABEL_EDGE_PADDING
    : anchor === 'end'
      ? labelX - LABEL_EDGE_PADDING
      : 2 * Math.min(labelX, stageWidth - labelX) - LABEL_EDGE_PADDING
  return Math.max(MIN_LABEL_WIDTH, Math.round(room))
}

/**
 * Applies the transform, producing the geometry that is actually drawn and the
 * geometry the accessible overlay is actually positioned by. One computation,
 * two consumers — so the visible halo and the clickable region are the same
 * circle by construction.
 *
 * @param {object} scene from buildScene()
 * @param {{scale:number,tx:number,ty:number}} transform from core/transform.mjs
 */
export function projectScene(scene, transform) {
  const { scale, tx, ty } = transform
  const px = (x) => x * scale + tx
  const py = (y) => y * scale + ty

  const nodes = scene.nodes.map((node) => {
    const r = node.r * scale
    // One number, used for the painted halo and for the interactive region.
    const haloR = Math.max((node.r + HALO_GAP) * scale, MIN_HIT_SCREEN_R)
    const labelX = px(node.labelX)
    return {
      nodeId: node.nodeId,
      label: node.label,
      ariaLabel: node.ariaLabel,
      depth: node.depth,
      state: node.state,
      tabbable: node.tabbable,
      x: px(node.x),
      y: py(node.y),
      r,
      haloR,
      hitR: haloR,
      labelX,
      labelY: py(node.labelY),
      anchor: node.anchor,
      labelMaxWidth: labelBudget(labelX, node.anchor, scene.width)
    }
  })

  return {
    width: scene.width,
    height: scene.height,
    rings: scene.rings.map((ring) => ({
      cx: px(ring.cx),
      cy: py(ring.cy),
      r: ring.r * scale,
      unrooted: ring.unrooted
    })),
    edges: scene.edges.map((edge) => ({
      edgeId: edge.edgeId,
      state: edge.state,
      points: bowPoints(px(edge.ax), py(edge.ay), px(edge.bx), py(edge.by))
    })),
    nodes,
    counts: { nodes: scene.nodes.length, edges: scene.edges.length }
  }
}

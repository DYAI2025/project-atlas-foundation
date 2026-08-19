// ATLAS-39 core / 3 of 3: geometry + focus state -> SVG markup.
//
// SUPERSEDED AS THE BROWSER RENDERER BY ATLAS-40. The workspace shell now draws
// the stage with core/render-webgl.mjs; app.mjs no longer imports this module
// and the browser never mounts this markup. The prediction below came true: the
// swap needed no change to the view model, the layout, the navigator, the
// inspector or the keyboard model.
//
//     renderStage(viewModel, layout, focusState, options) -> markup string
//
// It is kept, and still fully tested, for one job: the golden SVG files under
// test/golden/ are rendered by this function from the real committed evidence,
// so a byte comparison remains a dependency-free regression gate over the parts
// both renderers share — the view model and the deterministic layout. It is NOT
// evidence about what the browser paints any more; that is the WebGL renderer's
// business and is covered by the ATLAS-40 acceptance run.
//
// The renderer emits CSS classes and data attributes, never colours: the design
// system lives in tokens.css / stage.css. Passing `styleCss` inlines that
// stylesheet so the golden file is a standalone, openable image.
//
// Pure: no IO, no clock, no randomness, no DOM.

const LABEL_MAX = 26
const EDGE_BOW = 0.13 // quadratic control-point offset as a fraction of edge length

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

/** Escapes every character that could break out of text content or an attribute. */
export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => XML_ESCAPES[c])
}

function truncate(label) {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label
}

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

// A quadratic bow rather than a straight line: at low node counts the curve
// separates reciprocal relations and reads considerably calmer than a star of
// straight spokes. The control point is a pure function of the two endpoints,
// so it is as deterministic as the endpoints themselves.
function edgePath(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  const cx = Math.round((a.x + b.x) / 2 - dy * EDGE_BOW)
  const cy = Math.round((a.y + b.y) / 2 + dx * EDGE_BOW)
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

/**
 * @param {object} viewModel from buildViewModel()
 * @param {object} layout from computeLayout()
 * @param {object} focusState from selectFocus()
 * @param {{styleCss?: string}} [options] inline stylesheet, for the standalone golden
 * @returns {string} SVG markup
 */
export function renderStage(viewModel, layout, focusState, options = {}) {
  const positions = new Map(layout.placements.map((p) => [p.node_id, p]))
  const lines = []

  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="a39-stage" viewBox="0 0 ${layout.width} ${layout.height}" ` +
      `width="${layout.width}" height="${layout.height}" role="group" ` +
      `aria-label="${escapeXml(`Semantic graph of project ${viewModel.project_id}: ${viewModel.counts.nodes} nodes, ${viewModel.counts.edges} relations`)}">`
  )

  lines.push('<defs>')
  lines.push(
    '<radialGradient id="a39-field" cx="50%" cy="46%" r="72%">' +
      '<stop offset="0%" stop-color="var(--stage-glow)"/>' +
      '<stop offset="100%" stop-color="var(--stage-void)"/>' +
      '</radialGradient>'
  )
  lines.push('</defs>')
  if (options.styleCss) lines.push(`<style>${options.styleCss}</style>`)

  lines.push(`<rect class="a39-field" x="0" y="0" width="${layout.width}" height="${layout.height}"/>`)

  // Depth rings: the hierarchy drawn as space. Purely decorative geometry, so
  // it is hidden from assistive technology — the depth of each node is already
  // carried by its accessible name and by the navigator in the shell.
  lines.push('<g class="a39-rings" aria-hidden="true">')
  for (const ring of layout.rings) {
    lines.push(
      `<circle class="a39-ring${ring.unrooted ? ' is-unrooted' : ''}" cx="${layout.center.x}" cy="${layout.center.y}" r="${ring.radius}"/>`
    )
  }
  lines.push('</g>')

  lines.push('<g class="a39-edges" aria-hidden="true">')
  for (const edge of viewModel.edges) {
    const a = positions.get(edge.from)
    const b = positions.get(edge.to)
    lines.push(
      `<path class="a39-edge is-${edgeState(focusState, edge)}" d="${edgePath(a, b)}" ` +
        `data-edge-id="${escapeXml(edge.edge_id)}" data-relation="${escapeXml(edge.relation_type)}"/>`
    )
  }
  lines.push('</g>')

  // Nodes are emitted in view-model order — hierarchy level first — so the DOM
  // order a screen reader and the tab sequence walk matches the navigator and
  // the structure, not the geometry.
  lines.push('<g class="a39-nodes">')
  for (const [index, node] of viewModel.nodes.entries()) {
    const placement = positions.get(node.node_id)
    const state = nodeState(focusState, node.node_id)
    // Roving tabindex: exactly one node is in the tab order at a time and the
    // arrow keys move between neighbours, so a large graph never becomes a long
    // tab tunnel.
    const tabbable = focusState.hasFocus ? focusState.focusId === node.node_id : index === 0
    const depthText = node.depth === null ? 'no hierarchy path' : `level ${node.depth}`
    const accessibleName = `${node.label}, ${depthText}, ${node.degree} direct ${node.degree === 1 ? 'relation' : 'relations'}`
    lines.push(
      `<g class="a39-node is-${state}" data-node-id="${escapeXml(node.node_id)}" data-depth="${node.depth === null ? 'none' : node.depth}" ` +
        `role="button" tabindex="${tabbable ? '0' : '-1'}" aria-pressed="${state === 'focus' ? 'true' : 'false'}" ` +
        `aria-label="${escapeXml(accessibleName)}">`
    )
    lines.push(`<title>${escapeXml(node.label)}</title>`)
    lines.push(`<circle class="a39-node-halo" cx="${placement.x}" cy="${placement.y}" r="${placement.r + 9}"/>`)
    lines.push(`<circle class="a39-node-disc" cx="${placement.x}" cy="${placement.y}" r="${placement.r}"/>`)
    lines.push(
      `<text class="a39-node-label" x="${placement.labelX}" y="${placement.labelY}" ` +
        `text-anchor="${placement.labelAnchor}">${escapeXml(truncate(node.label))}</text>`
    )
    lines.push('</g>')
  }
  lines.push('</g>')

  lines.push('</svg>')
  return `${lines.join('\n')}\n`
}

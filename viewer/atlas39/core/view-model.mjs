// ATLAS-39 core / 1 of 3: snapshot -> view model.
//
// This module is loaded byte-identically by the browser shell and by
// `node --test`; that is what makes the golden visual verification honest.
// It is pure (no IO, no globals, no clock) and fail-closed: a snapshot that
// violates gbrain-read/v1 in a way the shell would have to guess around is
// refused with E_VIEW_MODEL_INVALID rather than partially drawn. The server
// already validates the snapshot against the contract before serving it; this
// is the second, independent gate that protects the UI from a snapshot that
// arrived by any other route.
//
// Provenance is treated as evidence, never as decoration: an absent sidecar or
// an unmatched page becomes an explicit null plus a status the UI must show.
// Nothing here ever invents a page id, a revision or a URL.

export const E_VIEW_MODEL_INVALID = 'E_VIEW_MODEL_INVALID'

const CONTRACT_VERSION = '1.0.0'
const ID_SCHEME = 'projection-local/v1'
// The one relation type that carries hierarchy. Exported so the layout derives
// its sectors from the same token the depths were derived from, rather than
// repeating the literal and letting the two drift apart.
export const HIERARCHY_RELATION = 'parent_of'

export class ViewModelError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ViewModelError'
    this.code = E_VIEW_MODEL_INVALID
  }
}

const refuse = (why) => {
  throw new ViewModelError(`${E_VIEW_MODEL_INVALID}: ${why}`)
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.length > 0

// Code-unit order, deliberately not localeCompare: the layout and the golden
// SVG derive from this order, so it must not depend on the process locale.
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

function assertSnapshotShape(snapshot) {
  if (!isObject(snapshot)) refuse('snapshot is not an object')
  if (snapshot.contract_version !== CONTRACT_VERSION) {
    refuse(`unsupported contract_version ${JSON.stringify(snapshot.contract_version)}`)
  }
  if (snapshot.id_scheme !== ID_SCHEME) {
    refuse(`unsupported id_scheme ${JSON.stringify(snapshot.id_scheme)}`)
  }
  // The projection-local boundary marker is load-bearing for the UI: the shell
  // labels these identifiers as non-canonical, so a snapshot claiming canonical
  // ids would make that label a lie.
  if (snapshot.canonical_entity_ids !== false) refuse('canonical_entity_ids must be false')
  if (!isText(snapshot.project_id)) refuse('project_id missing')
  if (!isObject(snapshot.source) || !isText(snapshot.source.source_kind) || !isText(snapshot.source.source_id)) {
    refuse('source is incomplete')
  }
  if (!Array.isArray(snapshot.nodes)) refuse('nodes is not an array')
  if (!Array.isArray(snapshot.edges)) refuse('edges is not an array')
}

function indexNodes(nodes) {
  const byId = new Map()
  for (const node of nodes) {
    if (!isObject(node)) refuse('node is not an object')
    if (!isText(node.node_id) || !isText(node.source_ref) || !isText(node.label)) {
      refuse(`node ${JSON.stringify(node.node_id)} is incomplete`)
    }
    if (byId.has(node.node_id)) refuse(`duplicate node_id ${node.node_id}`)
    byId.set(node.node_id, node)
  }
  return byId
}

function indexEdges(edges, nodesById) {
  const seen = new Set()
  for (const edge of edges) {
    if (!isObject(edge)) refuse('edge is not an object')
    if (!isText(edge.edge_id) || !isText(edge.from) || !isText(edge.to) || !isText(edge.relation_type)) {
      refuse(`edge ${JSON.stringify(edge.edge_id)} is incomplete`)
    }
    // v1 admits explicit relations only. An inferred edge reaching the shell
    // would put a generated relation on screen next to real Confluence
    // provenance, which is exactly the confusion the contract forbids.
    if (edge.origin !== 'explicit') refuse(`edge ${edge.edge_id} has non-explicit origin ${JSON.stringify(edge.origin)}`)
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) refuse(`edge ${edge.edge_id} has a dangling endpoint`)
    if (seen.has(edge.edge_id)) refuse(`duplicate edge_id ${edge.edge_id}`)
    seen.add(edge.edge_id)
  }
}

// Depth comes only from explicit parent_of edges. A node no parent_of edge
// reaches keeps depth null: the layout places it on a clearly separate
// "unrooted" ring instead of pretending to know its level.
function deriveDepths(nodes, edges) {
  const children = new Map()
  const hasParent = new Set()
  for (const edge of edges) {
    if (edge.relation_type !== HIERARCHY_RELATION) continue
    if (!children.has(edge.from)) children.set(edge.from, [])
    children.get(edge.from).push(edge.to)
    hasParent.add(edge.to)
  }
  const depths = new Map()
  const roots = nodes
    .map((n) => n.node_id)
    .filter((id) => !hasParent.has(id) && children.has(id))
    .sort(byCodeUnit)
  let frontier = roots
  let level = 0
  for (const id of frontier) depths.set(id, 0)
  while (frontier.length > 0) {
    const next = []
    for (const id of frontier) {
      for (const child of (children.get(id) ?? []).slice().sort(byCodeUnit)) {
        if (depths.has(child)) continue // first (shallowest) assignment wins
        depths.set(child, level + 1)
        next.push(child)
      }
    }
    frontier = next
    level += 1
  }
  return depths
}

function buildAdjacency(nodes, edges) {
  const adjacency = new Map(nodes.map((n) => [n.node_id, new Set()]))
  for (const edge of edges) {
    adjacency.get(edge.from).add(edge.to)
    adjacency.get(edge.to).add(edge.from)
  }
  return adjacency
}

// A usable sidecar is an object carrying a pages array. Anything else — absent,
// null, wrong shape — is "unavailable", which the shell shows as such.
function readProvenance(provenance) {
  if (!isObject(provenance) || !Array.isArray(provenance.pages)) {
    return { byPageId: new Map(), usable: false, generatedAt: null }
  }
  const byPageId = new Map()
  for (const page of provenance.pages) {
    if (isObject(page) && isText(page.page_id)) byPageId.set(page.page_id, page)
  }
  return {
    byPageId,
    usable: true,
    generatedAt: isText(provenance.generated_at) ? provenance.generated_at : null
  }
}

/**
 * @param {object} snapshot a gbrain-read/v1 graph snapshot
 * @param {object|null} provenance the provenance sidecar, or null when unavailable
 * @returns {object} the immutable view model the layout and renderer consume
 */
export function buildViewModel(snapshot, provenance) {
  assertSnapshotShape(snapshot)
  const nodesById = indexNodes(snapshot.nodes)
  indexEdges(snapshot.edges, nodesById)

  const edges = snapshot.edges.slice().sort((a, b) => byCodeUnit(a.edge_id, b.edge_id))
  const rawNodes = snapshot.nodes.slice().sort((a, b) => byCodeUnit(a.node_id, b.node_id))
  const depths = deriveDepths(rawNodes, edges)
  const adjacency = buildAdjacency(rawNodes, edges)
  const sidecar = readProvenance(provenance)

  let matched = 0
  const nodes = rawNodes.map((node) => {
    const page = sidecar.usable ? sidecar.byPageId.get(node.source_ref) ?? null : null
    if (page) matched += 1
    return {
      node_id: node.node_id,
      source_ref: node.source_ref,
      label: node.label,
      depth: depths.has(node.node_id) ? depths.get(node.node_id) : null,
      degree: adjacency.get(node.node_id).size,
      provenance: page
    }
  })

  const provenanceStatus = !sidecar.usable
    ? 'unavailable'
    : matched === nodes.length
      ? 'complete'
      : 'partial'

  const knownDepths = nodes.map((n) => n.depth).filter((d) => d !== null)

  return {
    contract_version: snapshot.contract_version,
    project_id: snapshot.project_id,
    id_scheme: snapshot.id_scheme,
    canonical_entity_ids: snapshot.canonical_entity_ids,
    source: { source_kind: snapshot.source.source_kind, source_id: snapshot.source.source_id },
    nodes,
    edges: edges.map((e) => ({
      edge_id: e.edge_id,
      from: e.from,
      to: e.to,
      relation_type: e.relation_type,
      origin: e.origin
    })),
    adjacency,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      maxDepth: knownDepths.length > 0 ? Math.max(...knownDepths) : 0
    },
    provenanceStatus,
    provenanceGeneratedAt: sidecar.usable ? sidecar.generatedAt : null
  }
}

/** Direct neighbours of a node, in both edge directions. Unknown id -> empty set. */
export function neighboursOf(viewModel, nodeId) {
  return viewModel.adjacency.get(nodeId) ?? new Set()
}

/** The focus state the renderer paints. An unknown id is the neutral overview. */
export function selectFocus(viewModel, nodeId) {
  const known = typeof nodeId === 'string' && viewModel.adjacency.has(nodeId)
  return {
    hasFocus: known,
    focusId: known ? nodeId : null,
    neighbourIds: known ? new Set(viewModel.adjacency.get(nodeId)) : new Set()
  }
}

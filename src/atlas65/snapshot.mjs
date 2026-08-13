// Persisted-readback -> gbrain-read/v1 snapshot + provenance sidecar.
// Pure and deterministic. Consumes ONLY what came back out of the persisted
// brain; it cannot fetch and it cannot import (enforced by a structural test).
// Only live-verified hierarchy links (link_type=parent_of AND
// link_source=confluence-hierarchy) become edges; anything else the brain may
// have auto-derived is deliberately excluded rather than presented as a
// source-backed relation. The sidecar is display metadata keyed by source_ref —
// it is NOT a second graph model and NOT part of the gbrain-read/v1 contract.
import { composeNodeId, composeEdgeId, validateSnapshot, validateScope, sortErrors } from '../gbrain-read-contract/validate.mjs'

export class SnapshotError extends Error {
  constructor(code, message, errors = []) {
    super(message)
    this.code = code
    this.errors = errors
  }
}

const SOURCE_KIND = 'confluence'
const EDGE_LINK_TYPE = 'parent_of'
const EDGE_LINK_SOURCE = 'confluence-hierarchy'
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function buildSnapshotFromReadback({ project, readback }) {
  if (!Array.isArray(readback.pages) || readback.pages.length === 0) {
    throw new SnapshotError('E_PERSISTENCE_EMPTY', 'persisted gbrain state contains no pilot pages — run atlas65:import; there is no fixture substitution')
  }
  const refBySlug = new Map()
  const provenancePages = []
  for (const page of readback.pages) {
    const fm = page.frontmatter ?? {}
    const ref = fm.confluence_page_id
    if (typeof ref !== 'string' || !page.slug?.endsWith(`/${ref}`) ||
        typeof fm.confluence_version !== 'number' ||
        typeof fm.confluence_url !== 'string' || typeof fm.captured_at !== 'string') {
      throw new SnapshotError('E_READBACK_PROVENANCE', `persisted page ${page.slug}: provenance frontmatter incomplete or inconsistent`)
    }
    if (typeof page.title !== 'string' || page.title.length === 0) {
      throw new SnapshotError('E_READBACK_PROVENANCE', `persisted page ${page.slug}: title missing`)
    }
    refBySlug.set(page.slug, ref)
    provenancePages.push({
      page_id: ref,
      title: page.title,
      version: fm.confluence_version,
      confluence_url: fm.confluence_url,
      captured_at: fm.captured_at,
      gbrain_slug: page.slug
    })
  }

  const nodes = readback.pages
    .map((page) => ({
      node_id: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, refBySlug.get(page.slug)),
      source_ref: refBySlug.get(page.slug),
      label: page.title
    }))
    .sort((a, b) => byCodeUnit(a.node_id, b.node_id))

  const edges = []
  const seen = new Set()
  for (const link of readback.links ?? []) {
    if (link.link_type !== EDGE_LINK_TYPE || link.link_source !== EDGE_LINK_SOURCE) continue
    const fromRef = refBySlug.get(link.from_slug)
    const toRef = refBySlug.get(link.to_slug)
    if (fromRef === undefined || toRef === undefined) {
      throw new SnapshotError('E_READBACK_DANGLING', `persisted hierarchy link ${link.from_slug} -> ${link.to_slug} references a page outside the persisted pilot set`)
    }
    const edge_id = composeEdgeId(project.project_id, SOURCE_KIND, project.root_page_id, EDGE_LINK_TYPE, fromRef, toRef)
    if (seen.has(edge_id)) continue
    seen.add(edge_id)
    edges.push({
      edge_id,
      from: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, fromRef),
      to: composeNodeId(project.project_id, SOURCE_KIND, project.root_page_id, toRef),
      relation_type: EDGE_LINK_TYPE,
      origin: 'explicit'
    })
  }
  edges.sort((a, b) => byCodeUnit(a.edge_id, b.edge_id))

  const snapshot = {
    contract_version: '1.0.0',
    project_id: project.project_id,
    id_scheme: 'projection-local/v1',
    canonical_entity_ids: false,
    source: { source_kind: SOURCE_KIND, source_id: project.root_page_id },
    nodes,
    edges
  }
  const provenance = {
    schema_version: '1.0',
    generated_from: 'gbrain-readback',
    project_id: project.project_id,
    source: { source_kind: SOURCE_KIND, source_id: project.root_page_id },
    pages: provenancePages.sort((a, b) => byCodeUnit(a.page_id, b.page_id))
  }
  return { snapshot, provenance }
}

export function validateOrThrow(snapshot, project) {
  const errors = sortErrors([...validateSnapshot(snapshot), ...validateScope(project, snapshot)])
  if (errors.length > 0) {
    throw new SnapshotError('E_SNAPSHOT_INVALID', `generated snapshot violates gbrain-read/v1 (${errors.length} findings)`, errors)
  }
}

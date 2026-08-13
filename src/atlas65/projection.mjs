// Capture -> GBrain write plan. Pure and deterministic: identical capture yields
// byte-identical pages and links. Provenance (page id, version, URL, capture time)
// travels INSIDE each page's frontmatter so a later readback can rebuild both the
// graph snapshot and the provenance sidecar from persisted state alone.
export class ProjectionError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const GBRAIN_SOURCE_ID_PATTERN = /^[a-z0-9-]{1,32}$/

function frontmatterValue(value) {
  return typeof value === 'number' ? String(value) : JSON.stringify(String(value))
}

export function pageContent(page, capture) {
  const fields = [
    ['type', 'source_page'],
    ['title', page.title],
    ['atlas_project_id', capture.project_id],
    ['confluence_page_id', page.page_id],
    ['confluence_version', page.version],
    ...(page.parent_id === null ? [] : [['confluence_parent_id', page.parent_id]]),
    ['confluence_url', page.confluence_url],
    ['captured_at', capture.captured_at]
  ]
  const fm = fields.map(([k, v]) => `${k}: ${frontmatterValue(v)}`).join('\n')
  return `---\n${fm}\n---\n\n${page.body_storage}\n`
}

export function buildProjection(capture) {
  const gbrainSourceId = `confluence-${capture.source.source_id}`
  if (!GBRAIN_SOURCE_ID_PATTERN.test(gbrainSourceId)) {
    throw new ProjectionError('E_PROJECTION_SOURCE_ID', `derived gbrain source id ${JSON.stringify(gbrainSourceId)} is not a valid gbrain source id`)
  }
  const ids = new Set(capture.pages.map((p) => p.page_id))
  const pages = [...capture.pages]
    .sort((a, b) => (a.page_id < b.page_id ? -1 : 1))
    .map((p) => ({ slug: `pages/${p.page_id}`, content: pageContent(p, capture) }))
  const links = []
  for (const p of capture.pages) {
    if (p.parent_id === null) continue
    // The declared root is the pilot's scope boundary. Its own live parent (for
    // example the space homepage) lies ABOVE that boundary: it is recorded in the
    // capture as provenance but is never materialized as an edge and never a
    // failure. Only NON-root pages must resolve their parent inside the capture.
    if (p.page_id === capture.source.source_id) continue
    if (!ids.has(p.parent_id)) {
      throw new ProjectionError('E_PROJECTION_PARENT_UNKNOWN', `page ${p.page_id} declares parent ${p.parent_id} which is not part of the verified capture`)
    }
    links.push({
      from_slug: `pages/${p.parent_id}`,
      to_slug: `pages/${p.page_id}`,
      link_type: 'parent_of',
      link_source: 'confluence-hierarchy'
    })
  }
  links.sort((a, b) => (`${a.from_slug}>${a.to_slug}` < `${b.from_slug}>${b.to_slug}` ? -1 : 1))
  return { gbrain_source_id: gbrainSourceId, pages, links }
}

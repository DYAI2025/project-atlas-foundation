// ATLAS-65 real-source reader. Fail-closed by design: no synthetic fallback, no
// partial capture. Every page must expose id, title, version.number and (except
// the root) a parentId that matches the declared source set — otherwise the whole
// fetch fails with one precise SourceError.
export class SourceError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const DEFAULT_BASE_URL = 'https://dyai2026.atlassian.net'

export function requireAuth(env) {
  const baseUrl = (env.ATLAS65_CONFLUENCE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const email = env.ATLAS65_CONFLUENCE_EMAIL
  const token = env.ATLAS65_CONFLUENCE_API_TOKEN
  if (!email || !token) {
    throw new SourceError(
      'E_SOURCE_AUTH_MISSING',
      'Confluence credentials missing: set ATLAS65_CONFLUENCE_EMAIL and ATLAS65_CONFLUENCE_API_TOKEN'
    )
  }
  return { baseUrl, authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` }
}

export function pageUrl(baseUrl, pageId) {
  return `${baseUrl}/wiki/api/v2/pages/${pageId}?body-format=storage`
}

export function assertPageShape(raw, expectedId) {
  const fail = (what) => {
    throw new SourceError('E_SOURCE_METADATA', `page ${expectedId}: ${what}`)
  }
  if (raw === null || typeof raw !== 'object') fail('response is not an object')
  if (String(raw.id) !== String(expectedId)) fail(`response id ${JSON.stringify(raw.id)} does not match requested id`)
  if (typeof raw.title !== 'string' || raw.title.length === 0) fail('title missing or empty')
  if (typeof raw.version?.number !== 'number' || !Number.isInteger(raw.version.number)) {
    fail('version.number missing — revision provenance cannot be established')
  }
  if (typeof raw.body?.storage?.value !== 'string') fail('body.storage.value missing')
  const parentId = raw.parentId === undefined || raw.parentId === null ? null : String(raw.parentId)
  return {
    id: String(raw.id),
    title: raw.title,
    version: raw.version.number,
    parentId,
    body: raw.body.storage.value
  }
}

export function verifySourceSet(pages, sourceSet, project) {
  const fail = (what) => {
    throw new SourceError('E_SOURCE_HIERARCHY', what)
  }
  const byId = new Map(pages.map((p) => [p.id, p]))
  const declared = sourceSet.pages
  if (byId.size !== declared.length) fail('fetched page count differs from declared source set')
  const roots = declared.filter((d) => d.expected_parent_id === null)
  if (roots.length !== 1) fail('source set must declare exactly one root')
  if (roots[0].page_id !== project.root_page_id) {
    fail(`declared root ${roots[0].page_id} is not the registered project root ${project.root_page_id}`)
  }
  for (const d of declared) {
    const live = byId.get(d.page_id)
    if (!live) fail(`declared page ${d.page_id} was not fetched`)
    if (d.expected_parent_id === null) continue
    if (!byId.has(d.expected_parent_id)) fail(`page ${d.page_id}: expected parent ${d.expected_parent_id} not in source set`)
    if (live.parentId !== d.expected_parent_id) {
      fail(`page ${d.page_id}: live parent ${JSON.stringify(live.parentId)} != declared ${d.expected_parent_id} — hierarchy drifted, refusing to materialize an unverified edge`)
    }
  }
}

export async function fetchSourceSet({ env, sourceSet, project, capturedAt, fetchImpl = fetch }) {
  const auth = requireAuth(env)
  const pages = []
  for (const d of sourceSet.pages) {
    let res
    try {
      res = await fetchImpl(pageUrl(auth.baseUrl, d.page_id), {
        headers: { authorization: auth.authorization, accept: 'application/json' }
      })
    } catch (e) {
      throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: network failure (${e.message})`)
    }
    if (!res.ok) throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: HTTP ${res.status}`)
    let raw
    try {
      raw = await res.json()
    } catch {
      throw new SourceError('E_SOURCE_UNREADABLE', `page ${d.page_id}: response is not JSON`)
    }
    pages.push(assertPageShape(raw, d.page_id))
  }
  verifySourceSet(pages, sourceSet, project)
  const sorted = [...pages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return {
    schema_version: '1.0',
    project_id: project.project_id,
    source: { source_kind: 'confluence', source_id: project.root_page_id },
    captured_at: capturedAt,
    pages: sorted.map((p) => ({
      page_id: p.id,
      title: p.title,
      version: p.version,
      parent_id: p.parentId,
      confluence_url: `${auth.baseUrl}/wiki/spaces/${project.confluence_space_key}/pages/${p.id}`,
      body_storage: p.body
    }))
  }
}

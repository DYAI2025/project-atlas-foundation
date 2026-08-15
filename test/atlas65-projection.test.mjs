import test from 'node:test'
import assert from 'node:assert/strict'
import { buildProjection, ProjectionError } from '../src/atlas65/projection.mjs'

const capture = () => ({
  schema_version: '1.0',
  project_id: 'PLUMBLINE',
  source: { source_kind: 'confluence', source_id: '900000001' },
  captured_at: '2026-08-13T00:00:00.000Z',
  pages: [
    { page_id: '900000001', title: 'Root', version: 5, parent_id: null, confluence_url: 'https://x/1', body_storage: '<p>r</p>' },
    { page_id: '900000002', title: 'Child', version: 2, parent_id: '900000001', confluence_url: 'https://x/2', body_storage: '<p>c</p>' }
  ]
})

test('projection is deterministic (byte-identical on identical capture)', () => {
  assert.equal(JSON.stringify(buildProjection(capture())), JSON.stringify(buildProjection(capture())))
})

test('projection maps pages to slugs + provenance frontmatter and hierarchy links only', () => {
  const p = buildProjection(capture())
  assert.equal(p.gbrain_source_id, 'confluence-900000001')
  assert.deepEqual(p.pages.map((x) => x.slug), ['pages/900000001', 'pages/900000002'])
  const fm = p.pages[1].content
  assert.match(fm, /^---\n/)
  assert.match(fm, /confluence_page_id: "900000002"/)
  assert.match(fm, /confluence_version: 2/)
  assert.match(fm, /captured_at: "2026-08-13T00:00:00.000Z"/)
  assert.match(fm, /<p>c<\/p>/)
  assert.deepEqual(p.links, [{
    from_slug: 'pages/900000001',
    to_slug: 'pages/900000002',
    link_type: 'parent_of',
    link_source: 'confluence-hierarchy'
  }])
})

test('no relation is ever invented: parentless pages produce zero links', () => {
  const c = capture()
  c.pages[1].parent_id = null
  assert.deepEqual(buildProjection(c).links, [])
})

test('the declared root is the scope boundary: a live root parent above it is never an edge and never a failure', () => {
  // Review round 1 finding: the root page may legitimately live under the space
  // homepage; its parent lies ABOVE the pilot scope and must neither materialize
  // an edge nor hard-fail the good path.
  const c = capture()
  c.pages[0].parent_id = '900000777' // outside the capture, on the ROOT row
  const p = buildProjection(c)
  assert.deepEqual(p.links.map((l) => [l.from_slug, l.to_slug]), [['pages/900000001', 'pages/900000002']])
})

test('a NON-root page with a parent outside the capture fails closed instead of inventing an edge', () => {
  const c = capture()
  c.pages[1].parent_id = '900000099'
  assert.throws(() => buildProjection(c), (e) => e instanceof ProjectionError && e.code === 'E_PROJECTION_PARENT_UNKNOWN')
})

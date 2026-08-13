import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSnapshotFromReadback, SnapshotError } from '../src/atlas65/snapshot.mjs'
import { validateSnapshot, validateScope } from '../src/gbrain-read-contract/validate.mjs'
import { loadRegistry, resolveProject } from '../src/registry/resolve.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const project = resolveProject(loadRegistry(), 'project_id', 'PLUMBLINE')

const readback = () => ({
  pages: [
    {
      slug: 'pages/900000001', title: 'Synthetic root',
      frontmatter: { confluence_page_id: '900000001', confluence_version: 5, confluence_url: 'https://x/1', captured_at: 'T' }
    },
    {
      slug: 'pages/900000002', title: 'Synthetic child A',
      frontmatter: { confluence_page_id: '900000002', confluence_version: 2, confluence_url: 'https://x/2', captured_at: 'T' }
    }
  ],
  links: [
    { from_slug: 'pages/900000001', to_slug: 'pages/900000002', link_type: 'parent_of', link_source: 'confluence-hierarchy' }
  ]
})

test('builder produces a contract-valid, scope-valid snapshot from persisted readback', () => {
  const { snapshot, provenance } = buildSnapshotFromReadback({ project, readback: readback() })
  assert.deepEqual(validateSnapshot(snapshot), [])
  assert.deepEqual(validateScope(project, snapshot), [])
  assert.equal(snapshot.id_scheme, 'projection-local/v1')
  assert.equal(snapshot.canonical_entity_ids, false)
  assert.deepEqual(snapshot.nodes.map((n) => n.node_id), [
    'PLUMBLINE:confluence:7503873:900000001',
    'PLUMBLINE:confluence:7503873:900000002'
  ])
  assert.deepEqual(snapshot.edges.map((e) => e.edge_id), [
    'PLUMBLINE:confluence:7503873:parent_of:900000001:900000002'
  ])
  assert.deepEqual(provenance.pages.map((p) => [p.page_id, p.version]), [['900000001', 5], ['900000002', 2]])
})

test('builder is deterministic (byte-identical)', () => {
  const a = buildSnapshotFromReadback({ project, readback: readback() })
  const b = buildSnapshotFromReadback({ project, readback: readback() })
  assert.equal(JSON.stringify(a), JSON.stringify(b))
})

test('foreign link provenance is excluded — only verified hierarchy edges materialize', () => {
  const r = readback()
  r.links.push({ from_slug: 'pages/900000001', to_slug: 'pages/900000002', link_type: 'mentions', link_source: 'markdown' })
  const { snapshot } = buildSnapshotFromReadback({ project, readback: r })
  assert.equal(snapshot.edges.length, 1)
})

test('a hierarchy link with an endpoint outside the persisted page set fails closed', () => {
  const r = readback()
  r.links.push({ from_slug: 'pages/900000001', to_slug: 'pages/900000009', link_type: 'parent_of', link_source: 'confluence-hierarchy' })
  assert.throws(() => buildSnapshotFromReadback({ project, readback: r }),
    (e) => e instanceof SnapshotError && e.code === 'E_READBACK_DANGLING')
})

test('empty persisted state fails closed — no fixture substitution', () => {
  assert.throws(() => buildSnapshotFromReadback({ project, readback: { pages: [], links: [] } }),
    (e) => e instanceof SnapshotError && e.code === 'E_PERSISTENCE_EMPTY')
})

test('page whose frontmatter lost its provenance fails closed', () => {
  const r = readback()
  delete r.pages[1].frontmatter.confluence_version
  assert.throws(() => buildSnapshotFromReadback({ project, readback: r }),
    (e) => e instanceof SnapshotError && e.code === 'E_READBACK_PROVENANCE')
})

test('structural guard: the readback path can never re-import (no fetch, no confluence module)', () => {
  for (const file of ['src/atlas65/snapshot.mjs', 'scripts/atlas65/generate-snapshot.mjs']) {
    const src = readFileSync(join(repoRoot, file), 'utf8')
    assert.ok(!src.includes('confluence-source'), `${file} must not import the source reader`)
    assert.ok(!/\bfetch\s*\(/.test(src), `${file} must not perform network fetches`)
  }
})

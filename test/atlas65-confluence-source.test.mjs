import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  SourceError,
  requireAuth,
  pageUrl,
  assertPageShape,
  verifySourceSet,
  fetchSourceSet
} from '../src/atlas65/confluence-source.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const FETCH_CLI = join(repoRoot, 'scripts/atlas65/fetch-source.mjs')
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME }

// Synthetic 9xxxxxxxx refs per repo convention — logic tests only; the real-source
// acceptance evidence comes exclusively from the live E2E run.
const SET = {
  schema_version: '1.0',
  project_selector: { selector_kind: 'project_id', selector_value: 'PLUMBLINE' },
  pages: [
    { page_id: '900000001', expected_parent_id: null },
    { page_id: '900000002', expected_parent_id: '900000001' },
    { page_id: '900000003', expected_parent_id: '900000002' }
  ]
}
const PROJECT = { project_id: 'PLUMBLINE', root_page_id: '900000001', confluence_space_key: 'PRODUKTMAN' }
const raw = (id, parent, version = 3) => ({
  id, title: `Page ${id}`, parentId: parent,
  version: { number: version },
  body: { storage: { value: `<p>body of ${id}</p>` } }
})

test('requireAuth fails closed without credentials', () => {
  assert.throws(() => requireAuth({}), (e) => e instanceof SourceError && e.code === 'E_SOURCE_AUTH_MISSING')
})

test('requireAuth returns base url + auth header parts', () => {
  const a = requireAuth({ ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' })
  assert.equal(a.baseUrl, 'https://dyai2026.atlassian.net')
  assert.equal(pageUrl(a.baseUrl, '900000001'),
    'https://dyai2026.atlassian.net/wiki/api/v2/pages/900000001?body-format=storage')
})

test('requireAuth strips trailing slashes from a base-url override', () => {
  const a = requireAuth({
    ATLAS65_CONFLUENCE_BASE_URL: 'https://example.invalid///',
    ATLAS65_CONFLUENCE_EMAIL: 'u@example.com',
    ATLAS65_CONFLUENCE_API_TOKEN: 't'
  })
  assert.equal(a.baseUrl, 'https://example.invalid')
  assert.equal(pageUrl(a.baseUrl, '900000001'),
    'https://example.invalid/wiki/api/v2/pages/900000001?body-format=storage')
})

test('assertPageShape accepts a complete page and normalizes parentId', () => {
  const p = assertPageShape(raw('900000002', '900000001'), '900000002')
  assert.deepEqual(
    { id: p.id, title: p.title, version: p.version, parentId: p.parentId },
    { id: '900000002', title: 'Page 900000002', version: 3, parentId: '900000001' }
  )
  assert.equal(assertPageShape(raw('900000001', undefined), '900000001').parentId, null)
})

for (const [name, mutate] of [
  ['missing version', (r) => { delete r.version }],
  ['non-numeric version', (r) => { r.version = { number: 'x' } }],
  ['missing title', (r) => { r.title = '' }],
  ['id mismatch', (r) => { r.id = '900000009' }],
  ['missing body', (r) => { delete r.body }]
]) {
  test(`assertPageShape fails closed on ${name}`, () => {
    const r = raw('900000002', '900000001'); mutate(r)
    assert.throws(() => assertPageShape(r, '900000002'),
      (e) => e instanceof SourceError && e.code === 'E_SOURCE_METADATA')
  })
}

test('verifySourceSet accepts live-verified parentage', () => {
  const pages = [raw('900000001', undefined), raw('900000002', '900000001'), raw('900000003', '900000002')]
    .map((r) => assertPageShape(r, r.id))
  verifySourceSet(pages, SET, PROJECT) // must not throw
})

test('verifySourceSet fails closed: root not registry root', () => {
  const pages = [assertPageShape(raw('900000001', undefined), '900000001')]
  const set = { ...SET, pages: [{ page_id: '900000001', expected_parent_id: null }] }
  assert.throws(() => verifySourceSet(pages, set, { ...PROJECT, root_page_id: '900000099' }),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_HIERARCHY' &&
      /is not the registered project root/.test(e.message))
})

test('verifySourceSet fails closed: live parent differs from declared', () => {
  const pages = [
    assertPageShape(raw('900000001', undefined), '900000001'),
    assertPageShape(raw('900000002', '900000009'), '900000002'),
    assertPageShape(raw('900000003', '900000002'), '900000003')
  ]
  assert.throws(() => verifySourceSet(pages, SET, PROJECT),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_HIERARCHY' &&
      /hierarchy drifted/.test(e.message))
})

test('verifySourceSet fails closed: declared parent outside the source set', () => {
  const set = {
    ...SET,
    pages: [{ page_id: '900000001', expected_parent_id: null }, { page_id: '900000003', expected_parent_id: '900000005' }]
  }
  const pages = [
    assertPageShape(raw('900000001', undefined), '900000001'),
    assertPageShape(raw('900000003', '900000005'), '900000003')
  ]
  assert.throws(() => verifySourceSet(pages, set, PROJECT),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_HIERARCHY' &&
      /not in source set/.test(e.message))
})

test('fetchSourceSet builds a deterministic capture from live pages', async () => {
  const responses = new Map([
    ['900000001', raw('900000001', undefined, 5)],
    ['900000002', raw('900000002', '900000001', 2)],
    ['900000003', raw('900000003', '900000002', 9)]
  ])
  const fetchImpl = async (url) => {
    const id = url.match(/pages\/(\d+)/)[1]
    return { ok: true, status: 200, json: async () => responses.get(id) }
  }
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  const a = await fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: '2026-08-13T00:00:00.000Z', fetchImpl })
  const b = await fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: '2026-08-13T00:00:00.000Z', fetchImpl })
  assert.equal(JSON.stringify(a), JSON.stringify(b)) // byte-identical
  assert.equal(a.project_id, 'PLUMBLINE')
  assert.deepEqual(a.source, { source_kind: 'confluence', source_id: '900000001' })
  assert.deepEqual(a.pages.map((p) => p.page_id), ['900000001', '900000002', '900000003']) // sorted
  assert.equal(a.pages[1].version, 2)
  assert.equal(a.pages[1].parent_id, '900000001')
  assert.match(a.pages[1].confluence_url, /^https:\/\/dyai2026\.atlassian\.net\/wiki\/spaces\/PRODUKTMAN\/pages\/900000002$/)
})

test('fetchSourceSet fails closed on HTTP error — no partial capture', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) })
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  await assert.rejects(
    fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_UNREADABLE'
  )
})

test('fetchSourceSet fails closed when fetch itself rejects — network failure', async () => {
  const fetchImpl = async () => { throw new Error('socket hang up') }
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  await assert.rejects(
    fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_UNREADABLE' && /network failure/.test(e.message)
  )
})

test('fetchSourceSet fails closed when the response body is not JSON', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } })
  const env = { ATLAS65_CONFLUENCE_EMAIL: 'u@example.com', ATLAS65_CONFLUENCE_API_TOKEN: 't' }
  await assert.rejects(
    fetchSourceSet({ env, sourceSet: SET, project: PROJECT, capturedAt: 'x', fetchImpl }),
    (e) => e instanceof SourceError && e.code === 'E_SOURCE_UNREADABLE' && /not JSON/.test(e.message)
  )
})

test('fetch CLI: unknown project selector is denied before any network use', () => {
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'NOPE'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /no project matches|E_UNKNOWN_PROJECT/)
})

test('fetch CLI: missing credentials fail closed with E_SOURCE_AUTH_MISSING', () => {
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'ATLAS'], { encoding: 'utf8', env: cleanEnv })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SOURCE_AUTH_MISSING/)
})

test('fetch CLI: source set declaring a non-project_id selector_kind fails the scope gate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas65-fetch-'))
  const setPath = join(dir, 'source-set.json')
  writeFileSync(setPath, JSON.stringify({
    schema_version: '1.0',
    project_selector: { selector_kind: 'root_page_id', selector_value: 'ATLAS' },
    pages: [{ page_id: '14778372', expected_parent_id: null }]
  }))
  // Dummy credentials so the observed exit-1 can only come from the scope gate,
  // and a loopback base URL so no environment can ever reach real Confluence.
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'ATLAS'], {
    encoding: 'utf8',
    env: {
      ...cleanEnv,
      ATLAS65_SOURCE_SET_PATH: setPath,
      ATLAS65_CONFLUENCE_BASE_URL: 'https://127.0.0.1:9',
      ATLAS65_CONFLUENCE_EMAIL: 'u@example.com',
      ATLAS65_CONFLUENCE_API_TOKEN: 't'
    }
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SOURCE_SCOPE/)
})

test('fetch CLI: unreadable source-set path fails closed with E_SOURCE_SET_UNREADABLE', () => {
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'ATLAS'], {
    encoding: 'utf8',
    env: { ...cleanEnv, ATLAS65_SOURCE_SET_PATH: join(tmpdir(), 'atlas65-does-not-exist.json') }
  })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_SOURCE_SET_UNREADABLE/)
})

test('fetch CLI: source set without a project_selector object fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas65-fetch-'))
  const setPath = join(dir, 'source-set.json')
  writeFileSync(setPath, JSON.stringify({ schema_version: '1.0', pages: [] }))
  const r = spawnSync(process.execPath, [FETCH_CLI, '--project', 'ATLAS'], {
    encoding: 'utf8',
    env: { ...cleanEnv, ATLAS65_SOURCE_SET_PATH: setPath }
  })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_SOURCE_SET_UNREADABLE/)
})

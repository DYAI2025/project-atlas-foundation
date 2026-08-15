import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'scripts/atlas25/discover.mjs')
// No inherited environment: no real credential can ever reach these tests, and a
// loopback base URL means no test can ever reach real Confluence.
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME }
const offline = {
  ...cleanEnv,
  ATLAS65_CONFLUENCE_BASE_URL: 'https://127.0.0.1:9',
  ATLAS65_CONFLUENCE_EMAIL: 'u@example.com',
  ATLAS65_CONFLUENCE_API_TOKEN: 't'
}

const run = (args, env = cleanEnv) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })

test('CLI: missing --project is a usage error (exit 2)', () => {
  const r = run([])
  assert.equal(r.status, 2)
  assert.match(r.stderr, /usage/)
})

test('CLI: unknown project is denied before any network use (exit 1)', () => {
  const r = run(['--project', 'NOPE'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: a project name that only differs in case is denied — no fuzzy routing', () => {
  const r = run(['--project', 'atlas'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: a Jira key passed as a project id is denied — project_id is the only selector', () => {
  const r = run(['--project', 'PLUM'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_UNKNOWN_PROJECT/)
})

test('CLI: missing credentials fail closed with E_SOURCE_AUTH_MISSING (exit 1)', () => {
  const r = run(['--project', 'ATLAS'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_SOURCE_AUTH_MISSING/)
})

test('CLI: an unreachable Confluence host fails closed with E_DISCOVERY_UNREADABLE (exit 1)', () => {
  const r = run(['--project', 'ATLAS'], offline)
  assert.equal(r.status, 1)
  assert.match(r.stderr, /E_DISCOVERY_UNREADABLE/)
})

test('CLI: an ambiguous registry is a technical error (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas25-cli-'))
  const registryPath = join(dir, 'registry.json')
  const real = JSON.parse(readFileSync(join(repoRoot, 'config/project-registry.json'), 'utf8'))
  real.projects.push({ ...real.projects[0] }) // duplicate project_id
  writeFileSync(registryPath, JSON.stringify(real))
  const r = run(['--project', 'ATLAS'], { ...offline, ATLAS_REGISTRY_PATH: registryPath })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_REGISTRY_AMBIGUOUS|E_REGISTRY_INVALID/)
})

test('CLI: an unreadable --previous file fails closed (exit 2) before any network use', () => {
  const r = run(
    ['--project', 'ATLAS', '--previous', join(tmpdir(), 'atlas25-does-not-exist.json')],
    offline
  )
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_PREVIOUS_UNREADABLE/)
})

test('CLI: a --previous file that is not JSON fails closed (exit 2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas25-cli-'))
  const p = join(dir, 'previous.json')
  writeFileSync(p, 'not json')
  const r = run(['--project', 'ATLAS', '--previous', p], offline)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /E_PREVIOUS_UNREADABLE/)
})

test('CLI: an unknown option is a usage error (exit 2)', () => {
  const r = run(['--project', 'ATLAS', '--fuzzy'], offline)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /usage|unknown option/)
})

test('CLI: no stdout or stderr output contains a credential value', () => {
  const r = run(['--project', 'ATLAS'], offline)
  const all = `${r.stdout}${r.stderr}`
  assert.equal(all.includes('u@example.com'), false)
  assert.equal(all.includes('Basic '), false)
  assert.equal(/authorization/i.test(all), false)
})

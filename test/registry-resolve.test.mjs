import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SCHEMA_VERSION,
  RegistryError,
  loadRegistry,
  validateRegistry,
  resolveProject
} from '../src/registry/resolve.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'src/registry/cli.mjs')

function runCli(args, options = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function body(run) {
  return JSON.parse(run.stdout)
}

function assertResponseShape(response) {
  assert.deepEqual(Object.keys(response), ['schema_version', 'resolved', 'project', 'errors'])
  assert.equal(response.schema_version, SCHEMA_VERSION)
}

function freshRegistry() {
  return structuredClone(loadRegistry())
}

// --- positive resolution -----------------------------------------------------

const POSITIVE_CASES = [
  { args: ['--project-id', 'ATLAS'], expect: 'ATLAS' },
  { args: ['--jira-key', 'EYT'], expect: 'EASYTREE' },
  { args: ['--root-page-id', '7503873'], expect: 'PLUMBLINE' }
]

for (const { args, expect } of POSITIVE_CASES) {
  test(`resolves ${args.join(' ')} to ${expect} with full response and exit 0`, () => {
    const run = runCli(args)
    assert.equal(run.code, 0, run.stderr)
    const response = body(run)
    assertResponseShape(response)
    assert.equal(response.resolved, true)
    assert.deepEqual(response.errors, [])
    assert.deepEqual(Object.keys(response.project), [
      'project_id',
      'jira_key',
      'confluence_space_key',
      'root_page_id',
      'allowed_writers',
      'approval_workflow',
      'status'
    ])
    assert.equal(response.project.project_id, expect)
    assert.equal(response.project.confluence_space_key, 'PRODUKTMAN')
    assert.equal(response.project.status, 'active')
  })
}

// --- unknown / deny by default ----------------------------------------------

const DENY_CASES = [
  ['--jira-key', 'NOPE'],
  ['--root-page-id', '999999'],
  // lowercase must NOT silently resolve EASYTREE: exact matching, no case folding
  ['--jira-key', 'eyt']
]

for (const args of DENY_CASES) {
  test(`denies ${args.join(' ')} with E_UNKNOWN_PROJECT and exit 1`, () => {
    const run = runCli(args)
    assert.equal(run.code, 1)
    const response = body(run)
    assertResponseShape(response)
    assert.equal(response.resolved, false)
    assert.equal(response.project, null)
    assert.deepEqual(
      response.errors.map((e) => e.code),
      ['E_UNKNOWN_PROJECT']
    )
  })
}

// --- usage errors ------------------------------------------------------------

const USAGE_CASES = [
  { name: 'no argument', args: [] },
  { name: 'multiple selectors', args: ['--jira-key', 'EYT', '--project-id', 'ATLAS'] },
  { name: 'selector without value', args: ['--jira-key'] },
  { name: 'unknown option', args: ['--fuzzy', 'EYT'] },
  { name: 'empty selector value', args: ['--jira-key', ''] },
  { name: 'prototype-chain option name', args: ['--__proto__', 'ATLAS'] },
  { name: 'hasOwnProperty as option name', args: ['hasOwnProperty', 'ATLAS'] }
]

for (const { name, args } of USAGE_CASES) {
  test(`usage error (${name}) exits 2 with E_USAGE`, () => {
    const run = runCli(args)
    assert.equal(run.code, 2)
    const response = body(run)
    assertResponseShape(response)
    assert.equal(response.resolved, false)
    assert.deepEqual(response.errors.map((e) => e.code), ['E_USAGE'])
    assert.match(run.stderr, /registry:/)
  })
}

// Prototype-chain method names must be treated as ordinary (unknown) selector
// values — deny with exit 1, never a usage error or option-map confusion.
for (const value of ['toString', 'constructor', 'hasOwnProperty']) {
  test(`prototype-chain value "${value}" is an ordinary unknown selector (exit 1)`, () => {
    const run = runCli(['--jira-key', value])
    assert.equal(run.code, 1, run.stderr)
    const response = body(run)
    assert.deepEqual(response.errors.map((e) => e.code), ['E_UNKNOWN_PROJECT'])
  })
}

// --- registry error paths, end-to-end at CLI level ---------------------------

function runCliWithRegistry(registryContent) {
  const dir = mkdtempSync(join(tmpdir(), 'registry-'))
  const path = join(dir, 'registry.json')
  if (registryContent !== null) writeFileSync(path, registryContent)
  return runCli(['--jira-key', 'EYT'], { env: { ...process.env, ATLAS_REGISTRY_PATH: path } })
}

test('CLI: unreadable registry fails closed with E_REGISTRY_UNREADABLE exit 2', () => {
  const run = runCliWithRegistry(null)
  assert.equal(run.code, 2)
  assert.deepEqual(body(run).errors.map((e) => e.code), ['E_REGISTRY_UNREADABLE'])
})

test('CLI: syntactically invalid registry fails closed with E_REGISTRY_INVALID exit 2', () => {
  const run = runCliWithRegistry('{ not json')
  assert.equal(run.code, 2)
  assert.deepEqual(body(run).errors.map((e) => e.code), ['E_REGISTRY_INVALID'])
})

test('CLI: registry with duplicate jira_key fails closed with E_REGISTRY_AMBIGUOUS exit 2', () => {
  const rigged = freshRegistry()
  rigged.projects[1].jira_key = rigged.projects[0].jira_key
  const run = runCliWithRegistry(JSON.stringify(rigged))
  assert.equal(run.code, 2)
  assert.deepEqual(body(run).errors.map((e) => e.code), ['E_REGISTRY_AMBIGUOUS'])
})

// --- registry integrity (fail closed) ---------------------------------------

test('duplicate jira_key is rejected as E_REGISTRY_AMBIGUOUS', () => {
  const registry = freshRegistry()
  registry.projects[1].jira_key = registry.projects[0].jira_key
  assert.throws(() => validateRegistry(registry), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_AMBIGUOUS')
})

test('duplicate project_id is rejected before ambiguity can resolve', () => {
  const registry = freshRegistry()
  registry.projects[2].project_id = registry.projects[0].project_id
  assert.throws(
    () => validateRegistry(registry),
    (e) => e instanceof RegistryError && ['E_REGISTRY_AMBIGUOUS', 'E_REGISTRY_INVALID'].includes(e.code)
  )
})

test('duplicate root_page_id is rejected as E_REGISTRY_AMBIGUOUS', () => {
  const registry = freshRegistry()
  registry.projects[1].root_page_id = registry.projects[2].root_page_id
  assert.throws(() => validateRegistry(registry), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_AMBIGUOUS')
})

test('wrong space key is rejected as E_REGISTRY_INVALID', () => {
  const registry = freshRegistry()
  registry.projects[1].confluence_space_key = 'EYT'
  assert.throws(() => validateRegistry(registry), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_INVALID')
})

test('bot/agent or unexpected writer is rejected as E_REGISTRY_INVALID', () => {
  for (const writers of [['agent-bot'], ['benjamin.poersch', 'claude'], []]) {
    const registry = freshRegistry()
    registry.projects[0].allowed_writers = writers
    assert.throws(() => validateRegistry(registry), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_INVALID')
  }
})

test('missing required field is rejected as E_REGISTRY_INVALID', () => {
  for (const field of ['project_id', 'jira_key', 'confluence_space_key', 'root_page_id', 'allowed_writers', 'approval_workflow', 'status']) {
    const registry = freshRegistry()
    delete registry.projects[1][field]
    assert.throws(() => validateRegistry(registry), (e) => e instanceof RegistryError, field)
  }
})

test('extra or missing V1 project is rejected as E_REGISTRY_INVALID', () => {
  const missing = freshRegistry()
  missing.projects.pop()
  assert.throws(() => validateRegistry(missing), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_INVALID')

  const extra = freshRegistry()
  extra.projects.push({ ...structuredClone(extra.projects[0]), project_id: 'ROGUE', jira_key: 'RGE', root_page_id: '1' })
  assert.throws(() => validateRegistry(extra), (e) => e instanceof RegistryError && e.code === 'E_REGISTRY_INVALID')
})

test('resolveProject rejects unknown selector kinds and duplicate matches', () => {
  const registry = freshRegistry()
  assert.throws(() => resolveProject(registry, 'title', 'ATLAS'), (e) => e.code === 'E_USAGE')
  const rigged = freshRegistry()
  rigged.projects[1].jira_key = rigged.projects[0].jira_key
  assert.throws(
    () => resolveProject(rigged, 'jira_key', rigged.projects[0].jira_key),
    (e) => e.code === 'E_REGISTRY_AMBIGUOUS'
  )
})

// --- determinism -------------------------------------------------------------

test('identical lookups produce byte-identical stdout and identical exit codes', () => {
  for (const args of [['--jira-key', 'EYT'], ['--jira-key', 'NOPE'], []]) {
    const first = runCli(args)
    const second = runCli(args)
    assert.equal(first.stdout, second.stdout, args.join(' '))
    assert.equal(first.code, second.code, args.join(' '))
  }
})

// --- CWD robustness ----------------------------------------------------------

test('CLI resolves the registry independent of the working directory', () => {
  const fromRepo = runCli(['--jira-key', 'EYT'], { cwd: repoRoot })
  const fromTmp = runCli(['--jira-key', 'EYT'], { cwd: tmpdir() })
  assert.equal(fromTmp.code, 0, fromTmp.stderr)
  assert.equal(fromTmp.stdout, fromRepo.stdout)
})

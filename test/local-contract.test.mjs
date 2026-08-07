import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AjvModule from 'ajv/dist/2020.js'
import {
  CONTRACT_VERSION,
  VALIDATION_ERROR_CODES,
  validateRequest
} from '../src/local-contract/validate.mjs'

const Ajv2020 = AjvModule.default ?? AjvModule

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'src/local-contract/cli.mjs')
const fixture = (name) => join(repoRoot, 'fixtures/local-contract', name)

function runCli(args, envOverrides = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides }
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function parsedStdout(run) {
  return JSON.parse(run.stdout)
}

function assertResponseShape(body) {
  assert.deepEqual(Object.keys(body), ['contract_version', 'valid', 'errors'])
  assert.equal(body.contract_version, CONTRACT_VERSION)
  assert.equal(typeof body.valid, 'boolean')
  assert.ok(Array.isArray(body.errors))
  for (const e of body.errors) {
    assert.deepEqual(Object.keys(e), ['path', 'code', 'message'])
  }
}

test('valid fixture: exit 0, valid=true, no errors', () => {
  const run = runCli([fixture('valid-request.json')])
  assert.equal(run.code, 0)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.valid, true)
  assert.deepEqual(body.errors, [])
})

test('missing required field: exit 1 with E_MISSING at /operation', () => {
  const run = runCli([fixture('invalid-missing-field.json')])
  assert.equal(run.code, 1)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.valid, false)
  assert.deepEqual(body.errors, [
    { path: '/operation', code: 'E_MISSING', message: 'required field missing' }
  ])
})

test('wrong data type: exit 1 with E_TYPE at /request_id', () => {
  const run = runCli([fixture('invalid-wrong-type.json')])
  assert.equal(run.code, 1)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.valid, false)
  assert.deepEqual(body.errors, [
    { path: '/request_id', code: 'E_TYPE', message: 'must be a string' }
  ])
})

test('syntactically invalid JSON file: exit 2 with E_INVALID_JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-contract-'))
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ "contract_version": ')
  const run = runCli([broken])
  assert.equal(run.code, 2)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.valid, false)
  assert.equal(body.errors[0].code, 'E_INVALID_JSON')
  assert.match(run.stderr, /not valid JSON/)
})

test('unreadable file: exit 2 with E_UNREADABLE', () => {
  const run = runCli([fixture('does-not-exist.json')])
  assert.equal(run.code, 2)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.errors[0].code, 'E_UNREADABLE')
})

test('missing argument: exit 2 with E_USAGE', () => {
  const run = runCli([])
  assert.equal(run.code, 2)
  const body = parsedStdout(run)
  assertResponseShape(body)
  assert.equal(body.errors[0].code, 'E_USAGE')
  assert.match(run.stderr, /usage:/)
})

test('output is deterministic: identical stdout across runs AND locales', () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-contract-'))
  const nonAscii = join(dir, 'non-ascii-unknown-fields.json')
  writeFileSync(
    nonAscii,
    JSON.stringify({
      contract_version: '1.0.0',
      request_id: 'req-003',
      repository: { owner: 'DYAI2025', name: 'project-atlas-foundation' },
      operation: 'inspect',
      'ä': 1,
      'z': 2
    })
  )
  const inputs = [
    fixture('valid-request.json'),
    fixture('invalid-missing-field.json'),
    fixture('invalid-wrong-type.json'),
    nonAscii
  ]
  const locales = ['C', 'de_DE.UTF-8', 'sv_SE.UTF-8']
  for (const input of inputs) {
    const runs = locales.map((lc) => runCli([input], { LC_ALL: lc, LANG: lc }))
    for (const r of runs.slice(1)) {
      assert.equal(r.stdout, runs[0].stdout, `${input} stdout differs across locales`)
      assert.equal(r.code, runs[0].code, `${input} exit code differs across locales`)
    }
  }
  const nonAsciiBody = JSON.parse(runCli([nonAscii]).stdout)
  assert.deepEqual(
    nonAsciiBody.errors.map((e) => e.path),
    ['/z', '/ä'],
    'non-ASCII paths must sort in UTF-16 code-unit order (z < ä)'
  )
})

test('multiple violations are reported sorted by path, then code', () => {
  const body = validateRequest({
    request_id: '',
    repository: { owner: 42 },
    operation: 'delete',
    extra: true
  })
  assert.equal(body.valid, false)
  assert.deepEqual(
    body.errors.map((e) => `${e.path}:${e.code}`),
    [
      '/contract_version:E_MISSING',
      '/extra:E_UNKNOWN_FIELD',
      '/operation:E_ENUM',
      '/repository/name:E_MISSING',
      '/repository/owner:E_TYPE',
      '/request_id:E_EMPTY'
    ]
  )
})

test('non-object root: single E_ROOT_TYPE error', () => {
  for (const root of [null, [], 'x', 7]) {
    const body = validateRequest(root)
    assert.equal(body.valid, false)
    assert.deepEqual(body.errors.map((e) => e.code), ['E_ROOT_TYPE'])
  }
})

const requestSchema = JSON.parse(
  readFileSync(join(repoRoot, 'contracts/local-adapter/v1/request.schema.json'), 'utf8')
)
const responseSchema = JSON.parse(
  readFileSync(join(repoRoot, 'contracts/local-adapter/v1/response.schema.json'), 'utf8')
)
const validateResponseAgainstSchema = new Ajv2020().compile(responseSchema)

const successResponse = { contract_version: '1.0.0', valid: true, errors: [] }
const failureResponse = {
  contract_version: '1.0.0',
  valid: false,
  errors: [{ path: '/operation', code: 'E_MISSING', message: 'required field missing' }]
}

test('response schema rejects valid:true with non-empty errors', () => {
  const contradictory = {
    contract_version: '1.0.0',
    valid: true,
    errors: [{ path: '/x', code: 'E_TYPE', message: 'x' }]
  }
  assert.equal(validateResponseAgainstSchema(contradictory), false)
})

test('response schema rejects valid:false with empty errors', () => {
  const contradictory = { contract_version: '1.0.0', valid: false, errors: [] }
  assert.equal(validateResponseAgainstSchema(contradictory), false)
})

test('response schema accepts a canonical success response', () => {
  assert.equal(validateResponseAgainstSchema(successResponse), true)
})

test('response schema accepts a canonical failure response', () => {
  assert.equal(validateResponseAgainstSchema(failureResponse), true)
})

test('real CLI outputs conform to the response schema', () => {
  const runs = [
    runCli([fixture('valid-request.json')]),
    runCli([fixture('invalid-missing-field.json')]),
    runCli([fixture('invalid-wrong-type.json')]),
    runCli([])
  ]
  for (const run of runs) {
    const body = parsedStdout(run)
    assert.equal(validateResponseAgainstSchema(body), true, JSON.stringify(body))
  }
})

test('request schema parity with the implementation', () => {
  assert.equal(requestSchema.properties.contract_version.const, CONTRACT_VERSION)
  assert.deepEqual(requestSchema.required.toSorted(), [
    'contract_version',
    'operation',
    'repository',
    'request_id'
  ])
  assert.equal(requestSchema.additionalProperties, false)
  const repo = requestSchema.properties.repository
  assert.equal(repo.additionalProperties, false)
  assert.deepEqual(repo.required.toSorted(), ['name', 'owner'])
  assert.equal(requestSchema.properties.request_id.minLength, 1)
  assert.equal(repo.properties.owner.minLength, 1)
  assert.equal(repo.properties.name.minLength, 1)
  assert.deepEqual(requestSchema.properties.operation.enum, ['inspect'])
})

test('response schema parity with the implementation', () => {
  assert.equal(responseSchema.properties.contract_version.const, CONTRACT_VERSION)
  assert.deepEqual(responseSchema.required.toSorted(), [
    'contract_version',
    'errors',
    'valid'
  ])
  assert.equal(responseSchema.additionalProperties, false)
  const errorItem = responseSchema.properties.errors.items
  assert.equal(errorItem.additionalProperties, false)
  assert.deepEqual(errorItem.required.toSorted(), ['code', 'message', 'path'])

  // validity invariant is present in the published schema
  assert.deepEqual(responseSchema.if, {
    properties: { valid: { const: true } },
    required: ['valid']
  })
  assert.equal(responseSchema.then.properties.errors.maxItems, 0)
  assert.equal(responseSchema.else.properties.errors.minItems, 1)

  // published error-code enum covers every code the runtime can emit:
  // validator codes from the exported constant, CLI technical codes
  // extracted from cli.mjs source so they cannot drift silently.
  const cliSource = readFileSync(join(repoRoot, 'src/local-contract/cli.mjs'), 'utf8')
  const cliCodes = [...cliSource.matchAll(/technicalFailure\('([A-Z_]+)'/g)].map((m) => m[1])
  assert.ok(cliCodes.length >= 3, 'expected CLI technical codes in cli.mjs')
  const emittable = [...new Set([...VALIDATION_ERROR_CODES, ...cliCodes])].toSorted()
  const published = errorItem.properties.code.enum.toSorted()
  assert.deepEqual(published, emittable)
})

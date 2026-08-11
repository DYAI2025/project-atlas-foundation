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
  CONTRACT_ERROR_CODES,
  OPERATIONS,
  ID_SCHEME,
  SOURCE_KINDS,
  EDGE_ORIGINS,
  ID_COMPONENT_PATTERN,
  validateRequest,
  validateSnapshot,
  validateScope
} from '../src/gbrain-read-contract/validate.mjs'
import { SELECTOR_KINDS } from '../src/registry/resolve.mjs'

const Ajv2020 = AjvModule.default ?? AjvModule

// Synthetic graph. The project id and Confluence root are registry identities
// (config/project-registry.json), never page-tree content; every source_ref is a
// synthetic 9xxxxxxxx placeholder so this fixture can never be mistaken for, or
// grow into, a second source of project truth.
const snapshot = (overrides = {}) => ({
  contract_version: '1.0.0',
  project_id: 'PLUMBLINE',
  id_scheme: 'projection-local/v1',
  canonical_entity_ids: false,
  source: { source_kind: 'confluence', source_id: '7503873' },
  nodes: [
    { node_id: 'PLUMBLINE:confluence:7503873:900000001', source_ref: '900000001', label: 'Synthetic root' },
    { node_id: 'PLUMBLINE:confluence:7503873:900000002', source_ref: '900000002', label: 'Synthetic child A' },
    { node_id: 'PLUMBLINE:confluence:7503873:900000003', source_ref: '900000003', label: 'Synthetic child B' }
  ],
  edges: [
    {
      edge_id: 'PLUMBLINE:confluence:7503873:parent_of:900000001:900000002',
      from: 'PLUMBLINE:confluence:7503873:900000001',
      to: 'PLUMBLINE:confluence:7503873:900000002',
      relation_type: 'parent_of',
      origin: 'explicit'
    },
    {
      edge_id: 'PLUMBLINE:confluence:7503873:parent_of:900000001:900000003',
      from: 'PLUMBLINE:confluence:7503873:900000001',
      to: 'PLUMBLINE:confluence:7503873:900000003',
      relation_type: 'parent_of',
      origin: 'explicit'
    }
  ],
  ...overrides
})

const request = (overrides = {}) => ({
  contract_version: '1.0.0',
  request_id: 'req-gr-001',
  project: { selector_kind: 'root_page_id', selector_value: '7503873' },
  operation: 'read_graph',
  ...overrides
})

const codes = (errors) => errors.map((e) => `${e.path}:${e.code}`)

test('contract version and capability are exactly the V1 values', () => {
  assert.equal(CONTRACT_VERSION, '1.0.0')
  assert.deepEqual(OPERATIONS, ['read_graph'])
})

test('conformant request produces no errors', () => {
  assert.deepEqual(validateRequest(request()), [])
})

test('unsupported request contract version fails closed', () => {
  assert.deepEqual(codes(validateRequest(request({ contract_version: '2.0.0' }))), [
    '/request/contract_version:E_CONST'
  ])
  assert.deepEqual(codes(validateRequest(request({ contract_version: '1.0' }))), [
    '/request/contract_version:E_CONST'
  ])
})

test('unknown capability, unknown field and unknown selector kind all fail closed', () => {
  const errors = validateRequest(
    request({
      operation: 'inspect',
      project: { selector_kind: 'title', selector_value: 'Personal Atlas' },
      extra: 1
    })
  )
  assert.deepEqual(codes(errors), [
    '/request/extra:E_UNKNOWN_FIELD',
    '/request/operation:E_ENUM',
    '/request/project/selector_kind:E_ENUM'
  ])
})

test('missing and empty request fields fail closed', () => {
  const bare = validateRequest({})
  assert.deepEqual(codes(bare), [
    '/request/contract_version:E_MISSING',
    '/request/operation:E_MISSING',
    '/request/project:E_MISSING',
    '/request/request_id:E_MISSING'
  ])
  assert.deepEqual(
    codes(validateRequest(request({ request_id: '', project: { selector_kind: 'project_id', selector_value: '' } }))),
    ['/request/project/selector_value:E_EMPTY', '/request/request_id:E_EMPTY']
  )
})

test('non-object request root is a single E_ROOT_TYPE', () => {
  for (const root of [null, [], 'x', 7]) {
    assert.deepEqual(
      validateRequest(root).map((e) => e.code),
      ['E_ROOT_TYPE']
    )
  }
})

// ---------------------------------------------------------------------------
// Graph snapshot document
// ---------------------------------------------------------------------------

test('conformant canonical snapshot produces no errors', () => {
  assert.deepEqual(validateSnapshot(snapshot()), [])
})

test('an empty graph is legal and is not silently treated as a defect', () => {
  assert.deepEqual(validateSnapshot(snapshot({ nodes: [], edges: [] })), [])
})

test('unsupported snapshot contract version fails closed', () => {
  assert.deepEqual(codes(validateSnapshot(snapshot({ contract_version: '2.0.0' }))), [
    '/snapshot/contract_version:E_CONST'
  ])
})

test('the projection-local id boundary is machine-visible and cannot be flipped', () => {
  assert.deepEqual(
    codes(validateSnapshot(snapshot({ canonical_entity_ids: true, id_scheme: 'canonical/v1' }))),
    ['/snapshot/canonical_entity_ids:E_CONST', '/snapshot/id_scheme:E_CONST']
  )
})

test('missing required provenance fields fail closed', () => {
  const noSource = snapshot()
  delete noSource.source
  assert.deepEqual(codes(validateSnapshot(noSource)), ['/snapshot/source:E_MISSING'])

  const noSourceId = snapshot()
  delete noSourceId.source.source_id
  assert.deepEqual(codes(validateSnapshot(noSourceId)), ['/snapshot/source/source_id:E_MISSING'])

  const noSourceRef = snapshot()
  delete noSourceRef.nodes[1].source_ref
  assert.deepEqual(codes(validateSnapshot(noSourceRef)), ['/snapshot/nodes/1/source_ref:E_MISSING'])

  const noRelation = snapshot()
  delete noRelation.edges[0].relation_type
  assert.deepEqual(codes(validateSnapshot(noRelation)), ['/snapshot/edges/0/relation_type:E_MISSING'])

  const noOrigin = snapshot()
  delete noOrigin.edges[0].origin
  assert.deepEqual(codes(validateSnapshot(noOrigin)), ['/snapshot/edges/0/origin:E_MISSING'])
})

test('V1 rejects inferred edges while keeping the explicit/inferred distinction expressible', () => {
  const inferred = snapshot()
  inferred.edges[0].origin = 'inferred'
  assert.deepEqual(codes(validateSnapshot(inferred)), ['/snapshot/edges/0/origin:E_ENUM'])
})

test('relation_type is syntactically constrained but is NOT a closed V1 catalog', () => {
  const other = snapshot()
  other.edges = [
    {
      edge_id: 'PLUMBLINE:confluence:7503873:references:900000001:900000002',
      from: 'PLUMBLINE:confluence:7503873:900000001',
      to: 'PLUMBLINE:confluence:7503873:900000002',
      relation_type: 'references',
      origin: 'explicit'
    }
  ]
  assert.deepEqual(validateSnapshot(other), [], 'an unknown-but-well-formed relation token must be accepted')

  const empty = snapshot()
  empty.edges[0].relation_type = ''
  assert.deepEqual(codes(validateSnapshot(empty)), ['/snapshot/edges/0/relation_type:E_EMPTY'])

  const separator = snapshot()
  separator.edges[0].relation_type = 'parent:of'
  assert.equal(codes(validateSnapshot(separator))[0], '/snapshot/edges/0/relation_type:E_CHARSET')
})

test('id components use a restricted charset so the derivation stays unambiguous', () => {
  const badRef = snapshot()
  badRef.nodes[1].source_ref = '9000:0002'
  badRef.nodes[1].node_id = 'PLUMBLINE:confluence:7503873:9000:0002'
  const observed = codes(validateSnapshot(badRef))
  assert.ok(observed.includes('/snapshot/nodes/1/source_ref:E_CHARSET'), observed.join(','))
  assert.ok(!observed.some((c) => c.endsWith(':E_ROOT_TYPE')))
})

// Both derivation vectors drift the LAST element and keep the drifted id sorted
// after its predecessor, so the assertion isolates the derivation guard instead of
// also tripping the canonical-order guard.
test('a node id that does not derive from its component fields fails closed', () => {
  const drifted = snapshot()
  drifted.nodes[2].node_id = 'PLUMBLINE:confluence:7503873:900000009'
  drifted.edges = []
  assert.deepEqual(codes(validateSnapshot(drifted)), ['/snapshot/nodes/2/node_id:E_ID_DERIVATION'])
})

test('an edge id that does not derive from project, source, relation and endpoints fails closed', () => {
  const drifted = snapshot()
  drifted.edges[1].edge_id = 'PLUMBLINE:confluence:7503873:parent_of:900000001:900000009'
  assert.deepEqual(codes(validateSnapshot(drifted)), ['/snapshot/edges/1/edge_id:E_ID_DERIVATION'])
})

test('non-object snapshot root is a single E_ROOT_TYPE', () => {
  for (const root of [null, [], 'x', 7]) {
    assert.deepEqual(
      validateSnapshot(root).map((e) => e.code),
      ['E_ROOT_TYPE']
    )
  }
})

test('duplicate node id fails closed at the second occurrence', () => {
  const dup = snapshot()
  dup.nodes[2] = { ...dup.nodes[1] }
  dup.edges = dup.edges.slice(0, 1)
  assert.deepEqual(codes(validateSnapshot(dup)), ['/snapshot/nodes/2/node_id:E_DUPLICATE_NODE_ID'])
})

test('duplicate edge id fails closed at the second occurrence', () => {
  const dup = snapshot()
  dup.edges[1] = { ...dup.edges[0] }
  assert.deepEqual(codes(validateSnapshot(dup)), ['/snapshot/edges/1/edge_id:E_DUPLICATE_EDGE_ID'])
})

test('an edge with an unknown "from" endpoint fails closed', () => {
  const dangling = snapshot()
  dangling.edges = [
    {
      edge_id: 'PLUMBLINE:confluence:7503873:parent_of:900000004:900000002',
      from: 'PLUMBLINE:confluence:7503873:900000004',
      to: 'PLUMBLINE:confluence:7503873:900000002',
      relation_type: 'parent_of',
      origin: 'explicit'
    }
  ]
  assert.deepEqual(codes(validateSnapshot(dangling)), ['/snapshot/edges/0/from:E_EDGE_ENDPOINT_UNKNOWN'])
})

test('an edge with an unknown "to" endpoint fails closed independently', () => {
  const dangling = snapshot()
  dangling.edges = [
    {
      edge_id: 'PLUMBLINE:confluence:7503873:parent_of:900000001:900000004',
      from: 'PLUMBLINE:confluence:7503873:900000001',
      to: 'PLUMBLINE:confluence:7503873:900000004',
      relation_type: 'parent_of',
      origin: 'explicit'
    }
  ]
  assert.deepEqual(codes(validateSnapshot(dangling)), ['/snapshot/edges/0/to:E_EDGE_ENDPOINT_UNKNOWN'])
})

test('nodes out of canonical order fail closed and are never silently normalized', () => {
  const unordered = snapshot()
  unordered.nodes = [unordered.nodes[1], unordered.nodes[0], unordered.nodes[2]]
  assert.deepEqual(codes(validateSnapshot(unordered)), ['/snapshot/nodes/1:E_ORDER'])
})

test('edges out of canonical order fail closed and are never silently normalized', () => {
  const unordered = snapshot()
  unordered.edges = [unordered.edges[1], unordered.edges[0]]
  assert.deepEqual(codes(validateSnapshot(unordered)), ['/snapshot/edges/1:E_ORDER'])
})

test('canonical order is UTF-16 code-unit order, not locale collation', () => {
  // "Z" (U+005A) sorts BEFORE "a" (U+0061) in code-unit order; several locale
  // collations disagree, so this vector pins the comparison rule itself.
  const cased = snapshot()
  cased.nodes = [
    { node_id: 'PLUMBLINE:confluence:7503873:Z1', source_ref: 'Z1', label: 'Upper' },
    { node_id: 'PLUMBLINE:confluence:7503873:a1', source_ref: 'a1', label: 'Lower' }
  ]
  cased.edges = []
  assert.deepEqual(validateSnapshot(cased), [])

  const flipped = snapshot()
  flipped.nodes = [cased.nodes[1], cased.nodes[0]]
  flipped.edges = []
  assert.deepEqual(codes(validateSnapshot(flipped)), ['/snapshot/nodes/1:E_ORDER'])
})

// ---------------------------------------------------------------------------
// Project / source scope (resolution itself stays owned by src/registry)
// ---------------------------------------------------------------------------

const PLUMBLINE = {
  project_id: 'PLUMBLINE',
  jira_key: 'PLUM',
  confluence_space_key: 'PRODUKTMAN',
  root_page_id: '7503873',
  allowed_writers: ['benjamin.poersch'],
  approval_workflow: 'proposal->owner-approval->publish',
  status: 'active'
}
const ATLAS = { ...PLUMBLINE, project_id: 'ATLAS', jira_key: 'ATLAS', root_page_id: '14778372' }

test('a resolved project whose scope matches the snapshot produces no scope errors', () => {
  assert.deepEqual(validateScope(PLUMBLINE, snapshot()), [])
})

test('an unresolved project selector denies by default', () => {
  assert.deepEqual(codes(validateScope(null, snapshot())), [
    '/request/project/selector_value:E_UNKNOWN_PROJECT'
  ])
})

test('a snapshot claiming a different project than the request resolved fails closed', () => {
  assert.deepEqual(codes(validateScope(ATLAS, snapshot())), ['/snapshot/project_id:E_PROJECT_MISMATCH'])
})

test('a snapshot combining one project with another project root fails closed', () => {
  const foreignRoot = snapshot()
  foreignRoot.source.source_id = '14778372'
  assert.deepEqual(codes(validateScope(PLUMBLINE, foreignRoot)), [
    '/snapshot/source/source_id:E_SOURCE_SCOPE'
  ])
})

// ---------------------------------------------------------------------------
// Executable checker (CLI)
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const CLI = join(repoRoot, 'src/gbrain-read-contract/cli.mjs')
const fx = (name) => join(repoRoot, 'fixtures/gbrain-read', name)

function runCli(args, envOverrides = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...envOverrides }
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

const body = (run) => JSON.parse(run.stdout)

function assertResponseShape(response) {
  assert.deepEqual(Object.keys(response), ['contract_version', 'valid', 'project_id', 'errors'])
  assert.equal(response.contract_version, CONTRACT_VERSION)
  assert.equal(typeof response.valid, 'boolean')
  assert.ok(Array.isArray(response.errors))
  for (const e of response.errors) assert.deepEqual(Object.keys(e), ['path', 'code', 'message'])
}

test('CLI: conformant request and canonical snapshot succeed with exit 0', () => {
  const run = runCli([fx('valid-request.json'), fx('valid-graph-snapshot.json')])
  assert.equal(run.code, 0)
  assertResponseShape(body(run))
  assert.equal(body(run).valid, true)
  assert.equal(body(run).project_id, 'PLUMBLINE')
  assert.deepEqual(body(run).errors, [])
})

test('CLI: unknown project denies with exit 1 and no resolved project', () => {
  const run = runCli([fx('invalid-unknown-project-request.json'), fx('valid-graph-snapshot.json')])
  assert.equal(run.code, 1)
  assertResponseShape(body(run))
  assert.equal(body(run).project_id, null)
  assert.deepEqual(codes(body(run).errors), ['/request/project/selector_value:E_UNKNOWN_PROJECT'])
})

test('CLI: cross-project snapshot fails closed with exit 1', () => {
  const run = runCli([fx('valid-request.json'), fx('invalid-cross-project-snapshot.json')])
  assert.equal(run.code, 1)
  assert.deepEqual(codes(body(run).errors), ['/snapshot/project_id:E_PROJECT_MISMATCH'])
})

test('CLI: a foreign confluence root under the right project fails closed with exit 1', () => {
  const run = runCli([fx('valid-request.json'), fx('invalid-foreign-root-snapshot.json')])
  assert.equal(run.code, 1)
  assert.deepEqual(codes(body(run).errors), ['/snapshot/source/source_id:E_SOURCE_SCOPE'])
})

test('CLI: every structural fixture fails closed with exit 1 and its own finding', () => {
  const cases = [
    ['invalid-unsupported-version-snapshot.json', '/snapshot/contract_version:E_CONST'],
    ['invalid-duplicate-node-snapshot.json', '/snapshot/nodes/2/node_id:E_DUPLICATE_NODE_ID'],
    ['invalid-dangling-edge-snapshot.json', '/snapshot/edges/0/to:E_EDGE_ENDPOINT_UNKNOWN'],
    ['invalid-unordered-nodes-snapshot.json', '/snapshot/nodes/1:E_ORDER'],
    ['invalid-inferred-edge-snapshot.json', '/snapshot/edges/0/origin:E_ENUM']
  ]
  for (const [fixture, expected] of cases) {
    const run = runCli([fx('valid-request.json'), fx(fixture)])
    assert.equal(run.code, 1, fixture)
    assert.deepEqual(codes(body(run).errors), [expected], fixture)
    assert.equal(body(run).valid, false, fixture)
  }
})

test('CLI: technical failures exit 2 — usage, unreadable file, malformed JSON', () => {
  const usage = runCli([fx('valid-request.json')])
  assert.equal(usage.code, 2)
  assert.deepEqual(body(usage).errors.map((e) => e.code), ['E_USAGE'])
  assert.match(usage.stderr, /usage:/)

  const unreadable = runCli([fx('valid-request.json'), fx('does-not-exist.json')])
  assert.equal(unreadable.code, 2)
  assert.deepEqual(body(unreadable).errors.map((e) => e.code), ['E_UNREADABLE'])

  const dir = mkdtempSync(join(tmpdir(), 'gbrain-read-'))
  const broken = join(dir, 'broken.json')
  writeFileSync(broken, '{ "contract_version": ')
  const malformed = runCli([fx('valid-request.json'), broken])
  assert.equal(malformed.code, 2)
  assert.deepEqual(body(malformed).errors.map((e) => e.code), ['E_INVALID_JSON'])
  assert.match(malformed.stderr, /not valid JSON/)
})

test('CLI: a malformed registry is technical, never a silent unknown project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gbrain-read-registry-'))
  const brokenRegistry = join(dir, 'registry.json')
  writeFileSync(brokenRegistry, JSON.stringify({ schema_version: '1.0', project_id: 'ATLAS' }))
  const run = runCli([fx('valid-request.json'), fx('valid-graph-snapshot.json')], {
    ATLAS_REGISTRY_PATH: brokenRegistry
  })
  assert.equal(run.code, 2)
  assert.deepEqual(body(run).errors.map((e) => e.code), ['E_REGISTRY_INVALID'])
})

test('CLI: output is byte-identical across runs and across process locales', () => {
  const pairs = [
    ['valid-request.json', 'valid-graph-snapshot.json'],
    ['valid-request.json', 'invalid-cross-project-snapshot.json'],
    ['valid-request.json', 'invalid-unordered-nodes-snapshot.json'],
    ['invalid-unknown-project-request.json', 'valid-graph-snapshot.json']
  ]
  for (const [req, snapFixture] of pairs) {
    const runs = ['C', 'de_DE.UTF-8', 'sv_SE.UTF-8'].map((lc) =>
      runCli([fx(req), fx(snapFixture)], { LC_ALL: lc, LANG: lc })
    )
    for (const r of runs.slice(1)) {
      assert.equal(r.stdout, runs[0].stdout, `${req}+${snapFixture} stdout differs across locales`)
      assert.equal(r.code, runs[0].code, `${req}+${snapFixture} exit code differs across locales`)
    }
  }
})

// ---------------------------------------------------------------------------
// Published schemas <-> runtime parity (real Draft 2020-12 validation)
// ---------------------------------------------------------------------------

const contractsDir = join(repoRoot, 'contracts/gbrain-read/v1')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const requestSchema = readJson(join(contractsDir, 'request.schema.json'))
const snapshotSchema = readJson(join(contractsDir, 'graph-snapshot.schema.json'))
const responseSchema = readJson(join(contractsDir, 'response.schema.json'))

const ajv = new Ajv2020()
const validateRequestSchema = ajv.compile(requestSchema)
const validateSnapshotSchema = ajv.compile(snapshotSchema)
const validateResponseSchema = ajv.compile(responseSchema)

test('committed valid fixtures satisfy the published request and snapshot schemas', () => {
  assert.equal(validateRequestSchema(readJson(fx('valid-request.json'))), true)
  assert.equal(validateSnapshotSchema(readJson(fx('valid-graph-snapshot.json'))), true)
})

test('the published snapshot schema rejects what it can express', () => {
  assert.equal(validateSnapshotSchema(readJson(fx('invalid-unsupported-version-snapshot.json'))), false)
  assert.equal(validateSnapshotSchema(readJson(fx('invalid-inferred-edge-snapshot.json'))), false)

  const promoted = readJson(fx('valid-graph-snapshot.json'))
  promoted.canonical_entity_ids = true
  assert.equal(validateSnapshotSchema(promoted), false)

  const badCharset = readJson(fx('valid-graph-snapshot.json'))
  badCharset.nodes[0].source_ref = 'has:separator'
  assert.equal(validateSnapshotSchema(badCharset), false)
})

test('the published response schema rejects both contradictory verdict shapes', () => {
  assert.equal(
    validateResponseSchema({
      contract_version: '1.0.0',
      valid: true,
      project_id: 'PLUMBLINE',
      errors: [{ path: '/x', code: 'E_TYPE', message: 'x' }]
    }),
    false
  )
  assert.equal(
    validateResponseSchema({ contract_version: '1.0.0', valid: false, project_id: null, errors: [] }),
    false
  )
})

test('every real CLI output conforms to the published response schema', () => {
  const pairs = [
    ['valid-request.json', 'valid-graph-snapshot.json'],
    ['valid-request.json', 'invalid-cross-project-snapshot.json'],
    ['valid-request.json', 'invalid-foreign-root-snapshot.json'],
    ['valid-request.json', 'invalid-duplicate-node-snapshot.json'],
    ['valid-request.json', 'invalid-dangling-edge-snapshot.json'],
    ['valid-request.json', 'invalid-unordered-nodes-snapshot.json'],
    ['valid-request.json', 'invalid-inferred-edge-snapshot.json'],
    ['invalid-unknown-project-request.json', 'valid-graph-snapshot.json']
  ]
  for (const [req, snapFixture] of pairs) {
    const response = body(runCli([fx(req), fx(snapFixture)]))
    assert.equal(validateResponseSchema(response), true, JSON.stringify(response))
  }
  assert.equal(validateResponseSchema(body(runCli([]))), true)
})

test('request schema parity: selectors and capability come from the single source', () => {
  assert.equal(requestSchema.properties.contract_version.const, CONTRACT_VERSION)
  assert.equal(requestSchema.additionalProperties, false)
  assert.deepEqual(requestSchema.required.toSorted(), [
    'contract_version',
    'operation',
    'project',
    'request_id'
  ])
  assert.deepEqual(requestSchema.properties.operation.enum, OPERATIONS)
  assert.deepEqual(
    requestSchema.properties.project.properties.selector_kind.enum.toSorted(),
    [...SELECTOR_KINDS].toSorted()
  )
  assert.equal(requestSchema.properties.project.additionalProperties, false)
})

test('snapshot schema parity: the projection-id boundary and the OPEN relation catalog', () => {
  assert.equal(snapshotSchema.properties.contract_version.const, CONTRACT_VERSION)
  assert.equal(snapshotSchema.properties.id_scheme.const, ID_SCHEME)
  assert.equal(snapshotSchema.properties.canonical_entity_ids.const, false)
  assert.deepEqual(snapshotSchema.properties.source.properties.source_kind.enum, SOURCE_KINDS)
  assert.deepEqual(snapshotSchema.$defs.edge.properties.origin.enum, EDGE_ORIGINS)
  assert.equal(snapshotSchema.$defs.id_component.pattern, ID_COMPONENT_PATTERN.source)
  assert.equal(snapshotSchema.additionalProperties, false)
  assert.equal(snapshotSchema.$defs.node.additionalProperties, false)
  assert.equal(snapshotSchema.$defs.edge.additionalProperties, false)

  // The catalog stays OPEN: relation_type is constrained syntactically and MUST NOT
  // be published as a closed set of relation names.
  const relationType = snapshotSchema.$defs.edge.properties.relation_type
  assert.equal(relationType.enum, undefined, 'relation_type must not publish a closed catalog')
  assert.equal(relationType.const, undefined, 'relation_type must not publish a closed catalog')
  assert.ok(!JSON.stringify(snapshotSchema).includes('parent_of'), 'no relation name may be baked into the schema')
})

test('published error-code enum equals exactly the codes the runtime can emit', () => {
  // Derived, never hand-listed: contract codes from the exported constant, technical
  // and registry codes extracted from the two modules that can throw or emit them.
  const literals = (path) => [...readFileSync(path, 'utf8').matchAll(/'(E_[A-Z_]+)'/g)].map((m) => m[1])
  const cliCodes = literals(join(repoRoot, 'src/gbrain-read-contract/cli.mjs'))
  const registryCodes = literals(join(repoRoot, 'src/registry/resolve.mjs'))
  assert.ok(cliCodes.length >= 3, 'expected technical codes in cli.mjs')
  assert.ok(registryCodes.length >= 3, 'expected registry codes in resolve.mjs')

  const emittable = [...new Set([...CONTRACT_ERROR_CODES, ...cliCodes, ...registryCodes])].toSorted()
  assert.deepEqual(responseSchema.properties.errors.items.properties.code.enum.toSorted(), emittable)
})

test('response schema parity with the implementation', () => {
  assert.equal(responseSchema.properties.contract_version.const, CONTRACT_VERSION)
  assert.equal(responseSchema.additionalProperties, false)
  assert.deepEqual(responseSchema.required.toSorted(), [
    'contract_version',
    'errors',
    'project_id',
    'valid'
  ])
  assert.deepEqual(responseSchema.if, {
    properties: { valid: { const: true } },
    required: ['valid']
  })
  assert.equal(responseSchema.then.properties.errors.maxItems, 0)
  assert.equal(responseSchema.else.properties.errors.minItems, 1)
  assert.equal(responseSchema.properties.errors.items.additionalProperties, false)
  assert.deepEqual(responseSchema.properties.errors.items.required.toSorted(), [
    'code',
    'message',
    'path'
  ])

  // The verdict is not the artifact: no graph payload may leak into the response.
  for (const forbidden of ['nodes', 'edges', 'snapshot', 'graph', 'result']) {
    assert.equal(responseSchema.properties[forbidden], undefined, forbidden)
  }
})

test('the ATLAS-12 frozen evidence file has no runtime consumer in this slice', () => {
  for (const file of ['validate.mjs', 'cli.mjs']) {
    const source = readFileSync(join(repoRoot, 'src/gbrain-read-contract', file), 'utf8')
    assert.ok(!source.includes('atlas-12-page-tree-snapshot'), `${file} must not read the frozen evidence file`)
    assert.ok(!source.includes('docs/evidence'), `${file} must not read docs/evidence`)
  }
})

// Adversarial review finding (2026-08-11): the deny-by-default signal must never be
// masked by unrelated structural findings. Before the fix, an unknown project paired
// with a structurally invalid snapshot reported only the structural finding, so a
// consumer inspecting `errors` could not see that the project had been denied at all.
test('CLI: the denial survives a structurally invalid snapshot and is never masked', () => {
  const run = runCli([
    fx('invalid-unknown-project-request.json'),
    fx('invalid-duplicate-node-snapshot.json')
  ])
  assert.equal(run.code, 1)
  const observed = codes(body(run).errors)
  assert.ok(
    observed.includes('/request/project/selector_value:E_UNKNOWN_PROJECT'),
    `denial missing from ${observed.join(',')}`
  )
  assert.ok(observed.includes('/snapshot/nodes/2/node_id:E_DUPLICATE_NODE_ID'), observed.join(','))
  assert.equal(body(run).project_id, null)
})

test('CLI: a valid verdict always names the resolved project', () => {
  const run = runCli([fx('valid-request.json'), fx('valid-graph-snapshot.json')])
  const response = body(run)
  assert.equal(response.valid, true)
  assert.equal(typeof response.project_id, 'string')
  assert.notEqual(response.project_id, null)
})

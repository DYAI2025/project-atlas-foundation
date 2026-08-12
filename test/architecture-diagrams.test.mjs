// ATLAS-14 ARCH_DOC_PARITY — focused tests for the architecture documents declared by
// architecture-decision.json.
//
// Two concerns, deliberately kept apart:
//   1. PARITY — every declared diagram_paths entry is usable and resolves, and the
//      repository validator turns a broken declaration into a controlled finding
//      (exit 1 + VALIDATION FAILED) rather than an uncaught crash.
//   2. SEMANTICS — durable architecture invariants of the two diagrams: the pilot and
//      the production target stay distinguishable, GBrain stays a derived projection,
//      the pilot claims no production controls, no graph UI stack is selected, and the
//      legacy repository is never an implementation source.
//
// The semantic assertions are structural (node declarations, subgraph blocks, edge
// direction) or property-based (a class of labels must/must not carry a marker). They
// deliberately do not pin arbitrary exact prose, and they do not define a diagram DSL:
// what is parsed here is ordinary Mermaid flowchart syntax.
//
// The validator cases run the real script as a subprocess against a throwaway copy of
// the working tree, so no test ever mutates the repository itself.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('..', import.meta.url))
const VALIDATOR = path.join(REPO, 'scripts', 'validate-current-repository.mjs')
const DECISION_FILE = 'architecture-decision.json'

const decision = JSON.parse(readFileSync(path.join(REPO, DECISION_FILE), 'utf8'))

// Premium Graph UI stacks named in architecture/approval-boundary.md, item 7. Choosing
// one of them needs a separate Owner decision, so no architecture document may imply it.
const FORBIDDEN_UI_STACKS = [
  'React',
  'Vue',
  'Svelte',
  'Three.js',
  'Cytoscape',
  'Sigma',
  'Cosmograph'
]

// ---------------------------------------------------------------------------
// Mermaid flowchart reading helpers (structure only, no rendering, no new deps)
// ---------------------------------------------------------------------------

function readDiagram(relPath) {
  return readFileSync(path.join(REPO, relPath), 'utf8')
}

const NODE_DECL = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\[\s*"([\s\S]*?)"\s*\]/gm
const ARROW = /-(?:\.)?-+>/

// Three kinds of element can legitimately mention "gbrain", and they carry different
// obligations: the pinned legacy repository, the versioned read contract, and the
// derived projection itself. Only the last one is a data-holding component.
const LEGACY_NODE = /gbrain-atlas/i
const READ_CONTRACT_NODE = /gbrain-read/i
const CANONICAL_CLAIM = /source of truth|canonical (?:store|write)|system of record|write store/i

/** All `ID["label"]` declarations in a diagram (or in one extracted block). */
function nodes(src) {
  const found = new Map()
  for (const m of src.matchAll(NODE_DECL)) found.set(m[1], m[2])
  return found
}

/** Directed edges as [from, to] id pairs; chained `A --> B --> C` is expanded. */
function edges(src) {
  const out = []
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('%%') || !ARROW.test(line)) continue
    const parts = line
      .replace(/\|[^|]*\|/g, ' ') // drop edge labels
      .split(ARROW)
      .map((s) => s.trim().replace(/\[[\s\S]*$/, '').trim())
    for (let i = 0; i + 1 < parts.length; i++) {
      const from = parts[i]
      const to = parts[i + 1]
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(from) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(to)) {
        out.push([from, to])
      }
    }
  }
  return out
}

/** The full text of `subgraph <id>[...] ... end`, nesting-aware. */
function subgraphBlock(src, id) {
  const lines = src.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^\\s*subgraph\\s+${id}\\b`).test(l))
  assert.notEqual(start, -1, `subgraph ${id} is not declared`)
  let depth = 0
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^subgraph\b/.test(t)) depth++
    else if (t === 'end') {
      depth--
      if (depth === 0) return lines.slice(start, i + 1).join('\n')
    }
  }
  assert.fail(`subgraph ${id} is never closed`)
}

function subgraphTitle(src, id) {
  const m = src.match(new RegExp(`^\\s*subgraph\\s+${id}\\s*\\[\\s*"([\\s\\S]*?)"\\s*\\]`, 'm'))
  assert.ok(m, `subgraph ${id} has no quoted title`)
  return m[1]
}

// ---------------------------------------------------------------------------
// Throwaway working-tree copy + real validator subprocess
// ---------------------------------------------------------------------------

/**
 * Copy every file git would carry (tracked + untracked-but-not-ignored) into a temp
 * directory, so the validator sees a faithful repository root it may be mutated in.
 */
function makeFixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-14-arch-'))
  const listed = execFileSync(
    'git',
    ['-C', REPO, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
  )
    .split('\0')
    .filter(Boolean)
  assert.ok(listed.length > 0, 'fixture source file list must not be empty')
  for (const rel of listed) {
    const src = path.join(REPO, rel)
    if (!statSync(src).isFile()) continue
    const dest = path.join(dir, rel)
    mkdirSync(path.dirname(dest), { recursive: true })
    cpSync(src, dest)
  }
  return dir
}

function runValidator(cwd) {
  return spawnSync(process.execPath, [VALIDATOR], { cwd, encoding: 'utf8' })
}

/** Controlled = exit 1 with findings, never an uncaught exception / stack trace. */
function assertControlledFailure(result, findingPattern, context) {
  const combined = `${result.stdout}\n${result.stderr}`
  assert.equal(result.status, 1, `${context}: expected exit 1, got ${result.status}`)
  assert.match(result.stderr, /VALIDATION FAILED/, `${context}: missing verdict`)
  assert.doesNotMatch(
    combined,
    /^\s+at\s/m,
    `${context}: stack trace present — the failure was not controlled`
  )
  assert.doesNotMatch(
    combined,
    /^[A-Za-z]*Error:/m,
    `${context}: uncaught error banner present — the failure was not controlled`
  )
  assert.match(result.stderr, findingPattern, `${context}: expected finding not reported`)
}

function writeDecision(dir, value) {
  writeFileSync(path.join(dir, DECISION_FILE), value, 'utf8')
}

function decisionWith(diagramPaths) {
  const copy = structuredClone(decision)
  if (diagramPaths === undefined) delete copy.diagram_paths
  else copy.diagram_paths = diagramPaths
  return JSON.stringify(copy, null, 2)
}

// ---------------------------------------------------------------------------
// 1) Parity: every declared diagram resolves
// ---------------------------------------------------------------------------

test('architecture-decision.json declares diagram_paths that all resolve to files', () => {
  assert.ok(
    Array.isArray(decision.diagram_paths) && decision.diagram_paths.length > 0,
    'diagram_paths must be a non-empty array'
  )
  for (const declared of decision.diagram_paths) {
    assert.equal(typeof declared, 'string', `not a string: ${JSON.stringify(declared)}`)
    assert.ok(declared.trim() !== '', 'declared path must not be empty')
    assert.ok(!declared.startsWith('/'), `must be repository-relative: ${declared}`)
    assert.ok(!declared.split('/').includes('..'), `must not escape the repository: ${declared}`)
    assert.ok(
      statSync(path.join(REPO, declared)).isFile(),
      `declared diagram does not resolve to a file: ${declared}`
    )
  }
})

test('the declared set covers exactly one context and one container diagram', () => {
  // Parity is about the declaration, not about hard-coded filenames: the two roles are
  // identified by role keyword, so a rename stays legal as long as both roles survive.
  const declared = decision.diagram_paths
  const context = declared.filter((p) => /context/i.test(p))
  const container = declared.filter((p) => /container/i.test(p))
  assert.equal(context.length, 1, `expected exactly one context diagram, got ${context.length}`)
  assert.equal(container.length, 1, `expected exactly one container diagram, got ${container.length}`)
})

const CONTEXT_PATH = decision.diagram_paths.find((p) => /context/i.test(p))
const CONTAINER_PATH = decision.diagram_paths.find((p) => /container/i.test(p))

// ---------------------------------------------------------------------------
// 2) + 3) Validator negative proofs — controlled failure, never a crash
// ---------------------------------------------------------------------------

test('the fixture copy of the working tree passes validation unchanged (control)', () => {
  const dir = makeFixtureRepo()
  try {
    const res = runValidator(dir)
    assert.equal(res.status, 0, `control fixture must pass:\n${res.stdout}\n${res.stderr}`)
    assert.match(res.stdout, /VALIDATION PASSED/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared diagram that is missing produces a controlled validation failure', () => {
  const dir = makeFixtureRepo()
  try {
    rmSync(path.join(dir, CONTEXT_PATH))
    const res = runValidator(dir)
    assertControlledFailure(
      res,
      new RegExp(`diagram_paths\\[\\d+\\] resolves to an existing file: ${CONTEXT_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      'missing declared diagram'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a declared diagram that is a directory produces a controlled validation failure', () => {
  const dir = makeFixtureRepo()
  try {
    writeDecision(dir, decisionWith(['architecture']))
    const res = runValidator(dir)
    assertControlledFailure(
      res,
      /diagram_paths\[0\] resolves to an existing file: architecture/,
      'declared path is a directory'
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed diagram_paths declarations fail closed without an unhandled crash', () => {
  const cases = [
    { name: 'not an array', body: decisionWith('architecture/c4-context.mmd'), finding: /declares diagram_paths as a non-empty array/ },
    { name: 'empty array', body: decisionWith([]), finding: /declares diagram_paths as a non-empty array/ },
    { name: 'key absent', body: decisionWith(undefined), finding: /declares diagram_paths as a non-empty array/ },
    { name: 'null object', body: decisionWith(null), finding: /declares diagram_paths as a non-empty array/ },
    { name: 'empty string entry', body: decisionWith(['']), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'whitespace entry', body: decisionWith(['   ']), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'null entry', body: decisionWith([null]), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'numeric entry', body: decisionWith([42]), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'object entry', body: decisionWith([{ path: 'architecture/c4-context.mmd' }]), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'absolute path entry', body: decisionWith(['/etc/hosts']), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'escaping path entry', body: decisionWith(['../outside.mmd']), finding: /diagram_paths\[0\] is a non-empty repository-relative path/ },
    { name: 'unparseable json', body: '{ "diagram_paths": [', finding: /architecture decision parses as a JSON object/ },
    { name: 'json array root', body: '["architecture/c4-context.mmd"]', finding: /architecture decision parses as a JSON object/ },
    { name: 'empty file', body: '', finding: /architecture decision parses as a JSON object/ }
  ]
  const dir = makeFixtureRepo()
  try {
    for (const c of cases) {
      writeDecision(dir, c.body)
      assertControlledFailure(runValidator(dir), c.finding, `malformed diagram_paths: ${c.name}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 4) - 8) Architecture semantics
// ---------------------------------------------------------------------------

test('both diagrams are well-formed flowcharts with balanced blocks and declared edge ends', () => {
  for (const rel of decision.diagram_paths) {
    const src = readDiagram(rel)
    assert.match(src, /^flowchart\s+\w+/m, `${rel}: no flowchart directive`)
    const opens = (src.match(/^\s*subgraph\b/gm) ?? []).length
    const closes = (src.match(/^\s*end\s*$/gm) ?? []).length
    assert.equal(opens, closes, `${rel}: ${opens} subgraph vs ${closes} end`)
    const declared = nodes(src)
    const subgraphIds = [...src.matchAll(/^\s*subgraph\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((m) => m[1])
    const known = new Set([...declared.keys(), ...subgraphIds])
    assert.ok(declared.size > 0, `${rel}: no nodes declared`)
    for (const [from, to] of edges(src)) {
      assert.ok(known.has(from), `${rel}: edge from undeclared id ${from}`)
      assert.ok(known.has(to), `${rel}: edge to undeclared id ${to}`)
    }
  }
})

test('the container diagram keeps the local pilot and the production target distinguishable', () => {
  const src = readDiagram(CONTAINER_PATH)
  const pilotTitle = subgraphTitle(src, 'LANE_A')
  const targetTitle = subgraphTitle(src, 'LANE_B')

  assert.match(pilotTitle, /pilot/i, 'lane A must be titled as the pilot lane')
  assert.match(targetTitle, /production target/i, 'lane B must be titled as the production target')

  // Both lanes are target state; neither may read as an existing deployment.
  assert.match(pilotTitle, /not implemented/i)
  assert.match(targetTitle, /not implemented/i)

  const pilotIds = [...nodes(subgraphBlock(src, 'LANE_A')).keys()]
  const targetIds = [...nodes(subgraphBlock(src, 'LANE_B')).keys()]
  assert.ok(pilotIds.length > 0, 'pilot lane has no containers')
  assert.ok(targetIds.length > 0, 'production-target lane has no containers')
  const overlap = pilotIds.filter((id) => targetIds.includes(id))
  assert.deepEqual(overlap, [], `lanes must not share containers: ${overlap.join(',')}`)
})

test('the pilot lane runs through real local persistence and the read contract to a viewer', () => {
  const src = readDiagram(CONTAINER_PATH)
  const block = subgraphBlock(src, 'LANE_A')
  const labels = [...nodes(block).values()].join('\n')
  assert.match(labels, /local/i, 'pilot must be explicitly local')
  assert.match(labels, /gbrain-read\/v1/i, 'pilot must go through the gbrain-read/v1 contract')
  assert.match(labels, /projection-local\/v1/i, 'pilot identifiers stay projection-local')
  assert.match(labels, /browser/i, 'pilot ends at a browser viewer')
  // The lane is a chain: every pilot container is connected to another pilot container.
  const ids = [...nodes(block).keys()]
  const laneEdges = edges(block).filter(([f, t]) => ids.includes(f) && ids.includes(t))
  assert.ok(laneEdges.length >= ids.length - 1, 'pilot containers must form a connected flow')
})

test('GBrain is represented as a derived projection, never as the canonical store', () => {
  let projectionNodes = 0
  for (const rel of decision.diagram_paths) {
    const src = readDiagram(rel)
    for (const [id, label] of nodes(src)) {
      if (!/gbrain/i.test(label)) continue
      if (LEGACY_NODE.test(label)) continue // legacy artifact, covered by its own test
      // No GBrain element of any kind may claim canonical status.
      assert.doesNotMatch(label, CANONICAL_CLAIM, `${rel}: ${id} must not claim canonical status`)
      if (READ_CONTRACT_NODE.test(label)) {
        assert.match(label, /read-only|read contract/i, `${rel}: ${id} must stay a read-only contract`)
        continue
      }
      projectionNodes++
      assert.match(label, /derived|projection/i, `${rel}: ${id} must be marked derived/projection`)
    }
  }
  assert.ok(projectionNodes >= 2, 'both diagrams must show GBrain as a projection')

  // Exactly one element in the context diagram carries the source-of-truth role, and it
  // is Confluence — not GBrain.
  const ctx = readDiagram(CONTEXT_PATH)
  const sourceOfTruth = [...nodes(ctx)].filter(([, label]) => /source of truth/i.test(label))
  assert.equal(sourceOfTruth.length, 1, 'exactly one context element may be the source of truth')
  assert.match(sourceOfTruth[0][1], /confluence/i)

  // Direction is the real invariant: the control plane projects into GBrain, and GBrain
  // never writes back into it.
  const coreIds = [...nodes(subgraphBlock(ctx, 'ATLAS_BOUNDARY')).keys()]
  assert.equal(coreIds.length, 1, 'the ATLAS boundary must hold exactly one control-plane element')
  const core = coreIds[0]
  const gbrainIds = [...nodes(ctx)]
    .filter(
      ([, label]) =>
        /gbrain/i.test(label) && !LEGACY_NODE.test(label) && !READ_CONTRACT_NODE.test(label)
    )
    .map(([id]) => id)
  assert.ok(gbrainIds.length > 0)
  const ctxEdges = edges(ctx)
  for (const g of gbrainIds) {
    assert.ok(
      ctxEdges.some(([f, t]) => f === core && t === g),
      `the control plane must project into ${g}`
    )
    assert.ok(
      !ctxEdges.some(([f, t]) => f === g && t === core),
      `${g} must never write into the control plane`
    )
  }
})

test('the pilot lane claims no production isolation, publisher or deployment controls', () => {
  const src = readDiagram(CONTAINER_PATH)
  const pilot = subgraphBlock(src, 'LANE_A')
  const target = subgraphBlock(src, 'LANE_B')

  for (const claim of [/postgres/i, /\brls\b/i, /publish/i, /\bvps\b/i]) {
    assert.doesNotMatch(pilot, claim, `pilot lane must not claim ${claim}`)
  }
  // The exclusion must be a real distinction, not an accident of an empty target lane.
  for (const claim of [/postgres/i, /\brls\b/i, /publisher/i, /\bvps\b/i]) {
    assert.match(target, claim, `production target must own ${claim}`)
  }
  assert.match(target, /project_id/i, 'production target must carry project_id isolation')
})

test('no Premium Graph UI stack is selected or implied by either diagram', () => {
  for (const rel of decision.diagram_paths) {
    const src = readDiagram(rel)
    for (const stack of FORBIDDEN_UI_STACKS) {
      const pattern = new RegExp(`\\b${stack.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
      assert.doesNotMatch(src, pattern, `${rel} must not name the UI stack ${stack}`)
    }
    // The read side is named, but only as a stack-neutral role.
    assert.match(src, /stack-neutral|read consumer|read-side|viewer/i, `${rel}: read side unnamed`)
  }
})

test('the legacy gbrain-atlas repository is never an implementation source', () => {
  // It has no place at all in the container (implementation-shaped) view.
  assert.doesNotMatch(
    readDiagram(CONTAINER_PATH),
    /gbrain-atlas/i,
    'the container view must not reference the legacy repository'
  )

  // In the context view it may appear, but only as an annotated read-only legacy
  // artifact with no outgoing relationship into the architecture.
  const ctx = readDiagram(CONTEXT_PATH)
  const legacy = [...nodes(ctx)].filter(([, label]) => /gbrain-atlas/i.test(label))
  for (const [id, label] of legacy) {
    assert.match(label, /legacy/i, `${id} must be marked as legacy`)
    assert.match(label, /read-only/i, `${id} must be marked as read-only`)
    const outgoing = edges(ctx).filter(([from]) => from === id)
    assert.deepEqual(outgoing, [], `${id} must not feed anything: ${JSON.stringify(outgoing)}`)
  }
})

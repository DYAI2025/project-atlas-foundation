// ATLAS-14 ARCH_DOC_PARITY — focused tests for the architecture documents declared by
// architecture-decision.json.
//
// Two concerns, deliberately kept apart:
//   1. PARITY — every declared diagram_paths entry is usable and resolves, and the
//      repository validator turns a broken declaration into a controlled finding
//      (exit 1 + VALIDATION FAILED) rather than an uncaught crash.
//   2. SEMANTICS — durable architecture invariants of the two diagrams: the pilot and
//      the production target stay distinguishable, GBrain stays a derived projection,
//      the pilot claims no production controls, no graph UI stack is selected, the
//      legacy repository is never an implementation source, and the DEC-06 knowledge
//      governance separation (human approval, separate publisher, agents read+propose)
//      survives.
//
// WHAT THESE TESTS DELIBERATELY DO NOT DO — no diagram DSL.
// Nothing here is anchored to a Mermaid identifier, to an exact subgraph title, to a
// node count or to a particular layout/topology. Roles are discovered by what an
// element SAYS it is: a lane is found by a title that reads as the pilot or as the
// production target, the control plane is found by the label that names it, the
// approval and publication authorities are found by the authority they claim. A
// consistent rename of every structural id in either diagram, or a different but
// meaning-preserving arrangement of the same elements, must leave this suite green.
// What is parsed is ordinary Mermaid flowchart syntax and ordinary label text.
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
// Generic Mermaid flowchart reader (structure only, no rendering, no new deps)
// ---------------------------------------------------------------------------

function readDiagram(relPath) {
  return readFileSync(path.join(REPO, relPath), 'utf8')
}

const NODE_DECL = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\[\s*"([\s\S]*?)"\s*\]/gm
const ARROW = /-(?:\.)?-+>/
const SUBGRAPH_OPEN = /^subgraph\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[\s*"([\s\S]*?)"\s*\])?/

// Three kinds of element can legitimately mention "gbrain", and they carry different
// obligations: the pinned legacy repository, the versioned read contract, and the
// derived projection itself. Only the last one is a data-holding component.
const LEGACY_NODE = /gbrain-atlas/i
const READ_CONTRACT_NODE = /gbrain-read/i
const CANONICAL_CLAIM = /source of truth|canonical (?:store|write)|system of record|write store/i

// The ATLAS-owned control plane, found by what it calls itself rather than by the
// identifier or the boundary box it happens to sit in today.
const CONTROL_PLANE = /atlas core|control plane/i

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

/**
 * Every `subgraph ... end` block, nesting-aware, as {id, title, block}. A subgraph
 * without a quoted title falls back to its identifier so callers never crash on one.
 */
function subgraphs(src) {
  const lines = src.split('\n')
  const open = []
  const out = []
  lines.forEach((raw, i) => {
    const t = raw.trim()
    if (t.startsWith('%%')) return
    const m = t.match(SUBGRAPH_OPEN)
    if (m) {
      open.push({ id: m[1], title: m[2] ?? m[1], start: i })
      return
    }
    if (t === 'end') {
      const started = open.pop()
      assert.ok(started, 'unbalanced `end` without an open subgraph')
      out.push({
        id: started.id,
        title: started.title,
        block: lines.slice(started.start, i + 1).join('\n')
      })
    }
  })
  assert.equal(open.length, 0, `unclosed subgraph: ${open.map((s) => s.id).join(',')}`)
  return out
}

/** The one subgraph whose TITLE reads like `pattern` — never addressed by identifier. */
function subgraphTitled(src, pattern, what) {
  const hits = subgraphs(src).filter((s) => pattern.test(s.title))
  assert.equal(hits.length, 1, `${what}: expected exactly one subgraph titled like ${pattern}, found ${hits.length}`)
  return hits[0]
}

/** Ids of the ATLAS-owned control-plane elements, however many the diagram draws. */
function controlPlaneIds(src) {
  const ids = [...nodes(src)].filter(([, label]) => CONTROL_PLANE.test(label)).map(([id]) => id)
  assert.ok(ids.length > 0, 'no ATLAS control-plane element is declared')
  return ids
}

// ---------------------------------------------------------------------------
// Authority reading — who claims to decide, who claims to publish (DEC-06)
// ---------------------------------------------------------------------------
//
// A label is read clause by clause (`<br/>`-separated, as authors already write them).
// A clause disclaims the authority only when the negation stands BEFORE it ("never
// approve or publish", "not the knowledge approver"); a negation trailing an unrelated
// part of the same clause cannot launder a claim into a disclaimer. Descriptive nouns
// are not authority either: a store that keeps "approval evidence" or "publication and
// audit records" holds neither role.

const CLAUSE_SEPARATOR = /<br\s*\/?>|\n/
const NEGATION = /\b(?:never|not|no|without|neither|nor)\b/i
const APPROVAL_AUTHORITY = /\bapprov(?:e|es|er)\b/i
const PUBLICATION_AUTHORITY =
  /\b(?:publisher|publishes|authoriz(?:e|es)\s+publication|publication\s+authority)\b/i

function claimsAuthority(label, pattern) {
  return label.split(CLAUSE_SEPARATOR).some((clause) => {
    const claim = clause.match(pattern)
    if (!claim) return false
    return !NEGATION.test(clause.slice(0, claim.index))
  })
}

function nodesClaiming(src, pattern) {
  return [...nodes(src)].filter(([, label]) => claimsAuthority(label, pattern))
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
    let info
    try {
      info = statSync(src)
    } catch {
      continue // listed but unreadable, e.g. a dangling symlink in a dirty worktree
    }
    if (!info.isFile()) continue
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

test('the declared set covers both the context and the container role', () => {
  // Parity is about the declaration, not about hard-coded filenames: the roles are
  // identified by keyword, so a rename stays legal. Declaring a further diagram later
  // (component, deployment) must not fail this test — only losing a role may.
  const declared = decision.diagram_paths
  const context = declared.filter((p) => /context/i.test(p))
  const container = declared.filter((p) => /container/i.test(p))
  assert.ok(context.length >= 1, 'no context diagram is declared')
  assert.ok(container.length >= 1, 'no container diagram is declared')
  assert.notEqual(
    context[0],
    container[0],
    'context and container must be two separate documents'
  )
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
// 4) Architecture semantics
// ---------------------------------------------------------------------------

test('both diagrams are well-formed flowcharts with balanced blocks and declared edge ends', () => {
  for (const rel of decision.diagram_paths) {
    const src = readDiagram(rel)
    assert.match(src, /^flowchart\s+\w+/m, `${rel}: no flowchart directive`)
    const declared = nodes(src)
    const blocks = subgraphs(src) // throws on any unbalanced subgraph/end
    const known = new Set([...declared.keys(), ...blocks.map((b) => b.id)])
    assert.ok(declared.size > 0, `${rel}: no nodes declared`)
    for (const [from, to] of edges(src)) {
      assert.ok(known.has(from), `${rel}: edge from undeclared id ${from}`)
      assert.ok(known.has(to), `${rel}: edge to undeclared id ${to}`)
    }
  }
})

test('the container diagram keeps the local pilot and the production target distinguishable', () => {
  const src = readDiagram(CONTAINER_PATH)
  const pilot = subgraphTitled(src, /pilot/i, 'pilot lane')
  const target = subgraphTitled(src, /production target/i, 'production-target lane')
  assert.notEqual(pilot.id, target.id, 'pilot and production target must be two lanes')

  // Both lanes are target state; neither may read as an existing deployment.
  assert.match(pilot.title, /not implemented/i)
  assert.match(target.title, /not implemented/i)

  const pilotIds = [...nodes(pilot.block).keys()]
  const targetIds = [...nodes(target.block).keys()]
  assert.ok(pilotIds.length > 0, 'pilot lane has no containers')
  assert.ok(targetIds.length > 0, 'production-target lane has no containers')
  const overlap = pilotIds.filter((id) => targetIds.includes(id))
  assert.deepEqual(overlap, [], `lanes must not share containers: ${overlap.join(',')}`)
})

test('the pilot lane is local, goes through the read contract and ends at a viewer', () => {
  const labels = [...nodes(subgraphTitled(readDiagram(CONTAINER_PATH), /pilot/i, 'pilot lane').block).values()].join('\n')
  assert.match(labels, /local/i, 'pilot must be explicitly local')
  assert.match(labels, /gbrain-read\/v1/i, 'pilot must go through the gbrain-read/v1 contract')
  assert.match(labels, /projection-local\/v1/i, 'pilot identifiers stay projection-local')
  assert.match(labels, /browser/i, 'pilot ends at a browser viewer')
})

test('GBrain is represented as a derived projection, never as the canonical store', () => {
  for (const rel of decision.diagram_paths) {
    const src = readDiagram(rel)
    let projections = 0
    for (const [id, label] of nodes(src)) {
      if (!/gbrain/i.test(label)) continue
      if (LEGACY_NODE.test(label)) continue // legacy artifact, covered by its own test
      // No GBrain element of any kind may claim canonical status.
      assert.doesNotMatch(label, CANONICAL_CLAIM, `${rel}: ${id} must not claim canonical status`)
      if (READ_CONTRACT_NODE.test(label)) {
        assert.match(label, /read-only|read contract/i, `${rel}: ${id} must stay a read-only contract`)
        continue
      }
      projections++
      assert.match(label, /derived|projection/i, `${rel}: ${id} must be marked derived/projection`)
    }
    assert.ok(projections >= 1, `${rel}: GBrain must be shown as a derived projection`)
  }

  // Exactly one element in the context diagram carries the source-of-truth role, and it
  // is Confluence — not GBrain.
  const ctx = readDiagram(CONTEXT_PATH)
  const sourceOfTruth = [...nodes(ctx)].filter(([, label]) => /source of truth/i.test(label))
  assert.equal(sourceOfTruth.length, 1, 'exactly one context element may be the source of truth')
  assert.match(sourceOfTruth[0][1], /confluence/i)

  // Direction is the real invariant: the control plane projects into GBrain, and GBrain
  // never writes back into it. How many boxes either side is drawn as is not.
  const coreIds = controlPlaneIds(ctx)
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
      ctxEdges.some(([f, t]) => coreIds.includes(f) && t === g),
      `the control plane must project into ${g}`
    )
    assert.ok(
      !ctxEdges.some(([f, t]) => f === g && coreIds.includes(t)),
      `${g} must never write into the control plane`
    )
  }
})

test('the pilot lane claims no production isolation, publisher or deployment controls', () => {
  const src = readDiagram(CONTAINER_PATH)
  const pilot = subgraphTitled(src, /pilot/i, 'pilot lane').block
  const target = subgraphTitled(src, /production target/i, 'production-target lane').block

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

// ---------------------------------------------------------------------------
// 5) DEC-06 knowledge governance
// ---------------------------------------------------------------------------

test('authority reading counts a claim unless the negation precedes it', () => {
  // Guards the reader itself. Without the ordering rule, a label saying "approves
  // proposals and authorizes publication, not delegated" would be read as holding
  // neither role, and the separation test below could be walked past by wording alone.
  const laundered = 'approves proposals and authorizes publication, not delegated'
  assert.ok(claimsAuthority(laundered, APPROVAL_AUTHORITY), 'trailing negation must not erase the approval claim')
  assert.ok(claimsAuthority(laundered, PUBLICATION_AUTHORITY), 'trailing negation must not erase the publication claim')

  // A real disclaimer stands before the authority it disclaims.
  assert.ok(!claimsAuthority('read and propose by default, never approve or publish', APPROVAL_AUTHORITY))
  assert.ok(!claimsAuthority('not the knowledge approver and not the publisher', APPROVAL_AUTHORITY))
  assert.ok(!claimsAuthority('not the knowledge approver and not the publisher', PUBLICATION_AUTHORITY))

  // Keeping records of a decision is not holding the authority for it.
  assert.ok(!claimsAuthority('classifications, proposals, approval evidence', APPROVAL_AUTHORITY))
  assert.ok(!claimsAuthority('publication and audit records, projection checkpoints', PUBLICATION_AUTHORITY))
})

test('the knowledge approval decision and the publication authority stay separate roles', () => {
  // DEC-06: an agent-authored knowledge change needs a HUMAN decision, and the
  // approving identity and the publishing identity are technically separated. Which
  // organisational person holds either is not an architecture statement — so the test
  // asks who CLAIMS the authority, not who is named.
  const ctx = readDiagram(CONTEXT_PATH)
  const approvers = nodesClaiming(ctx, APPROVAL_AUTHORITY)
  const publishers = nodesClaiming(ctx, PUBLICATION_AUTHORITY)

  assert.ok(approvers.length > 0, 'no element holds the knowledge approval decision')
  assert.ok(publishers.length > 0, 'no element holds the publication responsibility')

  const publisherIds = new Set(publishers.map(([id]) => id))
  const collapsed = approvers.map(([id]) => id).filter((id) => publisherIds.has(id))
  assert.deepEqual(
    collapsed,
    [],
    `approval and publication must not collapse into one role: ${collapsed.join(',')}`
  )

  assert.ok(
    approvers.some(([, label]) => /human/i.test(label)),
    'the approval decision must be marked as a human decision (DEC-06)'
  )
})

test('delivery-governance roles are not declared as the knowledge approver or publisher', () => {
  // The Product Owner may appear for delivery, architecture and release governance.
  // DEC-06 does not make that role the canonical knowledge approver or publisher, so
  // the diagram must not invent it. Vacuous if no such role is drawn at all.
  const ctx = readDiagram(CONTEXT_PATH)
  const delivery = [...nodes(ctx)].filter(([, label]) => /product owner/i.test(label))
  for (const [id, label] of delivery) {
    assert.ok(
      !claimsAuthority(label, APPROVAL_AUTHORITY),
      `${id} must not be declared the knowledge approver`
    )
    assert.ok(
      !claimsAuthority(label, PUBLICATION_AUTHORITY),
      `${id} must not be declared the publication authority`
    )
  }
})

test('the context diagram preserves the approval-boundary write paths', () => {
  // approval-boundary.md item 3 / DEC-06: no direct agent publish. Agents keep
  // read+propose, reach Confluence only through the control plane and a human decision,
  // and never carry an approval or publication authority of their own.
  // approval-boundary.md item 2: Obsidian is a read-only projection in V1, so it never
  // writes back into Confluence or into the control plane.
  const ctx = readDiagram(CONTEXT_PATH)
  const idsWhere = (pattern) =>
    [...nodes(ctx)].filter(([, label]) => pattern.test(label)).map(([id]) => id)

  const agentNodes = [...nodes(ctx)].filter(([, label]) => /coding agents/i.test(label))
  const confluence = idsWhere(/confluence/i)
  const obsidian = idsWhere(/obsidian/i)
  const core = controlPlaneIds(ctx)
  assert.ok(agentNodes.length > 0, 'the context diagram must show coding agents')
  assert.ok(confluence.length > 0, 'the context diagram must show Confluence')
  assert.ok(obsidian.length > 0, 'the context diagram must show Obsidian')

  for (const [id, label] of agentNodes) {
    assert.match(label, /read/i, `${id} must keep the read capability`)
    assert.match(label, /propose/i, `${id} must keep the propose capability`)
    assert.ok(
      !claimsAuthority(label, APPROVAL_AUTHORITY),
      `${id} must never hold approval authority (DEC-06)`
    )
    assert.ok(
      !claimsAuthority(label, PUBLICATION_AUTHORITY),
      `${id} must never publish canonical knowledge (DEC-06)`
    )
  }

  const ctxEdges = edges(ctx)
  for (const [agent] of agentNodes) {
    for (const target of confluence) {
      assert.ok(
        !ctxEdges.some(([f, t]) => f === agent && t === target),
        `${agent} must not write into ${target} directly (approval boundary item 3)`
      )
    }
  }
  const obsidianWrites = ctxEdges.filter(
    ([f, t]) => obsidian.includes(f) && (confluence.includes(t) || core.includes(t))
  )
  assert.deepEqual(
    obsidianWrites,
    [],
    `Obsidian must stay read-only (approval boundary item 2): ${JSON.stringify(obsidianWrites)}`
  )
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

// ATLAS-39 visual verification.
//
// The goldens under test/golden/ are real SVG files rendered by the exact
// modules the browser loads, with the stage design tokens inlined — open one in
// a browser and you are looking at the stage. Because the renderer is a pure
// function of (snapshot, viewport, focus), a byte comparison is a genuine
// visual regression gate that needs no headless-browser dependency and no CI
// change. Any change to geometry, state classes, labels, accessible names or
// stage styling fails here until the golden is deliberately regenerated.
//
// The tests also pin WHAT was rendered: the source is the committed real
// ATLAS-65 evidence, identified by its sha256, so a synthetic dataset cannot be
// slipped in behind a still-passing visual gate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { GOLDENS, GOLDEN_DIR, EVIDENCE_DIR, VIEWPORT, FOCUS_NODE_ID, repoRoot, renderGolden } from '../scripts/atlas39/render-golden.mjs'

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

// The accepted ATLAS-65 snapshot, byte-identical to the artifact the pilot
// pipeline published. If this changes, the graph on screen is no longer the
// graph that was accepted, and every golden below is meaningless.
const ACCEPTED_SNAPSHOT_SHA256 = '12c32883a6ccaeb0455b33715af89d4d8cc5547a255fec3386edcb158980b739'

test('the visual baseline is rendered from the accepted real ATLAS snapshot', () => {
  assert.equal(sha256(join(EVIDENCE_DIR, 'graph-snapshot.json')), ACCEPTED_SNAPSHOT_SHA256)
  const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
  assert.equal(snapshot.project_id, 'ATLAS')
  assert.equal(snapshot.source.source_id, '14778372')
  assert.equal(snapshot.nodes.length, 5)
  assert.equal(snapshot.edges.length, 4)
})

test('both goldens are byte-identical to a fresh render', () => {
  for (const { file, focusId } of GOLDENS) {
    const committed = readFileSync(join(GOLDEN_DIR, file), 'utf8')
    assert.equal(committed, renderGolden(focusId), `${file} drifted — regenerate with npm run atlas39:golden`)
  }
})

test('the golden is a standalone image carrying the stage design tokens', () => {
  const svg = readFileSync(join(GOLDEN_DIR, 'atlas39-stage-overview.svg'), 'utf8')
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'))
  assert.ok(svg.includes(`viewBox="0 0 ${VIEWPORT.width} ${VIEWPORT.height}"`))
  assert.ok(svg.includes('--focus-ring'), 'design tokens must be inlined')
  assert.ok(svg.includes('.a39-node-disc'), 'stage rules must be inlined')
  assert.ok(svg.trimEnd().endsWith('</svg>'))
})

test('the golden shows the real Confluence pages, not placeholders', () => {
  const svg = readFileSync(join(GOLDEN_DIR, 'atlas39-stage-overview.svg'), 'utf8')
  for (const pageId of ['14680066', '14778372', '15073290', '15171611', '22478849']) {
    assert.ok(svg.includes(`ATLAS:confluence:14778372:${pageId}`), `page ${pageId} missing from the stage`)
  }
  assert.ok(svg.includes('ATLAS Single Source of Truth'))
  assert.equal(svg.includes('lorem'), false)
})

test('the focused golden records a real focus state, not a copy of the overview', () => {
  const overview = readFileSync(join(GOLDEN_DIR, 'atlas39-stage-overview.svg'), 'utf8')
  const focused = readFileSync(join(GOLDEN_DIR, 'atlas39-stage-focus.svg'), 'utf8')
  assert.notEqual(overview, focused)
  // Matched in its markup form (space-separated class list); the inlined
  // stylesheet legitimately mentions the selector ".a39-node.is-focus".
  assert.equal((overview.match(/a39-node is-focus/g) || []).length, 0)
  assert.equal((overview.match(/a39-node is-idle/g) || []).length, 5)
  assert.match(focused, new RegExp(`data-node-id="${FOCUS_NODE_ID}"`))
  assert.equal((focused.match(/a39-node is-focus/g) || []).length, 1)
  assert.equal((focused.match(/a39-node is-neighbour/g) || []).length, 2)
  assert.equal((focused.match(/a39-edge is-active/g) || []).length, 2)
})

test('the --check mode reports drift instead of silently rewriting the baseline', () => {
  const script = join(repoRoot, 'scripts/atlas39/render-golden.mjs')
  const pass = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', cwd: repoRoot })
  assert.equal(pass.status, 0, pass.stderr)
  assert.match(pass.stdout, /goldens match/)

  // Negative proof: a gate that has only ever been observed passing is not
  // known to be a gate. The baseline is perturbed by exactly one byte, the
  // check must fail closed, and the original bytes are restored unconditionally.
  const target = join(GOLDEN_DIR, 'atlas39-stage-overview.svg')
  const original = readFileSync(target)
  try {
    writeFileSync(target, `${original.toString('utf8')}<!-- drift -->`)
    const fail = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', cwd: repoRoot })
    assert.equal(fail.status, 1)
    assert.match(fail.stderr, /E_VISUAL_DRIFT/)
    assert.match(fail.stderr, /atlas39-stage-overview\.svg: differs/)
  } finally {
    writeFileSync(target, original)
  }
  assert.equal(readFileSync(target).equals(original), true, 'the baseline must be restored')
})

test('a missing golden fails closed rather than passing vacuously', () => {
  const script = join(repoRoot, 'scripts/atlas39/render-golden.mjs')
  const target = join(GOLDEN_DIR, 'atlas39-stage-focus.svg')
  const original = readFileSync(target)
  try {
    rmSync(target)
    const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8', cwd: repoRoot })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unreadable/)
  } finally {
    writeFileSync(target, original)
  }
  assert.equal(readFileSync(target).equals(original), true, 'the baseline must be restored')
})

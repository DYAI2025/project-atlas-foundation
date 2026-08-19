// ATLAS-40: the fail-closed gate over the scene.
//
// A guard that has only ever been observed passing is not known to be a guard.
// So every test below is a counterexample: it takes the real, accepted scene,
// breaks exactly one thing in it, and requires a refusal naming that thing. The
// control at the top proves the unbroken scene passes, so a refusal cannot be
// mistaken for the guard simply rejecting everything.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import { buildScene, projectScene } from '../viewer/atlas39/core/scene.mjs'
import { sceneViolation } from '../viewer/atlas39/core/scene-guard.mjs'
import { resetTransform } from '../viewer/atlas39/core/transform.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE_DIR = join(repoRoot, 'docs/evidence/atlas-65')
const VIEWPORT = { width: 1440, height: 900 }

const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'provenance.json'), 'utf8'))
const viewModel = buildViewModel(snapshot, provenance)
const layout = computeLayout(viewModel, VIEWPORT)

/** A fresh, structurally independent copy of the real accepted scene. */
function freshScene() {
  const world = { width: layout.width, height: layout.height }
  return projectScene(
    buildScene(viewModel, layout, selectFocus(viewModel, null)),
    resetTransform(world)
  )
}

/** Breaks one thing and returns the guard's verdict. */
function afterMutation(mutate) {
  const scene = freshScene()
  mutate(scene)
  return sceneViolation(scene)
}

test('CONTROL: the unmutated real scene is accepted', () => {
  assert.equal(sceneViolation(freshScene()), null)
})

test('a non-finite coordinate is refused, never drawn approximately', () => {
  // This is the failure mode that motivates the whole module: most drivers drop
  // a triangle containing NaN without a word, so a node disappears and the graph
  // still looks perfectly fine.
  assert.match(afterMutation((s) => { s.nodes[2].x = Number.NaN }), /non-finite x/)
  assert.match(afterMutation((s) => { s.nodes[0].y = Number.POSITIVE_INFINITY }), /non-finite y/)
  assert.match(afterMutation((s) => { s.nodes[1].labelX = Number.NaN }), /non-finite labelX/)
  assert.match(afterMutation((s) => { s.edges[0].points[3].x = Number.NaN }), /point 3 is not a finite coordinate/)
  assert.match(afterMutation((s) => { s.rings[0].r = Number.NaN }), /non-finite r/)
})

test('a hit target that no longer matches its halo is refused', () => {
  // The accepted ATLAS-39 defect, pinned. A future change that recomputes one
  // of the two independently fails here instead of shipping.
  const violation = afterMutation((s) => { s.nodes[0].hitR = s.nodes[0].haloR + 6 })
  assert.match(violation, /hit radius .* differs from its halo/)
})

test('a halo smaller than its own disc is refused', () => {
  assert.match(afterMutation((s) => { s.nodes[0].haloR = 1; s.nodes[0].hitR = 1 }), /halo smaller than its disc/)
})

test('an unknown state is refused rather than painted as a default', () => {
  assert.match(afterMutation((s) => { s.nodes[0].state = 'selected' }), /unknown state "selected"/)
  assert.match(afterMutation((s) => { s.edges[0].state = 'highlight' }), /unknown state "highlight"/)
  assert.match(afterMutation((s) => { s.nodes[0].anchor = 'left' }), /unknown label anchor "left"/)
})

test('the tab order must contain exactly one node', () => {
  assert.match(afterMutation((s) => { for (const n of s.nodes) n.tabbable = false }), /0 nodes are in the tab order/)
  assert.match(afterMutation((s) => { for (const n of s.nodes) n.tabbable = true }), /5 nodes are in the tab order/)
  assert.match(afterMutation((s) => { s.nodes[0].tabbable = 'yes' }), /non-boolean tabbable/)
})

test('a label that is not plain text is refused', () => {
  assert.match(afterMutation((s) => { s.nodes[0].label = '' }), /has no label/)
  assert.match(afterMutation((s) => { s.nodes[0].label = 42 }), /has no label/)
  assert.match(afterMutation((s) => { s.nodes[0].ariaLabel = '' }), /has no ariaLabel/)
  assert.match(afterMutation((s) => { s.nodes[0].label = 'Root\u0000page' }), /control character in its label/)
  assert.match(afterMutation((s) => { s.nodes[1].label = 'Two\nlines' }), /control character in its label/)
  assert.match(afterMutation((s) => { s.nodes[1].ariaLabel = 'a\u009fb' }), /control character in its ariaLabel/)
})

test('a scene that disagrees with its own counts is refused', () => {
  // A truncated upload is the quiet way to lose part of a graph: the renderer
  // draws what it was given and the count in the status bar still says five.
  assert.match(afterMutation((s) => { s.nodes.pop() }), /claims 5 nodes but carries 4/)
  assert.match(afterMutation((s) => { s.edges.pop() }), /claims 4 edges but carries 3/)
  // The counts are corrected alongside the duplication, so what fires here is
  // the identity check rather than the arithmetic one above it.
  assert.match(
    afterMutation((s) => {
      s.nodes.push({ ...s.nodes[0], tabbable: false })
      s.counts.nodes = s.nodes.length
    }),
    /duplicate node id/
  )
  assert.match(
    afterMutation((s) => {
      s.edges.push({ ...s.edges[0] })
      s.counts.edges = s.edges.length
    }),
    /duplicate edge id/
  )
})

test('a degenerate stage or geometry is refused', () => {
  assert.match(afterMutation((s) => { s.width = 0 }), /width is not a positive number/)
  assert.match(afterMutation((s) => { s.height = Number.NaN }), /height is not a positive number/)
  assert.match(afterMutation((s) => { s.nodes[0].r = 0 }), /non-positive radius/)
  assert.match(afterMutation((s) => { s.nodes[0].labelMaxWidth = 0 }), /non-positive label budget/)
  assert.match(afterMutation((s) => { s.edges[0].points = [{ x: 1, y: 1 }] }), /fewer than two points/)
  assert.match(afterMutation((s) => { s.nodes[0].depth = 1.5 }), /invalid depth/)
  assert.match(afterMutation((s) => { s.nodes[0].depth = -1 }), /invalid depth/)
})

test('a structurally wrong scene is refused before anything is indexed', () => {
  for (const junk of [null, undefined, 'scene', 42, []]) {
    assert.equal(typeof sceneViolation(junk), 'string', `${JSON.stringify(junk)} was accepted`)
  }
  assert.match(afterMutation((s) => { s.nodes = 'five' }), /nodes is not an array/)
  assert.match(afterMutation((s) => { s.edges = null }), /edges is not an array/)
  assert.match(afterMutation((s) => { s.rings = 2 }), /rings is not an array/)
  assert.match(afterMutation((s) => { delete s.counts }), /counts is missing/)
  assert.match(afterMutation((s) => { s.nodes[0] = null }), /node 0 is not an object/)
  assert.match(afterMutation((s) => { s.edges[0] = 'edge' }), /edge 0 is not an object/)
  assert.match(afterMutation((s) => { s.nodes[0].nodeId = '' }), /has no node id/)
})

test('the guard reports the first problem and does not repair anything', () => {
  const scene = freshScene()
  const before = JSON.stringify(scene)
  scene.nodes[0].x = Number.NaN
  const violation = sceneViolation(scene)
  assert.ok(violation)
  // Nothing was clamped, dropped or defaulted on the way out: refusing is the
  // whole behaviour.
  assert.equal(Number.isNaN(scene.nodes[0].x), true)
  assert.equal(scene.nodes.length, 5)
  scene.nodes[0].x = JSON.parse(before).nodes[0].x
  assert.equal(sceneViolation(scene), null)
})

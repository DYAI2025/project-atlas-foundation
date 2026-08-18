// ATLAS-40: the scene the WebGL stage draws, built from the REAL accepted
// ATLAS-65 evidence.
//
// The point of these tests is that the graph on screen is the graph that was
// accepted. They therefore read the committed evidence directly, pin its digest,
// and assert on the actual Confluence page ids and titles — a synthetic dataset
// cannot be slipped in behind a still-passing scene test.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildViewModel, selectFocus } from '../viewer/atlas39/core/view-model.mjs'
import { computeLayout } from '../viewer/atlas39/core/layout.mjs'
import {
  HALO_GAP,
  MIN_HIT_SCREEN_R,
  EDGE_SEGMENTS,
  NODE_STATES,
  EDGE_STATES,
  buildScene,
  projectScene,
  parseCssColor,
  resolvePalette,
  labelBudget,
  depthColor,
  PaletteError
} from '../viewer/atlas39/core/scene.mjs'
import { sceneViolation } from '../viewer/atlas39/core/scene-guard.mjs'
import { resetTransform, zoomAt, panBy } from '../viewer/atlas39/core/transform.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const EVIDENCE_DIR = join(repoRoot, 'docs/evidence/atlas-65')
const VIEWPORT = { width: 1440, height: 900 }
const FOCUS_NODE_ID = 'ATLAS:confluence:14778372:15171611'

// The same digest the ATLAS-39 visual gate and the runbook pin. Stated again
// here so the WebGL scene cannot be verified against a different snapshot than
// the one that was accepted.
const ACCEPTED_SNAPSHOT_SHA256 = '12c32883a6ccaeb0455b33715af89d4d8cc5547a255fec3386edcb158980b739'

const snapshot = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'), 'utf8'))
const provenance = JSON.parse(readFileSync(join(EVIDENCE_DIR, 'provenance.json'), 'utf8'))
const viewModel = buildViewModel(snapshot, provenance)
const layout = computeLayout(viewModel, VIEWPORT)
const WORLD = { width: layout.width, height: layout.height }

const sceneAt = (focusId, transform = resetTransform(WORLD)) =>
  projectScene(buildScene(viewModel, layout, selectFocus(viewModel, focusId)), transform)

const REAL_PAGE_IDS = ['14680066', '14778372', '15073290', '15171611', '22478849']

test('the scene is built from the accepted real ATLAS snapshot', () => {
  const digest = createHash('sha256').update(readFileSync(join(EVIDENCE_DIR, 'graph-snapshot.json'))).digest('hex')
  assert.equal(digest, ACCEPTED_SNAPSHOT_SHA256)
  assert.equal(snapshot.project_id, 'ATLAS')
  assert.equal(snapshot.source.source_id, '14778372')
  assert.equal(snapshot.nodes.length, 5)
  assert.equal(snapshot.edges.length, 4)
})

test('every real node and edge reaches the renderer', () => {
  const scene = sceneAt(null)
  assert.equal(scene.counts.nodes, 5)
  assert.equal(scene.counts.edges, 4)
  assert.equal(scene.nodes.length, 5)
  assert.equal(scene.edges.length, 4)

  for (const pageId of REAL_PAGE_IDS) {
    assert.ok(
      scene.nodes.some((n) => n.nodeId === `ATLAS:confluence:14778372:${pageId}`),
      `page ${pageId} never reached the scene`
    )
  }
  const labels = scene.nodes.map((n) => n.label)
  assert.ok(labels.includes('ATLAS Single Source of Truth'))
  assert.ok(labels.includes('Sprint 2 – Visible Real Semantic Atlas – Sprint Plan'))
  // Each edge is tessellated for the GPU but keeps its identity.
  for (const edge of scene.edges) {
    assert.match(edge.edgeId, /^ATLAS:confluence:14778372:parent_of:/)
    assert.equal(edge.points.length, EDGE_SEGMENTS + 1)
  }
})

test('the accessible name of every node carries its hierarchy and its degree', () => {
  const scene = sceneAt(null)
  const root = scene.nodes.find((n) => n.nodeId === 'ATLAS:confluence:14778372:14778372')
  assert.equal(root.ariaLabel, 'ATLAS Single Source of Truth, level 0, 3 direct relations')
  const leaf = scene.nodes.find((n) => n.nodeId === 'ATLAS:confluence:14778372:22478849')
  assert.match(leaf.ariaLabel, /level 2, 1 direct relation$/)
})

test('exactly one node is in the tab order, and focusing moves it', () => {
  const overview = sceneAt(null)
  const tabbable = overview.nodes.filter((n) => n.tabbable)
  assert.equal(tabbable.length, 1)
  assert.equal(tabbable[0].nodeId, viewModel.nodes[0].node_id, 'the first node in hierarchy order should hold the tab stop')

  const focused = sceneAt(FOCUS_NODE_ID)
  const moved = focused.nodes.filter((n) => n.tabbable)
  assert.equal(moved.length, 1)
  assert.equal(moved[0].nodeId, FOCUS_NODE_ID)
})

test('focus produces a real focus state, not a recoloured overview', () => {
  const overview = sceneAt(null)
  assert.deepEqual([...new Set(overview.nodes.map((n) => n.state))], ['idle'])
  assert.deepEqual([...new Set(overview.edges.map((e) => e.state))], ['idle'])

  const focused = sceneAt(FOCUS_NODE_ID)
  const states = focused.nodes.map((n) => n.state)
  assert.equal(states.filter((s) => s === 'focus').length, 1)
  assert.equal(states.filter((s) => s === 'neighbour').length, 2)
  assert.equal(states.filter((s) => s === 'dim').length, 2)
  assert.equal(focused.edges.filter((e) => e.state === 'active').length, 2)
  assert.equal(focused.edges.filter((e) => e.state === 'dim').length, 2)
  for (const state of focused.nodes.map((n) => n.state)) assert.ok(NODE_STATES.includes(state))
  for (const state of focused.edges.map((e) => e.state)) assert.ok(EDGE_STATES.includes(state))
})

test('the interactive region is exactly the painted halo, at every zoom level', () => {
  // The accepted ATLAS-39 finding was a visible halo larger than the region that
  // answered a click. One field, two consumers, so it cannot recur.
  for (const factor of [1, 0.25, 0.5, 2, 4, 8]) {
    const scene = sceneAt(null, zoomAt(resetTransform(WORLD), factor, 720, 450, WORLD))
    for (const node of scene.nodes) {
      assert.equal(node.hitR, node.haloR, `hit and halo disagree at zoom ${factor}`)
      assert.ok(node.haloR >= node.r, `halo smaller than the disc at zoom ${factor}`)
      assert.ok(node.hitR >= MIN_HIT_SCREEN_R, `hit target ${node.hitR} is below the operable minimum`)
    }
  }
})

test('the halo tracks the disc until the operable minimum takes over', () => {
  const wide = sceneAt(null, { scale: 4, tx: 0, ty: 0 })
  for (const node of wide.nodes) {
    // Far above the floor, the halo is exactly the disc plus the gap.
    assert.ok(Math.abs(node.haloR - (node.r + HALO_GAP * 4)) < 1e-9)
  }
  const tiny = sceneAt(null, { scale: 0.25, tx: 0, ty: 0 })
  assert.ok(tiny.nodes.every((n) => n.hitR === MIN_HIT_SCREEN_R), 'the floor should hold at minimum zoom')
})

test('a label budget is real geometry, not a character count', () => {
  // The ATLAS-39 clipping finding came from truncating at a fixed 26 characters,
  // which cannot know how close to the border a label starts.
  assert.equal(labelBudget(1430, 'start', 1440), 48, 'a label hard against the right edge falls back to the minimum')
  assert.ok(labelBudget(200, 'start', 1440) > labelBudget(1200, 'start', 1440))
  assert.ok(labelBudget(1200, 'end', 1440) > labelBudget(200, 'end', 1440))
  assert.equal(labelBudget(720, 'middle', 1440), 1428)

  for (const node of sceneAt(null).nodes) {
    assert.ok(node.labelMaxWidth > 0, `${node.nodeId} has no room for its label`)
    assert.ok(node.label.length > 0)
    // Nothing is pre-truncated: the full real title reaches the overlay, which
    // ellipsises with the measured budget instead of guessing.
    assert.equal(node.label.includes('…'), false)
  }
  const sprint = sceneAt(null).nodes.find((n) => n.nodeId === 'ATLAS:confluence:14778372:22478849')
  assert.equal(sprint.label, 'Sprint 2 – Visible Real Semantic Atlas – Sprint Plan')
})

test('the scene stays drawable under zoom, pan and both combined', () => {
  const views = [
    resetTransform(WORLD),
    zoomAt(resetTransform(WORLD), 8, 0, 0, WORLD),
    zoomAt(resetTransform(WORLD), 0.25, 1440, 900, WORLD),
    panBy(resetTransform(WORLD), 100000, -100000, WORLD),
    panBy(zoomAt(resetTransform(WORLD), 6, 300, 300, WORLD), -5000, 5000, WORLD)
  ]
  for (const view of views) {
    const scene = sceneAt(FOCUS_NODE_ID, view)
    assert.equal(sceneViolation(scene), null, `scene refused at ${JSON.stringify(view)}`)
    assert.equal(scene.counts.nodes, 5, 'zooming must never drop a node from the scene')
    assert.equal(scene.counts.edges, 4, 'zooming must never drop an edge from the scene')
  }
})

test('pan moves the whole scene by exactly the pan delta', () => {
  const before = sceneAt(null, resetTransform(WORLD))
  const after = sceneAt(null, panBy(resetTransform(WORLD), 120, -80, WORLD))
  for (const [index, node] of after.nodes.entries()) {
    assert.equal(node.x - before.nodes[index].x, 120)
    assert.equal(node.y - before.nodes[index].y, -80)
    assert.equal(node.r, before.nodes[index].r, 'panning must not resize anything')
  }
})

test('zoom scales geometry about the anchor and leaves the graph intact', () => {
  const before = sceneAt(null, resetTransform(WORLD))
  const after = sceneAt(null, zoomAt(resetTransform(WORLD), 2, 720, 450, WORLD))
  for (const [index, node] of after.nodes.entries()) {
    assert.equal(node.r, before.nodes[index].r * 2)
    // The anchor is the stage centre, so a node's offset from it doubles.
    assert.ok(Math.abs((node.x - 720) - (before.nodes[index].x - 720) * 2) < 1e-9)
  }
})

test('colours are parsed from the design tokens and nowhere else', () => {
  assert.deepEqual(parseCssColor('#000'), [0, 0, 0, 1])
  assert.deepEqual(parseCssColor('#ffffff'), [1, 1, 1, 1])
  assert.deepEqual(parseCssColor('  #6fc7d6  ')?.map((c) => Math.round(c * 255)), [111, 199, 214, 255])
  assert.deepEqual(parseCssColor('rgba(255, 255, 255, 0.055)'), [1, 1, 1, 0.055])
  assert.deepEqual(parseCssColor('rgb(0 128 255)')?.slice(0, 3).map((c) => Math.round(c * 255)), [0, 128, 255])
  assert.deepEqual(parseCssColor('#11223344')?.map((c) => Math.round(c * 255)), [17, 34, 51, 68])
  for (const junk of ['', 'red', 'var(--accent)', 'rgb(1,2)', '#12345', 'rgba(1,2,3,4,5)', null, 42]) {
    assert.equal(parseCssColor(junk), null, `${JSON.stringify(junk)} should not parse as a colour`)
  }
})

test('the palette resolves from tokens.css and fails closed when a token is missing', () => {
  const tokens = readFileSync(join(repoRoot, 'viewer/atlas39/tokens.css'), 'utf8')
  const read = (name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(tokens)?.[1] ?? ''
  const palette = resolvePalette(read)
  for (const [name, colour] of Object.entries(palette)) {
    assert.equal(colour.length, 4, `${name} is not an rgba quadruple`)
    assert.ok(colour.every((c) => Number.isFinite(c) && c >= 0 && c <= 1), `${name} is out of range`)
  }
  assert.deepEqual(depthColor(palette, 0), palette.depth0)
  assert.deepEqual(depthColor(palette, 2), palette.depth2)
  assert.deepEqual(depthColor(palette, 9), palette.depthN)
  assert.deepEqual(depthColor(palette, null), palette.depthNone)

  // Counterexample: a design system that lost a token must not paint a default
  // pixel and carry on.
  assert.throws(
    () => resolvePalette((name) => (name === '--accent' ? '' : read(name))),
    (error) => error instanceof PaletteError && error.code === 'E_PALETTE_INVALID' && /--accent/.test(error.message)
  )
})

test('a valid scene from real data is never refused', () => {
  assert.equal(sceneViolation(sceneAt(null)), null)
  assert.equal(sceneViolation(sceneAt(FOCUS_NODE_ID)), null)
})

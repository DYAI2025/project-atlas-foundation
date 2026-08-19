// ATLAS-40: the viewport transform.
//
// Zoom and pan are the two interactions that can permanently lose the graph, so
// these tests are about recoverability first and about arithmetic second. The
// acceptance requirement is not "zoom changes the scale" — it is "there is no
// reachable state in which the graph is gone and no gesture brings it back".
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  IDENTITY,
  MIN_SCALE,
  MAX_SCALE,
  clampTransform,
  project,
  unproject,
  zoomAt,
  panBy,
  resetTransform,
  centerOn,
  isDefaultView
} from '../viewer/atlas39/core/transform.mjs'

const WORLD = { width: 1440, height: 900 }

test('the default view is the identity transform', () => {
  const view = resetTransform(WORLD)
  assert.deepEqual(view, { scale: 1, tx: 0, ty: 0 })
  assert.equal(isDefaultView(view), true)
  assert.equal(isDefaultView({ scale: 1.25, tx: 0, ty: 0 }), false)
  assert.equal(isDefaultView({ scale: 1, tx: 12, ty: 0 }), false)
})

test('project and unproject are exact inverses', () => {
  const view = { scale: 2.5, tx: -140, ty: 88 }
  for (const [x, y] of [[0, 0], [720, 450], [1439, 899]]) {
    const screen = project(view, x, y)
    const back = unproject(view, screen.x, screen.y)
    assert.ok(Math.abs(back.x - x) < 1e-9, `x round trip drifted: ${back.x} vs ${x}`)
    assert.ok(Math.abs(back.y - y) < 1e-9, `y round trip drifted: ${back.y} vs ${y}`)
  }
})

test('zoom keeps the point under the cursor pinned to the cursor', () => {
  const anchor = { x: 380, y: 610 }
  let view = resetTransform(WORLD)
  const worldBefore = unproject(view, anchor.x, anchor.y)
  for (const factor of [1.25, 1.25, 1.25, 0.8]) {
    view = zoomAt(view, factor, anchor.x, anchor.y, WORLD)
    const screen = project(view, worldBefore.x, worldBefore.y)
    assert.ok(Math.abs(screen.x - anchor.x) < 1e-6, `anchor drifted in x to ${screen.x}`)
    assert.ok(Math.abs(screen.y - anchor.y) < 1e-6, `anchor drifted in y to ${screen.y}`)
  }
  assert.ok(view.scale > 1, 'zooming in three steps and out one should still be zoomed in')
})

test('zoom is bounded in both directions', () => {
  let inward = resetTransform(WORLD)
  for (let i = 0; i < 40; i += 1) inward = zoomAt(inward, 2, 700, 400, WORLD)
  assert.equal(inward.scale, MAX_SCALE)

  let outward = resetTransform(WORLD)
  for (let i = 0; i < 40; i += 1) outward = zoomAt(outward, 0.5, 700, 400, WORLD)
  assert.equal(outward.scale, MIN_SCALE)
})

test('panning cannot push the graph out of reach', () => {
  // Two hundred hard pans in one direction, then the question that matters:
  // is any of the laid-out world still on screen?
  let view = resetTransform(WORLD)
  for (let i = 0; i < 200; i += 1) view = panBy(view, 500, 500, WORLD)
  const topLeft = project(view, 0, 0)
  const bottomRight = project(view, WORLD.width, WORLD.height)
  assert.ok(bottomRight.x > 0, 'the whole world was pushed off the left edge')
  assert.ok(bottomRight.y > 0, 'the whole world was pushed off the top edge')
  assert.ok(topLeft.x < WORLD.width, 'the whole world was pushed off the right edge')
  assert.ok(topLeft.y < WORLD.height, 'the whole world was pushed off the bottom edge')
})

test('a corrupted transform is repaired rather than propagated', () => {
  // NaN has no boundary to clamp towards, so it is replaced by the identity
  // component. Anything else would make one bad gesture permanent.
  const repaired = clampTransform({ scale: Number.NaN, tx: Number.NaN, ty: Number.POSITIVE_INFINITY }, WORLD)
  assert.equal(repaired.scale, IDENTITY.scale)
  assert.equal(repaired.tx, IDENTITY.tx)
  assert.ok(Number.isFinite(repaired.ty))

  for (const wild of [
    { scale: 1e12, tx: -1e15, ty: 1e15 },
    { scale: -4, tx: 0, ty: 0 },
    { scale: 0, tx: 0, ty: 0 }
  ]) {
    const view = clampTransform(wild, WORLD)
    assert.ok(view.scale >= MIN_SCALE && view.scale <= MAX_SCALE, `scale escaped: ${view.scale}`)
    assert.ok(Number.isFinite(view.tx) && Number.isFinite(view.ty))
  }
})

test('reset recovers the default view from any extreme state', () => {
  let view = resetTransform(WORLD)
  for (let i = 0; i < 30; i += 1) view = zoomAt(view, 3, 0, 0, WORLD)
  for (let i = 0; i < 30; i += 1) view = panBy(view, -9999, 9999, WORLD)
  assert.notDeepEqual(view, IDENTITY)
  assert.deepEqual(resetTransform(WORLD), { scale: 1, tx: 0, ty: 0 })
})

test('centring puts a world point in the middle of the stage without changing zoom', () => {
  const zoomed = zoomAt(resetTransform(WORLD), 2, 0, 0, WORLD)
  const centred = centerOn(zoomed, 1200, 800, WORLD)
  assert.equal(centred.scale, zoomed.scale)
  const screen = project(centred, 1200, 800)
  // The clamp may hold the view back at the world border, so the assertion is
  // the honest one: the point ends up on screen, and closer to the middle than
  // it was.
  assert.ok(screen.x > 0 && screen.x < WORLD.width, `x off stage: ${screen.x}`)
  assert.ok(screen.y > 0 && screen.y < WORLD.height, `y off stage: ${screen.y}`)
})

test('a degenerate world does not produce a degenerate transform', () => {
  for (const world of [{ width: 0, height: 0 }, { width: Number.NaN, height: 10 }, {}]) {
    const view = clampTransform({ scale: 2, tx: 10, ty: 10 }, world)
    assert.ok(Number.isFinite(view.scale) && Number.isFinite(view.tx) && Number.isFinite(view.ty))
  }
})

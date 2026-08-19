// ATLAS-40 slice 2: the pointer drag state machine.
//
// The defect this file exists for: after a drag crossed the movement threshold,
// a pointercancel left the click suppression armed. A cancelled pointer never
// delivers the click the suppression was waiting for, so the armed flag was
// spent on the NEXT, unrelated click — the user presses something and the
// application ignores them once, with nothing on screen to explain why.
//
// Slice 1 could only assert that app.mjs still contained the string
// "suppressClick = true". That is exactly why this shipped.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDragGesture, DRAG_THRESHOLD } from '../viewer/atlas39/core/gesture.mjs'

const down = (over = {}) => ({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 100, clientY: 100, ...over })
const move = (over = {}) => ({ type: 'pointermove', pointerId: 1, clientX: 100, clientY: 100, ...over })
const up = (over = {}) => ({ type: 'pointerup', pointerId: 1, ...over })
const cancel = (over = {}) => ({ type: 'pointercancel', pointerId: 1, ...over })

/** Drags far enough to cross the threshold. Returns the gesture. */
function panned() {
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4, clientY: 100 }))
  assert.equal(step.panning, true, 'the fixture did not actually start a pan')
  assert.equal(step.began, true)
  // dx/dy are the whole numeric output of this module — what the shell feeds to
  // panBy. Asserting only `.panning` would let a build that reports no movement,
  // or movement at right angles to the pointer, ship green.
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the crossing step must report the full movement since the press')
  assert.equal(step.dy, 0, 'a purely horizontal drag reported vertical movement')
  return g
}

test('a movement below the threshold is a click, not a pan', () => {
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD - 1 }))
  assert.equal(step.panning, false)
  assert.equal(g.isClickSuppressed(), false, 'a click gesture must never suppress its own click')
  g.end(up())
  assert.equal(g.consumeClick(), false)
})

test('the threshold is 4 screen pixels, and exactly that far already pans', () => {
  // The value and the boundary are both hand-written here on purpose. Every
  // other test spells the threshold symbolically, so without this table a
  // tenfold change to an accepted, human-visually-signed-off interaction
  // constant — or a `<` quietly becoming `<=` — passes with nothing red.
  assert.equal(DRAG_THRESHOLD, 4, 'the accepted drag threshold changed')
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD }))
  assert.equal(step.panning, true, 'a movement of exactly the threshold must pan (the comparison is strict <)')
  assert.equal(step.dx, DRAG_THRESHOLD)
  assert.equal(step.dy, 0)
})

test('the threshold option is honoured, so a caller can pass its own', () => {
  const g = createDragGesture({ threshold: DRAG_THRESHOLD * 5 })
  g.start(down())
  const below = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 }))
  assert.equal(below.panning, false, 'the default threshold was used instead of the option')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 5 }))
  assert.equal(step.panning, true)
  assert.equal(step.dx, DRAG_THRESHOLD * 5, 'a refused step must not consume the movement it refused')
  assert.equal(step.dy, 0)
})

test('each pan step reports the delta since the previous point, and begins exactly once', () => {
  const g = createDragGesture()
  g.start(down())
  const first = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4, clientY: 100 }))
  assert.equal(first.began, true)
  assert.equal(first.dx, DRAG_THRESHOLD * 4)
  assert.equal(first.dy, 0)
  const second = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 + 3, clientY: 93 }))
  assert.equal(second.panning, true)
  // The shell takes the pointer capture on `began`; a second true would re-take it.
  assert.equal(second.began, false, 'began must be true only on the step that crossed the threshold')
  assert.equal(second.dx, 3, 'the delta is measured from the previous point, not from the press origin')
  assert.equal(second.dy, -7)
})

test('a threshold-crossing drag suppresses exactly the click it produced', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true)
  g.end(up())
  assert.equal(g.consumeClick(), true, 'the click that ends a pan must be swallowed')
  // Spent, not sticky: a second click is a real click again.
  assert.equal(g.consumeClick(), false, 'the suppression leaked into a second click')
})

test('REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  const done = g.end(cancel())
  assert.equal(done.ended, true)
  assert.equal(done.wasPanning, true)
  // A cancelled pointer delivers no click, so nothing is left to swallow.
  assert.equal(g.isClickSuppressed(), false, 'pointercancel left the click suppression armed')
  assert.equal(g.consumeClick(), false, 'the next unrelated click was swallowed')
})

test('a cancelled drag below the threshold also leaves nothing armed', () => {
  const g = createDragGesture()
  g.start(down())
  g.move(move({ clientX: 101 }))
  g.end(cancel())
  assert.equal(g.consumeClick(), false)
})

test('the state machine ignores a second, unrelated pointer', () => {
  const g = panned()
  assert.equal(g.move(move({ pointerId: 2, clientX: 900 })).panning, false)
  assert.equal(g.end(up({ pointerId: 2 })).ended, false, 'another pointer ended this gesture')
  assert.equal(g.isPanning(), true, 'the real gesture was cancelled by an unrelated pointer')
})

test('only the primary button starts a gesture', () => {
  const g = createDragGesture()
  assert.equal(g.start(down({ button: 2 })), false)
  assert.equal(g.move(move({ clientX: 400 })).panning, false)
})

test('a fresh press always disarms, whatever the previous gesture left behind', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true)
  g.end(up())
  g.start(down({ pointerId: 7 }))
  assert.equal(g.isClickSuppressed(), false)
})

test('end() reports the pointer id so the shell releases the capture it took', () => {
  const g = panned()
  const done = g.end(up())
  assert.equal(done.pointerId, 1)
  assert.equal(done.wasPanning, true)
})

test('the gesture carries no clock, randomness or DOM', () => {
  const source = readFileSync(new URL('../viewer/atlas39/core/gesture.mjs', import.meta.url), 'utf8')
  const forbiddenTokens = [
    'Date.', 'new Date', 'Math.random', 'performance',
    'document', 'window', 'globalThis', 'navigator', 'localStorage',
    'requestAnimationFrame'
  ]
  for (const forbidden of forbiddenTokens) {
    assert.equal(source.includes(forbidden), false, `gesture.mjs references ${forbidden}`)
  }
})

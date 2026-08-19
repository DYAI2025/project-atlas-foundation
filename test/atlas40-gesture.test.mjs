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
import {
  createDragGesture,
  DRAG_THRESHOLD,
  GestureError,
  E_GESTURE_THRESHOLD
} from '../viewer/atlas39/core/gesture.mjs'

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
  // isPanning() must distinguish "a pointer is down" from "a pan is running" —
  // that distinction is the whole reason the method exists, and every other
  // assertion of it runs with a pan already in flight, where a method that
  // merely reported "a pointer is down" would read identically.
  assert.equal(g.isPanning(), false, 'a press that has not moved is not a pan')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD - 1 }))
  assert.equal(step.panning, false)
  assert.equal(g.isPanning(), false, 'a press that moved below the threshold is not a pan')
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

test('a threshold that would disable the threshold is refused, not silently accepted', () => {
  // Both `Math.hypot(dx, dy) < NaN` and `Math.hypot(dx, dy) < 'x'` are false, so
  // an unvalidated option silently switches the threshold OFF: a half-pixel
  // twitch becomes a pan and every click on the stage is swallowed. The option
  // fails closed instead, the way ViewModelError/PaletteError do for their own
  // unusable input.
  for (const bad of [Number.NaN, -1, 0, null, 'x', Infinity, -Infinity]) {
    assert.throws(
      () => createDragGesture({ threshold: bad }),
      (err) => err instanceof GestureError && err.code === E_GESTURE_THRESHOLD,
      `createDragGesture accepted the unusable threshold ${String(bad)}`
    )
  }
  // The default is still reachable, and a usable explicit value still works.
  assert.equal(createDragGesture().isPanning(), false)
  assert.equal(createDragGesture({}).isPanning(), false)
  assert.equal(createDragGesture({ threshold: undefined }).isPanning(), false)
  const tight = createDragGesture({ threshold: 1 })
  tight.start(down())
  assert.equal(tight.move(move({ clientX: 101 })).panning, true, 'a usable explicit threshold was refused')
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

test('a second primary press cannot take the stage away from a pan in flight', () => {
  // The ordinary accidental second touch on a stage with `touch-action: none`.
  // Unguarded, start() overwrote the active gesture and cleared its suppression:
  // the finger that was moving could then neither move nor end, and because the
  // shell gates its cleanup on end() reporting `ended`, the pointer capture was
  // never released and body[data-panning] never removed — the pan dies under the
  // user's finger with nothing on screen to explain it.
  const g = panned()
  assert.equal(g.start(down({ pointerId: 2, clientX: 500, clientY: 500 })), false, 'a second press hijacked a pan in flight')
  assert.equal(g.isPanning(), true, 'the second press cancelled the pan it does not own')
  assert.equal(g.isClickSuppressed(), true, 'the second press disarmed a suppression it does not own')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 + 5 }))
  assert.equal(step.panning, true, 'the panning pointer could no longer move the stage')
  assert.equal(step.dx, 5)
  assert.equal(step.dy, 0)
  const done = g.end(up())
  assert.equal(done.ended, true, 'the panning pointer could no longer end its own gesture')
  assert.equal(done.pointerId, 1)
  assert.equal(done.wasPanning, true)
})

test('a press that never panned is replaceable by any other pointer', () => {
  // The guard above is keyed on `panning`, not on `active`, and this is why: a
  // press whose pointerup or pointercancel the shell never sees would otherwise
  // refuse every later press for the lifetime of the page.
  //
  // The name of this test is deliberately narrow. It pins the never-panned half
  // of the lost-pointer story only; the panning half is the test below, and the
  // residual neither of them closes is stated there.
  const g = createDragGesture()
  assert.equal(g.start(down()), true)
  assert.equal(g.start(down({ pointerId: 2, clientX: 200, clientY: 200 })), true, 'a press that never panned blocked the next one')
  const step = g.move(move({ pointerId: 2, clientX: 200 + DRAG_THRESHOLD * 4, clientY: 200 }))
  assert.equal(step.panning, true, 'the replacing press could not pan')
  assert.equal(step.dx, DRAG_THRESHOLD * 4)
  assert.equal(g.move(move({ pointerId: 1, clientX: 900 })).panning, false, 'the replaced pointer still drives the stage')
})

test('a lost PANNING pointer re-anchors on its own next press instead of dead-locking the stage', () => {
  // The longer-lived lost-pointer state, and the one where the pointer is most
  // likely to leave the element: a pan is in flight and the shell never sees
  // the matching pointerup/pointercancel — a window blur mid-drag, a native
  // drag or context-menu takeover, or an `up` that landed outside the listening
  // element because pointer capture was unavailable.
  //
  // Keyed on `panning` alone, that state was permanent: every later press of
  // every id was refused, while each stray pointermove still reported
  // `{panning: true}` with a live delta, so the wired stage would follow the
  // bare cursor with `began` false and therefore nothing in the DOM to show it.
  // Slice 1's app.mjs re-anchored on every primary pointerdown, so the identical
  // lost pointer self-healed on the user's next click; this test pins that the
  // module does not regress below that.
  //
  // What this does NOT pin, because the module does not do it: a lost panning
  // TOUCH pointer, whose next finger arrives with a fresh id and is refused
  // until the lost id presses again. Letting a foreign id re-anchor would undo
  // the guard in the test above. A mouse, whose id does not change, is closed.
  const g = panned()
  assert.equal(g.isPanning(), true, 'precondition: a pan is in flight')
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  assert.equal(
    g.start(down({ pointerId: 1, clientX: 300, clientY: 300 })),
    true,
    'the lost panning pointer could not re-anchor, so no press can ever reach the stage again'
  )
  assert.equal(g.isPanning(), false, 're-anchoring left the stale pan running')
  assert.equal(g.isClickSuppressed(), false, 're-anchoring left the stale suppression armed')
  // The re-anchored press measures from where it pressed, not from the stale
  // origin the lost gesture left behind.
  const step = g.move(move({ pointerId: 1, clientX: 300 + DRAG_THRESHOLD * 4, clientY: 300 }))
  assert.equal(step.panning, true, 'the re-anchored press could not pan')
  assert.equal(step.began, true, 'the re-anchored press inherited the lost gesture\'s panning state')
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the re-anchored press measured from the lost gesture origin')
  assert.equal(step.dy, 0)
  const done = g.end(up())
  assert.equal(done.ended, true, 'the re-anchored gesture could not end')
  assert.equal(done.wasPanning, true)
  assert.equal(done.pointerId, 1)
})

test('only the primary button starts a gesture', () => {
  const g = createDragGesture()
  assert.equal(g.start(down({ button: 2 })), false)
  assert.equal(g.move(move({ clientX: 400 })).panning, false)
  // The documented success return is read here, so a start() that reports
  // failure while starting a gesture cannot ship green.
  assert.equal(g.start(down()), true, 'a primary press must start a gesture and say so')
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
  // Scan the CODE, not the English. This module's comments are long and
  // load-bearing, and 'window', 'document', 'navigator' and 'performance' are
  // ordinary words inside them — a raw substring scan fires on vocabulary
  // rather than on capability use, and it already did once: the comment "a
  // window losing the pointer" tripped this guard while the code was pure.
  // Two independent defences, so neither has to be perfect: comments are
  // removed, and the property-access tokens are spelled with their dot, which
  // prose does not produce.
  //
  // BOTH comment forms are stripped. Stripping only `//` lines left every JSDoc
  // block in the module scanned as code, so a future `@param` or `@returns`
  // that spelled `window.` would have re-created the exact prose-fires-the-guard
  // failure this guard was already reworked once to repair. Full lines only for
  // the `//` form (never partial lines, which a string containing '//' would let
  // truncate real code away); the block form is delimited, so it is safe whole.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  // Both strips are load-bearing, so both are proved not to have eaten the code
  // they were meant to leave standing — one probe per region of the module.
  assert.match(code, /export function createDragGesture/, 'the comment strip removed the code as well')
  assert.match(code, /Math\.hypot\(dx, dy\) < threshold/, 'the comment strip removed the threshold comparison')
  assert.match(code, /event\.type === 'pointercancel'/, 'the comment strip removed the pointercancel repair')
  assert.match(code, /return active\?\.panning === true/, 'the comment strip removed isPanning')
  const forbiddenTokens = [
    'Date.', 'new Date', 'Math.random', 'performance.',
    'document.', 'window.', 'globalThis', 'navigator.', 'localStorage',
    'requestAnimationFrame'
  ]
  for (const forbidden of forbiddenTokens) {
    assert.equal(code.includes(forbidden), false, `gesture.mjs references ${forbidden}`)
  }
  // Property-access spellings alone cannot see bare environment sniffing:
  // `typeof document !== 'undefined'`, `typeof window`, `process.argv`,
  // `fetch(...)`, `setTimeout(...)` and `queueMicrotask(...)` all passed the
  // token list above. The code is comment-free at this point, so the bare
  // identifiers can be matched on word boundaries without firing on prose.
  const forbiddenIdentifiers = [
    'window', 'document', 'navigator', 'performance', 'globalThis',
    'localStorage', 'sessionStorage', 'indexedDB', 'process', 'fetch',
    'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
    'requestAnimationFrame', 'Date', 'XMLHttpRequest', 'WebSocket', 'require'
  ]
  for (const forbidden of forbiddenIdentifiers) {
    assert.doesNotMatch(
      code,
      new RegExp(`\\b${forbidden}\\b`),
      `gesture.mjs references the bare identifier ${forbidden}`
    )
  }
})

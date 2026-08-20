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
// One purity guard for every pure core module, so a second suite cannot ship a
// weaker copy of it. See the header above the STRING_MARKER_MUTANT below.
import {
  stripComments,
  purityViolations,
  PurityScanError,
  FORBIDDEN_TOKENS,
  FORBIDDEN_IDENTIFIERS,
  MODULE_SPECIFIER
} from './helpers/purity.mjs'

const down = (over = {}) => ({ type: 'pointerdown', pointerId: 1, button: 0, clientX: 100, clientY: 100, ...over })
// `buttons` is part of the record the module reads: 0 means the press is over.
// A move fixture without it would leave the whole "the button is still held"
// invariant untested, and the module refuses a step whose button state it
// cannot read rather than assuming one is held.
const move = (over = {}) => ({ type: 'pointermove', pointerId: 1, buttons: 1, clientX: 100, clientY: 100, ...over })
const up = (over = {}) => ({ type: 'pointerup', pointerId: 1, ...over })
const cancel = (over = {}) => ({ type: 'pointercancel', pointerId: 1, ...over })
// `detail` is part of the click record the module reads, and the two fixtures
// below are the two values it distinguishes. UI Events defines `detail` on a
// click as the click count, so a click a pointer produced carries at least 1.
// HTML's "fire a synthetic pointer event" — the algorithm behind
// `element.click()` and behind the activation behaviour a keyboard Enter or
// Space runs — initialises `type`, `bubbles`, `cancelable`, the modifier keys
// and `view`, and never initialises `detail`, so it keeps the 0 default of
// UIEventInit. `new MouseEvent('click', {bubbles: true})` is the same story.
//
// Measured against the shipped wiring, headed, 2026-08-20, Chromium
// 151.0.7922.34, every record captured in the capture phase on #stage-host —
// which is where wirePointer() binds the guard, so these are the records
// consumeClick actually receives:
//
//   the click a mouse pan synthesises at pointerup   detail 1, isTrusted true
//   a plain mouse click on a node                    detail 1, isTrusted true
//   element.click()                                  detail 0, isTrusted false
//   new MouseEvent('click', {bubbles: true})         detail 0, isTrusted false
//   a keyboard Enter on a focused node button        NO click event at all
//   a touch pan ended by pointerup                   NO click event at all
//
// The keyboard row is the one D9 predicted and it is not a click route in this
// build: onStageKeydown calls preventDefault() on Enter and Space over a node
// (app.mjs, the Enter/' ' case), which cancels the button's activation
// behaviour. `isTrusted` is deliberately NOT the discriminator — an engine that
// synthesises a trusted click after a touch pan must still have it swallowed,
// and `detail` is what separates "a pointer caused this" from "nothing did".
const pointerClick = (over = {}) => ({ type: 'click', detail: 1, ...over })
const uncausedClick = (over = {}) => ({ type: 'click', detail: 0, ...over })

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
  assert.equal(g.consumeClick(pointerClick()), false)
})

test('the threshold is 4 screen pixels, and exactly that far already pans', () => {
  // The value and the boundary are both hand-written here on purpose. Every
  // other test spells the threshold symbolically, so without this table a
  // tenfold change to an accepted, human-visually-signed-off interaction
  // constant — or a `>=` quietly becoming `>` — passes with nothing red.
  assert.equal(DRAG_THRESHOLD, 4, 'the accepted drag threshold changed')
  const g = createDragGesture()
  g.start(down())
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD }))
  assert.equal(step.panning, true, 'a movement of exactly the threshold must pan (the comparison is >=)')
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
  // Read once more AFTER the pan ended, which is the one moment the accessor
  // exists for and the only moment where `suppressClick` and `active?.panning`
  // DISAGREE. Every other reading of it in this file is taken where the two
  // agree, which let `isClickSuppressed()` be rewired to report the panning
  // flag instead with the whole suite green — the same surviving-mutant class
  // already found and repaired for its sibling `isPanning()`.
  assert.equal(g.isPanning(), false, 'the pan is over once its pointer lifted')
  assert.equal(g.isClickSuppressed(), true, 'the suppression the pan armed did not survive its own pointerup')
  assert.equal(g.consumeClick(pointerClick()), true, 'the click that ends a pan must be swallowed')
  // Spent, not sticky: a second click is a real click again.
  assert.equal(g.consumeClick(pointerClick()), false, 'the suppression leaked into a second click')
})

test('REGRESSION: pointercancel after a threshold-crossing drag does not swallow the next click', () => {
  const g = panned()
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  const done = g.end(cancel())
  assert.equal(done.ended, true)
  assert.equal(done.wasPanning, true)
  // A cancelled pointer delivers no click, so nothing is left to swallow.
  assert.equal(g.isClickSuppressed(), false, 'pointercancel left the click suppression armed')
  assert.equal(g.consumeClick(pointerClick()), false, 'the next unrelated click was swallowed')
})

test('REGRESSION: a suppression is spent only by a click a pointer produced, never by one it did not', () => {
  // The second route to the identical user-visible defect, and the one D9 left
  // explicitly unmeasured until the headed acceptance run of 2026-08-20 —
  // reported there verbatim as:
  //
  //   FAIL  S2-25b a click suppression must not outlive the gesture that armed
  //         it (touch pan ended by pointerup)
  //     MEASURED: Chromium 151.0.7922.34 synthesised a click after the touch
  //     pan = false. A later click carrying no pointerdown -> aria-pressed=false
  //     (swallowed=true).
  //
  // A touch pan ended by `pointerup` produced no click in that engine, so a
  // disarm keyed on the CAUSE (`event.type === 'pointercancel'`) never fired and
  // the armed flag was spent on the next unrelated click instead — the same
  // swallowed click as the pointercancel route, one gesture sideways.
  //
  // The repair is keyed on the INVARIANT, not on an engine: only the click this
  // gesture produced may spend its suppression. A click carrying `detail === 0`
  // was produced by no pointer at all — see the fixture comments above — so it
  // is delivered, and it retires the suppression, because the pan's own click
  // would have arrived before it if the engine had ever synthesised one. In an
  // engine that DOES synthesise the click after a touch pan, that click arrives
  // first, carries `detail >= 1`, and is swallowed exactly as it should be:
  // nothing here branches on pointer type, and nothing here encodes what any
  // particular browser does.
  const g = panned()
  g.end(up())
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  assert.equal(
    g.consumeClick(uncausedClick()),
    false,
    'a click no pointer produced was swallowed by a pan that produced no click either'
  )
  assert.equal(
    g.isClickSuppressed(),
    false,
    'the suppression outlived the gesture and is still waiting for a click that will never come'
  )
  // And the suppression is really gone, not merely skipped once: a pointer
  // click arriving afterwards is a real click again.
  assert.equal(g.consumeClick(pointerClick()), false, 'the retired suppression swallowed a later real click')

  // The mirror case, so this test cannot be satisfied by never swallowing
  // anything: the same pan, and the click the pan DID produce.
  const h = panned()
  h.end(up())
  assert.equal(h.consumeClick(pointerClick()), true, "the pan's own synthesised click was no longer swallowed")
})

test('a cancelled drag below the threshold also leaves nothing armed', () => {
  const g = createDragGesture()
  g.start(down())
  g.move(move({ clientX: 101 }))
  g.end(cancel())
  assert.equal(g.consumeClick(pointerClick()), false)
})

test('the state machine ignores a second, unrelated pointer', () => {
  const g = panned()
  assert.equal(g.move(move({ pointerId: 2, clientX: 900 })).panning, false)
  assert.equal(g.end(up({ pointerId: 2 })).ended, false, 'another pointer ended this gesture')
  assert.equal(g.isPanning(), true, 'the real gesture was cancelled by an unrelated pointer')
})

test('a pointercancel from a pointer this gesture does not own leaves the suppression alone', () => {
  // The mirror image of the REGRESSION test above, and the assertion that pins
  // WHERE the repair sits: hoisting `if (event.type === 'pointercancel')` above
  // the ownership early-return is a one-line reordering that keeps every other
  // test in this file green. On a multi-touch stage (`touch-action: none`) the
  // browser cancels unrelated pointers routinely, and a foreign cancel that
  // disarmed the owner's suppression would hand the pan's own synthesised click
  // to whatever node the pan ended over — a silent selection the user never made.
  const g = panned()
  const foreign = g.end(cancel({ pointerId: 2 }))
  assert.deepEqual(
    foreign,
    { ended: false, wasPanning: false, pointerId: null },
    'a foreign pointercancel ended a gesture it does not own'
  )
  assert.equal(g.isClickSuppressed(), true, 'a foreign pointercancel disarmed a suppression it does not own')
  assert.equal(g.isPanning(), true, 'a foreign pointercancel stopped the pan')
  const done = g.end(up())
  assert.equal(done.ended, true)
  assert.equal(done.wasPanning, true)
  assert.equal(g.consumeClick(pointerClick()), true, "the pan's own click was let through onto a node")
})

test('an accidental second press by another pointer is refused while the panning pointer is alive', () => {
  // The ordinary accidental second touch on a stage with `touch-action: none`.
  // Unguarded, start() overwrote the active gesture and cleared its suppression:
  // the finger that was moving could then neither move nor end, and because the
  // shell gates its cleanup on end() reporting `ended`, the pointer capture was
  // never released and body[data-panning] never removed — the pan dies under the
  // user's finger with nothing on screen to explain it.
  //
  // The name says "an accidental second press" and not "no second press",
  // because the module deliberately does not guarantee the stronger claim: the
  // panning pointer's OWN id re-anchors (the test below), and a second foreign
  // press that the owner answers with nothing re-anchors too (the test after
  // it). Both exemptions exist so a gesture whose end this module never sees
  // cannot disable the stage permanently.
  const g = panned()
  assert.equal(g.start(down({ pointerId: 2, clientX: 500, clientY: 500 })), false, 'a second press hijacked a pan in flight')
  assert.equal(g.isPanning(), true, 'the second press cancelled the pan it does not own')
  assert.equal(g.isClickSuppressed(), true, 'the second press disarmed a suppression it does not own')
  const step = g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 + 5 }))
  assert.equal(step.panning, true, 'the panning pointer could no longer move the stage')
  assert.equal(step.dx, 5)
  assert.equal(step.dy, 0)
  // That step is proof the owner is alive, so the next accidental touch is
  // refused again rather than counting as the second unanswered press.
  assert.equal(
    g.start(down({ pointerId: 3, clientX: 700, clientY: 700 })),
    false,
    'a pointer that had just moved the stage was presumed lost'
  )
  assert.equal(g.isPanning(), true)
  const done = g.end(up())
  assert.equal(done.ended, true, 'the panning pointer could no longer end its own gesture')
  assert.equal(done.pointerId, 1)
  assert.equal(done.wasPanning, true)
})

test('a lost panning TOUCH pointer gives the stage back on the second unanswered press', () => {
  // The residual the guard above used to leave permanently open. A touch pan
  // whose pointerup/pointercancel is never delivered cannot re-anchor on its
  // own id, because that finger is gone and its id never returns: every later
  // finger was refused, the stage could not be panned again for the life of the
  // page, body[data-panning] stayed set (the shell removes it only when end()
  // reports `ended`) and the grabbing cursor with it. Slice 1's app.mjs
  // self-healed on the very next press; this module must not be worse than the
  // code it replaces.
  const g = createDragGesture()
  assert.equal(g.start(down({ pointerId: 11 })), true)
  const pan = g.move(move({ pointerId: 11, clientX: 100 + DRAG_THRESHOLD * 4 }))
  assert.equal(pan.panning, true, 'precondition: a touch pan is in flight')
  // ...and pointer 11 is never heard from again.
  assert.equal(
    g.start(down({ pointerId: 12, clientX: 400, clientY: 400 })),
    false,
    'the first fresh finger stole a pan that may still be live'
  )
  // That refused tap must not be eaten by the lost pan's suppression either.
  assert.equal(g.consumeClick(pointerClick()), false, "the fresh finger's tap was swallowed by a pan it has nothing to do with")
  assert.equal(g.start(down({ pointerId: 13, clientX: 500, clientY: 500 })), true, 'the stage stayed bricked against every later finger')
  assert.equal(g.isPanning(), false, 're-anchoring left the stale pan running')
  assert.equal(g.isClickSuppressed(), false, 're-anchoring left the stale suppression armed')
  const step = g.move(move({ pointerId: 13, clientX: 500 + DRAG_THRESHOLD * 4, clientY: 500 }))
  assert.equal(step.panning, true, 'the re-anchored finger could not pan')
  assert.equal(step.began, true)
  assert.equal(step.dx, DRAG_THRESHOLD * 4, 'the re-anchored finger measured from the lost gesture origin')
  const done = g.end(up({ pointerId: 13 }))
  assert.equal(done.ended, true, 'the shell never gets to release the capture or remove body[data-panning]')
  assert.equal(done.pointerId, 13)
})

test('a click that arrives while a gesture is still running is not that gesture to swallow', () => {
  // The browser synthesises a pan's click AFTER its pointerup, so a click that
  // arrives while the gesture is still in flight belongs to something else — a
  // second finger tapping a node, or a keyboard-activated click on a stage node
  // button. Spending the suppression on it is the swallowed click this module
  // exists to prevent, one gesture removed.
  const g = panned()
  assert.equal(g.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  assert.equal(g.consumeClick(pointerClick()), false, "a click during a live pan was swallowed as that pan's tail")
  assert.equal(g.isClickSuppressed(), true, 'a click that is not the pan tail spent the suppression anyway')
  const done = g.end(up())
  assert.equal(done.ended, true)
  assert.equal(g.consumeClick(pointerClick()), true, "the pan's own click was no longer swallowed")
})

test('a press that never panned is replaceable by any other pointer', () => {
  // The guard above is keyed on `panning`, not on `active`, and this is why: a
  // press whose pointerup or pointercancel the shell never sees would otherwise
  // refuse every later press for the lifetime of the page.
  //
  // The name of this test is deliberately narrow. It pins the never-panned half
  // of the lost-pointer story only; the panning halves are the tests above and
  // below it.
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
  // module does not regress below that. For a mouse — whose pointer id does not
  // change, and whose bare hover also carries `buttons: 0` — this state is
  // closed twice over: by the drop in `move()` and by this re-anchor.
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

test('a press whose end this module never sees is dropped by the first move with no button held', () => {
  // Ordinary mouse, no lost-pointer exoticism required. A press that stays
  // under the threshold never makes the shell take a pointer capture (Task 6
  // takes it on `began`), so a pointerup released over a SIBLING of
  // `#stage-host` — `.a39-stage-controls` and the sidebar both are, which
  // index.html:58-60 proves — never reaches the shell's listener and `end()`
  // is never called. Trusting `active` alone, the next bare hover measured a
  // large delta from the stale press origin, crossed the threshold, panned the
  // graph under a cursor with no button held, and armed a click suppression
  // that swallowed the user's next real click.
  const g = createDragGesture()
  g.start(down())
  assert.equal(g.move(move({ clientX: 101 })).panning, false, 'precondition: the press stayed under the threshold')
  // The pointerup happens somewhere this module never hears about it. Then the
  // user hovers back over the stage with NO button held.
  const hover = g.move(move({ clientX: 260, clientY: 180, buttons: 0 }))
  assert.deepEqual(hover, { panning: false, began: false, dx: 0, dy: 0 }, 'a bare hover panned the stage from a stale press origin')
  assert.equal(g.isPanning(), false)
  assert.equal(g.isClickSuppressed(), false, 'a bare hover armed a click suppression')
  // The stale press is gone, not merely skipped: even a later move that does
  // report a held button cannot resurrect it without a fresh pointerdown.
  assert.equal(g.move(move({ clientX: 900, clientY: 900 })).panning, false, 'a dropped press still drove the stage')
  assert.equal(g.consumeClick(pointerClick()), false)

  // Same story one step further along: a pan that crossed the threshold and
  // whose pointerup the module never saw. Here the suppression is already
  // armed, and the click it was waiting for — if the browser synthesised one at
  // all — was dispatched before this hover ever arrived.
  const p = panned()
  assert.equal(p.isClickSuppressed(), true, 'precondition: the pan armed the suppression')
  const hover2 = p.move(move({ clientX: 500, clientY: 500, buttons: 0 }))
  assert.equal(hover2.panning, false, 'a bare hover kept panning the stage')
  assert.equal(p.isPanning(), false, 'a pan with no button held is still a pan')
  assert.equal(p.isClickSuppressed(), false, 'a lost pan left a suppression with no click left to spend it on')
  assert.equal(p.consumeClick(pointerClick()), false, "the user's next real click was swallowed")
})

test('a step whose button state or coordinates cannot be read is refused, not treated as a pan', () => {
  // `Math.hypot(NaN, NaN) < 4` and `Math.hypot(Infinity, 0) < 4` are both
  // false — the identical fail-open mechanism this module documents and guards
  // against for the `threshold` operand, on the delta operand. Written as `<`,
  // a delta the module cannot measure fell straight through: a ZERO-pixel move
  // reported `{panning: true, began: true, dx: NaN}`, armed a click suppression
  // for a pan that never happened, and fed NaN to the shell's panBy, which
  // poisons the stage transform permanently.
  const g = createDragGesture()
  assert.equal(
    g.start({ type: 'pointerdown', pointerId: 1, button: 0 }),
    false,
    'a press with no coordinates started a gesture'
  )
  assert.equal(g.start(down({ clientX: Number.NaN })), false, 'a press at NaN started a gesture')
  assert.equal(g.start(down({ clientY: Infinity })), false, 'a press at Infinity started a gesture')
  assert.equal(g.isPanning(), false)

  assert.equal(g.start(down()), true)
  for (const bad of [{ clientX: Number.NaN }, { clientY: Infinity }, { clientX: undefined }, { clientY: -Infinity }]) {
    assert.deepEqual(
      g.move(move(bad)),
      { panning: false, began: false, dx: 0, dy: 0 },
      `a move at ${JSON.stringify(bad)} was treated as movement`
    )
  }
  assert.equal(g.isPanning(), false, 'a delta the module cannot measure started a pan')
  assert.equal(g.isClickSuppressed(), false, 'a pan that never happened armed a click suppression')
  // A pan already in flight skips the threshold comparison entirely, so up
  // there the delta guard is the only thing between NaN and the shell's panBy —
  // which renders the stage transform permanently unusable.
  const p = panned()
  assert.deepEqual(
    p.move(move({ clientX: Number.NaN })),
    { panning: false, began: false, dx: 0, dy: 0 },
    'a running pan fed NaN straight through to the shell'
  )
  assert.equal(p.isPanning(), true, 'a refused step ended a live pan')
  // A step whose button state is missing is refused the same way — but a stream
  // this module cannot read must not be able to cancel a real gesture, so the
  // press survives it.
  assert.equal(
    g.move({ type: 'pointermove', pointerId: 1, clientX: 200, clientY: 100 }).panning,
    false,
    'a step with no button state was treated as a held button'
  )
  assert.equal(
    g.move(move({ clientX: 100 + DRAG_THRESHOLD * 4 })).panning,
    true,
    'a refused step discarded the live gesture instead of just refusing itself'
  )
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

// ---------------------------------------------------------------------------
// The purity guard, and the guard on the guard.
//
// The scanner itself now lives in test/helpers/purity.mjs and is imported at
// the top of this file, because the view-state suite re-spelled it as a raw
// substring list of its own and the two disagreed in both directions — false
// reds on ordinary prose, blind spots on a real clock. Its rationale, its
// measured history and its denylists are documented there; the tests that pin
// its capability stay here, where they were written.
//
// The rule it exists for: scan the CODE, not the English. This module's
// comments are long and load-bearing, and 'window', 'document', 'navigator' and
// 'performance' are ordinary words inside them — a raw substring scan fires on
// vocabulary rather than on capability use, and it already did once: the
// comment "a window losing the pointer" tripped this guard while the code was
// pure.
// ---------------------------------------------------------------------------

/** The exact mutation that defeated the regex strip this scanner replaced. */
const STRING_MARKER_MUTANT = [
  "const OPEN_MARK = '/*'",
  'function leakProbe() { return document.title + window.name + navigator.userAgent }',
  "const CLOSE_MARK = '*/'",
  'export const MARKS = [OPEN_MARK, CLOSE_MARK, leakProbe]'
].join('\n')

// The exact mutation that defeated the string-aware scanner, in the same class:
// a scanner that knows strings but not REGULAR EXPRESSION literals consumes the
// `\/` of `/\//` as an ordinary escaped backslash, then reads the closing `/`
// plus the following `/` as the start of a line comment and deletes the rest of
// the line. Measured on the predecessor of the current scanner, verbatim:
// stripComments("const SLASH_RE = /\\//; const t = document.title") returned
// "const SLASH_RE = /\\", and purityViolations() of that same text returned [].
// End to end, appended as one line to viewer/atlas39/core/view-state.mjs with
// `grep -c document.title` = 1 proving the probe was on disk, that suite stayed
// green at exit 0, 18/18 — a clock and a DOM read walking past a guard named
// for refusing both.
const REGEX_MARKER_MUTANT = 'export const SLASH_RE = /\\//; export const stamp = () => document.title + Date.now()'

// The mutation above spells the regex after `=`, which is the one position the
// scanner already read correctly, so on its own it proved nothing about the
// sibling positions. This one is the shape this codebase actually writes:
// semicolon-free statements, so the keyword that licenses the regex follows an
// IDENTIFIER across a newline. Measured on the committed scanner before the
// word-boundary repair: `keep()` never ended a word at whitespace, so the
// previous word here was `textreturn`, which is in no keyword list, `/\//`
// lexed as a division and the `//` inside it deleted the rest of the line —
// purityViolations() returned [] on this exact text, while the same function
// with `String(text)` on the line above (a `)` ending the word, so `return` was
// seen) returned ["document.","document"]. End to end, appended to
// viewer/atlas39/core/view-state.mjs it left that suite at exit 0, 18/18 with a
// DOM read and a clock on disk.
const REGEX_AFTER_IDENTIFIER_MUTANT = [
  'export function hasSlash(text) {',
  '  const subject = text',
  "  return /\\//.test(subject) ? document.title + Date.now() : ''",
  '}'
].join('\n')

test('the gesture carries no clock, randomness or DOM', () => {
  const source = readFileSync(new URL('../viewer/atlas39/core/gesture.mjs', import.meta.url), 'utf8')
  const code = stripComments(source)
  // The strip is load-bearing, so it is proved not to have eaten the code it
  // was meant to leave standing — one probe per region of the module.
  assert.match(code, /export function createDragGesture/, 'the comment strip removed the code as well')
  assert.match(code, /!\(Math\.hypot\(dx, dy\) >= threshold\)/, 'the comment strip removed the threshold comparison')
  assert.match(code, /event\.type === 'pointercancel'/, 'the comment strip removed the pointercancel repair')
  assert.match(code, /return active\?\.panning === true/, 'the comment strip removed isPanning')
  for (const forbidden of FORBIDDEN_TOKENS) {
    assert.equal(code.includes(forbidden), false, `gesture.mjs references ${forbidden}`)
  }
  for (const forbidden of FORBIDDEN_IDENTIFIERS) {
    assert.doesNotMatch(
      code,
      new RegExp(`\\b${forbidden}\\b`),
      `gesture.mjs references the bare identifier ${forbidden}`
    )
  }
  assert.doesNotMatch(code, MODULE_SPECIFIER, 'gesture.mjs imports from a module specifier')
  assert.deepEqual(purityViolations(source), [], 'the purity rules disagree with each other')
})

test('the purity guard cannot be switched off by a string or a regular expression literal, and sees imports and randomness', () => {
  // Without this test the guard proves only that four PRE-EXISTING regions
  // survived the strip, which says nothing about a newly added region the strip
  // ate. These assertions are about the guard's own capability.

  // 1. The superseded regex strip really did have the hole, so this is a repair
  //    and not decoration.
  const supersededStrip = STRING_MARKER_MUTANT
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(supersededStrip, /document\.title/, 'the superseded strip no longer reproduces its own hole')

  // 2. The scanner keeps that code, so the denylists get to see it.
  const scanned = stripComments(STRING_MARKER_MUTANT)
  assert.match(scanned, /function leakProbe/, 'two string literals deleted the code between them')
  assert.equal(
    scanned.split('document.title').length - 1,
    1,
    'the code between two string-literal comment markers was eaten by the strip'
  )
  assert.ok(
    purityViolations(STRING_MARKER_MUTANT).includes('document.'),
    'a probe hidden between two string literals passed the purity guard'
  )

  // 3. Comments are still removed, so prose still cannot fire the guard — the
  //    failure this guard was already reworked twice to repair.
  const prose = [
    '// a window losing the pointer, and document.title, and navigator.userAgent',
    '/** @param {number} x — window.name, document.body, performance.now() */',
    'const kept = 1'
  ].join('\n')
  assert.deepEqual(purityViolations(prose), [], 'prose fired the purity guard')
  assert.match(stripComments(prose), /const kept = 1/, 'the strip ate the code around the prose')

  // 4. A string whose CONTENT looks like a comment marker stays code.
  assert.match(
    stripComments("const s = 'a // and a /* inside a string are text'"),
    /a \/\/ and a \/\* inside a string are text/,
    'the scanner treated a string literal as a comment'
  )

  // 5. The denylists see the two capabilities they were blind to: module
  //    imports (static, re-exported and dynamic) and randomness.
  assert.ok(
    purityViolations("import { readFileSync } from 'node:fs'").includes('import'),
    'a static import passed the purity guard'
  )
  assert.ok(
    purityViolations("export { readFileSync } from 'node:fs'").includes("from '<specifier>'"),
    'a re-export from a module specifier passed the purity guard'
  )
  assert.ok(
    purityViolations("const load = () => import('node:fs')").includes('import'),
    'a dynamic import passed the purity guard'
  )
  assert.ok(
    purityViolations('const jitter = crypto.getRandomValues(new Uint8Array(1))[0]').includes('crypto'),
    'crypto.getRandomValues passed the purity guard'
  )
  assert.ok(
    purityViolations('const t = setTimeout(fn, 0)').includes('setTimeout'),
    'setTimeout passed the purity guard'
  )

  // 6. A regular expression literal is code too, and the one ending in an
  //    escaped slash is what defeated the scanner that knew only strings. The
  //    literal survives the strip whole, and everything after it on the same
  //    line is still scanned.
  const scannedRegex = stripComments(REGEX_MARKER_MUTANT)
  assert.match(scannedRegex, /const SLASH_RE = \/\\\/\//, 'the scanner truncated the regular expression literal')
  assert.match(scannedRegex, /document\.title/, 'a regex literal switched the scan off for the rest of the line')
  assert.ok(
    purityViolations(REGEX_MARKER_MUTANT).includes('document.'),
    'a DOM read behind a regular expression literal passed the purity guard'
  )
  assert.ok(
    purityViolations(REGEX_MARKER_MUTANT).includes('Date.'),
    'a clock behind a regular expression literal passed the purity guard'
  )

  // 6b. The same literal one token boundary further away: the keyword that
  //     licenses it follows an identifier across a newline, which is how every
  //     statement in this semicolon-free codebase ends. A word that does not
  //     close at whitespace re-opens the `//`-deletion hole of 6.
  const scannedAfterIdentifier = stripComments(REGEX_AFTER_IDENTIFIER_MUTANT)
  assert.match(
    scannedAfterIdentifier,
    /return \/\\\/\/\.test\(subject\)/,
    'a keyword that follows an identifier across whitespace was not recognised, so the regex literal was lexed as a division'
  )
  assert.match(
    scannedAfterIdentifier,
    /document\.title/,
    'a regex literal after a keyword that follows an identifier switched the scan off for the rest of the line'
  )
  assert.ok(
    purityViolations(REGEX_AFTER_IDENTIFIER_MUTANT).includes('document.'),
    'a DOM read behind a regex literal in statement-after-identifier position passed the purity guard'
  )
  assert.ok(
    purityViolations(REGEX_AFTER_IDENTIFIER_MUTANT).includes('Date.'),
    'a clock behind a regex literal in statement-after-identifier position passed the purity guard'
  )
  // The repair must not turn ordinary division into a regex: `subject` is not a
  // keyword, so the slash after it still divides and the line survives whole.
  assert.match(
    stripComments('const half = subject / 2\nconst t = 1'),
    /const half = subject \/ 2\nconst t = 1/,
    'a division after an ordinary identifier was read as a regular expression'
  )

  // 7. Where the scanner cannot classify a slash it refuses instead of
  //    guessing, because guessing is what deleted the line above. A regex
  //    literal cannot span a line, so one that does not close on its own is a
  //    text this scanner must not strip.
  assert.throws(
    () => stripComments('const broken = /abc\nconst t = document.title'),
    PurityScanError,
    'an unclassifiable slash was guessed at instead of refused'
  )
})

// The mutations that defeated the scanner one nesting level down, and one token
// position sideways. The three above are the history of the STRING and REGEX
// branches; these are the TEMPLATE branch and the division branch, and both
// were measured on the committed scanner before the repair below.
//
// A template literal inside another template's `${ … }`: the end of a template
// was found by scanning for the next unescaped backtick, which knows nothing
// about substitutions, so the OUTER literal was closed on the INNER one's
// opening backtick and the inner literal's text landed in perceived-code
// position. Spelled `/*` it deleted everything to end of file, spelled `//` the
// rest of the line. Measured, verbatim: stripComments() of the first mutant
// returned "export function p08(text) {\n  const t = `a ${ `" and
// purityViolations() returned []; of the second it returned
// "export function p09(text) {\n  const t = `a ${ `\n  return t\n}", again with
// no violations. End to end, appended to viewer/atlas39/core/view-state.mjs and
// to viewer/atlas39/core/gesture.mjs, both suites stayed green at exit 0 (19/19
// and 22/22) with document.title and Date.now() provably on disk.
const NESTED_TEMPLATE_BLOCK_MUTANT = [
  'export function p08(text) {',
  '  const t = `a ${ `/*` } b`',
  '  return t + text',
  '}',
  'export function p08leak() {',
  '  return document.title + Date.now()',
  '}'
].join('\n')

const NESTED_TEMPLATE_LINE_MUTANT = [
  'export function p09(text) {',
  '  const t = `a ${ `//` } b` + text + document.title + Date.now()',
  '  return t',
  '}'
].join('\n')

// A regular expression literal written where `regexCanStart()` answers `false`
// — directly after `)` or after a `}` in statement position. Both are valid
// JavaScript (a `]` there is not, which is why no `]` mutant is written here).
// Lexed as a division, the two adjacent slashes of `/\//` — its escape and its
// terminator — then met the `//` branch and deleted the rest of the line.
// Measured, verbatim: stripComments() of the first returned
// "export function p02(text) {\n  if (text) /\\\n  return 1\n}" with no
// violations, and the `}` and `if (subject)` spellings did the same. End to
// end, the third of them appended to viewer/atlas39/core/view-state.mjs left
// that suite at exit 0, 19/19 with a DOM read and a clock on disk.
const REGEX_AFTER_PAREN_MUTANT = [
  'export function p02(text) {',
  '  if (text) /\\//.test(document.title + Date.now())',
  '  return 1',
  '}'
].join('\n')

const REGEX_AFTER_BRACE_MUTANT = [
  'export function p03(text) {',
  '  const out = []',
  '  if (text) { }',
  '  /\\//.test(text) ? out.push(document.title) : out.push(Date.now())',
  '  return out',
  '}'
].join('\n')

const REGEX_AFTER_IF_PAREN_MUTANT = [
  'export function hasSlash(text) {',
  '  const subject = String(text)',
  '  if (subject) /\\//.test(subject) && document.title && Date.now()',
  '  return subject',
  '}'
].join('\n')

// The two denylist spellings, built from the backslash's own byte rather than
// written as '\\u0044ate', so that what reaches the scanner is exactly the six
// characters JavaScript reads as one `D` and no reader has to decode an escape
// of an escape to see what is being asserted.
const BACKSLASH = String.fromCharCode(92)
const ESCAPED_CLOCK_MUTANT = [
  'export function p23() {',
  '  return ' + BACKSLASH + 'u0044ate.now()',
  '}'
].join('\n')
const ESCAPED_DOM_MUTANT = [
  'export function p24() {',
  '  return ' + BACKSLASH + 'u0064ocument.title',
  '}'
].join('\n')
const FUNCTION_CONSTRUCTOR_MUTANT = [
  'export function p25() {',
  "  const read = Function('return Da' + 'te.now()')",
  '  return read()',
  '}'
].join('\n')

test('the purity guard cannot be switched off by a nested template literal or a regex in division position, and sees escaped identifiers', async () => {
  // 1. A template inside a template's `${ … }`. The scan must delete NOTHING
  //    from either mutant — asserted as whole-text equality, because "the probe
  //    survived" is what the two predecessors also looked like on the line
  //    before the one that got eaten.
  assert.equal(
    stripComments(NESTED_TEMPLATE_BLOCK_MUTANT),
    NESTED_TEMPLATE_BLOCK_MUTANT,
    'a `/*` inside a nested template literal switched the scan off'
  )
  assert.equal(
    stripComments(NESTED_TEMPLATE_LINE_MUTANT),
    NESTED_TEMPLATE_LINE_MUTANT,
    'a `//` inside a nested template literal switched the scan off'
  )
  for (const mutant of [NESTED_TEMPLATE_BLOCK_MUTANT, NESTED_TEMPLATE_LINE_MUTANT]) {
    const violations = purityViolations(mutant)
    assert.ok(violations.includes('document.'), 'a DOM read behind a nested template literal passed the purity guard')
    assert.ok(violations.includes('Date.'), 'a clock behind a nested template literal passed the purity guard')
  }

  // 2. The substitution is CODE, not template text, so a comment inside one is
  //    still removed and prose inside one still cannot fire the guard. Without
  //    this the repair could have been "never strip anything inside a template".
  assert.equal(
    stripComments('const t = `a ${ b /* window.name */ } c`'),
    'const t = `a ${ b  } c`',
    'a comment inside a template substitution was kept as template text'
  )
  assert.deepEqual(
    purityViolations('const t = `a ${ b /* window.name */ } c`'),
    [],
    'prose inside a template substitution fired the purity guard'
  )
  // …and an ordinary template still survives the scan untouched.
  assert.equal(
    stripComments('const t = `a ${ b } c`\nconst u = 1'),
    'const t = `a ${ b } c`\nconst u = 1',
    'an ordinary template literal was damaged by the substitution scan'
  )

  // 3. A regex literal in division position. The scanner still LEXES these as
  //    divisions — telling them apart needs the parenthesis's own keyword — so
  //    what is pinned is the only consequence that ever mattered: it deletes
  //    nothing, and the denylists see the whole line.
  for (const mutant of [REGEX_AFTER_PAREN_MUTANT, REGEX_AFTER_BRACE_MUTANT, REGEX_AFTER_IF_PAREN_MUTANT]) {
    assert.equal(stripComments(mutant), mutant, 'a regex literal in division position switched the scan off')
    const violations = purityViolations(mutant)
    assert.ok(violations.includes('document.'), 'a DOM read behind a regex in division position passed the purity guard')
    assert.ok(violations.includes('Date.'), 'a clock behind a regex in division position passed the purity guard')
  }

  // 4. The repair must not turn an ordinary division into a regular expression,
  //    and the line comment after one must still be removed: `regexLiteralEnd`
  //    stops at the first unescaped slash, so the span here is `/ 2 /` and
  //    carries neither delimiter.
  assert.equal(
    stripComments('const half = total / 2 // half of it\nconst t = 1'),
    'const half = total / 2 \nconst t = 1',
    'a division followed by a line comment was read as a regular expression'
  )
  assert.equal(
    stripComments('const r = a / b /* note */ + c'),
    'const r = a / b  + c',
    'a division followed by a block comment was read as a regular expression'
  )

  // 5. A `\u` escape in an IdentifierName really is the global — not an
  //    argument about the specification, but the value, evaluated. The module
  //    is imported from a data: URL so the measurement itself needs neither
  //    eval nor the Function constructor.
  const clock = await import('data:text/javascript,export const now = ' + BACKSLASH + 'u0044ate.now()')
  assert.equal(typeof clock.now, 'number', 'the escaped identifier did not resolve to the real clock')
  // The word-boundary rules cannot see it, which is why the escape itself is
  // the rule: assert the name is absent from the scanned code before asserting
  // that the guard still fires.
  assert.doesNotMatch(stripComments(ESCAPED_CLOCK_MUTANT), /\bDate\b/, 'the escaped clock spelled the denied name after all')
  assert.doesNotMatch(stripComments(ESCAPED_DOM_MUTANT), /\bdocument\b/, 'the escaped DOM read spelled the denied name after all')
  assert.deepEqual(
    purityViolations(ESCAPED_CLOCK_MUTANT),
    [BACKSLASH + 'u<escape>'],
    'a clock spelled with a unicode escape passed the purity guard'
  )
  assert.deepEqual(
    purityViolations(ESCAPED_DOM_MUTANT),
    [BACKSLASH + 'u<escape>'],
    'a DOM read spelled with a unicode escape passed the purity guard'
  )

  // 6. `Function` sits next to `eval` for the reason `eval` is listed at all.
  //    Asserted as the whole result, so this pins that it is the added name
  //    doing the work and not some other rule catching the mutant by accident.
  assert.deepEqual(
    purityViolations(FUNCTION_CONSTRUCTOR_MUTANT),
    ['Function'],
    'the Function constructor passed the purity guard'
  )
})

// ATLAS-40 core / slice 2: the pointer drag state machine.
//
// Slice 1 kept this state inside wirePointer() in app.mjs, where `node --test`
// could only assert that the source still contained the right words. That was
// enough to stop the wiring being deleted and not enough to notice it was
// wrong: after a pan crossed the movement threshold, a `pointercancel` — a
// touch the browser takes over, a page that loses the pointer, a device
// disconnecting — left the click suppression armed. A cancelled pointer never
// delivers the click that suppression was waiting for, so the flag stayed
// armed with nothing to spend it on.
//
// A swallowed click is the worst kind of interaction defect: nothing is drawn
// wrong, nothing errors, the application simply ignores the user once. So the
// state machine lives here, where the defect is a test rather than a comment.
//
// Four invariants keep a gesture this module never sees the end of from
// outliving the press that started it, because every one of them shipped as a
// measured defect in an earlier round of this file:
//
//   1. A pan needs a button to still be held (`move()` reads `buttons`).
//   2. A click that arrives while a gesture is still running is not that
//      gesture's tail, so it is not swallowed (`consumeClick()`).
//   3. A pan whose owner answers nothing while two presses arrive is presumed
//      lost, so it cannot disable the stage for the life of the page
//      (`start()`).
//   4. Only the click a gesture PRODUCED may spend its suppression. Keying the
//      disarm on the cause — `pointercancel` — left the flag armed after a pan
//      ended by `pointerup` that the engine answered with no click at all, and
//      the headed run of 2026-08-20 measured that swallowing the user's next
//      activation (`consumeClick()`).
//
// This module knows nothing about the DOM. It consumes plain records
// {type, pointerId, button, buttons, clientX, clientY} for pointers and
// {type, detail} for clicks, and returns what the shell should do about them.
//
// Pure: no IO, no clock, no randomness, no DOM.

/** Screen pixels of movement that turn a press into a pan instead of a click. */
export const DRAG_THRESHOLD = 4

/**
 * Was this click produced by a pointer at all?
 *
 * UI Events defines `detail` on a click as the click count, so every click a
 * pointer produces carries at least 1. HTML's "fire a synthetic pointer event"
 * — the algorithm behind `element.click()` and behind the activation behaviour
 * that a keyboard Enter or Space runs on a button — initialises `type`,
 * `bubbles`, `cancelable`, the modifier keys and `view`, and never initialises
 * `detail`, which therefore keeps the 0 default of UIEventInit. A
 * script-constructed `new MouseEvent('click', {bubbles: true})` is the same.
 *
 * This is a fact about the event, not about a browser: nothing here asks what a
 * pointer type is or what any engine does with one.
 *
 * An unreadable `detail` counts as "no pointer produced this", which is the
 * direction that DELIVERS the click. A record whose provenance this module
 * cannot read is not evidence that the pan's own click has arrived, and the
 * defect this module exists to prevent is a swallowed one.
 *
 * @param {{detail?: number}} [event]
 */
const producedByPointer = (event) => Number.isFinite(event?.detail) && event.detail >= 1

export const E_GESTURE_THRESHOLD = 'E_GESTURE_THRESHOLD'

export class GestureError extends Error {
  constructor(message) {
    super(message)
    this.name = 'GestureError'
    this.code = E_GESTURE_THRESHOLD
  }
}

/**
 * @param {{threshold?: number}} [options]
 * @returns {{start:Function, move:Function, end:Function,
 *            isClickSuppressed:Function, consumeClick:Function, isPanning:Function}}
 * @throws {GestureError} when `threshold` is not a finite number above zero.
 */
export function createDragGesture({ threshold = DRAG_THRESHOLD } = {}) {
  // Fail closed on the option, because failing open here disables the very
  // thing the option names: `Math.hypot(...) < NaN` and `Math.hypot(...) < 'x'`
  // are both false, so an unvalidated threshold turns a half-pixel twitch into
  // a pan and every click on the stage into a swallowed one. Sibling core
  // modules throw on this class of bad input (ViewModelError, PaletteError);
  // so does this one.
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new GestureError(
      `${E_GESTURE_THRESHOLD}: threshold must be a finite number of pixels above zero, received ${String(threshold)}`
    )
  }

  let active = null
  let suppressClick = false

  return {
    /**
     * @returns {boolean} true when a gesture actually started. False on a
     *   non-primary button, false on a press whose coordinates this module
     *   cannot measure from, and false on the FIRST press by a different
     *   pointer while a pan is in flight.
     */
    start(event) {
      if (event.button !== 0) return false
      // Fail closed on the origin. Everything this module reports is measured
      // from it, so a press at a coordinate that is not a finite number makes
      // every later delta NaN — and `Math.hypot(NaN, NaN) < threshold` is
      // false, which used to mean a zero-pixel move started a pan, armed a
      // click suppression for a pan that never happened, and fed NaN to the
      // shell's panBy, poisoning the stage transform permanently.
      if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return false
      // A pan in flight owns the stage until it ends. A second primary press by
      // ANOTHER pointer — the ordinary accidental second touch on a surface with
      // `touch-action: none` — must not take the gesture away from the finger
      // that is moving: the replaced pointer could then neither move nor end,
      // and because the shell gates its cleanup on `end()` reporting `ended`,
      // its pointer capture would never be released and `body[data-panning]`
      // would stay set, with nothing on screen to explain it.
      //
      // Three exemptions keep that guard from becoming a dead-lock, because a
      // gesture this module never sees the end of would otherwise be permanent:
      //
      // 1. A press that has not yet panned is always replaceable (the guard is
      //    keyed on `panning`, not on `active`).
      // 2. The panning pointer's OWN id re-anchors. A second `pointerdown` for
      //    a pointer this module still believes is panning can only mean its
      //    `pointerup`/`pointercancel` was never delivered — a window blur
      //    mid-drag, a native drag or context-menu takeover, or an `up` that
      //    landed outside the listening element because pointer capture was
      //    unavailable. Re-anchoring restores slice 1's self-healing behaviour,
      //    which re-armed the gesture on every primary `pointerdown`. For a
      //    mouse, whose pointer id is always the same, that closes the lost
      //    pointer case completely.
      // 3. A SECOND foreign press with no sign of life from the owner in
      //    between re-anchors. A lost *touch* pointer never presses again — its
      //    id is gone with the finger — so keying the refusal on the owner's id
      //    alone made that state permanent: every later finger was refused, the
      //    stage could never be panned again, and `body[data-panning]` stayed
      //    set for the life of the page. Refusing once per contest keeps the
      //    accidental second touch from stealing a live pan (the defect this
      //    guard exists for) while making the lost-touch state cost the user
      //    one extra press instead of a reload. Any owned move clears the
      //    contest, so a pointer that is demonstrably alive is defended again.
      if (active?.panning === true && active.id !== event.pointerId) {
        if (active.contested !== true) {
          active.contested = true
          return false
        }
      }
      // A fresh press always disarms: whatever a previous gesture left behind,
      // the click that belongs to THIS press must be allowed through.
      suppressClick = false
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false, contested: false }
      return true
    },

    /**
     * @returns {{panning:boolean, began:boolean, dx:number, dy:number}}
     *   `began` is true only on the step that crossed the threshold, so the
     *   shell takes the pointer capture exactly once.
     */
    move(event) {
      const idle = { panning: false, began: false, dx: 0, dy: 0 }
      if (!active || event.pointerId !== active.id) return idle
      // A pan needs a button to still be held. Trusting `active` alone left a
      // press whose end this module never saw alive for the life of the page:
      // a press that stayed under the threshold takes no pointer capture (the
      // shell takes it on `began`), so a `pointerup` over a SIBLING of
      // `#stage-host` — `.a39-stage-controls` and the sidebar both are — never
      // reaches the shell's listener and `end()` is never called. The next bare
      // hover then measured a large delta from the stale origin, crossed the
      // threshold, and panned the graph under a cursor with no button held.
      //
      // `buttons` is the bitmask of buttons currently held, so 0 means the
      // press is over. Its ABSENCE is refused rather than assumed, because "no
      // button state" is not evidence that a button is held; every real
      // PointerEvent carries it and Task 6 forwards the event itself. A
      // malformed step is refused without discarding the gesture — a stream
      // this module cannot read must not be able to cancel a real pan.
      if (!Number.isFinite(event.buttons)) return idle
      if (event.buttons === 0) {
        // The press ended where this module could not see it. Nothing is left
        // to swallow either: the click it would have produced, if any, was
        // dispatched before this hover ever arrived.
        active = null
        suppressClick = false
        return idle
      }
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      // Fail closed on the delta, for the same reason the `threshold` option
      // fails closed above and by the identical mechanism: `Math.hypot(NaN,
      // NaN) < 4` and `Math.hypot(Infinity, 0) < 4` are both false, so a
      // comparison written as `<` treats a delta it cannot measure as "far
      // enough to pan".
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return idle
      // A move this module owns is proof the pointer is alive, so the stage is
      // defended against the next accidental second press again.
      active.contested = false
      let began = false
      if (!active.panning) {
        if (!(Math.hypot(dx, dy) >= threshold)) return idle
        active.panning = true
        began = true
        // Above the threshold this gesture is a pan, so the click the browser
        // synthesises at pointerup is not a selection and must not act like one.
        suppressClick = true
      }
      active.x = event.clientX
      active.y = event.clientY
      return { panning: true, began, dx, dy }
    },

    /** @returns {{ended:boolean, wasPanning:boolean, pointerId:(number|null)}} */
    end(event) {
      // Ownership first. A `pointercancel` for a pointer this gesture does not
      // own must not disarm the suppression the owner armed: on a multi-touch
      // stage the browser cancels unrelated pointers routinely, and a repair
      // hoisted above this early return would let a foreign cancel hand the
      // pan's own synthesised click straight to whatever node the pan ended
      // over — the mirror image of the defect this module was created to fix.
      if (!active || event.pointerId !== active.id) {
        return { ended: false, wasPanning: false, pointerId: null }
      }
      const wasPanning = active.panning
      const pointerId = active.id
      // THE REPAIR. A cancelled pointer never delivers the click the
      // suppression was armed for. Leaving it armed spends it on the next,
      // unrelated click instead.
      if (event.type === 'pointercancel') suppressClick = false
      active = null
      return { ended: true, wasPanning, pointerId }
    },

    /**
     * True while a click suppression is armed — i.e. a pan crossed the
     * threshold and the click it produces has not been spent or cancelled yet.
     * Armed is not the same as spendable: see `consumeClick`.
     */
    isClickSuppressed() {
      return suppressClick
    },

    /**
     * Swallows at most one click. Returns true when the caller should stop it.
     * The suppression is spent either way, so it can never reach a second click.
     *
     * A click that arrives while a gesture is STILL running is not that
     * gesture's tail — the browser synthesises the pan's click after its
     * pointerup — so it is neither swallowed nor allowed to spend the
     * suppression. That is what stops a pan this module never saw the end of
     * from eating an unrelated click: the fresh finger that taps a node while a
     * lost pan is still believed to be in flight is delivered, not ignored.
     *
     * THE SECOND REPAIR (2026-08-20). Only the click this gesture PRODUCED may
     * spend its suppression. `end()` disarms on `pointercancel` because a
     * cancelled pointer delivers no click — but that keys the disarm on the
     * CAUSE, and the invariant is "a suppression that no click will ever spend
     * must not outlive the gesture". A pan ended by `pointerup` that yields no
     * synthesised click leaves the identical stale flag, and the headed
     * acceptance run of 2026-08-20 measured exactly that: after a touch pan
     * ended by `pointerup`, Chromium 151.0.7922.34 synthesised no click, the
     * flag stayed armed, and the user's next activation was swallowed.
     *
     * So a click no pointer produced is delivered AND retires the suppression:
     * had the engine synthesised the pan's click, it would have arrived before
     * this one. Nothing here branches on pointer type and nothing encodes what
     * an engine does — in an engine that does synthesise that click, it arrives
     * first, carries `detail >= 1`, and is swallowed as it should be.
     *
     * @param {{detail?: number}} [event] the click event itself.
     */
    consumeClick(event) {
      if (!suppressClick) return false
      if (active !== null) return false
      suppressClick = false
      return producedByPointer(event)
    },

    /** True while a pan is in progress. A press that has not moved is not one. */
    isPanning() {
      return active?.panning === true
    }
  }
}

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
// This module knows nothing about the DOM. It consumes plain records
// {type, pointerId, button, clientX, clientY} and returns what the shell should
// do about them.
//
// Pure: no IO, no clock, no randomness, no DOM.

/** Screen pixels of movement that turn a press into a pan instead of a click. */
export const DRAG_THRESHOLD = 4

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
     *   non-primary button, and false when a pan is already in flight.
     */
    start(event) {
      if (event.button !== 0) return false
      // A pan in flight owns the stage until it ends. A second primary press —
      // the ordinary accidental second touch on a surface with
      // `touch-action: none` — must not take the gesture away from the finger
      // that is moving: the replaced pointer could then neither move nor end,
      // and because the shell gates its cleanup on `end()` reporting `ended`,
      // its pointer capture would never be released and `body[data-panning]`
      // would stay set, with nothing on screen to explain it.
      //
      // The guard is keyed on `panning`, not on `active`: a press that has not
      // yet panned stays replaceable, so a pointer whose up/cancel the shell
      // never sees cannot dead-lock the stage against every later press.
      if (active?.panning === true) return false
      // A fresh press always disarms: whatever a previous gesture left behind,
      // the click that belongs to THIS press must be allowed through.
      suppressClick = false
      active = { id: event.pointerId, x: event.clientX, y: event.clientY, panning: false }
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
      const dx = event.clientX - active.x
      const dy = event.clientY - active.y
      let began = false
      if (!active.panning) {
        if (Math.hypot(dx, dy) < threshold) return idle
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

    /** True when the next click is the tail of a pan and must be swallowed. */
    isClickSuppressed() {
      return suppressClick
    },

    /**
     * Swallows at most one click. Returns true when the caller should stop it.
     * The suppression is spent either way, so it can never reach a second click.
     */
    consumeClick() {
      if (!suppressClick) return false
      suppressClick = false
      return true
    },

    /** True while a pan is in progress. A press that has not moved is not one. */
    isPanning() {
      return active?.panning === true
    }
  }
}

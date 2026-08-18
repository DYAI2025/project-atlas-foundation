// ATLAS-40 core / 1 of 4: the viewport transform.
//
// Zoom and pan are the two interactions that can permanently lose the graph, so
// the transform is not stored as "whatever the last wheel event produced". It is
// a value object with an explicit, total clamp: every function in this module
// returns a transform that has already been forced back inside the legal range.
// There is therefore no reachable state in which the graph is off screen and no
// gesture can recover it — which is the actual acceptance requirement, not
// "zoom works".
//
// Convention: world coordinates are the CSS-pixel coordinates computeLayout()
// produced for the stage viewport. Screen coordinates are CSS pixels relative to
// the stage box. The mapping is uniform scale plus translation:
//
//     screen = world * scale + (tx, ty)
//
// Pure: no IO, no clock, no randomness, no DOM.

export const MIN_SCALE = 0.25
export const MAX_SCALE = 8
// How much of the laid-out graph must stay inside the stage box. The clamp below
// is expressed against the world rectangle, so at any zoom level at least this
// fraction of the stage is covered by world space that actually contains the
// graph. 0.15 keeps a corner of the graph reachable while still allowing a
// genuinely useful off-centre inspection of a detail.
export const MIN_VISIBLE_FRACTION = 0.15

export const IDENTITY = Object.freeze({ scale: 1, tx: 0, ty: 0 })

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

const clampNumber = (value, low, high) => (value < low ? low : value > high ? high : value)

/**
 * Forces a transform back inside the legal range.
 *
 * A non-finite component is not clamped towards a boundary — NaN has no
 * boundary — it is replaced by the identity component. That is what makes an
 * extreme or corrupted gesture recoverable instead of sticky: one further
 * interaction, or the reset control, always lands on a drawable transform.
 *
 * @param {{scale:number,tx:number,ty:number}} transform
 * @param {{width:number,height:number}} world size of the laid-out graph area
 * @returns {{scale:number,tx:number,ty:number}}
 */
export function clampTransform(transform, world) {
  const scale = clampNumber(
    isFiniteNumber(transform?.scale) && transform.scale > 0 ? transform.scale : IDENTITY.scale,
    MIN_SCALE,
    MAX_SCALE
  )
  const width = isFiniteNumber(world?.width) && world.width > 0 ? world.width : 1
  const height = isFiniteNumber(world?.height) && world.height > 0 ? world.height : 1

  // The world rectangle painted at this scale.
  const paintedW = width * scale
  const paintedH = height * scale
  // Translation range that keeps at least MIN_VISIBLE_FRACTION of the stage box
  // covered by the painted world rectangle, in both directions.
  const marginX = width * (1 - MIN_VISIBLE_FRACTION)
  const marginY = height * (1 - MIN_VISIBLE_FRACTION)
  const minTx = -paintedW + width - marginX
  const maxTx = marginX
  const minTy = -paintedH + height - marginY
  const maxTy = marginY

  return {
    scale,
    tx: clampNumber(isFiniteNumber(transform?.tx) ? transform.tx : IDENTITY.tx, Math.min(minTx, maxTx), Math.max(minTx, maxTx)),
    ty: clampNumber(isFiniteNumber(transform?.ty) ? transform.ty : IDENTITY.ty, Math.min(minTy, maxTy), Math.max(minTy, maxTy))
  }
}

/** world -> screen */
export function project(transform, x, y) {
  return { x: x * transform.scale + transform.tx, y: y * transform.scale + transform.ty }
}

/** screen -> world. Exact inverse of project() for any legal transform. */
export function unproject(transform, x, y) {
  return { x: (x - transform.tx) / transform.scale, y: (y - transform.ty) / transform.scale }
}

/**
 * Zooms by `factor` while keeping the world point currently under
 * (screenX, screenY) pinned to that same screen position. This is the property
 * that makes wheel zoom feel like zooming rather than like drifting.
 */
export function zoomAt(transform, factor, screenX, screenY, world) {
  const safeFactor = isFiniteNumber(factor) && factor > 0 ? factor : 1
  const anchorX = isFiniteNumber(screenX) ? screenX : 0
  const anchorY = isFiniteNumber(screenY) ? screenY : 0
  const before = unproject(transform, anchorX, anchorY)
  const scale = clampNumber(transform.scale * safeFactor, MIN_SCALE, MAX_SCALE)
  return clampTransform(
    { scale, tx: anchorX - before.x * scale, ty: anchorY - before.y * scale },
    world
  )
}

/** Pans by a screen-pixel delta. */
export function panBy(transform, dx, dy, world) {
  return clampTransform(
    {
      scale: transform.scale,
      tx: transform.tx + (isFiniteNumber(dx) ? dx : 0),
      ty: transform.ty + (isFiniteNumber(dy) ? dy : 0)
    },
    world
  )
}

/** The default view. Always legal, by construction. */
export function resetTransform(world) {
  return clampTransform(IDENTITY, world)
}

/**
 * Puts a world point in the middle of the stage without changing zoom. Used when
 * a search match or a navigator entry focuses a node that may be off screen —
 * focusing something the user then cannot see is the same defect as losing the
 * graph.
 */
export function centerOn(transform, worldX, worldY, world) {
  const x = isFiniteNumber(worldX) ? worldX : 0
  const y = isFiniteNumber(worldY) ? worldY : 0
  return clampTransform(
    {
      scale: transform.scale,
      tx: world.width / 2 - x * transform.scale,
      ty: world.height / 2 - y * transform.scale
    },
    world
  )
}

/** True when the transform is the untouched default view. */
export function isDefaultView(transform) {
  return transform.scale === IDENTITY.scale && transform.tx === IDENTITY.tx && transform.ty === IDENTITY.ty
}

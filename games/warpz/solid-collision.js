// ==========================================
// MODULE: SHARED "PHYSICAL CONSTRAINT" COLLISION
// ==========================================
//
// Every obstacle up to Station was "lethal" — touch it, you die, checked
// with a simple hitsCircle(x, y, radius) boolean. Station introduces a
// second category per the user's explicit spec: some obstacle material is a
// PHYSICAL CONSTRAINT instead — the player can't pass through it, but
// touching it doesn't end the round. This file holds the two generic shape
// primitives that category needs (circle-vs-annulus-with-gaps,
// circle-vs-rotated-rectangle) plus the multi-pass driver that resolves a
// moving circle against a list of them — written obstacle-agnostic on
// purpose, since a second, solid-only obstacle is planned to reuse this
// same file rather than duplicating the resolution logic.
//
// Per the user's explicit "slide along the surface" choice (not a hard
// stop): resolution corrects position along each shape's own surface
// normal only, leaving whatever tangential motion the player's drag already
// had intact — call this every frame with the player's freshly-dragged
// position and it naturally reads as sliding along a wall or around a
// ring's rim, not just stopping dead. Annulus resolution still re-derives
// the player's ANGLE from their current position every call (that part IS
// safe to re-derive — it's just "slide," no history needed), but which
// RADIAL boundary counts as "home" needs actual memory — nearest-to-new-
// position tunnels a player through a thin band in one big drag frame (see
// git history / the first attempt at this comment for that bug).
//
// The fix went through TWO versions. The first tried "remember the
// player's last valid (x, y), compare its distance against the CURRENT
// ring center." That's broken for a ring that moves (Station descends
// every frame): as the ring's center drifts toward/past a player's
// position, re-measuring an OLD position against the NEW center silently
// drifts from "correct" to "wrong" — confirmed directly, a stationary
// player held against the ring got pulled straight through it once the
// ring's own descent carried its center past them. A remembered POSITION
// is only valid relative to the center it was measured against; once that
// center moves, the comparison itself is measuring the wrong thing.
//
// The actual fix: track which side the player is on as an explicit
// boolean the CALLER owns and passes back in next frame (`wasOutsideHint`
// below), rather than re-deriving it from a stored position every call.
// This function always returns the freshly-determined side alongside the
// corrected position (`isOutside`) — the caller's only job is to hold onto
// that value and hand it back next frame. Because it's a plain boolean
// with no positional/geometric content, it can never go stale relative to
// a moving center — it only changes when this function itself decides the
// player has legitimately crossed to the other side (through an open gap).

const TAU = Math.PI * 2;

// A small guaranteed gap kept between the player's circle and any solid
// surface once resolved — resolving to an EXACT tangent (zero gap) reads
// as "touching/overlapping" once the ring's own stroke width and glow
// effects (which extend a couple px past its precise mathematical edge)
// are rendered on top, even though the underlying physics never actually
// penetrated. Applied uniformly to both shape resolvers so every solid
// surface behaves consistently.
const CLEARANCE_MARGIN = 2;

function clockAngle(dx, dy) {
  return Math.atan2(dx, -dy);
}

function normalizeAngleDelta(delta) {
  let d = delta % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// A solid annulus (ring band) with zero or more angular gaps currently open
// enough to pass through. `gaps` is an array of { center, halfWidth } in
// radians (clock-angle convention, same as the rest of WARPZ's obstacle
// code) — a gap is only passed in here at all once it's open past whatever
// threshold the caller considers "open enough," so this function itself
// has no concept of door animation/openness, just "is there a hole here or
// not right now."
//
// `wasOutsideHint` — true/false if the caller has a value from last call,
// omit (or pass undefined/null) only when there's genuinely no history yet
// (a shape's very first-ever call), which falls back to a plain overlap
// test since there's nothing better to go on.
//
// Returns { x, y, isOutside } — position unchanged if nothing needed
// resolving, `isOutside` is the freshly-determined side to feed back in as
// next call's hint.
export function resolveCircleAgainstAnnulus(x, y, radius, cx, cy, rOuter, rInner, gaps, wasOutsideHint) {
  const dx = x - cx, dy = y - cy;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const angle = clockAngle(dx, dy);
  const mid = (rOuter + rInner) / 2;
  const outerTarget = rOuter + radius + CLEARANCE_MARGIN;
  const innerTarget = rInner - radius - CLEARANCE_MARGIN;

  const hasHint = wasOutsideHint === true || wasOutsideHint === false;
  const wasOutside = hasHint ? wasOutsideHint : dist >= mid;
  // Blocked unless STILL cleanly on the side they started this frame on.
  // Deliberately NOT "does the new position overlap the band" — that
  // version only catches a jump that barely crosses into the band and
  // completely misses one that clears it entirely in a single frame.
  const needsResolve = hasHint
    ? (wasOutside ? dist - radius < rOuter + CLEARANCE_MARGIN : dist + radius > rInner - CLEARANCE_MARGIN)
    : (dist + radius > rInner - CLEARANCE_MARGIN && dist - radius < rOuter + CLEARANCE_MARGIN);

  if (!needsResolve) return { x, y, isOutside: dist >= mid, inGap: false };

  const inOpenGap = gaps.some((g) => Math.abs(normalizeAngleDelta(angle - g.center)) < g.halfWidth);
  if (inOpenGap) {
    // A gap crossing is the only way `isOutside` legitimately flips — but
    // NOT via "dist >= mid": mid is just the band's midpoint, and dist is
    // measured against a center that moves every frame (Station always
    // descends). A player standing PERFECTLY STILL can have dist drift
    // across mid purely because the ring itself moved past them, with zero
    // movement of their own — that misread as "they walked through," which
    // then let a later frame see them as fair game to pull the wrong way.
    // Only flip once they've genuinely cleared past the FAR boundary (not
    // just the midpoint) — a threshold passive ring drift is far less
    // likely to cross by itself within one open-door window, vs. genuine
    // drag movement through the doorway, which easily clears it.
    let isOutside = wasOutside;
    if (wasOutside && dist + radius <= rInner - CLEARANCE_MARGIN) isOutside = false;
    else if (!wasOutside && dist - radius >= rOuter + CLEARANCE_MARGIN) isOutside = true;
    // `inGap: true` tells the caller "nothing was corrected because there's
    // a real gap here" — Station.js uses this to cap how long a player can
    // sit un-resolved in an open gap without genuinely crossing (a rotating
    // door's opening can end up slowly tracking a near-stationary player's
    // own angle for longer than any one door stays open, letting the
    // ring's motion alone erode their distance — see Station.js's own
    // dwell-timer comment for the fuller story).
    return { x, y, isOutside, inGap: true };
  }

  // Clamp radius to whichever boundary is "home." Angle still comes fresh
  // from the CURRENT position either way — that's what makes this a slide
  // rather than a snap-back-to-where-you-were. isOutside is unchanged —
  // being held back onto your own side doesn't cross you to the other one.
  const newDist = wasOutside ? outerTarget : innerTarget;
  return {
    x: cx + Math.sin(angle) * newDist,
    y: cy - Math.cos(angle) * newDist,
    isOutside: wasOutside,
    inGap: false,
  };
}

// A solid rectangle in its own local frame (centered at (cx, cy)), where
// that local frame is whatever a caller's own `ctx.translate(cx, cy);
// ctx.rotate(angle)` (WARPZ's usual clock-angle convention — angle 0 = up,
// increasing clockwise) would draw into — i.e. local -y is "outward" at
// angle=0, same frame Station.js's spoke code draws its caps in. Local
// half-extents (halfW, halfH) are along that frame's own x/y axes.
// Standard circle-vs-AABB closest-point resolution, done in local space and
// rotated back — naturally handles both a flat-face hit (pure radial push)
// and a corner hit (push away from the corner), which is what makes this
// slide properly along a wall AND still stop cleanly at a corner.
export function resolveCircleAgainstRect(x, y, radius, cx, cy, angle, halfW, halfH) {
  const effRadius = radius + CLEARANCE_MARGIN; // see CLEARANCE_MARGIN's own comment
  const dx = x - cx, dy = y - cy;
  // World -> local is the INVERSE of the rotation ctx.rotate(angle) applies
  // when drawing (verified against that mapping directly, not assumed) —
  // easy to get backwards, which is exactly what happened on the first
  // pass of this function.
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);

  const closestX = Math.max(-halfW, Math.min(halfW, localX));
  const closestY = Math.max(-halfH, Math.min(halfH, localY));
  const distX = localX - closestX, distY = localY - closestY;
  const distSq = distX * distX + distY * distY;

  if (distSq >= effRadius * effRadius) return { x, y }; // not touching

  let pushX, pushY;
  if (distSq > 0.0001) {
    // Outside the rect but within `effRadius` of its border (or a corner)
    // — push straight away from the closest point.
    const dist = Math.sqrt(distSq);
    pushX = closestX + (distX / dist) * effRadius;
    pushY = closestY + (distY / dist) * effRadius;
  } else {
    // Circle's center is INSIDE the rect (can happen if it slipped in over
    // a big frame delta) — push out along whichever axis needs the least
    // correction.
    const toRight = halfW - localX, toLeft = localX + halfW;
    const toBottom = halfH - localY, toTop = localY + halfH;
    const minX = Math.min(toRight, toLeft), minY = Math.min(toBottom, toTop);
    if (minX < minY) {
      pushX = toRight < toLeft ? halfW + effRadius : -halfW - effRadius;
      pushY = localY;
    } else {
      pushX = localX;
      pushY = toBottom < toTop ? halfH + effRadius : -halfH - effRadius;
    }
  }

  // Local -> world: the FORWARD rotation this time (the one ctx.rotate()
  // itself applies), not the inverse used for world -> local above.
  const worldDx = pushX * Math.cos(angle) - pushY * Math.sin(angle);
  const worldDy = pushX * Math.sin(angle) + pushY * Math.cos(angle);
  return { x: cx + worldDx, y: cy + worldDy };
}

// Runs every shape's resolver in sequence against a working position,
// twice — one pass isn't always enough when two shapes are both touching
// the circle at once (e.g. a corner where a spoke meets a ring): the first
// pass's correction for shape A can push the circle newly into shape B, so
// a second pass lets B (and a re-check of A) settle it. `shapes` is an
// array of { resolve: (x, y, radius) => {x, y} } — callers build these as
// thin closures over resolveCircleAgainstAnnulus/resolveCircleAgainstRect
// with their own fixed parameters already bound in.
export function resolveCircleAgainstShapes(x, y, radius, shapes) {
  let px = x, py = y;
  for (let pass = 0; pass < 2; pass++) {
    for (const shape of shapes) {
      const r = shape.resolve(px, py, radius);
      px = r.x; py = r.y;
    }
  }
  return { x: px, y: py };
}

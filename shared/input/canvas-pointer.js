// Unified mouse+touch pointer tracking for canvas games, extracted from JEWELZ.
// Converts client coordinates into canvas-space coordinates (accounting for the
// canvas being CSS-scaled to fit the responsive stage) and reports start/move/end.
//
// WHY COORDINATE CONVERSION IS NEEDED: a <canvas width="450" height="800">
// has an internal drawing surface that's exactly 450x800 pixels — that's the
// coordinate system JEWELZ's game logic (player position, collision checks,
// etc.) works in. But CSS resizes the canvas to fit the screen (see
// games/jewelz/style.css: height:100%; width:auto — so on most devices the
// canvas is displayed much smaller or larger than its native 450x800). Mouse
// and touch events report positions in on-screen CSS pixels, not the
// canvas's internal drawing coordinates. toCanvasCoords() below is what
// bridges the two: "the player tapped at this spot on their SCREEN — where
// is that within the canvas's internal 450x800 grid?"

export function enableCanvasPointerDrag({ canvas, onStart, onMove, onEnd }) {
  function toCanvasCoords(clientX, clientY) {
    // getBoundingClientRect() returns the canvas's current on-screen size
    // and position (in CSS pixels) — e.g. { left: 20, top: 95, width: 300,
    // height: 533 } if it's currently being displayed at 300x533 on screen.
    const rect = canvas.getBoundingClientRect();
    // canvas.width/height (no "style.") are the canvas's fixed INTERNAL
    // resolution — 450 and 800, set once in the HTML and never changed by
    // CSS. Dividing internal-size by on-screen-size gives the scale factor
    // between the two coordinate systems.
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    // (clientX - rect.left) converts the pointer's page position into a
    // position relative to the canvas's top-left corner (still in on-screen
    // CSS pixels); multiplying by scaleX/scaleY then converts that into the
    // canvas's internal coordinate system.
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  // Mouse handlers: straightforward, since MouseEvent always has
  // clientX/clientY directly on it.
  function onMouseDown(e) {
    if (onStart) onStart(toCanvasCoords(e.clientX, e.clientY));
  }
  function onMouseMove(e) {
    if (onMove) onMove(toCanvasCoords(e.clientX, e.clientY));
  }
  function onMouseUp() {
    if (onEnd) onEnd();
  }

  // Touch handlers: a TouchEvent can represent multiple simultaneous
  // fingers, held in e.touches — this game only cares about single-finger
  // dragging, so it always reads e.touches[0] (the first/only finger) and
  // bails out early if there isn't one.
  function onTouchStart(e) {
    if (e.touches.length === 0) return;
    e.preventDefault(); // stops the page from scrolling/zooming while playing
    if (onStart) onStart(toCanvasCoords(e.touches[0].clientX, e.touches[0].clientY));
  }
  function onTouchMove(e) {
    if (e.touches.length === 0) return;
    e.preventDefault();
    if (onMove) onMove(toCanvasCoords(e.touches[0].clientX, e.touches[0].clientY));
  }
  function onTouchEnd() {
    if (onEnd) onEnd();
  }

  // mousedown/touchstart only need to fire when the press/tap actually
  // starts ON the canvas, so those are bound to `canvas`. But once a drag is
  // underway, the pointer might move outside the canvas's bounds (player
  // drags fast and the cursor ends up past the edge) — mousemove/mouseup and
  // their touch equivalents are bound to `window` instead so the drag keeps
  // being tracked anywhere on the page, not just while directly over the
  // canvas.
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  // { passive: false } is required for e.preventDefault() to actually work
  // inside the touch handlers above — see the longer explanation of this in
  // shared/input/dom-tile-drag.js.
  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  window.addEventListener('touchmove', onTouchMove, { passive: false });
  window.addEventListener('touchend', onTouchEnd);

  // Returns a cleanup function — not currently called by JEWELZ (the game
  // lives for the whole page's lifetime), but available if a future
  // single-page setup ever needs to tear this down without a full reload.
  return function destroy() {
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('touchstart', onTouchStart);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onTouchEnd);
  };
}

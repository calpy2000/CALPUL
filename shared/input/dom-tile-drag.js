// Unified mouse+touch drag-to-swap for DOM tile grids.
// Generalized from GLYMPZ's approach (single getClientCoords() code path for both
// input types, elementFromPoint() to resolve the drop target) — this replaces
// SOLVZ's separate native-HTML5-drag / hand-rolled-touch-avatar implementations.
//
// The module only detects "tile A was dragged onto tile B" gestures; it leaves
// the meaning of "swap" to the caller via onSwap(tileA, tileB), since different
// games swap different things (GLYMPZ swaps position/order, SOLVZ swaps displayed
// text content).
//
// HOW IT WORKS, IN ONE SENTENCE: on mousedown/touchstart we remember which
// tile was grabbed; on mousemove/touchmove we move that tile visually to
// follow the pointer AND check what's underneath it; on mouseup/touchend we
// check what's underneath one final time and, if it's a valid drop target,
// hand both tiles to the caller's onSwap() function.

// Mouse events and touch events carry the pointer's position in different
// places (e.clientX/clientY for mouse; e.touches[0].clientX/clientY for
// touch). This function hides that difference so the rest of the file can
// just call getClientCoords(e) regardless of which kind of event fired.
// e.touches is used during touchstart/touchmove (fingers currently down);
// e.changedTouches is used for touchend, where e.touches has *already* been
// emptied out because the finger just lifted — changedTouches still has the
// info for the finger(s) that just changed state.
function getClientCoords(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length > 0) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

// `container`: the DOM element to listen for drag gestures within (e.g. the
//   whole board — a single drag can validly start on one grid and end on
//   another, which is how SOLVZ lets you drag a number from its tray onto the
//   equation grid above).
// `tileSelector`: CSS selector identifying draggable tiles inside container
//   (defaults to '.tile').
// `canSwap(a, b)`: caller-supplied function deciding whether two specific
//   tiles are allowed to swap (e.g. SOLVZ only allows number-with-number or
//   operator-with-operator).
// `isLocked()`: caller-supplied function checked on every drag attempt —
//   returning true blocks dragging entirely (used while a start banner is
//   showing, or after a puzzle is already solved).
// `onSwap(a, b)`: caller-supplied function that actually performs whatever
//   "swap" means for that specific game.
export function enableTileDragSwap({
  container,
  tileSelector = '.tile',
  canSwap = () => true,
  isLocked = () => false,
  onSwap,
}) {
  // These variables live in the closure created by this function call, so
  // they persist between separate event firings (mousedown, then several
  // mousemoves, then mouseup) without needing to be stored anywhere else.
  let activeTile = null; // the tile currently being dragged, or null if nothing is
  let hoverTile = null; // the tile currently highlighted as a valid drop target
  let startX = 0;
  let startY = 0;
  let isDragging = false;

  function clearHover() {
    if (hoverTile) hoverTile.classList.remove('drag-over');
    hoverTile = null;
  }

  // Fires on mousedown (mouse) or touchstart (finger down).
  function onDragStart(e) {
    if (isLocked()) return;
    // e.target is whatever exact element was clicked/touched — could be a
    // child of the tile (e.g. text inside it), not necessarily the tile
    // element itself. .closest(tileSelector) walks UP the DOM tree from
    // e.target until it finds an ancestor (or itself) matching the
    // selector, or returns null if none exists — this is exactly why
    // .tile * { pointer-events: none; } shows up in every game's CSS, so
    // clicks on a tile's inner content still land on the tile itself.
    const tile = e.target.closest(tileSelector);
    if (!tile || !container.contains(tile) || tile.classList.contains('is-animating')) return;

    const coords = getClientCoords(e);
    startX = coords.x;
    startY = coords.y;
    activeTile = tile;
    isDragging = true;

    tile.classList.add('is-dragging');
    // Object.assign copies multiple properties onto tile.style in one go —
    // shorthand for three separate `tile.style.zIndex = ...` lines.
    // z-index:100 keeps the dragged tile visually on top of its neighbors;
    // transition:none stops any CSS transition from fighting the manual
    // position updates below; position:relative is required for the
    // translate() transform (used in onDragMove) to work as expected.
    Object.assign(tile.style, { zIndex: '100', transition: 'none', position: 'relative' });

    // Stops the browser's own default behavior for this event — for touch,
    // that mainly means preventing the page from scrolling while dragging a
    // tile. (See the addEventListener calls near the bottom: touch
    // listeners are registered with { passive: false } specifically so
    // preventDefault() is allowed to work here.)
    e.preventDefault();
  }

  // Fires repeatedly on mousemove/touchmove while a drag is in progress.
  function onDragMove(e) {
    if (!isDragging || !activeTile) return;
    e.preventDefault();

    const coords = getClientCoords(e);
    const dx = coords.x - startX;
    const dy = coords.y - startY;
    // CSS transform: translate(...) visually moves the tile by (dx, dy)
    // pixels from its original position, without affecting layout (the
    // tile's actual position in the grid doesn't change — this is purely a
    // visual offset while dragging).
    activeTile.style.transform = `translate(${dx}px, ${dy}px)`;

    // document.elementFromPoint(x, y) asks the browser "what element is
    // visually at this pixel position?" — but since the dragged tile is
    // currently sitting AT the pointer position (following the cursor), it
    // would always answer "the tile being dragged" instead of whatever's
    // underneath it. Hiding the tile with visibility:hidden right before
    // the check (and restoring it right after) lets elementFromPoint "see
    // through" to whatever tile is actually underneath the pointer.
    // visibility:hidden (rather than display:none) is used because it
    // doesn't affect layout — the tile keeps its space, it just isn't
    // rendered for that one instant.
    activeTile.style.visibility = 'hidden';
    const elUnderPoint = document.elementFromPoint(coords.x, coords.y);
    activeTile.style.visibility = 'visible';
    const candidate = elUnderPoint ? elUnderPoint.closest(tileSelector) : null;

    const isValidHover =
      candidate && candidate !== activeTile && container.contains(candidate) && canSwap(activeTile, candidate);

    // Only touch the DOM (add/remove the CSS class) when the hovered tile
    // actually changed, rather than on every single mousemove — this
    // avoids constantly re-triggering the .drag-over CSS styling for no
    // reason as the pointer wiggles around within the same tile.
    if (candidate !== hoverTile || !isValidHover) {
      clearHover();
      if (isValidHover) {
        hoverTile = candidate;
        hoverTile.classList.add('drag-over');
      }
    }
  }

  // Fires once on mouseup/touchend — decides whether a valid drop happened
  // and, if so, calls the caller's onSwap().
  function onDragEnd(e) {
    if (!isDragging || !activeTile) return;
    clearHover();
    const coords = getClientCoords(e);

    // Same hide/check/restore trick as onDragMove, to find what's under the
    // pointer at the moment of release.
    activeTile.style.visibility = 'hidden';
    const elUnderPoint = document.elementFromPoint(coords.x, coords.y);
    const targetTile = elUnderPoint ? elUnderPoint.closest(tileSelector) : null;
    activeTile.style.visibility = 'visible';

    // Undo the visual drag styling from onDragStart, snapping the tile back
    // to its normal in-grid position (the drag offset was only ever a CSS
    // transform, so removing it puts the tile back where CSS grid/flexbox
    // naturally places it).
    Object.assign(activeTile.style, { transform: 'none', zIndex: '', position: '' });
    activeTile.classList.remove('is-dragging');

    if (
      targetTile &&
      targetTile !== activeTile &&
      container.contains(targetTile) &&
      canSwap(activeTile, targetTile)
    ) {
      // Saved into a local variable because `activeTile` gets reset to null
      // a few lines down (before the setTimeout callback runs), and the
      // callback still needs to know which element to clean up.
      const source = activeTile;
      source.classList.add('is-animating');
      targetTile.classList.add('is-animating');

      onSwap(source, targetTile); // hand control to the caller — it decides what "swap" means

      // Keeps both tiles marked "is-animating" (which onDragStart checks,
      // via tile.classList.contains('is-animating'), to block re-dragging a
      // tile mid-animation) for 200ms — matching each game's own CSS
      // "swap pop" animation duration — then clears the flag.
      setTimeout(() => {
        source.classList.remove('is-animating');
        targetTile.classList.remove('is-animating');
      }, 200);
    }

    activeTile = null;
    isDragging = false;
  }

  // mousedown/touchstart are only listened for on `container` (only tiles
  // inside it can start a drag), but mousemove/mouseup/touchmove/touchend
  // are listened for on the whole `document` — because once a drag starts,
  // the pointer can move anywhere on the page (including outside the
  // original container) and we still need to track it and detect the
  // eventual release.
  //
  // `{ passive: false }` tells the browser "this handler might call
  // preventDefault(), so don't optimistically start scrolling/zooming
  // before asking me." Touch listeners default to passive:true in modern
  // browsers for scroll-performance reasons, which would silently make
  // e.preventDefault() do nothing — passive:false is what makes the
  // preventDefault() calls above actually stop the page from scrolling
  // while dragging a tile.
  container.addEventListener('mousedown', onDragStart);
  container.addEventListener('touchstart', onDragStart, { passive: false });
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('touchmove', onDragMove, { passive: false });
  document.addEventListener('mouseup', onDragEnd);
  document.addEventListener('touchend', onDragEnd);

  // enableTileDragSwap() returns a cleanup function. None of the current
  // games actually call it (each game's drag-swap lives for the whole page
  // lifetime), but it's here so a future game COULD tear down the listeners
  // cleanly if it ever needed to (e.g. a single-page app that mounts and
  // unmounts games without a full page reload).
  return function destroy() {
    container.removeEventListener('mousedown', onDragStart);
    container.removeEventListener('touchstart', onDragStart);
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('touchmove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('touchend', onDragEnd);
  };
}

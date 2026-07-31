// Split-flap style MM:SS timer widget for the shared header.
// createFlipTimer() builds the DOM and returns { root, setSeconds }.
// setSeconds() only animates the digit tiles whose value actually changed.
//
// HOW THE FLIP ANIMATION WORKS: each digit "tile" actually contains TWO
// overlapping text elements stacked on top of each other —
// .flip-timer__digit--current (showing the old value) and
// .flip-timer__digit--next (showing the new value, initially parked just
// above the visible area). Adding the "is-flipping" CSS class to the tile
// triggers a CSS transition (defined in shared/shell.css) that slides
// --current down and out of view while sliding --next down into view — that
// slide is what LOOKS like a rolling digit. Once the flip finishes, we swap
// the --current element's text to match, and reset both elements back to
// their starting positions so the tile is ready to flip again next time.
// The DOM elements' CSS classes never actually change — the *classes*
// --current/--next always mean the same physical <span>; only their text
// content and position change each cycle.

// Builds one digit tile: two stacked spans, both starting at "0". This
// function is not exported — only createFlipTimer() below needs it.
function buildDigitTile() {
  const tile = document.createElement('span');
  tile.className = 'flip-timer__tile';
  tile.innerHTML = `
    <span class="flip-timer__digit flip-timer__digit--current">0</span>
    <span class="flip-timer__digit flip-timer__digit--next">0</span>
  `;
  return tile;
}

// Called once per game (from shell.js) to build the whole MM:SS widget.
// Returns { root, setSeconds } — `root` is the DOM element to insert into
// the page, `setSeconds` is the function callers use afterward to update
// the displayed time.
export function createFlipTimer() {
  const root = document.createElement('div');
  root.className = 'flip-timer';

  // Four digit tiles: minutes-tens, minutes-ones, seconds-tens, seconds-ones.
  const m1 = buildDigitTile();
  const m2 = buildDigitTile();
  const colon = document.createElement('span');
  colon.className = 'flip-timer__colon';
  colon.textContent = ':';
  const s1 = buildDigitTile();
  const s2 = buildDigitTile();

  // Element.append() (plural, not appendChild) can take multiple arguments
  // at once and adds them all as children in order — a small convenience
  // over calling appendChild() five separate times.
  root.append(m1, m2, colon, s1, s2);

  const tiles = [m1, m2, s1, s2];
  // Tracks the currently-displayed digit for each tile, by array index, so
  // setDigit() below can tell "did this specific digit actually change?"
  // and skip animating tiles whose value is unchanged (e.g. most calls to
  // setSeconds() don't change the minutes digits at all).
  const lastValues = ['0', '0', '0', '0'];

  // Cleanup previously relied solely on a 'transitionend' listener. If that
  // event ever failed to fire for a tile's first flip — e.g. the value
  // changed before the browser had painted a frame to transition from,
  // which reliably happens to whichever digit changes first — that tile
  // got stuck forever: the class stuck at "is-flipping", and every future
  // update just silently swapped text with no animation. A fixed timeout
  // (matching the CSS transition duration) always fires, so cleanup always
  // happens, and each flip force-resets to the base state first so a
  // previously-stuck tile self-heals on its next change instead of staying
  // broken.
  const FLIP_DURATION_MS = 300; // must match the transition duration set in shared/shell.css

  // Snaps a tile back to its "not flipping" resting position with no
  // animation, so the next flip starts from a known-clean state.
  function resetTileInstantly(tile) {
    // "no-transition" is a CSS class (see shared/shell.css) that sets
    // `transition: none` — adding it temporarily disables the animation so
    // the class changes below apply INSTANTLY instead of sliding.
    tile.classList.add('no-transition');
    tile.classList.remove('is-flipping');
    // Reading `.offsetWidth` forces the browser to immediately recalculate
    // layout ("reflow") right now, rather than batching this style change
    // together with whatever comes next. Without this line, the upcoming
    // `classList.remove('no-transition')` could get applied in the same
    // batch as the changes above, and the browser might collapse them all
    // into one paint — silently skipping the "instant reset" we're trying
    // to force. `void` just means "call this and discard the result — we
    // only want the side effect of reading it, not the number itself."
    // This trick is commonly called a "forced reflow" or "layout thrashing
    // trick" if you want to search for more on it.
    void tile.offsetWidth;
    tile.classList.remove('no-transition'); // re-enable animation for the next flip
  }

  // Updates one tile to show `newValue`, animating the change unless the
  // tile is already showing that value.
  function setDigit(tile, index, newValue) {
    if (lastValues[index] === newValue) return; // nothing changed, skip entirely
    lastValues[index] = newValue;

    // `tile._flipTimeout` stashes a value directly on the DOM element
    // object itself (not a CSS attribute — just a plain JS property, since
    // DOM elements are regular JavaScript objects you can attach anything
    // to). This is how each tile remembers its own pending cleanup timer
    // across separate calls to setDigit(), without needing a
    // separate outside data structure to track "which timer belongs to
    // which tile". If a new value arrives before the previous flip's timer
    // fired, cancel that old one first — otherwise it would run later and
    // stomp on the newer value.
    if (tile._flipTimeout) {
      clearTimeout(tile._flipTimeout);
      tile._flipTimeout = null;
    }
    resetTileInstantly(tile);

    const current = tile.querySelector('.flip-timer__digit--current');
    const next = tile.querySelector('.flip-timer__digit--next');
    next.textContent = newValue;

    // requestAnimationFrame schedules the callback to run right before the
    // browser's next repaint. Doing the reset above, then waiting for the
    // *next* frame to add "is-flipping", guarantees the browser actually
    // paints the "reset" state first — so when "is-flipping" gets added
    // afterward, there's a real before/after difference for it to animate
    // between. Adding "is-flipping" in the very same tick as the reset
    // risked the browser collapsing both changes together and skipping the
    // animation (the same class of bug the forced-reflow trick above also
    // guards against).
    requestAnimationFrame(() => {
      tile.classList.add('is-flipping');
    });

    // setTimeout schedules the cleanup to run once, after FLIP_DURATION_MS
    // + a little buffer — deliberately NOT relying on the CSS
    // 'transitionend' event, because that event can fail to fire in edge
    // cases (see the comment above FLIP_DURATION_MS). A plain timer always
    // fires on schedule regardless of what the animation itself does.
    tile._flipTimeout = setTimeout(() => {
      current.textContent = newValue; // catch the "current" slot up to match what's now showing
      resetTileInstantly(tile); // snap both layers back to their resting position, ready to flip again
      tile._flipTimeout = null;
    }, FLIP_DURATION_MS + 50);
  }

  // The function callers actually use. Takes a raw number of seconds and
  // updates all four digit tiles to match.
  function setSeconds(totalSeconds) {
    // Guard against negative numbers or fractional seconds sneaking in.
    const clamped = Math.max(0, Math.floor(totalSeconds));
    // "% 100" keeps minutes to two digits even past 99 minutes, so the
    // display never overflows its four tiles.
    const mm = String(Math.floor(clamped / 60) % 100).padStart(2, '0');
    const ss = String(clamped % 60).padStart(2, '0');
    // mm and ss are two-character strings like "05" — indexing them with
    // [0]/[1] pulls out each individual character/digit.
    const digits = [mm[0], mm[1], ss[0], ss[1]];
    tiles.forEach((tile, i) => setDigit(tile, i, digits[i]));
  }

  return { root, setSeconds };
}

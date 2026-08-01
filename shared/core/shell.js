// Common page chrome shared by every game: header, footer, start banner + Play Now,
// end-of-game message/animation, and the return-to-hub link.
//
// Convention each game's index.html follows:
//
//   <div class="shell" id="app-shell">
//     <div class="shell-stage" id="game-stage">
//       <div id="game-root">
//         ...game-specific markup...
//       </div>
//     </div>
//   </div>
//
// initShell() injects the header/footer/banner/end-screen around #game-root and
// tells the caller whether today has already been played (so the game knows
// whether to start fresh, resume, or stay locked).
//
// BIG PICTURE PATTERN: initShell() is what's sometimes called a "factory
// function" — instead of returning a simple value, it builds a bunch of DOM
// elements, wires up their behavior, and then returns an *object of
// functions* (showStartBanner, showEndScreen, etc.) that the calling game
// uses to control those elements later. Those returned functions are
// "closures" — they keep access to the local variables from inside
// initShell() (like `overlay`, `endScreen`, `shareBtn`) even after
// initShell() itself has finished running. That's how, e.g., calling
// shell.showEndScreen(...) from deep inside a game's own code still knows
// which DOM element to update, without that game ever touching the DOM
// directly.

import { getDailyStatus } from './daily-lock.js';
import { getBestScore, getTodayScore, saveTodayScore } from './game-storage.js';
import { createFlipTimer } from './flip-timer.js';
import { showPageLoadingIndicator } from './loading-indicator.js';

// Small helper to cut down on repetition below: creates a DOM element,
// optionally gives it a class and some inner HTML, and hands it back — but
// does NOT attach it to the page yet (that's a separate step at each call
// site, e.g. `stage.appendChild(header)`). This is plain DOM scripting
// (document.createElement), not jQuery — shell.js is intentionally
// framework-agnostic since it needs to work the same whether the game using
// it loads jQuery (SOLVZ, GLYMPZ) or not (JEWELZ).
function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

// Builds the footer's score line: "Best: ..." alone, or "Best: ... · Today:
// ..." once today's game has actually been completed (see showEndScreen's
// `score` option below, which is what stamps getTodayScore() for today in
// the first place — a game that hasn't been played today, or one the
// player gave up on without a real result, has no today score to show, so
// the line stays just "Best: ..."). `formatScore` is an optional function
// each game can pass in (e.g. SOLVZ/GLYMPZ format seconds as "1:23" instead
// of the raw number of seconds) — if the game didn't provide one, the raw
// score number is used as-is.
function formatFooterScore(gameId, formatScore) {
  const best = getBestScore(gameId);
  const bestText = best === null ? 'No score yet' : `Best: ${formatScore ? formatScore(best) : best}`;

  const today = getTodayScore(gameId);
  if (today === null) return bestText;
  return `${bestText} · Today: ${formatScore ? formatScore(today) : today}`;
}

// The single entry point every game calls once, near the top of its
// index.js. The parameter here uses "destructuring with defaults":
// `{ gameId, title, emoji = '', ... }` pulls each named property straight
// out of the options object passed in, and properties like `emoji = ''`
// fall back to that default if the caller didn't supply one. So a game can
// call initShell({ gameId: 'solvz', title: 'SOLVZ', ... }) and skip any
// property that has a sensible default.
export function initShell({
  gameId,
  title,
  emoji = '',
  // Optional image URL (e.g. a canvas-rendered data: URL) shown in place of
  // the plain-text `emoji` glyph, right before the title — see
  // games/jewelz/jewel-icon.js's getJewelIconDataURL(). Matches the same
  // single icon+title format used for this game's tile on the hub page.
  // Most games just pass `emoji` and leave this out.
  emojiImage = null,
  // Optional { glyph, accent } pair for SOLVZ, the one game with no
  // generated icon art of its own — renders `glyph` in a small raised
  // circle filled with `accent`, matching that game's hub tile badge (see
  // .hub__tile-badge in style.css and games-registry.js's `accent` field)
  // instead of a plain-text emoji or an image.
  emojiBadge = null,
  instructions = '',
  hubPath = '../../index.html',
  formatScore = null,
  // Optional { bg, ink, rim } trio that colors this game's own "play now" /
  // "resume" / "return to games" buttons (.shell-btn) using ITS OWN hub-tile
  // colors — see games-registry.js's `color` (bg), the same hue made solid
  // for `ink` (button text), and `rim` (the exact same translucent bevel
  // shadow color that game's hub tile already uses) — instead of the one
  // fixed global blue (--accent) every game used before. Falls back to that
  // global blue if a game doesn't pass this.
  accentColor = null,
}) {
  // Every game's HTML is required to already contain these two elements
  // (see the convention comment at the top of the file). getElementById
  // returns `null` if nothing matches, so this check fails loudly with a
  // clear error instead of silently doing nothing later if a game's HTML
  // forgot to include them.
  const stage = document.getElementById('game-stage');
  const root = document.getElementById('game-root');
  if (!stage || !root) {
    throw new Error('shell.js: page must contain #game-stage wrapping #game-root');
  }

  // Setting these three custom properties on .shell (stage's own parent —
  // see the convention comment at the top of the file) makes them available
  // to .shell-btn wherever it's used underneath, in both the start banner
  // and the end screen, without threading the colors through every
  // individual button element.
  if (accentColor) {
    stage.parentNode.style.setProperty('--shell-accent', accentColor.bg);
    stage.parentNode.style.setProperty('--shell-accent-ink', accentColor.ink);
    stage.parentNode.style.setProperty('--shell-accent-rim', accentColor.rim);
  }

  // --- Header ---
  // Template literals (the backtick-quoted string below) let us build a
  // chunk of HTML with ${...} placeholders substituted in directly — this
  // is being set as innerHTML by el(), so the browser parses it into real
  // DOM elements. `&larr;` is the HTML entity for a left-arrow character.
  const header = el(
    'header',
    'shell-header',
    // When emojiImage or emojiBadge is supplied, it takes the spot the
    // plain-text emoji glyph would otherwise sit in, right before the
    // title — the same single icon+title format as this game's hub tile.
    // `.shell-header__title` is a flex row (see shell.css), so the icon
    // sits vertically centered against the text automatically.
    `<a class="shell-header__back" href="${hubPath}" aria-label="Back to games">&larr; back</a>
     <span class="shell-header__title">${
       emojiImage
         ? `<img class="shell-header__icon" src="${emojiImage}" alt="">${title}`
         : emojiBadge
         ? `<span class="shell-header__badge" style="background:${emojiBadge.accent}">${emojiBadge.glyph}</span>${title}`
         : `${emoji ? emoji + ' ' : ''}${title}`
     }</span>`
  );
  // insertBefore(newNode, referenceNode) puts `header` immediately before
  // `stage` in the DOM tree, as a sibling — i.e. header ends up positioned
  // right above the game's own stage/content, inside whatever wraps both
  // (the .shell div from each game's HTML).
  stage.parentNode.insertBefore(header, stage);

  // Shows the spinner on THIS (still-current) page the instant "back" is
  // tapped, rather than relying only on the hub's own spinner timing — see
  // index.js's identical reasoning on its own hub-tile click listener. A
  // plain <a href> already navigates on its own right after this runs; this
  // only adds the proactive show, nothing about the click itself changes.
  header.querySelector('.shell-header__back').addEventListener('click', () => showPageLoadingIndicator());

  // --- Footer ---
  const footer = el(
    'footer',
    'shell-footer',
    `<span class="shell-footer__score" id="shell-best-score">${formatFooterScore(gameId, formatScore)}</span>`
  );
  // createFlipTimer() (see flip-timer.js) builds the little MM:SS pill
  // widget and returns { root, setSeconds }. `root` is the actual DOM
  // element to display; `setSeconds` is the function used later to update
  // it. `.prepend()` inserts it as the FIRST child of footer, so it renders
  // above the "Best: ..." score text.
  const timer = createFlipTimer();
  footer.prepend(timer.root);
  stage.parentNode.insertBefore(footer, stage.nextSibling);

  // Re-reads best/today score from localStorage and updates the footer
  // text. Called after a game ends, in case that run just became the new
  // best (or just stamped today's own score — see showEndScreen's `score`
  // option below). innerHTML (not textContent) because formatScore can
  // return markup now (e.g. JEWELZ's inline jewel <img> — see
  // games/jewelz/index.js) — harmless for every other game, whose
  // formatScore just returns plain text/numbers with no special characters
  // to escape.
  function refreshBestScore() {
    footer.querySelector('#shell-best-score').innerHTML = formatFooterScore(gameId, formatScore);
  }

  // --- Start banner overlay ---
  // getDailyStatus() (see daily-lock.js) tells us whether this game has
  // already been played today: 'not-started', 'in-progress', or
  // 'completed'. This is computed once, right here, and handed back to the
  // calling game via the returned `status` property — the game itself
  // decides what to do with each case (e.g. whether to call
  // showStartBanner() at all).
  const status = getDailyStatus(gameId);

  // Built once, up front, but starts hidden (`is-hidden` class) — showing
  // and hiding it later is just toggling that CSS class, not
  // creating/destroying DOM.
  const overlay = el(
    'div',
    'shell-overlay is-hidden',
    // `instructions` is a chunk of HTML the calling game already wraps in
    // its own <p> tags, one per sentence/step (see e.g. games/rainz's
    // initShell call) — using a <div> here (rather than a <p>) is what
    // makes that valid, since a <p> can't contain another <p>. Each <p>'s
    // own margin (see .shell-overlay__instructions p in shell.css) is what
    // puts a gap between them.
    `<div class="shell-overlay__panel">
       <div class="shell-overlay__instructions">${instructions}</div>
       <button class="shell-btn" id="shell-play-btn" type="button">Play Now</button>
     </div>`
  );
  stage.appendChild(overlay);

  function hideStartBanner() {
    overlay.classList.add('is-hidden');
  }

  // `onStart` is a callback function the calling game provides — it's what
  // actually runs when the player clicks Play Now (e.g. shuffling a puzzle
  // and starting its timer). shell.js doesn't know or care what that
  // callback does; it just promises to call it once the button is clicked.
  // The second parameter, `{ label = 'Play Now' } = {}`, lets a caller
  // override the button text (used for the "Resume" case) while still
  // working fine if called with no second argument at all.
  function showStartBanner(onStart, { label = 'Play Now' } = {}) {
    overlay.classList.remove('is-hidden');
    const btn = overlay.querySelector('#shell-play-btn');
    btn.textContent = label;
    // Assigning to `.onclick` replaces any previous click handler on this
    // button. That's intentional here — each call to showStartBanner()
    // fully replaces what happens on click, so there's never more than one
    // handler stacked up.
    btn.onclick = () => {
      hideStartBanner();
      if (onStart) onStart();
    };
  }

  // --- End-of-game message + animation ---
  const endScreen = el(
    'div',
    'shell-end-screen is-hidden',
    `<div class="shell-end-screen__panel">
       <div class="shell-end-screen__message" id="shell-end-message"></div>
       <button class="shell-btn" id="shell-hub-btn" type="button">Return to <span class="shell-btn__brand">PUSULZ</span></button>
       <button class="shell-btn shell-btn--small is-hidden" id="shell-share-btn" type="button">Share Results</button>
     </div>`
  );
  stage.appendChild(endScreen);
  endScreen.querySelector('#shell-hub-btn').onclick = () => {
    showPageLoadingIndicator(); // shown proactively — see the back link's identical reasoning above
    window.location.href = hubPath; // full page navigation back to the hub
  };

  const shareBtn = endScreen.querySelector('#shell-share-btn');
  const SHARE_LABEL = 'Share Results';

  // `async function` means this function can use `await` inside it to pause
  // until a Promise resolves, and calling it always returns a Promise
  // itself. navigator.clipboard.writeText() is a browser API that returns
  // one (it's asynchronous because writing to the clipboard is a permission-
  // gated operation the browser may need to check first).
  //
  // This deliberately always copies to the clipboard rather than invoking
  // navigator.share() (the Web Share API, which hands off to the OS share
  // sheet) — handing off to the OS puts what happens next entirely in that
  // platform/app's hands: some show a normal compose screen you can edit
  // before sending (which is what this is going for), but others — notably
  // tapping a specific contact's "direct share" shortcut for WhatsApp on
  // some devices — send immediately with no chance to add anything.
  // Copying to the clipboard sidesteps that inconsistency entirely and
  // matches how NYT's Wordle-style share buttons work: paste into whatever
  // app/chat you want, add your own line, then send it yourself, the same
  // way every time.
  async function shareResults(shareText) {
    try {
      await navigator.clipboard.writeText(shareText);
      shareBtn.textContent = 'Copied to clipboard';
      setTimeout(() => { shareBtn.textContent = SHARE_LABEL; }, 1500);
    } catch {
      // Clipboard writes can be blocked (e.g. no user gesture, or the
      // browser denied the permission) — not a real error worth reporting,
      // so it's silently ignored.
    }
  }

  // Four different celebration "styles" built on the canvas-confetti
  // library (loaded via a <script> tag in each game's HTML — see
  // index.html's comment near that tag) — fireConfetti() below picks one at
  // random each time, so repeat wins don't all look identical.
  const CONFETTI_VARIATIONS = [
    // Two little "cannons" in the bottom corners, firing repeatedly toward
    // the middle for ~2s — a common canvas-confetti recipe for a
    // full-screen burst rather than a single small poof in one spot.
    function cannons() {
      const endTime = Date.now() + 2000;
      (function nextBurst() {
        window.confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
        window.confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
        if (Date.now() < endTime) requestAnimationFrame(nextBurst);
      })();
    },
    // Fireworks: individual bursts popping from random spots on the screen
    // over ~3s — more chaotic/celebratory than the two steady cannons.
    function fireworks() {
      const endTime = Date.now() + 3000;
      (function nextFirework() {
        window.confetti({
          particleCount: 90,
          spread: 360,
          startVelocity: 30,
          origin: { x: Math.random(), y: Math.random() * 0.5 },
        });
        if (Date.now() < endTime) setTimeout(nextFirework, 400 + Math.random() * 300);
      })();
    },
    // Same cannon shape as the first variation, but star-shaped particles
    // instead of paper confetti rectangles.
    function stars() {
      const endTime = Date.now() + 2000;
      const defaults = { shapes: ['star'], colors: ['#FFD700', '#FFA500', '#FF6347', '#EEE8AA'] };
      (function nextBurst() {
        window.confetti(Object.assign({}, defaults, { particleCount: 4, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } }));
        window.confetti(Object.assign({}, defaults, { particleCount: 4, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } }));
        if (Date.now() < endTime) requestAnimationFrame(nextBurst);
      })();
    },
    // A single burst using an emoji as the "confetti" shape instead of
    // paper/stars — confetti.shapeFromText() is a canvas-confetti helper
    // that rasterizes a text string (here, one emoji) into a reusable shape.
    function emoji() {
      const shape = window.confetti.shapeFromText({ text: '🎉', scalar: 3 });
      window.confetti({ shapes: [shape], particleCount: 40, spread: 100, startVelocity: 35, origin: { y: 0.6 }, scalar: 3 });
    },
  ];

  // `typeof window.confetti !== 'function'` is a defensive check, not
  // something expected to normally trigger — if the CDN script fails to
  // load (offline, blocked, etc.) this quietly does nothing rather than
  // throwing and breaking the actual win/loss logic around it.
  function fireConfetti() {
    if (typeof window.confetti !== 'function') return;
    const variation = CONFETTI_VARIATIONS[Math.floor(Math.random() * CONFETTI_VARIATIONS.length)];
    variation();
  }

  // The main function every game calls when a puzzle is solved, or when the
  // player returns to a game they already completed today. `animateTarget`
  // is an optional DOM element (e.g. the tile grid) to briefly pulse via
  // CSS animation, so the win feels a bit more alive than the message just
  // appearing. `celebrate` triggers the confetti burst above — games only
  // pass this on an actual fresh win, never when just redisplaying a result
  // the player already saw (e.g. reloading an already-completed day), and
  // MUVEEZ specifically leaves it off for a loss too.
  //
  // Position is plain CSS (shared/shell.css) — fixed a set distance above
  // the footer for every game, so the start banner and end screen land in
  // the exact same spot everywhere rather than depending on each game's own
  // board/grid/canvas size.
  // `score` is optional and should only be passed on an ACTUAL fresh win —
  // the same value the game just handed to submitScore() (see e.g.
  // games/solvz/index.js). Passing it stamps today's own score (via
  // saveTodayScore()) so the footer's "Today: ..." can show it even on a
  // day that didn't beat the best. Leave it out for a loss/give-up (no
  // submitScore() call either — see e.g. MUVEEZ's/QUADZ's loss paths) or
  // when just redisplaying an already-completed day's result (that day's
  // score was already stamped the first time it was won).
  function showEndScreen({ message, animateTarget, shareText, celebrate = false, score = null } = {}) {
    // .innerHTML (not .textContent) because game messages include <br> tags
    // for line breaks.
    endScreen.querySelector('#shell-end-message').innerHTML = message || '';
    endScreen.classList.remove('is-hidden');
    if (score !== null) saveTodayScore(gameId, score);
    refreshBestScore();
    if (celebrate) fireConfetti();

    shareBtn.textContent = SHARE_LABEL; // reset in case "Copied to clipboard" was still showing from a previous click
    if (shareText) {
      shareBtn.classList.remove('is-hidden');
      shareBtn.onclick = () => shareResults(shareText);
    } else {
      // Games aren't required to pass shareText — if they don't, the share
      // button just stays hidden for that screen.
      shareBtn.classList.add('is-hidden');
    }

    if (animateTarget) {
      animateTarget.classList.add('shell-end-animate');
      // Adds the CSS animation class, then removes it 900ms later (matching
      // the animation's own duration in shell.css) so the class is "clean"
      // and ready to re-trigger the animation again next time, rather than
      // permanently stuck on.
      setTimeout(() => animateTarget.classList.remove('shell-end-animate'), 900);
    }
  }

  // What initShell() actually hands back to the calling game. `status` lets
  // the game decide what to do (show the banner? resume in place? show the
  // end screen immediately?) — the banner itself stays hidden unless the
  // game explicitly calls showStartBanner(), which it should only do when
  // status.status === 'not-started' or 'in-progress'.
  return {
    status,
    showStartBanner,
    hideStartBanner,
    showEndScreen,
    refreshBestScore,
    // Only exposing `setSeconds` here (not the whole `timer` object) keeps
    // the returned API narrow — callers can update the timer, but can't
    // reach into its internals.
    timer: { setSeconds: timer.setSeconds },
  };
}

// Keeps the Service Worker from being terminated by the browser's own idle
// timeout (~30s of no fetch/message activity — standard Chrome/Safari
// resource-saving behavior) while a game is open. Reviving a terminated
// worker on the next fetch costs real time: confirmed via Chrome DevTools
// Protocol on 2026-08-18, ~1.2s just for the worker's own starting->running
// transition, before any of the hub's own boot work even begins — this is
// what makes "back to hub" feel especially slow after leaving a game idle
// for a while. See project_gamehub_back_button_delay memory for the full
// investigation (this addresses one of two confirmed causes — the other,
// a periodic browser-level GC pause during rapid continuous navigation,
// isn't something a page-side fix can address).
//
// Pings by fetching a tiny, already-precached file — genuine, ordinary
// Service Worker "fetch" event activity from the worker's own perspective,
// so it resets the idle timer the same way a real navigation would, with
// no changes needed to service-worker.js itself (its existing fetch
// handler already serves this instantly from the code cache). Resolved
// relative to THIS file's own location (same trick install-gate.js's
// siteUrl() uses for testers.json) rather than as a bare relative path —
// a bare 'shared/core/app-version.js' would resolve against the CALLING
// PAGE's URL instead (e.g. games/glympz/index.html), landing on
// games/glympz/shared/core/app-version.js, which doesn't exist. Confirmed
// via a live CDP test 2026-08-18: the bare-path version 404'd on every
// ping from inside a game page.
const PING_URL = new URL('./app-version.js', import.meta.url).href;

// Comfortably under the ~30s termination window, with margin for slower
// devices/timer drift, so the worker never actually goes idle long enough
// to be killed during ordinary play.
const PING_INTERVAL_MS = 20000;

function ping() {
  if (!('serviceWorker' in navigator)) return;
  fetch(PING_URL, { cache: 'default' }).catch(() => {});
}

// Call once per game page, right after requireStandalone() — same place
// every other shared/core boot helper is called from. Pauses while the tab
// is hidden/backgrounded (nothing to keep warm for a player who isn't
// looking at the screen, and mobile OSes throttle/suspend background
// timers anyway) and restarts fresh on return, rather than letting a stale
// interval fire immediately.
export function startServiceWorkerKeepAlive() {
  let timer = null;

  function start() {
    if (timer) return;
    timer = setInterval(ping, PING_INTERVAL_MS);
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  if (!document.hidden) start();
}

// Precaches the site's code (every HTML/CSS/JS/JSON file it needs to run)
// into an app-controlled cache, so every navigation/reload afterward is
// served instantly from here instead of depending on a real network
// round-trip. This is the actual fix for the "no spinning wheel during a
// real load" problem seen across the site: once nothing has to genuinely
// wait on the network, there's no gap left during which the browser
// withholds painting — see shared/core/update-gate.js for the client-side
// half of this (what shows a message and waits for this to finish before
// letting the hub continue).
//
// Deliberately does NOT precache games/glympz/images/* or
// games/muveez/images/* — 58MB combined, a genuinely long download that
// isn't needed just to fix the freeze (that's caused by CODE loading, not
// images) and would burn real cellular data for images a tester might not
// even see today. Those are cached opportunistically instead, the first
// time each one is actually requested — see the fetch handler below — into
// a SEPARATE, permanent cache that (unlike the code cache) is never cleared
// on a version bump, since curated movie stills never change once set.
//
// CACHE_VERSION must be bumped BY HAND every time site code changes, kept
// in sync with shared/core/app-version.js's APP_VERSION by convention only
// (this is a plain worker script, not an ES module, so it can't import that
// file). Bumping it changes this file's own bytes, which is what makes the
// browser notice a new version exists at all — that byte-for-byte diff is
// the actual trigger for reinstalling and re-precaching, not anything
// clever inside this file.
const CACHE_VERSION = 'v2.13';
const CODE_CACHE = `pusulz-code-${CACHE_VERSION}`;
const IMAGE_CACHE = 'pusulz-images'; // no version suffix — permanent, see comment above

// Generated from the actual repo file tree (excluding games/*/images/,
// tools/ — dev-only curation scripts never served to testers — and .git).
// Keep this in sync by hand when files are added/removed/renamed; a stale
// entry here just means that one file won't be precached (falls back to a
// normal network fetch, same as before this existed), not a broken build.
const CODE_URLS = [
  './',
  'apple-touch-icon.png',
  'favicon.ico',
  'games-registry.js',
  'icon-192.png',
  'icon-512.png',
  'index.html',
  'index.js',
  'manifest.json',
  'style.css',
  'testers.json',
  'welcome.css',
  'welcome.html',
  'welcome.js',

  'shared/beta-gate.css',
  'shared/core/app-version.js',
  'shared/core/beta-gate.js',
  'shared/core/daily-lock.js',
  'shared/core/date-utils.js',
  'shared/core/flip-timer.js',
  'shared/core/game-storage.js',
  'shared/core/loading-indicator.js',
  'shared/core/shell.js',
  'shared/core/tool-mode.js',
  'shared/core/tools-panel.js',
  'shared/core/update-gate.js',
  'shared/feedback.css',
  'shared/feedback.html',
  'shared/feedback.js',
  'shared/fonts/Quicksand-400.woff2',
  'shared/fonts/Quicksand-500.woff2',
  'shared/fonts/Quicksand-600.woff2',
  'shared/fonts/Quicksand-700.woff2',
  'shared/input/canvas-pointer.js',
  'shared/input/dom-tile-drag.js',
  'shared/shell.css',
  'shared/tokens.css',
  'shared/tools-panel.css',

  'games/glympz/index.html',
  'games/glympz/index.js',
  'games/glympz/manifest.json',
  'games/glympz/row-icon.js',
  'games/glympz/style.css',

  'games/jewelz/Bar.js',
  'games/jewelz/Jewel.js',
  'games/jewelz/bar-icon.js',
  'games/jewelz/index.html',
  'games/jewelz/index.js',
  'games/jewelz/jewel-icon.js',
  'games/jewelz/manifest.json',
  'games/jewelz/player-icon.js',
  'games/jewelz/style.css',

  'games/muveez/answers.js',
  'games/muveez/fuzzy-match.js',
  'games/muveez/icon.js',
  'games/muveez/index.html',
  'games/muveez/index.js',
  'games/muveez/manifest.json',
  'games/muveez/style.css',

  'games/quadz/index.html',
  'games/quadz/index.js',
  'games/quadz/manifest.json',
  'games/quadz/puzzles.js',
  'games/quadz/style.css',
  'games/quadz/tile-icon.js',
  'games/quadz/words.js',

  'games/rainz/Raindrop.js',
  'games/rainz/index.html',
  'games/rainz/index.js',
  'games/rainz/manifest.json',
  'games/rainz/raindrop-icon.js',
  'games/rainz/style.css',
  'games/rainz/umbrella-icon.js',
  'games/rainz/words.js',

  'games/slydz/index.html',
  'games/slydz/index.js',
  'games/slydz/manifest.json',
  'games/slydz/style.css',
  'games/slydz/tile-icon.js',
  'games/slydz/words.js',

  'games/solvz/index.html',
  'games/solvz/index.js',
  'games/solvz/manifest.json',
  'games/solvz/style.css',

  'games/warpz/Asteroid.js',
  'games/warpz/Cluster.js',
  'games/warpz/EnergyOrb.js',
  'games/warpz/Maze.js',
  'games/warpz/StarShard.js',
  'games/warpz/Starfield.js',
  'games/warpz/Station.js',
  'games/warpz/Worm.js',
  'games/warpz/Zapper.js',
  'games/warpz/asteroid-icon.js',
  'games/warpz/energy-orb-icon.js',
  'games/warpz/index.html',
  'games/warpz/index.js',
  'games/warpz/manifest.json',
  'games/warpz/player-icon.js',
  'games/warpz/sequences.json',
  'games/warpz/skull-icon.js',
  'games/warpz/solid-collision.js',
  'games/warpz/star-shard-icon.js',
  'games/warpz/style.css',
];

self.addEventListener('install', (event) => {
  // skipWaiting() so a newly-installed version takes over as soon as this
  // finishes, rather than sitting "waiting" until every open tab/instance of
  // the app is fully closed — update-gate.js is already what makes the
  // CURRENT page wait for this to genuinely finish before doing anything
  // that depends on it, so there's no risk of the swap happening underneath
  // unfinished work.
  event.waitUntil(
    caches.open(CODE_CACHE).then((cache) => cache.addAll(CODE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drops any OLDER version's code cache (this is what makes a version
      // bump actually free up the previous version's storage) — deliberately
      // never touches pusulz-images, which has no version suffix and is
      // meant to persist across every future update indefinitely.
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('pusulz-code-') && name !== CODE_CACHE).map((name) => caches.delete(name))
      );
      // clients.claim() lets this worker start controlling the page that's
      // ALREADY open right now (the one that triggered this install), not
      // just future ones — without this, the very first visit that installs
      // this worker wouldn't actually benefit from it until a second visit.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin CDN requests (jQuery, confetti) pass through untouched

  if (/\/games\/(glympz|muveez)\/images\//.test(url.pathname)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // ignoreSearch: true — reloadWithSpinner() (see loading-indicator.js)
  // reloads via a `?_r=...` cache-busting query param specifically to force
  // a fresh-looking navigation; without this option that'd be treated as a
  // totally different URL from the precached entry and always miss the
  // cache, silently defeating the point of this for every "Reset" button.
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req)));
});

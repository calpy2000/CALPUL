// Registers the site's service worker (see ../../service-worker.js) and, if
// it needs to install/update, adds a message to the already-visible
// #pageLoading spinner and waits for that install to genuinely finish before
// resolving — see service-worker.js's own comment for the full reasoning
// (this is what makes every later navigation/reload/fetch on the site
// instant instead of a real network wait, which is what was causing pages
// to show no spinner during a real load).
//
// Call once, as close to the top of the hub's own index.js as possible —
// BEFORE hidePageLoadingIndicator() (so there's still something on screen to
// attach the message to) and BEFORE initBetaGate() specifically, since the
// beta gate's own testers.json fetch needs this cache to already be in
// place, or a brand-new install is still exposed to the exact freeze this
// exists to prevent. Hub-only: no game page needs this, since a tester
// always reaches a game BY WAY OF the hub first.
export async function ensureAppReady() {
  if (!('serviceWorker' in navigator)) return; // unsupported browser — proceed on plain network requests, same as before this existed

  let reg;
  try {
    // updateViaCache: 'none' — belt and suspenders against GitHub Pages'
    // own Cache-Control on service-worker.js (currently max-age=600):
    // browsers are already supposed to bypass HTTP caching for the main SW
    // script by default, but this makes it explicit rather than leaning on
    // every browser getting that spec detail right.
    reg = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
  } catch {
    return; // e.g. no HTTPS in a local dev environment — proceed rather than block the whole app on this
  }

  await checkAndWait(reg);
}

// Same idea as ensureAppReady(), but for later in the session — right
// before a hub tile navigates to a game — rather than only at the hub's own
// initial load. A tester who leaves the hub open for a while (never doing a
// fresh reopen) previously wouldn't pick up a new version until their next
// cold start, and even then it was a race (see below). Call this AFTER
// showing the spinner and yielding for a real paint, and BEFORE navigating.
export async function checkForUpdateBeforeNavigate() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!reg) return;
  await checkAndWait(reg);
}

// Shared by both entry points above. reg.update() forces a genuine,
// immediate network check of service-worker.js's bytes rather than relying
// on the browser's own internal timing for when it gets around to noticing
// a change — awaiting it (rather than only inspecting reg.installing /
// reg.waiting the instant register() resolves, which is what this code used
// to do) is what closes the actual race: that browser-internal check is its
// own async network round-trip, so reg.installing/waiting can still both be
// undefined at the exact moment register() resolves even when a genuine
// update exists, simply because the byte-compare hasn't finished yet. That
// race is why picking up a new version used to take 2-3 app restarts rather
// than being reliable on the first one.
async function checkAndWait(reg) {
  await reg.update().catch(() => {}); // e.g. offline — fall through to whatever's already installed

  // installing/waiting only has a value when there's a NEW version that
  // hasn't taken over yet — on every normal check where nothing changed,
  // this is undefined and the function just returns immediately.
  const worker = reg.installing || reg.waiting;
  if (!worker) return;

  addReadyMessage();
  await new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve();
    });
  });
}

function addReadyMessage() {
  const el = document.getElementById('pageLoading');
  if (!el || el.querySelector('.page-loading__message')) return;
  const msg = document.createElement('p');
  msg.className = 'page-loading__message';
  msg.textContent = "Loading updated game files — this'll only take a moment";
  el.appendChild(msg);
}

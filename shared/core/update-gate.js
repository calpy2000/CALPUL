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

  await checkForUpdate(reg);
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
  await checkForUpdate(reg);
}

// Real device testing (2026-08-08) showed reg.update()'s own network
// round-trip — NOT just the rare "genuinely found an update" case — can
// itself take several seconds on a slow connection, on EVERY hub load and
// EVERY tile tap. That's the actual cost this throttle exists to cut down:
// sessionStorage (rather than localStorage) is the deliberate choice here —
// it survives ordinary in-app navigation (hub -> game -> back -> hub is all
// still the same browsing session, so a tester bouncing between games only
// pays this once per hour of continuous play) but is cleared the moment the
// app is genuinely closed and reopened, so a fresh session always checks
// immediately rather than possibly serving a stale version for up to an
// hour after a real restart. That combination is what makes "push at least
// an hour apart, then close/reopen to verify" a reliable manual test
// recipe: the very next fresh session after a push is guaranteed to check.
const LAST_CHECK_KEY = 'pusulz-last-update-check';
const CHECK_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

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
async function checkForUpdate(reg) {
  if (recentlyChecked()) return; // already confirmed current within the last hour this session — trust it and skip the network round-trip entirely
  markChecked();

  // Shown unconditionally, the moment a real (non-throttled) check begins —
  // not only once an update is confirmed found. Since the check itself can
  // be the slow part regardless of outcome, the spinner needs SOME message
  // covering that wait, not just the "found something, downloading it" case
  // below. Same sentence shape/wording as that message on purpose, so the
  // two read as one continuous thought if this one gets replaced by it.
  setLoadingMessage("Checking for game file updates — this'll only take a moment");
  await reg.update().catch(() => {}); // e.g. offline — fall through to whatever's already installed

  // installing/waiting only has a value when there's a NEW version that
  // hasn't taken over yet — on every normal check where nothing changed,
  // this is undefined and the function just returns immediately (leaving
  // the "Checking..." message as the last thing shown, which is accurate —
  // nothing further is happening — and about to be removed by whichever
  // caller's own hidePageLoadingIndicator()/navigation follows anyway).
  const worker = reg.installing || reg.waiting;
  if (!worker) return;

  setLoadingMessage("Loading updated game files — this'll only take a moment");
  await new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated' || worker.state === 'redundant') resolve();
    });
  });
}

// sessionStorage access is wrapped in try/catch — some private-browsing
// modes throw on read/write rather than just no-opping. Failing OPEN (i.e.
// treating storage errors as "not recently checked") just means this
// device checks every time, same as every device did before this throttle
// existed — never failing toward silently skipping a real update check.
function recentlyChecked() {
  try {
    const last = Number(sessionStorage.getItem(LAST_CHECK_KEY) || 0);
    return Date.now() - last < CHECK_THROTTLE_MS;
  } catch {
    return false;
  }
}

function markChecked() {
  try {
    sessionStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // ignore — worst case this device just checks every time
  }
}

// Shared by both messages above — reuses the same paragraph across both
// stages of a single check (rather than addReadyMessage()'s old
// add-once-and-never-touch-again behavior) so a check that upgrades from
// "checking" to "a real update was found" reads as one line updating in
// place, not a second line appearing alongside the first.
function setLoadingMessage(text) {
  const el = document.getElementById('pageLoading');
  if (!el) return;
  let msg = el.querySelector('.page-loading__message');
  if (!msg) {
    msg = document.createElement('p');
    msg.className = 'page-loading__message';
    el.appendChild(msg);
  }
  msg.textContent = text;
}

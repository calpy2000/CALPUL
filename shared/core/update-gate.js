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
    reg = await navigator.serviceWorker.register('service-worker.js');
  } catch {
    return; // e.g. no HTTPS in a local dev environment — proceed rather than block the whole app on this
  }

  // installing/waiting only has a value when there's a NEW version that
  // hasn't taken over yet — on every normal return visit (already installed,
  // already active) this is undefined and the function just returns
  // immediately, which is the common case after the very first visit.
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
  msg.textContent = "Getting things ready — this'll only take a moment";
  el.appendChild(msg);
}

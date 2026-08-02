// Dismisses the page-load spinner (see each page's own inline <style> block
// in its <head> for the actual visual + its 200ms-before-appearing delay —
// that part is pure CSS on purpose, so it's in effect from first paint,
// before this module has even loaded).
//
// Call this ONCE, as the very first statement in a page's own index.js,
// right after its import block and before anything else runs. Thanks to
// how ES modules work, a script's top-level code doesn't start running
// until every file it imports has already been fetched and evaluated — so
// "the first statement in index.js" is naturally "the moment this page's
// whole JS module graph has finished loading," which is exactly the gap
// the spinner exists to cover. Everything after this call (fetching JSON,
// building DOM, starting a game loop) either finishes fast enough not to
// need its own indicator, or reaches for showPageLoadingIndicator() below
// (e.g. the hub's beta gate, while validating a typed code) instead of
// building its own separate loading visual — one spinner, always shown the
// same way, everywhere on the site.
export function hidePageLoadingIndicator() {
  const el = document.getElementById('pageLoading');
  if (el) el.remove();
}

// Re-shows the same full-page centered spinner for a LATER wait that isn't
// the initial page load (hidePageLoadingIndicator() above already removed
// the original element from the DOM by this point) — rebuilds it fresh
// rather than trying to un-remove the old one. Relies on the page's own
// inline .page-loading/.page-loading__spinner rules already being present
// in <head> (every page that has a page-load spinner at all defines these),
// so this only needs to recreate the matching markup, not any CSS. Safe to
// call again while already showing (e.g. a double-tap) — it just no-ops.
export function showPageLoadingIndicator() {
  if (document.getElementById('pageLoading')) return;
  const el = document.createElement('div');
  el.className = 'page-loading';
  el.id = 'pageLoading';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="page-loading__spinner"></div>';
  document.body.appendChild(el);
}

// Use this instead of a plain `window.location.href = url` (or a plain
// `<a href>` with no click handler at all) for any navigation that isn't
// ALREADY buffered by a real delay of its own (contrast: the dev/tester
// tools' reset-then-reload flow already waits 500ms before reloading, which
// is plenty of time for a real paint — this helper isn't needed there).
//
// Just calling showPageLoadingIndicator() and then immediately navigating
// is NOT enough on its own: adding a DOM node doesn't guarantee the browser
// actually renders a frame showing it before navigation begins — a
// same-tick DOM change right before the page starts unloading can be
// skipped entirely, with zero visible frames in between, which is exactly
// what an instant link tap (hub tile, header "back", "Return to PUSULZ")
// does. The two nested requestAnimationFrame calls force a real paint to
// happen first: the outer one fires at the start of the NEXT frame (so the
// spinner's insertion is at least scheduled for that frame's render), and
// scheduling the actual navigation inside a SECOND, nested rAF guarantees
// we're now past a frame that has actually been painted, not just queued —
// the standard "wait for a real paint" pattern for exactly this class of
// bug. Only after that does it navigate, by which point the spinner is
// genuinely on screen and (being the current page's last-painted content)
// stays there for the whole transition, regardless of how long the
// destination page takes to load.
export function navigateWithSpinner(url) {
  showPageLoadingIndicator();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // A small extra setTimeout on top of the double-rAF above — belt and
      // suspenders. Confirmed via a real forced-slow-navigation test (real
      // 3s network delay, screencast-captured frame by frame) that the
      // double-rAF alone reliably works in Chromium. Real on-device testing
      // on iOS Safari/standalone-PWA (the exact case this hedge was
      // originally written to guard against without being able to verify)
      // showed the spinner NOT appearing at all — so this was bumped from
      // 30ms to 100ms, since WebKit's rAF-to-actual-compositor-flush timing
      // is evidently looser than Chromium's and 30ms wasn't enough margin.
      // Still cheap and imperceptible as a one-time per-navigation delay.
      setTimeout(() => {
        window.location.href = url;
      }, 100);
    });
  });
}

// Use this instead of a plain window.location.reload() for the dev/tester
// tools' "reset" actions. A true reload() appears to behave differently
// from navigating to a URL (even the SAME url): where a normal navigation
// keeps the current page's last-painted frame on screen until the next
// page is ready (see navigateWithSpinner() above), reload() seems to blank
// the screen to a plain white background first, then fetch/parse/paint the
// page from scratch — a real white flash before the spinner ever gets a
// chance to show, confirmed on a real device. Navigating to the exact same
// URL plus a harmless, unique query param (rather than calling reload()
// itself) makes the browser treat this as an ordinary cross-page
// navigation instead, which is the code path that doesn't have that flash.
// The extra param is stripped from the address bar the moment the reloaded
// page's own script runs (see hidePageLoadingIndicator() usage sites — this
// stripping happens once, right alongside it), so it never lingers or ends
// up in a bookmark/share.
export function reloadWithSpinner() {
  showPageLoadingIndicator();
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Math.random()).slice(2));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Same extra setTimeout hedge as navigateWithSpinner() above — see
      // its own comment for why this is 100ms rather than the original 30ms.
      setTimeout(() => {
        window.location.href = url.toString();
      }, 100);
    });
  });
}

// Strips the `_r=...` cache-busting param reloadWithSpinner() adds, via
// history.replaceState (no new navigation/reload of its own). Call once,
// early in a page's own index.js — safe to call even when the param isn't
// present (no-ops).
export function stripReloadParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('_r')) return;
  url.searchParams.delete('_r');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

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

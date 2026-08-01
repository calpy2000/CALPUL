// Dismisses the page-load spinner (see tokens.css's own .page-loading rules
// for the actual visual + its 200ms-before-appearing delay — that part is
// pure CSS on purpose, so it's in effect from first paint, before this
// module has even loaded).
//
// Call this ONCE, as the very first statement in a page's own index.js,
// right after its import block and before anything else runs. Thanks to
// how ES modules work, a script's top-level code doesn't start running
// until every file it imports has already been fetched and evaluated — so
// "the first statement in index.js" is naturally "the moment this page's
// whole JS module graph has finished loading," which is exactly the gap
// the spinner exists to cover. Everything after this call (fetching JSON,
// building DOM, starting a game loop) either finishes fast enough not to
// need its own indicator, or is genuinely interactive (e.g. the hub's beta
// gate waiting on a typed code) rather than a load the spinner should
// keep covering.
export function hidePageLoadingIndicator() {
  const el = document.getElementById('pageLoading');
  if (el) el.remove();
}

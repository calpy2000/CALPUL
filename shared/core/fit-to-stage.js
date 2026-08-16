// Shrinks a game's own content block to guarantee it fits within its
// #game-stage box, so it never overflows into the footer or gets covered by
// the shell-overlay/shell-end-screen panel (both position:absolute against
// the stage — see shared/shell.css). Built for VALUZ/MOJEEZ, whose content
// is intrinsic-height (grows to fit real question/clue text) rather than
// aspect-ratio-bound like most other games — see each of those games' own
// style.css header comment. Call once after initShell() has built the real
// header/footer (stage.clientHeight isn't meaningful before that), and keep
// watching resize/orientation changes afterward.
//
// Rather than measuring the overlay/end-screen panel's real height (both are
// hidden most of the time, and rendering one just to measure it adds a
// round-trip), a fixed budget is reserved for "whichever panel might show" —
// both are a single row of ~15px text with modest padding, so their real
// heights land in a narrow, predictable range. The budget is intentionally
// on the generous side (better to shrink content a little more than needed
// than to leave a panel clipping content underneath it).
const PANEL_RESERVE_PX = 64;
const GAP_PX = 10;
const MIN_SCALE = 0.75;
const STEP = 0.02;

// contentEl's own CSS must read a `--fit-scale` custom property (defaulting
// to 1) into every size that should shrink — font-size, padding, gap — via
// calc(base * var(--fit-scale, 1)). This function only ever sets that one
// property; it doesn't know or care what CSS is actually scaling.
function fitContentToStage(stageEl, contentEl) {
  const stageH = stageEl.clientHeight;
  const budget = stageH - PANEL_RESERVE_PX - GAP_PX;

  let scale = 1;
  contentEl.style.setProperty('--fit-scale', scale);
  if (budget <= 0) return scale; // pathologically tiny stage — nothing sane to do, leave at full size

  let contentH = contentEl.scrollHeight;
  while (contentH > budget && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, +(scale - STEP).toFixed(2));
    contentEl.style.setProperty('--fit-scale', scale);
    contentH = contentEl.scrollHeight;
  }
  return scale;
}

// Runs the fit immediately, then re-runs on resize/orientation change
// (debounced) so rotating the device or a short desktop window re-measures
// against the real, current stage size rather than the one at page load.
export function watchFitToStage(stageEl, contentEl) {
  const run = () => fitContentToStage(stageEl, contentEl);
  run();
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(run, 120);
  });
  return run;
}

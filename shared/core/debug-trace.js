// TEMPORARY — diagnostic trace for the beta-gate freeze investigation.
// Writes each checkpoint to localStorage (synchronous, needs no paint to
// "work") rather than showing anything live on screen — if the page really
// isn't painting during the freeze, a live overlay would suffer the exact
// same invisibility problem we're trying to diagnose. Reading the trace
// back happens on the NEXT successful page load instead (see
// showTraceIfPresent() below, called from index.js), which we know paints
// fine — that's exactly what already happens when refreshing after a freeze.
// REMOVE this file and its call sites once the investigation is resolved.
const KEY = 'pusulz_debug_trace';

export function logTrace(label) {
  let entries;
  try {
    entries = JSON.parse(localStorage.getItem(KEY)) || [];
  } catch {
    entries = [];
  }
  entries.push({ label, t: Math.round(performance.now()) });
  localStorage.setItem(KEY, JSON.stringify(entries));
}

export function clearTrace() {
  localStorage.removeItem(KEY);
}

// Call once, as early as possible in the hub's own index.js — if a PRIOR
// page load left a trace behind (i.e. this load is the "refresh after a
// freeze" load), shows it full-screen with a Continue button instead of
// silently proceeding into the normal hub. No-ops (returns false) if
// there's no leftover trace, which is the normal case on every ordinary
// visit.
export function showTraceIfPresent() {
  let entries;
  try {
    entries = JSON.parse(localStorage.getItem(KEY));
  } catch {
    entries = null;
  }
  if (!entries || !entries.length) return false;

  const lines = [`=== Trace from previous (frozen) load — ${entries.length} events ===`, ''];
  let prev = null;
  entries.forEach((e) => {
    const delta = prev == null ? '' : `  (+${e.t - prev}ms)`;
    lines.push(`${e.t}ms  ${e.label}${delta}`);
    prev = e.t;
  });

  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:999999;background:#0a0a0a;color:#3f3;' +
    'font:12px/1.6 ui-monospace,monospace;padding:14px;padding-bottom:70px;' +
    'overflow:auto;white-space:pre-wrap;-webkit-overflow-scrolling:touch;';
  overlay.textContent = lines.join('\n');

  const btn = document.createElement('button');
  btn.textContent = 'Continue →';
  btn.type = 'button';
  btn.style.cssText =
    'position:fixed;bottom:14px;right:14px;z-index:1000000;padding:12px 20px;' +
    'font-size:15px;border-radius:8px;border:none;background:#3d5af1;color:#fff;';

  return new Promise((resolve) => {
    btn.addEventListener('click', () => {
      overlay.remove();
      btn.remove();
      clearTrace();
      resolve(true);
    });
    document.body.appendChild(overlay);
    document.body.appendChild(btn);
  });
}

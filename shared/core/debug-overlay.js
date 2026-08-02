// TEMPORARY — diagnostic overlay for the missing-spinner investigation. Shows
// real load timing (Paint Timing API + Resource Timing API) on screen so it
// can be read/screenshotted on a real device with no devtools access, rather
// than flashing past before anyone can see it. Doesn't auto-dismiss — stays
// up until the "Continue" button is tapped, so there's no rush to screenshot
// it in time. REMOVE this file and its call sites once the investigation
// (why some pages show no spinner during a real load) is resolved.
//
// Call this AT THE POINT hidePageLoadingIndicator() would normally be
// called (i.e. once the page's own JS module graph has finished loading) —
// it captures a snapshot of everything the browser has loaded UP TO that
// moment, which is exactly the window during which the spinner should have
// been visible. Returns a Promise that resolves once "Continue" is tapped;
// await it, then proceed with the page's own normal hidePageLoadingIndicator()
// call.
export function showDebugOverlay(label) {
  return new Promise((resolve) => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint');
    const resources = performance
      .getEntriesByType('resource')
      .filter((r) => /\.(css|js|json)(\?|$)/.test(r.name))
      .sort((a, b) => a.startTime - b.startTime);

    const fmt = (n) => (n == null ? 'n/a' : Math.round(n) + 'ms');
    const fp = paints.find((p) => p.name === 'first-paint');
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');

    const lines = [];
    lines.push(`=== ${label} ===`);
    lines.push(`domContentLoaded: ${fmt(nav?.domContentLoadedEventEnd)}`);
    lines.push(`loadEvent: ${fmt(nav?.loadEventEnd)}`);
    lines.push(`first-paint: ${fp ? fmt(fp.startTime) : 'NEVER FIRED'}`);
    lines.push(`first-contentful-paint: ${fcp ? fmt(fcp.startTime) : 'NEVER FIRED'}`);
    lines.push('');
    lines.push(`resources (${resources.length}) — start→end  size  file:`);
    resources.forEach((r) => {
      const short = r.name.replace(location.origin, '').split('?')[0];
      const cached = r.transferSize === 0 && r.decodedBodySize > 0 ? '  [from cache]' : '';
      lines.push(`${fmt(r.startTime)}→${fmt(r.responseEnd)}  ${r.transferSize}B  ${short}${cached}`);
    });

    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:#0a0a0a;color:#3f3;' +
      'font:11px/1.5 ui-monospace,monospace;padding:14px;padding-bottom:70px;' +
      'overflow:auto;white-space:pre-wrap;-webkit-overflow-scrolling:touch;';
    overlay.textContent = lines.join('\n');

    const btn = document.createElement('button');
    btn.textContent = 'Continue →';
    btn.type = 'button';
    btn.style.cssText =
      'position:fixed;bottom:14px;right:14px;z-index:1000000;padding:12px 20px;' +
      'font-size:15px;border-radius:8px;border:none;background:#3d5af1;color:#fff;';
    btn.addEventListener('click', () => {
      overlay.remove();
      btn.remove();
      resolve();
    });

    document.body.appendChild(overlay);
    document.body.appendChild(btn);
  });
}

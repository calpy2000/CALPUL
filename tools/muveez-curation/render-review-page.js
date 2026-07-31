// Renders the current candidate (preview.jpg + pending-review.json) into a
// single self-contained HTML page for Artifact to publish — a fallback for
// when inline chat images (via the Read tool) don't render reliably in the
// user's client. The image is embedded as a base64 data URI so the page
// works with no external requests at all.
//
// Usage: node render-review-page.js <output-html-path>

const fs = require('fs');
const path = require('path');

const CANDIDATES_PATH = path.join(__dirname, 'candidates.json');
const PENDING_REVIEW_PATH = path.join(__dirname, 'pending-review.json');
const PREVIEW_PATH = path.join(__dirname, 'preview.jpg');

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error('Usage: node render-review-page.js <output-html-path>');
    process.exit(1);
  }

  const pending = JSON.parse(fs.readFileSync(PENDING_REVIEW_PATH, 'utf8'));
  const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  const total = data.candidates.length;
  const added = data.candidates.filter((c) => c.status === 'added').length;
  const skipped = data.candidates.filter((c) => c.status === 'skipped').length;
  const remaining = total - added - skipped;

  const imageB64 = fs.readFileSync(PREVIEW_PATH).toString('base64');

  const html = `<title>MUVEEZ curation — ${escapeHtml(pending.title)}</title>
<style>
  :root {
    --bg: #12151b;
    --surface: #1b1f28;
    --surface-2: #20242e;
    --border: #2a2f3a;
    --ink: #eceef2;
    --muted: #8b93a3;
    --gold: #c9a15a;
    --gold-dim: #8a7038;
    --added: #6fae8c;
    --skipped: #b3735a;
  }
  :root[data-theme="light"] {
    --bg: #f2ede2;
    --surface: #ffffff;
    --surface-2: #f7f3ea;
    --border: #ddd3bd;
    --ink: #1c1a14;
    --muted: #6b6455;
    --gold: #a67c2e;
    --gold-dim: #c9a15a;
    --added: #3f7a5c;
    --skipped: #9a4f34;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {
      --bg: #f2ede2;
      --surface: #ffffff;
      --surface-2: #f7f3ea;
      --border: #ddd3bd;
      --ink: #1c1a14;
      --muted: #6b6455;
      --gold: #a67c2e;
      --gold-dim: #c9a15a;
      --added: #3f7a5c;
      --skipped: #9a4f34;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 20px;
    background: var(--bg);
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .card {
    width: 100%;
    max-width: 520px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.35);
  }
  .eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--gold);
    text-align: center;
  }
  .frame {
    border: 1px solid var(--gold-dim);
    border-radius: 10px;
    padding: 6px;
    background: var(--surface-2);
  }
  .frame img {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    object-fit: cover;
    border-radius: 6px;
  }
  h1 {
    margin: 0;
    text-align: center;
    font-family: Georgia, "Iowan Old Style", "Times New Roman", serif;
    font-weight: 700;
    font-size: clamp(24px, 6vw, 32px);
    letter-spacing: 0.01em;
    text-wrap: balance;
  }
  .meta {
    text-align: center;
    color: var(--muted);
    font-size: 14px;
    margin-top: -12px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
  .stat {
    text-align: center;
    padding: 10px 6px;
    background: var(--surface-2);
    border-radius: 8px;
  }
  .stat .n {
    display: block;
    font-size: 20px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stat .l {
    display: block;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-top: 2px;
  }
  .stat.added .n { color: var(--added); }
  .stat.skipped .n { color: var(--skipped); }
  .instruction {
    text-align: center;
    font-size: 14px;
    color: var(--muted);
    line-height: 1.5;
  }
  .instruction strong { color: var(--ink); }
  .credit {
    text-align: center;
    font-size: 11px;
    color: var(--muted);
    opacity: 0.7;
  }
</style>
<div class="card">
  <div class="eyebrow">MUVEEZ &middot; Image Curation</div>
  <div class="frame">
    <img src="data:image/jpeg;base64,${imageB64}" alt="Candidate still" />
  </div>
  <div>
    <h1>${escapeHtml(pending.title)}</h1>
    <div class="meta">${pending.year} &middot; candidate ${pending.index + 1} of ${total}</div>
  </div>
  <div class="stats">
    <div class="stat added"><span class="n">${added}</span><span class="l">Added</span></div>
    <div class="stat skipped"><span class="n">${skipped}</span><span class="l">Skipped</span></div>
    <div class="stat"><span class="n">${remaining}</span><span class="l">Remaining</span></div>
  </div>
  <div class="instruction">Back in your conversation with Claude, reply <strong>add</strong> or <strong>skip</strong> for this one.</div>
  <div class="credit">Image via TMDb</div>
</div>
`;

  fs.writeFileSync(outPath, html);
  console.log('Wrote', outPath);
}

main();

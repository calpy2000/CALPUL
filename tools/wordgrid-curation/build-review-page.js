// Builds a self-contained static HTML review page from selected-366.json —
// one card per puzzle showing its 4x4 letter grid plus the 8 words, so the
// words can be scanned for commonness. No external assets (fonts, scripts)
// since this is meant to be published as a Claude Artifact, which blocks
// all outbound requests.

const fs = require('fs');
const path = require('path');

const sourceFile = process.argv[2] || 'selected-366-spaced.json';
const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, sourceFile), 'utf8'));

const html = `<!doctype html>
<title>WYRDGRID — 366 Candidate Puzzles</title>
<style>
  :root {
    --bg: #eef1ef;
    --bg-grid-line: #dfe4e1;
    --panel: #ffffff;
    --ink: #1b2420;
    --ink-dim: #5b665f;
    --border: #d3dad6;
    --accent: #2f6f6b;
    --accent-contrast: #ffffff;
    --flagged: #b45309;
    --flagged-bg: #fef3e2;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14191a;
      --bg-grid-line: #1d2426;
      --panel: #1b2224;
      --ink: #e8ede9;
      --ink-dim: #93a099;
      --border: #2b3436;
      --accent: #5fb3ac;
      --accent-contrast: #0d1a19;
      --flagged: #f0a75a;
      --flagged-bg: #3a2c17;
    }
  }
  :root[data-theme="dark"] {
    --bg: #14191a; --bg-grid-line: #1d2426; --panel: #1b2224; --ink: #e8ede9;
    --ink-dim: #93a099; --border: #2b3436; --accent: #5fb3ac; --accent-contrast: #0d1a19;
    --flagged: #f0a75a; --flagged-bg: #3a2c17;
  }
  :root[data-theme="light"] {
    --bg: #eef1ef; --bg-grid-line: #dfe4e1; --panel: #ffffff; --ink: #1b2420;
    --ink-dim: #5b665f; --border: #d3dad6; --accent: #2f6f6b; --accent-contrast: #ffffff;
    --flagged: #b45309; --flagged-bg: #fef3e2;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      linear-gradient(var(--bg-grid-line) 1px, transparent 1px) 0 0 / 100% 32px,
      linear-gradient(90deg, var(--bg-grid-line) 1px, transparent 1px) 0 0 / 32px 100%,
      var(--bg);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 20px 24px;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
    letter-spacing: 0.01em;
  }
  h1 .mono-accent {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    color: var(--accent);
  }
  .subtitle {
    margin: 0 0 14px;
    color: var(--ink-dim);
    font-size: 14px;
    max-width: 68ch;
  }
  .controls {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }
  #search {
    flex: 1 1 240px;
    max-width: 360px;
    padding: 9px 12px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg);
    color: var(--ink);
    font-size: 14px;
  }
  #search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  #count {
    font-size: 13px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  main {
    padding: 20px 24px 64px;
  }
  #grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 14px;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .day {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    font-weight: 600;
    font-size: 13px;
    color: var(--ink-dim);
  }
  .rank {
    font-size: 11px;
    color: var(--ink-dim);
    font-variant-numeric: tabular-nums;
  }

  .letter-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    aspect-ratio: 1;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
  }
  .letter-grid .cell {
    background: var(--panel);
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    font-weight: 600;
    font-size: 15px;
  }

  .words {
    font-size: 12px;
    line-height: 1.6;
    color: var(--ink-dim);
  }
  .words b { color: var(--ink); font-weight: 600; letter-spacing: 0.02em; }
  .words .row-words, .words .col-words { display: block; }
  .word-tag {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
  }

  .card.is-hidden { display: none; }

  footer {
    padding: 24px;
    color: var(--ink-dim);
    font-size: 12px;
    max-width: 68ch;
  }
</style>

<header>
  <h1><span class="mono-accent">WYRDGRID</span> — 366 candidate puzzles</h1>
  <p class="subtitle">
    Each card is one day's 4×4 grid: 4 across words (rows) and 4 down words
    (columns), all 8 distinct. Sourced from a common-word frequency list
    cross-checked against a real curated dictionary (SCOWL, the word list
    behind most spell-checkers) — no proper nouns, no profanity, no
    abbreviations. No word repeats within 7 days of itself, and no word is
    used more than 20 times across all 366 days.
  </p>
  <div class="controls">
    <input id="search" type="text" placeholder="Filter by day number or word…" autocomplete="off" />
    <span id="count"></span>
  </div>
</header>

<main>
  <div id="grid"></div>
</main>

<footer>
  Generated from a common-word-frequency list intersected with a real
  English dictionary and a proper-noun blocklist, scheduled onto days 1–366
  so no word reappears within 7 days of its last use and no word is used
  more than 20 times total, preferring the most universally common words
  where the schedule allows.
</footer>

<script>
  const PUZZLES = ${JSON.stringify(puzzles)};

  const gridEl = document.getElementById('grid');
  const searchEl = document.getElementById('search');
  const countEl = document.getElementById('count');

  function cardHTML(p) {
    const letters = p.rows.join('').split('');
    const cells = letters.map((ch) => \`<div class="cell">\${ch}</div>\`).join('');
    return \`
      <div class="card" data-day="\${p.day}" data-words="\${[...p.rows, ...p.cols].join(' ')}">
        <div class="card-head">
          <span class="day">Day \${p.day}</span>
          <span class="rank">rank \${p.worstRank}</span>
        </div>
        <div class="letter-grid">\${cells}</div>
        <div class="words">
          <span class="row-words"><b>Across:</b> <span class="word-tag">\${p.rows.join(' · ')}</span></span>
          <span class="col-words"><b>Down:</b> <span class="word-tag">\${p.cols.join(' · ')}</span></span>
        </div>
      </div>
    \`;
  }

  gridEl.innerHTML = PUZZLES.map(cardHTML).join('');
  const cardEls = [...gridEl.children];

  function applyFilter() {
    const q = searchEl.value.trim().toUpperCase();
    let shown = 0;
    cardEls.forEach((el, i) => {
      const p = PUZZLES[i];
      const matches = !q || String(p.day) === q || el.dataset.words.includes(q);
      el.classList.toggle('is-hidden', !matches);
      if (matches) shown++;
    });
    countEl.textContent = q ? \`\${shown} / \${PUZZLES.length} shown\` : \`\${PUZZLES.length} puzzles\`;
  }

  searchEl.addEventListener('input', applyFilter);
  applyFilter();
</script>
`;

fs.writeFileSync(path.join(__dirname, 'review-366.html'), html);
console.log(`Wrote review-366.html (${puzzles.length} puzzles)`);

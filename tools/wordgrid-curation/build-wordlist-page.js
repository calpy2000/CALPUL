// Builds a self-contained static HTML page listing every distinct word
// used across the 366 selected puzzles, alphabetically, grouped by first
// letter — a simpler companion view to review-366.html for scanning the
// whole vocabulary at once rather than grid-by-grid.

const fs = require('fs');
const path = require('path');

const puzzles = JSON.parse(fs.readFileSync(path.join(__dirname, 'selected-366-final.json'), 'utf8'));
const wordSet = new Set();
puzzles.forEach((p) => [...p.rows, ...p.cols].forEach((w) => wordSet.add(w)));
const words = [...wordSet].sort();

const groups = new Map();
words.forEach((w) => {
  const letter = w[0];
  if (!groups.has(letter)) groups.set(letter, []);
  groups.get(letter).push(w);
});

const html = `<!doctype html>
<title>WYRDGRID — Word List (${words.length})</title>
<style>
  :root {
    --bg: #eef1ef; --bg-grid-line: #dfe4e1; --panel: #ffffff; --ink: #1b2420;
    --ink-dim: #5b665f; --border: #d3dad6; --accent: #2f6f6b; --accent-contrast: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14191a; --bg-grid-line: #1d2426; --panel: #1b2224; --ink: #e8ede9;
      --ink-dim: #93a099; --border: #2b3436; --accent: #5fb3ac; --accent-contrast: #0d1a19; }
  }
  :root[data-theme="dark"] { --bg: #14191a; --bg-grid-line: #1d2426; --panel: #1b2224; --ink: #e8ede9;
    --ink-dim: #93a099; --border: #2b3436; --accent: #5fb3ac; --accent-contrast: #0d1a19; }
  :root[data-theme="light"] { --bg: #eef1ef; --bg-grid-line: #dfe4e1; --panel: #ffffff; --ink: #1b2420;
    --ink-dim: #5b665f; --border: #d3dad6; --accent: #2f6f6b; --accent-contrast: #ffffff; }

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
    position: sticky; top: 0; z-index: 5;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 20px 24px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  h1 .mono-accent { font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace; color: var(--accent); }
  .subtitle { margin: 0 0 14px; color: var(--ink-dim); font-size: 14px; max-width: 68ch; }
  #search {
    width: 100%; max-width: 360px;
    padding: 9px 12px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--bg); color: var(--ink); font-size: 14px;
  }
  #search:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

  main { padding: 20px 24px 64px; }
  .letter-section { break-inside: avoid; margin-bottom: 18px; }
  .letter-heading {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    font-weight: 700; font-size: 13px; color: var(--accent);
    text-transform: uppercase; letter-spacing: 0.08em;
    margin: 0 0 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .word-columns { columns: 5 160px; column-gap: 20px; }
  @media (max-width: 700px) { .word-columns { columns: 2 140px; } }
  .word {
    font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
    font-size: 14px;
    padding: 2px 0;
    break-inside: avoid;
  }
  .word.is-hidden { display: none; }
  .letter-section.is-empty { display: none; }
</style>

<header>
  <h1><span class="mono-accent">WYRDGRID</span> — word list</h1>
  <p class="subtitle">All ${words.length} distinct words used across the 366 selected puzzles, alphabetically.</p>
  <input id="search" type="text" placeholder="Filter…" autocomplete="off" />
</header>

<main id="main">
${[...groups.entries()].map(([letter, ws]) => `
  <section class="letter-section" data-letter="${letter}">
    <h2 class="letter-heading">${letter} <span style="color:var(--ink-dim); font-weight:400;">(${ws.length})</span></h2>
    <div class="word-columns">
      ${ws.map((w) => `<div class="word">${w}</div>`).join('\n      ')}
    </div>
  </section>`).join('\n')}
</main>

<script>
  const searchEl = document.getElementById('search');
  const sections = [...document.querySelectorAll('.letter-section')];
  searchEl.addEventListener('input', () => {
    const q = searchEl.value.trim().toUpperCase();
    sections.forEach((section) => {
      let anyVisible = false;
      section.querySelectorAll('.word').forEach((el) => {
        const match = !q || el.textContent.includes(q);
        el.classList.toggle('is-hidden', !match);
        if (match) anyVisible = true;
      });
      section.classList.toggle('is-empty', !anyVisible);
    });
  });
</script>
`;

fs.writeFileSync(path.join(__dirname, 'wordlist.html'), html);
console.log(`Wrote wordlist.html (${words.length} words)`);

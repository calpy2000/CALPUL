// Builds the final 366-day schedule from the SCOWL-dictionary-filtered
// square pool (squares-common20k-scowl.json — SCOWL is the same curated,
// proper-noun-free word list most spell-checkers use, replacing the
// earlier words_alpha.txt + hand-built blocklist approach, which was both
// under-inclusive of real dictionary words like WEST/KING/HOPE/WOOD and
// over-inclusive of things that were never a "common word" to begin with,
// like slurs/profanity and abbreviations that had snuck into words_alpha.txt),
// enforcing THREE constraints:
//   1. All 8 words in a single puzzle are distinct (guaranteed already by
//      generate-squares.js).
//   2. No word reappears within 7 days of its previous use anywhere in the
//      366-day schedule.
//   3. No word is used more than MAX_USES times in total across all 366
//      days.
// Same greedy day-by-day approach as select-366-spaced.js, just with the
// extra total-use-count check added alongside the day-gap check.

const fs = require('fs');
const path = require('path');

const WINDOW = 7;
const MAX_USES = 20;

const squares = JSON.parse(fs.readFileSync(path.join(__dirname, 'squares-common20k-scowl-v6.json'), 'utf8'));
// Rank against the STRICTER 10k-based list where possible (lower index =
// more common) — words only found in the wider 20k list rank below all of
// those, so quality is still preferred from the 10k pool first, with the
// 20k pool used as extra depth rather than swamping the ranking.
const rankOrder = fs.readFileSync(path.join(__dirname, 'common10k-scowl-v6.txt'), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
const rank = new Map(rankOrder.map((w, i) => [w, i]));

const seenWordSets = new Set();
const distinct = [];
for (const sq of squares) {
  const key = [...sq.rows, ...sq.cols].slice().sort().join(',');
  if (seenWordSets.has(key)) continue;
  seenWordSets.add(key);
  distinct.push(sq);
}

function score(sq) {
  const words = [...sq.rows, ...sq.cols];
  const ranks = words.map((w) => rank.get(w) ?? Infinity);
  return { worst: Math.max(...ranks), sum: ranks.reduce((a, b) => a + b, 0) };
}

const candidates = distinct
  .map((sq) => ({ sq, words: [...sq.rows, ...sq.cols], ...score(sq) }))
  .sort((a, b) => (a.worst - b.worst) || (a.sum - b.sum));

const lastUsedDay = new Map();
const useCount = new Map();
const schedule = [];
const remaining = candidates.slice();

for (let day = 1; day <= 366; day++) {
  let pickIndex = -1;
  for (let idx = 0; idx < remaining.length; idx++) {
    const cand = remaining[idx];
    const conflict = cand.words.some((w) => {
      const tooSoon = lastUsedDay.has(w) && (day - lastUsedDay.get(w)) <= WINDOW;
      const tooMany = (useCount.get(w) || 0) >= MAX_USES;
      return tooSoon || tooMany;
    });
    if (!conflict) { pickIndex = idx; break; }
  }
  if (pickIndex === -1) {
    console.error(`Day ${day}: NO valid candidate found.`);
    break;
  }
  const chosen = remaining.splice(pickIndex, 1)[0];
  chosen.words.forEach((w) => {
    lastUsedDay.set(w, day);
    useCount.set(w, (useCount.get(w) || 0) + 1);
  });
  schedule.push({ day, rows: chosen.sq.rows, cols: chosen.sq.cols, worstRank: chosen.worst });
}

console.log(`Scheduled ${schedule.length} / 366 days.`);

// Verify both constraints hold.
const usageDays = new Map();
schedule.forEach((p) => {
  [...p.rows, ...p.cols].forEach((w) => {
    if (!usageDays.has(w)) usageDays.set(w, []);
    usageDays.get(w).push(p.day);
  });
});
let gapViolations = 0;
let capViolations = 0;
for (const [w, days] of usageDays) {
  if (days.length > MAX_USES) { capViolations++; console.error(`CAP VIOLATION: "${w}" used ${days.length} times`); }
  const sorted = [...days].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= WINDOW) {
      gapViolations++;
      console.error(`GAP VIOLATION: "${w}" on day ${sorted[i - 1]} and day ${sorted[i]}`);
    }
  }
}
console.log(`7-day gap check: ${gapViolations === 0 ? 'PASSED' : gapViolations + ' violations'}`);
console.log(`Max-${MAX_USES}-uses check: ${capViolations === 0 ? 'PASSED' : capViolations + ' violations'}`);

const useCounts = [...useCount.values()].sort((a, b) => b - a);
console.log(`Most-used word count: ${useCounts[0]}, words used exactly ${MAX_USES} times: ${useCounts.filter((c) => c === MAX_USES).length}`);
const wordsUsedOnce = [...useCount.values()].filter((c) => c === 1).length;
console.log(`Total distinct words used across the schedule: ${useCount.size}`);

fs.writeFileSync(path.join(__dirname, 'selected-366-final.json'), JSON.stringify(schedule, null, 2));

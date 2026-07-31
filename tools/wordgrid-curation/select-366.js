// Picks 366 of the 3,254 candidate word squares, preferring puzzles whose
// least-common word is still as common as possible (so the ones most
// likely to need a manual swap surface first isn't a concern — quite the
// opposite, we WANT the most common-feeling ones selected).
//
// Two squares that are transposes of each other (same 8 words, rows/cols
// swapped) are functionally the same puzzle content to a reviewer, so only
// one orientation per distinct word-set is kept before picking the top 366.

const fs = require('fs');
const path = require('path');

const squares = JSON.parse(fs.readFileSync(path.join(__dirname, 'squares-common10k-filtered.json'), 'utf8'));
// common10k-filtered.txt preserves the original google-10000-english
// frequency order (lower index = more common), so this doubles as a
// commonness rank lookup.
const rankOrder = fs.readFileSync(path.join(__dirname, 'common10k-filtered.txt'), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
const rank = new Map(rankOrder.map((w, i) => [w, i]));

// Dedupe transposes: keep only the first orientation seen per distinct
// 8-word set.
const seenWordSets = new Set();
const distinct = [];
for (const sq of squares) {
  const key = [...sq.rows, ...sq.cols].slice().sort().join(',');
  if (seenWordSets.has(key)) continue;
  seenWordSets.add(key);
  distinct.push(sq);
}

// Score: [worstRank, sumRank] — worstRank is the LEAST common of the 8
// words (higher = less common), sumRank is the total (tiebreaker). Sorting
// ascending on this puts "all 8 words are very common" puzzles first.
function score(sq) {
  const words = [...sq.rows, ...sq.cols];
  const ranks = words.map((w) => rank.get(w) ?? Infinity);
  return { worst: Math.max(...ranks), sum: ranks.reduce((a, b) => a + b, 0) };
}

const scored = distinct.map((sq) => ({ sq, ...score(sq) }));
scored.sort((a, b) => (a.worst - b.worst) || (a.sum - b.sum));

const chosen = scored.slice(0, 366).map((entry, i) => ({
  day: i + 1,
  rows: entry.sq.rows,
  cols: entry.sq.cols,
  worstRank: entry.worst,
}));

console.log(`Distinct word-sets available: ${distinct.length}`);
console.log(`Selected: ${chosen.length}`);
console.log(`Worst-word rank range in selection: ${chosen[0].worstRank} (day 1) .. ${chosen[chosen.length - 1].worstRank} (day 366)`);

fs.writeFileSync(path.join(__dirname, 'selected-366.json'), JSON.stringify(chosen, null, 2));

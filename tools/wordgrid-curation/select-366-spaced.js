// Same starting pool as select-366.js (1,620 distinct word-squares, ranked
// by how common their worst word is), but this version schedules them onto
// days 1..366 with an added constraint: no word may reappear within 7 days
// of its previous use (i.e. the same day-gap must be > 7). Greedy day-by-day
// assignment — at each day, walks the quality-ranked candidate list and
// takes the first one none of whose 8 words were used in the last 7 days.

const fs = require('fs');
const path = require('path');

const WINDOW = 7; // "within seven days" — a gap of exactly 7 is still too close; only >7 is allowed

const squares = JSON.parse(fs.readFileSync(path.join(__dirname, 'squares-common10k-filtered.json'), 'utf8'));
const rankOrder = fs.readFileSync(path.join(__dirname, 'common10k-filtered.txt'), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
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

const lastUsedDay = new Map(); // word -> day it was last placed
const schedule = [];
const remaining = candidates.slice();
const skippedDays = []; // days where we had to fall back past the "ideal" pick

for (let day = 1; day <= 366; day++) {
  let pickIndex = -1;
  for (let idx = 0; idx < remaining.length; idx++) {
    const cand = remaining[idx];
    const conflict = cand.words.some((w) => lastUsedDay.has(w) && (day - lastUsedDay.get(w)) <= WINDOW);
    if (!conflict) { pickIndex = idx; break; }
  }
  if (pickIndex === -1) {
    console.error(`Day ${day}: NO valid candidate found (ran out of options satisfying the ${WINDOW}-day gap). Pool exhausted or too constrained.`);
    break;
  }
  if (pickIndex > 0) skippedDays.push({ day, skippedOver: pickIndex });
  const chosen = remaining.splice(pickIndex, 1)[0];
  chosen.words.forEach((w) => lastUsedDay.set(w, day));
  schedule.push({ day, rows: chosen.sq.rows, cols: chosen.sq.cols, worstRank: chosen.worst });
}

console.log(`Scheduled ${schedule.length} / 366 days.`);
console.log(`Days where the top-ranked candidate had to be skipped due to the 7-day rule: ${skippedDays.length}`);
if (skippedDays.length) {
  const maxSkip = Math.max(...skippedDays.map((s) => s.skippedOver));
  console.log(`Largest number of candidates skipped in a row on one day: ${maxSkip}`);
}

// Verify: no word appears twice within the window, anywhere in the final schedule.
const usageDays = new Map();
schedule.forEach((p) => {
  [...p.rows, ...p.cols].forEach((w) => {
    if (!usageDays.has(w)) usageDays.set(w, []);
    usageDays.get(w).push(p.day);
  });
});
let violations = 0;
for (const [w, days] of usageDays) {
  days.sort((a, b) => a - b);
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] <= WINDOW) {
      violations++;
      console.error(`VIOLATION: "${w}" used on day ${days[i - 1]} and day ${days[i]} (gap ${days[i] - days[i - 1]})`);
    }
  }
}
console.log(`Constraint check: ${violations === 0 ? 'PASSED — no word reused within ' + WINDOW + ' days anywhere in the schedule.' : violations + ' VIOLATIONS FOUND'}`);

fs.writeFileSync(path.join(__dirname, 'selected-366-spaced.json'), JSON.stringify(schedule, null, 2));

// Generates games/totalz/days.json — one entry per calendar day-of-year,
// each a { numbers, target, minRequired, trail } puzzle.
//
// Unlike a typical curated-content game (VALUZ/MOJEEZ), TOTALZ's targets
// aren't picked and then checked for solvability — they're CONSTRUCTED from
// a chosen subset of the day's 6 numbers, so every generated puzzle is
// solvable by definition. `minRequired` (how many of the 6 numbers the
// puzzle genuinely needs — never fewer) is independently verified via
// chainReachableWithAtMost(), not just assumed from how the equation was
// built.
//
// Distribution: ~55% of days need at least 4 numbers, ~45% need at least 5.
// A "needs all 6" tier was attempted and dropped — proven-rare and
// expensive to find via this construct-then-verify approach (one attempt
// ran 38 minutes and still failed to find a single qualifying target); a
// smarter (non-brute-force) construction strategy would be needed to bring
// that tier back.
//
// Run: node generate-days.js  (takes roughly 60-90 minutes for the full
// 366 days — k=5 targets alone can need anywhere from a few dozen to a few
// thousand random construction attempts before one survives the "nothing
// shorter also works" check).

const fs = require('fs');
const path = require('path');

const LARGE_POOL = [25, 50, 75, 100];
const SMALL_POOL = [2, 3, 4, 5, 6, 7, 8, 9];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function applyBinary(a, opKey, b) {
  switch (opKey) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
  }
}

function binaryValid(a, opKey, b) {
  const r = applyBinary(a, opKey, b);
  if (!Number.isInteger(r) || r <= 0) return false;
  if (opKey === '/' && a % b !== 0) return false;
  return true;
}

function numberVariants(raw) {
  const variants = [{ transform: null, value: raw }];
  if (raw !== 1 && raw * raw <= 999999) variants.push({ transform: 'sq', value: raw * raw });
  if (raw !== 1 && Number.isInteger(Math.sqrt(raw))) variants.push({ transform: 'rt', value: Math.sqrt(raw) });
  return variants;
}

// Builds a random valid chain using every number in `subset`, in a random
// order, with an occasional (20%) transform on the incoming number — the
// resulting final value becomes the day's target. Retries with a fresh
// random order/transform/operator choice up to 300 times before giving up
// on this particular subset (the caller retries with different numbers).
function constructRandomEquation(subset) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const order = shuffle(subset);
    let cur = order[0];
    const trail = [{ type: 'first', raw: order[0], transform: null }];
    let ok = true;
    for (let i = 1; i < order.length; i++) {
      const raw = order[i];
      const variantPool = Math.random() < 0.2 ? numberVariants(raw) : [{ transform: null, value: raw }];
      const variant = variantPool[Math.floor(Math.random() * variantPool.length)];
      const ops = shuffle(['+', '-', '*', '/']);
      const op = ops.find((o) => binaryValid(cur, o, variant.value));
      if (!op) { ok = false; break; }
      trail.push({ type: 'binary', op, raw, transform: variant.transform });
      cur = applyBinary(cur, op, variant.value);
    }
    if (ok) return { trail, value: cur };
  }
  return null;
}

// Exhaustive (not budget-limited) check of whether `target` is reachable
// using AT MOST `maxCount` of the given numbers, via a left-to-right CHAIN —
// matching exactly what the game allows (order matters, no arbitrary
// regrouping/parenthesization). Proper DP over "which numbers have been
// used" (a bitmask) rather than enumerating permutations, which would blow
// up factorially — tracks the SET of values reachable with each exact mask
// regardless of which order produced them, processed in increasing
// population-count order so every extension only ever reads already-
// finished smaller masks.
function chainReachableWithAtMost(nums, maxCount, target) {
  const n = nums.length;
  const achievable = new Map();

  function withUnaryClosure(set) {
    for (const v of [...set]) {
      if (v !== 1 && v * v <= 999999) set.add(v * v);
      if (v !== 1 && Number.isInteger(Math.sqrt(v))) set.add(Math.sqrt(v));
    }
    return set;
  }

  for (let i = 0; i < n; i++) {
    achievable.set(1 << i, withUnaryClosure(new Set([nums[i]])));
  }

  const levels = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    let bits = 0;
    for (let m = mask; m; m &= m - 1) bits++;
    if (bits <= maxCount) (levels[bits] = levels[bits] || []).push(mask);
  }

  for (let level = 1; level < maxCount; level++) {
    for (const mask of levels[level] || []) {
      const curSet = achievable.get(mask);
      if (!curSet) continue;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) continue;
        const newMask = mask | (1 << i);
        if (!achievable.has(newMask)) achievable.set(newMask, new Set());
        const target2 = achievable.get(newMask);
        const raw = nums[i];
        const variants = [raw];
        if (raw !== 1 && raw * raw <= 999999) variants.push(raw * raw);
        if (raw !== 1 && Number.isInteger(Math.sqrt(raw))) variants.push(Math.sqrt(raw));
        for (const cur of curSet) {
          for (const v of variants) {
            for (const op of ['+', '-', '*', '/']) {
              if (binaryValid(cur, op, v)) target2.add(applyBinary(cur, op, v));
            }
          }
        }
      }
    }
    for (const mask of levels[level + 1] || []) {
      const set = achievable.get(mask);
      if (set) withUnaryClosure(set);
    }
  }

  for (const set of achievable.values()) {
    if (set.has(target)) return true;
  }
  return false;
}

function generateOneDay(k, budget) {
  for (let attempt = 0; attempt < budget; attempt++) {
    const large = shuffle(LARGE_POOL).slice(0, 2);
    const small = shuffle(SMALL_POOL).slice(0, 4);
    const nums = [...large, ...small];
    const subsetIdx = shuffle([0, 1, 2, 3, 4, 5]).slice(0, k);
    const subset = subsetIdx.map((i) => nums[i]);
    const built = constructRandomEquation(subset);
    if (!built || built.value < 100 || built.value > 999) continue;
    if (k > 1 && chainReachableWithAtMost(nums, k - 1, built.value)) continue;
    return { numbers: nums.slice().sort((a, b) => b - a), target: built.value, minRequired: k, trail: built.trail };
  }
  return null;
}

function generate366() {
  const days = [];
  const seen = new Set();
  let dayNum = 0;
  let k4count = 0, k5count = 0;
  const t0 = Date.now();

  while (dayNum < 366) {
    const k = Math.random() < 0.55 ? 4 : 5;
    const budget = k === 5 ? 8000 : 1500;
    const day = generateOneDay(k, budget);
    if (!day) { console.log(`day ${dayNum + 1}: FAILED to generate at k=${k}, retrying`); continue; }
    const key = day.numbers.join(',') + '|' + day.target;
    if (seen.has(key)) continue; // avoid an exact duplicate puzzle
    seen.add(key);
    dayNum++;
    if (k === 4) k4count++; else k5count++;
    days.push({ day: dayNum, numbers: day.numbers, target: day.target, minRequired: day.minRequired, trail: day.trail });
    if (dayNum % 50 === 0) console.log(`... ${dayNum}/366 generated (${((Date.now() - t0) / 1000).toFixed(1)}s elapsed)`);
  }

  console.log(`\nDone: 366 days in ${((Date.now() - t0) / 1000).toFixed(1)}s. k=4: ${k4count}, k=5: ${k5count}`);
  return days;
}

if (require.main === module) {
  const days = generate366();
  const outPath = path.join(__dirname, '..', '..', 'games', 'totalz', 'days.json');
  fs.writeFileSync(outPath, JSON.stringify(days));
  console.log(`Wrote ${outPath}`);
}

module.exports = { shuffle, applyBinary, binaryValid, numberVariants, constructRandomEquation, chainReachableWithAtMost, generateOneDay, generate366 };

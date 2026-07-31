// Finds order-4 "word squares": 4 row words + 4 column words, all valid
// dictionary words, all 8 distinct — from a common-word list.
//
// Naive approach (try every row3/row4 candidate from the full word list)
// is O(N^4) — 1000+ words to the 4th power is trillions of iterations, far
// too slow. Instead, at each step we compute, PER COLUMN POSITION, the set
// of letters that could legally continue that column (via a prefix index
// built once up front), then intersect the four per-position word sets to
// get only the words that satisfy ALL FOUR columns simultaneously — the
// same technique real word-square/crossword solvers use.
//
// Usage: node generate-squares.js <wordlistFile> [maxResults]

const fs = require('fs');
const path = require('path');

const wordlistFile = process.argv[2] || 'google10k.txt';
const maxResults = parseInt(process.argv[3], 10) || Infinity;

const raw = fs.readFileSync(path.join(__dirname, wordlistFile), 'utf8');
const words = [...new Set(
  raw.split('\n')
    .map((w) => w.trim().toUpperCase())
    .filter((w) => /^[A-Z]{4}$/.test(w))
)];

console.log(`Loaded ${words.length} unique 4-letter words from ${wordlistFile}`);

const wordSet = new Set(words);

// byPos[pos] : Map<letter, Set<wordIndex>> — every word's letter at each of
// the 4 positions, for fast "which words have letter L at position P" union.
const byPos = [new Map(), new Map(), new Map(), new Map()];
words.forEach((w, idx) => {
  for (let pos = 0; pos < 4; pos++) {
    const ch = w[pos];
    if (!byPos[pos].has(ch)) byPos[pos].set(ch, new Set());
    byPos[pos].get(ch).add(idx);
  }
});

// nextLetters.get(prefix) -> Set of letters L such that prefix+L is itself a
// valid prefix of some word (for prefix length 1-2) or a complete word (for
// prefix length 3). Built by scanning every word once.
const nextLetters = new Map();
function addNext(prefix, letter) {
  if (!nextLetters.has(prefix)) nextLetters.set(prefix, new Set());
  nextLetters.get(prefix).add(letter);
}
for (const w of words) {
  addNext('', w[0]);
  addNext(w[0], w[1]);
  addNext(w.slice(0, 2), w[2]);
  addNext(w.slice(0, 3), w[3]);
}

function union(sets) {
  const out = new Set();
  for (const s of sets) for (const v of s) out.add(v);
  return out;
}
function intersect(sets) {
  const [first, ...rest] = sets;
  const out = new Set();
  for (const v of first) if (rest.every((s) => s.has(v))) out.add(v);
  return out;
}

// Given the 4 column-prefixes-so-far, returns the set of word indices that
// are legal candidates for the NEXT row — i.e. words whose letter at each
// position c is a legal continuation of that column's prefix.
function candidatesForPrefixes(prefixes, excludeSet) {
  const perPosition = prefixes.map((prefix, pos) => {
    const allowed = nextLetters.get(prefix);
    if (!allowed) return new Set(); // dead end — no word continues this column at all
    return union([...allowed].map((ch) => byPos[pos].get(ch) || new Set()));
  });
  const combined = intersect(perPosition);
  if (excludeSet.size) for (const idx of excludeSet) combined.delete(idx);
  return combined;
}

const results = [];
const startTime = Date.now();

for (let i = 0; i < words.length; i++) {
  const row1 = words[i];

  const row2Candidates = candidatesForPrefixes([row1[0], row1[1], row1[2], row1[3]], new Set([i]));
  for (const j of row2Candidates) {
    const row2 = words[j];
    const p = [row1[0] + row2[0], row1[1] + row2[1], row1[2] + row2[2], row1[3] + row2[3]];

    const row3Candidates = candidatesForPrefixes(p, new Set([i, j]));
    for (const k of row3Candidates) {
      const row3 = words[k];
      const q = [p[0] + row3[0], p[1] + row3[1], p[2] + row3[2], p[3] + row3[3]];

      const row4Candidates = candidatesForPrefixes(q, new Set([i, j, k]));
      for (const l of row4Candidates) {
        const row4 = words[l];
        const cols = [q[0] + row4[0], q[1] + row4[1], q[2] + row4[2], q[3] + row4[3]];
        if (!cols.every((c) => wordSet.has(c))) continue; // candidatesForPrefixes already guarantees this in practice, but double-check

        const rows = [row1, row2, row3, row4];
        const all8 = [...rows, ...cols];
        if (new Set(all8).size !== 8) continue;

        results.push({ rows, cols });
        if (results.length >= maxResults) {
          finish();
          return;
        }
      }
    }
  }
  if (i % 100 === 0) {
    console.log(`  ...row1=${row1} (${i}/${words.length}), ${results.length} squares so far, ${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed`);
  }
}

finish();

function finish() {
  console.log(`\nDone in ${((Date.now() - startTime) / 1000).toFixed(1)}s. Found ${results.length} word squares.`);
  fs.writeFileSync(path.join(__dirname, `squares-${wordlistFile.replace('.txt', '')}.json`), JSON.stringify(results, null, 2));
}

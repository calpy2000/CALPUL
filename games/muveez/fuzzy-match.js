// MUVEEZ-only fuzzy answer matching. A guess doesn't need to be a
// character-for-character match of the stored answer — this file decides
// how much slack to give and still call it correct.
//
// The pipeline, in order:
//   1. Lowercase, expand "&" to "and".
//   2. Replace hyphens with spaces (so "Ant-Man" and "Ant Man" are the same
//      shape going into the rest of the pipeline).
//   3. Strip remaining punctuation (apostrophes, commas, periods, colons,
//      exclamation marks, quotes) entirely.
//   4. Collapse repeated whitespace, trim.
//   5. Drop a leading "the" (only when it's the very first word — "the" in
//      the middle of a title, e.g. "The Good, THE Bad and THE Ugly", is
//      left alone).
//   6. Convert spelled-out numbers to digits word-by-word (and merge
//      "twenty" + "one" into "21", etc.) so "ocean's eight" lines up with
//      the stored "Ocean's 8".
// Both the stored answer and the player's guess go through the exact same
// steps, so whatever form either one is typed/stored in, they end up
// compared on equal footing.
//
// On top of that: a small hand-picked list of ALTERNATE_ANSWERS handles
// cases the pipeline above genuinely can't reach on its own — "Se7en" has
// its 7 baked into the middle of a word (no punctuation/number-word rule
// would ever pull "seven" back out of that), and "F1" is a contraction of
// "Formula 1" rather than a typo/spelling variant of it.
//
// Last line of defense: Levenshtein (edit) distance between the two fully
// normalized strings, with a small allowance that scales with the title's
// length — a couple of mistyped/missing/extra letters still counts, but a
// guess that's a completely different length/shape won't.

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS_WORDS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const ALTERNATE_ANSWERS = {
  'Se7en': ['seven'],
  'F1': ['formula 1', 'formula one'],
};

// Turns a sequence of tokens like ["twenty", "one", "jump", "street"] into
// ["21", "jump", "street"] — walks the list once, and whenever it sees a
// tens-word immediately followed by a 1-9 units-word, merges them into one
// combined number before falling back to converting standalone number-words.
function convertNumberWords(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const next = tokens[i + 1];
    if (TENS_WORDS[word] !== undefined && next !== undefined && NUMBER_WORDS[next] >= 1 && NUMBER_WORDS[next] <= 9) {
      out.push(String(TENS_WORDS[word] + NUMBER_WORDS[next]));
      i++; // consumed the units word too
    } else if (TENS_WORDS[word] !== undefined) {
      out.push(String(TENS_WORDS[word]));
    } else if (NUMBER_WORDS[word] !== undefined) {
      out.push(String(NUMBER_WORDS[word]));
    } else {
      out.push(word);
    }
  }
  return out;
}

function normalizeForMatch(str) {
  let s = str.toLowerCase();
  s = s.replace(/&/g, ' and ');
  s = s.replace(/-/g, ' ');
  s = s.replace(/['".,!:;?]/g, ''); // strip remaining punctuation
  s = s.replace(/\s+/g, ' ').trim();

  let tokens = s.split(' ').filter(Boolean);
  if (tokens[0] === 'the') tokens = tokens.slice(1); // only a LEADING "the"
  tokens = convertNumberWords(tokens);

  return tokens.join(' ');
}

// Standard dynamic-programming edit distance: the fewest single-character
// insertions/deletions/substitutions needed to turn `a` into `b`.
function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

// How many stray characters a guess is allowed to have and still count —
// scales gently with the answer's length so "It" isn't as forgiving as
// "The Good, the Bad and the Ugly", capped so long titles don't become
// absurdly lenient.
function toleranceFor(normalizedAnswer) {
  return Math.min(5, Math.max(1, Math.ceil(normalizedAnswer.length / 6)));
}

// True if `answerTokens` appears as a contiguous, in-order run somewhere
// inside `guessTokens` — i.e. the guess is the correct title PLUS possibly
// extra words tacked on (a sequel number, a subtitle, whatever), never
// missing any of the required words. This is intentionally one-directional:
// guessing "Toy Story 2" for the answer "Toy Story" counts (contains it),
// but guessing "Toy Story" for the answer "Toy Story 2" does not (misses
// the "2"). The answer set only ever has one entry per franchise "base"
// name at a time (see the note in games-registry... actually see
// tools/muveez-curation's dedup pass), so accepting a guess that names the
// right movie plus something extra is safe — there's no competing
// same-base answer it could be accidentally confused with.
function containsTokens(guessTokens, answerTokens) {
  if (answerTokens.length === 0 || answerTokens.length > guessTokens.length) return false;
  for (let start = 0; start + answerTokens.length <= guessTokens.length; start++) {
    let allMatch = true;
    for (let offset = 0; offset < answerTokens.length; offset++) {
      if (guessTokens[start + offset] !== answerTokens[offset]) { allMatch = false; break; }
    }
    if (allMatch) return true;
  }
  return false;
}

export function isFuzzyMatch(rawGuess, rawAnswer) {
  const guess = normalizeForMatch(rawGuess);
  if (!guess) return false;

  const candidates = [rawAnswer, ...(ALTERNATE_ANSWERS[rawAnswer] || [])].map(normalizeForMatch);
  const guessTokens = guess.split(' ');

  return candidates.some((answer) => {
    if (guess === answer) return true;
    if (containsTokens(guessTokens, answer.split(' '))) return true;
    return levenshtein(guess, answer) <= toleranceFor(answer);
  });
}

// SPOKZ — an early hand-curated set of themed daily puzzles, one example
// per "theme pool type" from the design discussion (category, prefix/
// suffix compound, hidden word, double letter, bookend, single vowel,
// semordnilap, alphabetical order). Every word here is a real, verified
// entry in games/spokz/words.js's own dictionary — nothing guessed.
//
// Only 8 days exist so far (this is a first real-content pass, not the
// full 366-day themed calendar) — see index.js's buildDailyPuzzle() for
// how these 8 get mapped onto real calendar days (today = index 0, then
// cycling through the 8 repeatedly beyond that until more themed days
// are curated).
//
// `clue` is just the description half of the "Clue: ..." line — the
// "Clue:" label itself is a fixed part of the UI (see index.js's
// clue-banner), not repeated here.
export const THEMED_DAYS = [
  {
    poolType: 'category',
    centerLetter: 'C',
    words: ['CALF', 'CARP', 'COLT', 'COOT', 'CRAB', 'CROW'],
    clue: 'these are all BEASTLY',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'B',
    anchor: 'SUN',
    words: ['BEAM', 'BELT', 'BURN', 'BIRD', 'BATH', 'BEDS'],
    clue: 'these words can follow SUN',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'B',
    words: ['BOWL', 'BRAT', 'BARK', 'BOIL', 'BOAT', 'BLOG'],
    hiddenWords: ['OWL', 'RAT', 'ARK', 'OIL', 'OAT', 'LOG'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'B',
    words: ['BALL', 'BEEF', 'BEER', 'BILL', 'BOOK', 'BUZZ'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'bookend',
    centerLetter: 'S',
    words: ['SEES', 'SETS', 'SUNS', 'SONS', 'SAWS', 'SAYS'],
    clue: 'every word starts and ends with the same letter',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'S',
    vowel: 'O',
    words: ['SOLD', 'SONG', 'SOON', 'SOFT', 'SORT', 'SPOT'],
    clue: 'every word today uses only one vowel: O',
  },
  {
    poolType: 'semordnilap',
    centerLetter: 'S',
    words: ['STOP', 'STAR', 'SPIN', 'SNAP', 'SWAP', 'SPOT'],
    reversedWords: ['POTS', 'RATS', 'NIPS', 'PANS', 'PAWS', 'TOPS'],
    clue: 'every word is an ANADROME (when read backward it is another real word)',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'D',
    words: ['DEFT', 'DEFY', 'DEMO', 'DENT', 'DENY', 'DIRT'],
    clue: "every word's letters are in alphabetic order",
  },
];

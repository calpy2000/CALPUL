// SPOKZ — a hand-curated set of themed daily puzzles, one example per
// "theme pool type" from the design discussion (category, prefix/suffix
// compound, hidden word, double letter, bookend, single vowel,
// semordnilap, alphabetical order). Every word here is a real, verified
// entry in games/spokz/words.js's own dictionary — nothing guessed.
//
// 60 days total (this is still not the full 366-day themed calendar) —
// see index.js's buildDailyPuzzle() for how these get mapped onto real
// calendar days, cycling through all 60 repeatedly beyond that until more
// themed days are curated. The original 8 entries (indices 0-7) come
// first, followed by a 52-day batch (indices 8-59) added 2026-08-29 —
// index.js's THEMED_START_DAY was adjusted so index 8 lands on that same
// day, i.e. the new batch is what actually starts showing "today" and
// each day after, with the original 8 now cycling back in afterward
// rather than being dropped. The 52-day batch was deliberately ordered so
// no two consecutive days share the same poolType, and the three largest
// groups (hiddenWord/doubleLetter/singleVowel, 10 days each) are spread
// evenly across the whole run rather than clumped — don't reshuffle this
// order casually, regenerate it the same way if entries are added/removed.
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
  {
    poolType: 'hiddenWord',
    centerLetter: 'S',
    words: ['SCAR', 'SHIP', 'SHOE', 'SPAN', 'STAR', 'SLOT'],
    hiddenWords: ['CAR', 'HIP', 'HOE', 'PAN', 'TAR', 'LOT'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'C',
    words: ['COOL', 'COOP', 'CUFF', 'CELL', 'COOK', 'CUSS'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'S',
    vowel: 'A',
    words: ['SAND', 'SANG', 'SASH', 'SCAN', 'SCAR', 'SLAM'],
    clue: 'every word today uses only one vowel: A',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'P',
    words: ['PART', 'PINK', 'PEAR', 'PLOT', 'PACE', 'PARK'],
    hiddenWords: ['ART', 'INK', 'EAR', 'LOT', 'ACE', 'ARK'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'D',
    words: ['DOOM', 'DOLL', 'DEED', 'DOSS', 'DEEP', 'DUFF'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'T',
    vowel: 'E',
    words: ['TEEN', 'TREE', 'TREK', 'TEST', 'THEM', 'THEY'],
    clue: 'every word today uses only one vowel: E',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'T',
    words: ['TRAY', 'TRIP', 'THAT', 'TRAM', 'TRAP', 'TROT'],
    hiddenWords: ['RAY', 'RIP', 'HAT', 'RAM', 'RAP', 'ROT'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'F',
    words: ['FUSS', 'FIZZ', 'FILL', 'FEED', 'FOOT', 'FELL'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'C',
    vowel: 'O',
    words: ['COOK', 'COOL', 'CORN', 'CROP', 'CROW', 'CORD'],
    clue: 'every word today uses only one vowel: O',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'C',
    words: ['CRIB', 'CLAW', 'CLIP', 'CAPE', 'CHAT', 'CORE'],
    hiddenWords: ['RIB', 'LAW', 'LIP', 'APE', 'HAT', 'ORE'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'H',
    words: ['HALL', 'HOOF', 'HISS', 'HEED', 'HOOT', 'HILL'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'P',
    vowel: 'I',
    words: ['PICK', 'PINK', 'PING', 'PINT', 'PILL', 'PIPS'],
    clue: 'every word today uses only one vowel: I',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'C',
    words: ['CENT', 'CHIN', 'CHIP', 'CITY', 'COPY', 'COST'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'G',
    words: ['GOAT', 'GLAD', 'GASH', 'GALE', 'GORE', 'GEAR'],
    hiddenWords: ['OAT', 'LAD', 'ASH', 'ALE', 'ORE', 'EAR'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'W',
    words: ['WELL', 'WOOL', 'WEED', 'WOOF', 'WEEK', 'WALL'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'G',
    vowel: 'U',
    words: ['GULF', 'GULL', 'GUSH', 'GUST', 'GUTS', 'GRUB'],
    clue: 'every word today uses only one vowel: U',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'A',
    words: ['ACES', 'AILS', 'AIMS', 'AIRS', 'ALMS', 'AMPS'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'D',
    words: ['DART', 'DRAG', 'DICE', 'DRUM', 'DEAR', 'DRAT'],
    hiddenWords: ['ART', 'RAG', 'ICE', 'RUM', 'EAR', 'RAT'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'G',
    words: ['GOOD', 'GOOF', 'GLEE', 'GULL', 'GEEK', 'GAFF'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'B',
    vowel: 'O',
    words: ['BOLD', 'BOND', 'BOOK', 'BOOM', 'BOOT', 'BORN'],
    clue: 'every word today uses only one vowel: O',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'B',
    words: ['BELT', 'BENT', 'BEST', 'BINS', 'BLOT', 'BLOW'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'S',
    anchor: 'BACK',
    words: ['SIDE', 'SPIN', 'STOP', 'SEAT', 'STAY', 'STAB'],
    clue: 'these words can follow BACK',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'F',
    words: ['FLAG', 'FARM', 'FEAR', 'FOIL', 'FLIP', 'FAIR'],
    hiddenWords: ['LAG', 'ARM', 'EAR', 'OIL', 'LIP', 'AIR'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'L',
    words: ['LOOK', 'LULL', 'LEEK', 'LESS', 'LOOM', 'LOOP'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'D',
    vowel: 'A',
    words: ['DAWN', 'DART', 'DASH', 'DATA', 'DRAG', 'DRAW'],
    clue: 'every word today uses only one vowel: A',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'F',
    words: ['FILM', 'FINS', 'FIRS', 'FIST', 'FLOP', 'FLOW'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'S',
    anchor: 'IN',
    words: ['SIDE', 'SECT', 'STEP', 'SANE', 'SOLE', 'SURE'],
    clue: 'these words can follow IN',
  },
  {
    poolType: 'semordnilap',
    centerLetter: 'D',
    words: ['DEER', 'DRAW', 'DIAL', 'DOOM', 'DRAB', 'DIVA'],
    reversedWords: ['REED', 'WARD', 'LAID', 'MOOD', 'BARD', 'AVID'],
    clue: 'every word is an ANADROME (when read backward it is another real word)',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'H',
    words: ['HAIR', 'HEAR', 'HARM', 'HOWL', 'HASH', 'HEEL'],
    hiddenWords: ['AIR', 'EAR', 'ARM', 'OWL', 'ASH', 'EEL'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'M',
    words: ['MOOD', 'MESS', 'MILL', 'MEET', 'MOOR', 'MOSS'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'M',
    vowel: 'E',
    words: ['MEET', 'MEND', 'MESH', 'MESS', 'MELT', 'MERE'],
    clue: 'every word today uses only one vowel: E',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'G',
    words: ['GILT', 'GIMP', 'GIST', 'GLOP', 'GLOW', 'GORY'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'T',
    anchor: 'UP',
    words: ['TAKE', 'TOWN', 'TURN', 'TIME', 'TALK', 'TICK'],
    clue: 'these words can follow UP',
  },
  {
    poolType: 'semordnilap',
    centerLetter: 'T',
    words: ['TIDE', 'TIME', 'TOOL', 'TRAP', 'TRAM', 'TANG'],
    reversedWords: ['EDIT', 'EMIT', 'LOOT', 'PART', 'MART', 'GNAT'],
    clue: 'every word is an ANADROME (when read backward it is another real word)',
  },
  {
    poolType: 'category',
    centerLetter: 'P',
    words: ['PORK', 'PEAS', 'PLUM', 'PEAR', 'PATE', 'PITA'],
    clue: 'these are good to eat',
  },
  {
    poolType: 'bookend',
    centerLetter: 'T',
    words: ['TACT', 'TENT', 'TEST', 'TEXT', 'TILT', 'TWIT'],
    clue: 'every word starts and ends with the same letter',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'W',
    words: ['WRAP', 'WARM', 'WEAR', 'WHIP', 'WINK', 'WAGE'],
    hiddenWords: ['RAP', 'ARM', 'EAR', 'HIP', 'INK', 'AGE'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'P',
    words: ['POOL', 'PUFF', 'PASS', 'PEEL', 'PILL', 'POOR'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'W',
    vowel: 'A',
    words: ['WALK', 'WALL', 'WARD', 'WARM', 'WASH', 'WANT'],
    clue: 'every word today uses only one vowel: A',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'C',
    words: ['CHOP', 'CHOW', 'CLOT', 'COPS', 'COSY', 'CRUX'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'S',
    anchor: 'OVER',
    words: ['SEAS', 'STAY', 'SIZE', 'SOLD', 'SHOT', 'SPIN'],
    clue: 'these words can follow OVER',
  },
  {
    poolType: 'semordnilap',
    centerLetter: 'L',
    words: ['LIAR', 'LIVE', 'LOOP', 'LEEK', 'LEER', 'LAIR'],
    reversedWords: ['RAIL', 'EVIL', 'POOL', 'KEEL', 'REEL', 'RIAL'],
    clue: 'every word is an ANADROME (when read backward it is another real word)',
  },
  {
    poolType: 'category',
    centerLetter: 'B',
    words: ['BALL', 'BASE', 'BOWL', 'BIKE', 'BOOT', 'BARS'],
    clue: 'these are all found in SPORTS',
  },
  {
    poolType: 'bookend',
    centerLetter: 'P',
    words: ['PEEP', 'PLOP', 'POMP', 'PREP', 'PROP', 'PUMP'],
    clue: 'every word starts and ends with the same letter',
  },
  {
    poolType: 'hiddenWord',
    centerLetter: 'M',
    words: ['MART', 'MOAT', 'MASK', 'MARK', 'MODE', 'MEND'],
    hiddenWords: ['ART', 'OAT', 'ASK', 'ARK', 'ODE', 'END'],
    clue: 'the 3 letters in each spoke make their own 3 letter word',
  },
  {
    poolType: 'doubleLetter',
    centerLetter: 'T',
    words: ['TOOL', 'TALL', 'TEEN', 'TOSS', 'TIFF', 'TOOT'],
    clue: 'every word today has a double leTTer',
  },
  {
    poolType: 'singleVowel',
    centerLetter: 'L',
    vowel: 'I',
    words: ['LICK', 'LIFT', 'LIMB', 'LIMP', 'LING', 'LINK'],
    clue: 'every word today uses only one vowel: I',
  },
  {
    poolType: 'alphabetical',
    centerLetter: 'B',
    words: ['BEGS', 'BEVY', 'BIOS', 'BOPS', 'BOXY', 'BENS'],
    clue: 'every word\'s letters are in alphabetic order',
  },
  {
    poolType: 'prefixSuffix',
    centerLetter: 'C',
    anchor: 'RE',
    words: ['CAST', 'CALL', 'CODE', 'COIL', 'COPY', 'CORD'],
    clue: 'these words can follow RE',
  },
  {
    poolType: 'semordnilap',
    centerLetter: 'P',
    words: ['PALS', 'PETS', 'PINS', 'PEEK', 'PLUG', 'PRAT'],
    reversedWords: ['SLAP', 'STEP', 'SNIP', 'KEEP', 'GULP', 'TARP'],
    clue: 'every word is an ANADROME (when read backward it is another real word)',
  },
  {
    poolType: 'category',
    centerLetter: 'S',
    words: ['SOFA', 'SINK', 'SHED', 'STEP', 'SUDS', 'SLAT'],
    clue: 'these are all found in the HOME',
  },
  {
    poolType: 'bookend',
    centerLetter: 'B',
    words: ['BARB', 'BLAB', 'BLOB', 'BOMB', 'BULB', 'BLUB'],
    clue: 'every word starts and ends with the same letter',
  },
];

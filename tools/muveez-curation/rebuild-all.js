// Full deterministic rebuild from source data, after the images/ folder got
// corrupted by a botched merge (see conversation history / memory for the
// story). Re-derives the correct final movie list from first principles and
// re-fetches every image fresh from TMDb — slower than trying to salvage
// files, but eliminates any risk of subtle leftover corruption.
//
// Pipeline reconstructed:
//   1. HISTORICAL_366 (366 titles, known-correct order) matched back against
//      candidates.json (450 title+year pairs) to recover each one's year —
//      sequential matching (not a lookup table) because a few titles like
//      "Cinderella" or "King Kong" appear twice with different years, and
//      order must be preserved to tell them apart.
//   2. Remove day 253 ("Remember the Titans") -> 261.
//   3. Append the 14 batch1 survivors (title+year already known).
//   4. Append batch2 (24), batch3 (13, "Watergate" will fail again — that's
//      expected/fine), batch4 (15, "X-Men" will fail again — also expected).
//   5. Remove this round's 14-day removal set (from batch2/3/4's ORIGINAL
//      276-326 numbering, matching what the user actually reviewed).
//   6. Fetch everything from TMDb fresh and save as a clean sequential
//      images/1.jpg..N.jpg + answers.js.
//
// Usage: TMDB_KEY=xxxx node rebuild-all.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const CANDIDATES_PATH = path.join(__dirname, 'candidates.json');
const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'muveez', 'images');
const ANSWERS_PATH = path.join(__dirname, '..', '..', 'games', 'muveez', 'answers.js');
const REBUILD_LOG = path.join(__dirname, 'rebuild-log.json');

const HISTORICAL_366 = [
  'The Wizard of Oz','Gone with the Wind','Citizen Kane','Some Like It Hot','Rear Window',
  '12 Angry Men','Ben-Hur','The Sound of Music','Mary Poppins','My Fair Lady',
  'West Side Story','To Kill a Mockingbird',"Breakfast at Tiffany's",'Dr. No','Goldfinger',
  'The Graduate','2001: A Space Odyssey','Planet of the Apes','Butch Cassidy and the Sundance Kid','Willy Wonka & the Chocolate Factory',
  'The Godfather','Jaws','Star Wars','Rocky','Grease',
  'Apocalypse Now','Taxi Driver','Annie Hall',"One Flew Over the Cuckoo's Nest",'Close Encounters of the Third Kind',
  'Superman','Saturday Night Fever','The Exorcist','A Clockwork Orange','The Sting',
  'Young Frankenstein','Monty Python and the Holy Grail','E.T. the Extra-Terrestrial','Back to the Future','Ghostbusters',
  'Return of the Jedi','Indiana Jones and the Last Crusade','Top Gun','The Karate Kid','The Goonies',
  'Beetlejuice','Batman','Die Hard','Predator','The Terminator',
  'Gremlins','Big','Dirty Dancing',"Ferris Bueller's Day Off",'The Breakfast Club',
  'Full Metal Jacket','Platoon','Field of Dreams','Coming to America','Back to the Future Part II',
  'Poltergeist','The NeverEnding Story','Labyrinth','Footloose','Flashdance',
  'Scarface','Tootsie','Amadeus','Stand by Me','The Shining',
  'Tron','WarGames','Beverly Hills Cop','Crocodile Dundee','Working Girl',
  'When Harry Met Sally...','Lethal Weapon','Jurassic Park','Titanic','The Lion King',
  'Forrest Gump','The Matrix','Toy Story','Home Alone','Pulp Fiction',
  'The Shawshank Redemption','Aladdin','Beauty and the Beast','Independence Day','Men in Black',
  'Mrs. Doubtfire','Jumanji','Speed','Braveheart','Good Will Hunting',
  'Saving Private Ryan','Mission: Impossible','Face/Off','The Rock','Se7en',
  'American Beauty','Notting Hill','Groundhog Day','A Few Good Men','The Fugitive',
  'Dances with Wolves','Edward Scissorhands','Batman Returns','The Nightmare Before Christmas','Goodfellas',
  'The Silence of the Lambs','Terminator 2: Judgment Day','Basic Instinct','True Lies',"You've Got Mail",
  'The Big Lebowski','Toy Story 2',"A Bug's Life",'Hercules','Mulan',
  'Tarzan','Pocahontas','James and the Giant Peach','Babe','Free Willy',
  'The Lost World: Jurassic Park','Get Shorty','Clueless',"There's Something About Mary",'Austin Powers: International Man of Mystery',
  "Wayne's World",'Dumb and Dumber','Ace Ventura: Pet Detective','The Mask','Gladiator',
  'The Lord of the Rings: The Fellowship of the Ring','The Lord of the Rings: The Two Towers','The Lord of the Rings: The Return of the King',"Harry Potter and the Sorcerer's Stone",'Harry Potter and the Chamber of Secrets',
  'Harry Potter and the Goblet of Fire','Shrek','Spider-Man 2','Pirates of the Caribbean: The Curse of the Black Pearl','Monsters, Inc.',
  'The Incredibles','Ratatouille','WALL-E','Up','Avatar',
  'Slumdog Millionaire','The Departed','No Country for Old Men','There Will Be Blood','Little Miss Sunshine',
  'Juno','Superbad','Anchorman: The Legend of Ron Burgundy','Napoleon Dynamite','Mean Girls',
  'Elf','The Notebook','500 Days of Summer','Wedding Crashers','Talladega Nights: The Ballad of Ricky Bobby',
  'Zoolander',"Ocean's Eleven",'Minority Report','I Am Legend','War of the Worlds',
  'King Kong','Cast Away','A Beautiful Mind','Chicago','Moulin Rouge!',
  'Kill Bill: Volume 1','School of Rock','Bruce Almighty','The 40-Year-Old Virgin','Knocked Up',
  'Meet the Parents','Legally Blonde','Bend It Like Beckham','The Devil Wears Prada','National Treasure',
  'The Bourne Identity',"Ocean's Twelve",'Charlie and the Chocolate Factory','Madagascar','Ice Age',
  'Shark Tale','Cars','Happy Feet','Enchanted','Night at the Museum',
  'Freaky Friday','The Princess Diaries','Spy Kids','Inception','The Avengers',
  'Frozen','Guardians of the Galaxy','Interstellar','Mad Max: Fury Road','The Social Network',
  'La La Land','Get Out','Black Panther','Wonder Woman','Deadpool',
  'Zootopia','Moana','Coco','Inside Out','The Martian',
  'Gravity','Whiplash','The Grand Budapest Hotel','Django Unchained','Skyfall',
  'Gone Girl','The Wolf of Wall Street','Baby Driver','Knives Out','Parasite',
  '1917','Jojo Rabbit','A Quiet Place','It','Star Wars: The Force Awakens',
  'Rogue One: A Star Wars Story','Doctor Strange','Ant-Man','Captain America: Civil War','Toy Story 3',
  'Toy Story 4','Despicable Me','Despicable Me 2','Minions','The Secret Life of Pets',
  'Kung Fu Panda','How to Train Your Dragon','Brave','The Hunger Games','Divergent',
  'Twilight','The Fault in Our Stars','Now You See Me','Argo','Silver Linings Playbook',
  'Bridesmaids','The Hangover','21 Jump Street','Pitch Perfect','Crazy Rich Asians',
  'A Star Is Born','Bohemian Rhapsody','Green Book','Three Billboards Outside Ebbing, Missouri','Lady Bird',
  'Call Me by Your Name','Blade Runner 2049','Dunkirk','Logan','Thor: Ragnarok',
  'Spider-Man: Homecoming','Jurassic World','Star Trek','Iron Man 2','Iron Man 3',
  'Avengers: Age of Ultron','Big Hero 6','Wreck-It Ralph','Tangled','Maleficent',
  'Cinderella','The Jungle Book','Beauty and the Beast','Aladdin','The Lion King',
  'Dune','Everything Everywhere All at Once','Top Gun: Maverick','Barbie','Oppenheimer',
  'Spider-Man: No Way Home','No Time to Die','The Batman','Encanto','Turning Red',
  'Nope','Elvis','Puss in Boots: The Last Wish','Guardians of the Galaxy Vol. 3','John Wick: Chapter 4',
  'Mission: Impossible – Dead Reckoning Part One','Avatar: The Way of Water','Free Guy','Soul','Onward',
  'Luca','Lightyear','Elemental','The Super Mario Bros. Movie','Wonka',
  'Poor Things','Killers of the Flower Moon','Napoleon','Wicked','Inside Out 2',
  'Deadpool & Wolverine','Dune: Part Two','Snow White and the Seven Dwarfs','Pinocchio','Fantasia',
  'Dumbo','Bambi','Cinderella','Peter Pan','Lady and the Tramp',
  '101 Dalmatians','The Jungle Book','Robin Hood','The Fox and the Hound','The Little Mermaid',
  "Charlotte's Web",'Matilda','Little Women','The Prince of Egypt','Shaun the Sheep Movie',
  'Paddington','Coraline','Corpse Bride','Casino Royale','GoldenEye',
  'Live and Let Die','The Spy Who Loved Me','Moonraker','Mission: Impossible II','Mission: Impossible – Ghost Protocol',
  'The Fast and the Furious','Fast Five','Furious 7','Rocky II','Rocky III',
  'Rocky IV','Creed','Cool Runnings','Remember the Titans','The Blind Side',
  'Moneyball','Rudy','A League of Their Own','Space Jam','Happy Gilmore',
  'Click','50 First Dates','The Wedding Singer','Godzilla','King Kong',
  'The Mummy',"National Lampoon's Vacation",'Home Alone 2: Lost in New York','The Santa Clause',"It's a Wonderful Life",
  'A Christmas Story',
];

if (HISTORICAL_366.length !== 366) {
  console.error('Sanity check failed: expected 366, got', HISTORICAL_366.length);
  process.exit(1);
}

// Match each HISTORICAL_366 title to a candidates.json entry to recover its
// year — sequential/consuming match (not a lookup map) so duplicate titles
// (Cinderella, King Kong, etc.) resolve to the RIGHT occurrence in order.
function matchYears(titles, candidates) {
  const pool = candidates.map((c) => ({ title: c.title, year: c.year, used: false }));
  return titles.map((title) => {
    const hit = pool.find((c) => !c.used && c.title === title);
    if (!hit) throw new Error(`No candidates.json match for "${title}"`);
    hit.used = true;
    return { title, year: hit.year };
  });
}

async function tmdbGet(urlPath, params) {
  const url = new URL(`https://api.themoviedb.org/3${urlPath}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params || {})) if (v !== null && v !== undefined) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1000));
    return tmdbGet(urlPath, params);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchOne(entry, dayNumber) {
  let search = await tmdbGet('/search/movie', { query: entry.title, year: entry.year });
  let movie = search.results && search.results[0];
  if (!movie && entry.year) {
    search = await tmdbGet('/search/movie', { query: entry.title });
    movie = search.results && search.results[0];
  }
  if (!movie) return { dayNumber, title: entry.title, status: 'failed', reason: 'no TMDb match' };

  const images = await tmdbGet(`/movie/${movie.id}/images`, { include_image_language: 'null' });
  const backdrops = (images.backdrops || []).sort((a, b) => b.vote_average - a.vote_average);
  if (backdrops.length === 0) return { dayNumber, title: entry.title, status: 'failed', reason: 'no backdrop images' };

  const imageUrl = `https://image.tmdb.org/t/p/original${backdrops[0].file_path}`;
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return { dayNumber, title: entry.title, status: 'failed', reason: `image download ${imgRes.status}` };
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const meta = await sharp(buffer).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.max(0, Math.round((meta.width - side) / 2));
  const top = Math.max(0, Math.round((meta.height - side) / 2));

  await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .resize(500, 500)
    .jpeg({ quality: 88 })
    .toFile(path.join(IMAGES_DIR, `${dayNumber}.jpg`));

  return { dayNumber, title: entry.title, status: 'ok' };
}

async function main() {
  const candidatesData = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));

  // Step 1: HISTORICAL_366 is the 366-title list from BEFORE the
  // long/short-flag + explicit-list removal round — it still needs that
  // 104-item removal applied to reach 262 (this was the bug: rebuild-all.js
  // originally skipped straight to removing day 253, which only made sense
  // against the ALREADY-104-reduced 262-list, not the raw 366).
  const ORIGINAL_REMOVE_104 = new Set([19,20,29,30,37,38,42,52,60,71,98,109,112,126,130,136,137,138,139,140,141,144,149,151,157,158,159,161,164,165,172,173,176,178,187,188,203,204,207,220,226,229,230,231,234,235,236,238,240,247,249,250,253,259,260,261,262,263,265,266,269,270,271,274,275,276,281,282,283,286,288,293,294,295,296,297,298,300,304,310,311,312,313,314,329,330,333,339,340,341,342,343,344,345,346,347,350,351,352,353,356,363,365,366]);

  // Step 2: 366 -> 262 (the 104 removal) -> remove day 253 (Remember the Titans) -> 261.
  const withYears = matchYears(HISTORICAL_366, candidatesData.candidates);
  const after104 = withYears.filter((_, i) => !ORIGINAL_REMOVE_104.has(i + 1));
  console.log('Main list after 104-removal:', after104.length, '(expect 262)');
  const main261 = after104.filter((_, i) => i + 1 !== 253);
  console.log('Main list after removing day 253:', main261.length, '(expect 261)');

  // Step 3: batch1's 14 survivors (title+year as originally searched).
  const BATCH1_SURVIVORS = [
    { title: 'The Color Purple', year: 1985 },
    { title: 'The Holiday', year: 2006 },
    { title: 'The Hustler', year: 1961 },
    { title: 'Wall Street', year: 1987 },
    { title: 'Captain America', year: 2011 }, // searched as "Captain America: The First Avenger"
    { title: 'Puss in Boots', year: 2011 },
    { title: 'The Full Monty', year: 1997 },
    { title: 'Midnight Cowboy', year: 1969 },
    { title: 'Johnny English', year: 2003 },
    { title: 'Austin Powers', year: 1997 }, // searched as "Austin Powers: International Man of Mystery"
    { title: 'Frankenstein', year: 1931 },
    { title: 'Ghost', year: 1990 },
    { title: 'The Wild One', year: 1953 },
    { title: 'Alien', year: 1979 },
  ];
  const SEARCH_OVERRIDE = {
    'Captain America': 'Captain America: The First Avenger',
    'Austin Powers': 'Austin Powers: International Man of Mystery',
  };

  // Step 4: batch2 (24), batch3 (13, incl. Watergate which will fail),
  // batch4 (15, incl. X-Men which will fail) — original day numbers 276-326
  // preserved so the removal set below lines up with what the user reviewed.
  const batch2 = [
    { title: 'Alfie', year: 1966 }, { title: 'The Italian Job', year: 2003 }, { title: 'Blue Velvet', year: 1986 },
    { title: 'The Addams Family', year: 1991 }, { title: 'Blue Jasmine', year: 2013 }, { title: 'I, Tonya', year: 2017 },
    { title: 'Wuthering Heights', year: 1939 }, { title: 'The Great Escape', year: 1963 }, { title: 'Apollo 13', year: 1995 },
    { title: 'Cast Away', year: 2000 }, { title: 'Jerry Maguire', year: 1996 }, { title: 'The Gentlemen', year: 2019 },
    { title: 'Lawrence of Arabia', year: 1962 }, { title: 'A Fistful of Dollars', year: 1964 }, { title: 'Million Dollar Baby', year: 2004 },
    { title: 'The Running Man', year: 1987 }, { title: 'The Witness', year: null, search: 'The Witness' }, { title: 'Pay It Forward', year: 2000 },
    { title: 'Wilde', year: 1997 }, { title: 'Bridge of Spies', year: 2015 }, { title: 'Much Ado About Nothing', year: 1993 },
    { title: 'Hamlet', year: 1996 }, { title: 'Shakespeare in Love', year: 1998 }, { title: 'The Odyssey', year: null, search: 'The Odyssey' },
  ];
  const batch3 = [
    { title: 'War Horse', year: 2011 }, { title: 'High Noon', year: 1952 }, { title: 'Gunfight at the O.K. Corral', year: 1957 },
    { title: 'The Mermaid', year: 2016 }, { title: "A Hard Day's Night", year: 1964 }, { title: 'Ned Kelly', year: 2003 },
    { title: 'Arthur', year: 1981 }, { title: 'Hooper', year: 1978 }, { title: 'Desperately Seeking Susan', year: 1985 },
    { title: 'Evita', year: 1996 }, { title: 'Spartacus', year: 1960 }, { title: 'Gentlemen Prefer Blondes', year: 1953 },
    { title: 'Watergate', year: null, search: 'Watergate' },
  ];
  const batch4 = [
    { title: 'The Usual Suspects', year: 1995 }, { title: 'Daredevil', year: 2003 }, { title: 'Mary Poppins Returns', year: 2018 },
    { title: 'X-Men', year: 2000 }, { title: 'The Wolverine', year: 2013 }, { title: 'Love Story', year: 1970 },
    { title: 'The Cincinnati Kid', year: 1965 }, { title: 'Bullitt', year: 1968 }, { title: 'Harper', year: 1966 },
    { title: 'The Color of Money', year: 1986 }, { title: 'The Irishman', year: 2019 }, { title: 'Gangs of New York', year: 2002 },
    { title: 'Eyes Wide Shut', year: 1999 }, { title: 'Black Hawk Down', year: 2001 }, { title: 'In Bruges', year: 2008 },
  ];

  // Assign ORIGINAL day numbers exactly as the user saw them: batch2 at
  // 276-299, batch3 at 300-312, batch4 starting wherever batch3 actually
  // left off (311, since Watergate/312 never got a file) — 312-326.
  const batch2Days = batch2.map((e, i) => ({ ...e, day: 276 + i }));
  const batch3Days = batch3.map((e, i) => ({ ...e, day: 300 + i }));
  const batch4Days = batch4.map((e, i) => ({ ...e, day: 312 + i }));

  const removeSetRound2 = new Set([282,283,284,285,292,293,295,297,299,303,305,318,320,324]);
  const newBatchSurvivors = [...batch2Days, ...batch3Days, ...batch4Days].filter((e) => !removeSetRound2.has(e.day));
  // 24+13+15=52 total entries at this stage (Watergate/X-Men still counted —
  // they'll fail naturally during fetchOne just like before), minus 14
  // removed = 38. Two of those 38 (Watergate, X-Men) will fail to fetch,
  // leaving 36 real images — same end result as before, just the failures
  // happen later in the pipeline rather than being pre-filtered here.
  console.log('New-batch entries after round-2 removal:', newBatchSurvivors.length, '(expect 52-14=38, of which 2 will fail to fetch)');

  const finalList = [
    ...main261,
    ...BATCH1_SURVIVORS,
    ...newBatchSurvivors,
  ];
  console.log('Final list to attempt:', finalList.length, '(expect 261+14+38=313, ~311 real images expected after the 2 known failures)');

  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const results = [];
  for (let i = 0; i < finalList.length; i++) {
    const entry = finalList[i];
    const dayNumber = i + 1;
    const searchTitle = SEARCH_OVERRIDE[entry.title] || entry.search || entry.title;
    const r = await fetchOne({ title: searchTitle, year: entry.year }, dayNumber);
    r.title = entry.title; // keep the intended display title even if search used an override
    results.push(r);
    if (dayNumber % 20 === 0 || r.status !== 'ok') {
      console.log(`[${dayNumber}/${finalList.length}] ${entry.title} -> ${r.status}${r.reason ? ' (' + r.reason + ')' : ''}`);
    }
  }

  fs.writeFileSync(REBUILD_LOG, JSON.stringify(results, null, 2));

  const succeeded = results.filter((r) => r.status === 'ok');
  console.log(`\nFetched ${succeeded.length}/${finalList.length} successfully.`);
  const failed = results.filter((r) => r.status !== 'ok');
  if (failed.length) {
    console.log('Failed (no file created, will leave a gap needing a final compaction pass):');
    failed.forEach((f) => console.log(`  day ${f.dayNumber}: ${f.title} - ${f.reason}`));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

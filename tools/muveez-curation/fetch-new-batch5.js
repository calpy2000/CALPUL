// Fifth hand-picked batch — see fetch-new-batch.js for the pattern.
// Usage: TMDB_KEY=xxxx node fetch-new-batch5.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'muveez', 'images');
const NEW_TITLES_LOG = path.join(__dirname, 'new-batch5-log.json');

const BATCH = [
  { search: 'In the Heat of the Night', year: 1967, display: 'In the Heat of the Night' },
  { search: 'To Sir, with Love', year: 1967, display: 'To Sir, with Love' },
  { search: 'Sister Act', year: 1992, display: 'Sister Act' },
  { search: 'Romeo and Juliet', year: 1968, display: 'Romeo and Juliet' },
  { search: 'Eat Pray Love', year: 2010, display: 'Eat Pray Love' },
  { search: "Ocean's 8", year: 2018, display: "Ocean's 8" },
  { search: 'Born on the Fourth of July', year: 1989, display: 'Born on the Fourth of July' },
  { search: 'Patriot Games', year: 1992, display: 'Patriot Games' },
  { search: 'Clear and Present Danger', year: 1994, display: 'Clear and Present Danger' },
  { search: 'Duck Soup', year: 1933, display: 'Duck Soup' },
  { search: 'Laurel and Hardy', year: null, display: 'Laurel and Hardy' },
  { search: 'The Rainbow', year: 1989, display: 'The Rainbow' },
  { search: '10 Things I Hate About You', year: 1999, display: '10 Things I Hate About You' },
  { search: 'Brokeback Mountain', year: 2005, display: 'Brokeback Mountain' },
  { search: 'The Boat That Rocked', year: 2009, display: 'The Boat That Rocked' },
  { search: 'About Time', year: 2013, display: 'About Time' },
  { search: 'Get Carter', year: 1971, display: 'Get Carter' },
  { search: 'Judge Dredd', year: 1995, display: 'Judge Dredd' },
  { search: 'The Good, the Bad and the Ugly', year: 1966, display: 'The Good, the Bad and the Ugly' },
  { search: 'Around the World in 80 Days', year: 1956, display: 'Around the World in 80 Days' },
  { search: "Von Ryan's Express", year: 1965, display: "Von Ryan's Express" },
  { search: 'The Magnificent Seven', year: 1960, display: 'The Magnificent Seven' },
  { search: 'The Last Samurai', year: 2003, display: 'The Last Samurai' },
  { search: 'F1', year: 2025, display: 'F1' },
  { search: 'Ford v Ferrari', year: 2019, display: 'Ford v Ferrari' },
  { search: 'The Illusionist', year: 2006, display: 'The Illusionist' },
  { search: 'American Psycho', year: 2000, display: 'American Psycho' },
  { search: 'The Boxer', year: 1997, display: 'The Boxer' },
  { search: 'The Wrestler', year: 2008, display: 'The Wrestler' },
  { search: 'Twister', year: 1996, display: 'Twister' },
  { search: 'Gandhi', year: 1982, display: 'Gandhi' },
  { search: 'The Dukes of Hazzard', year: 2005, display: 'The Dukes of Hazzard' },
  { search: 'Starsky & Hutch', year: 2004, display: 'Starsky & Hutch' },
];

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

function currentMaxDay() {
  const nums = fs.readdirSync(IMAGES_DIR)
    .map((f) => { const m = f.match(/^(\d+)\.jpg$/); return m ? parseInt(m[1], 10) : null; })
    .filter((n) => n !== null);
  return nums.length ? Math.max(...nums) : 0;
}

async function fetchOne(entry, dayNumber) {
  let search = await tmdbGet('/search/movie', { query: entry.search, year: entry.year });
  let movie = search.results && search.results[0];
  if (!movie && entry.year) {
    search = await tmdbGet('/search/movie', { query: entry.search });
    movie = search.results && search.results[0];
  }
  if (!movie) return { dayNumber, display: entry.display, status: 'failed', reason: 'no TMDb match' };

  const images = await tmdbGet(`/movie/${movie.id}/images`, { include_image_language: 'null' });
  const backdrops = (images.backdrops || []).sort((a, b) => b.vote_average - a.vote_average);
  if (backdrops.length === 0) return { dayNumber, display: entry.display, status: 'failed', reason: 'no backdrop images' };

  const imageUrl = `https://image.tmdb.org/t/p/original${backdrops[0].file_path}`;
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return { dayNumber, display: entry.display, status: 'failed', reason: `image download ${imgRes.status}` };
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

  return { dayNumber, display: entry.display, status: 'ok', tmdbTitle: movie.title, tmdbYear: (movie.release_date || '').slice(0, 4), tmdbId: movie.id };
}

async function main() {
  const startDay = currentMaxDay() + 1;
  console.log(`Starting new batch at day ${startDay} (${BATCH.length} titles)`);

  const results = [];
  for (let i = 0; i < BATCH.length; i++) {
    const dayNumber = startDay + i;
    const r = await fetchOne(BATCH[i], dayNumber);
    results.push(r);
    console.log(`[day ${dayNumber}] ${BATCH[i].display} -> ${r.status}${r.reason ? ' (' + r.reason + ')' : r.tmdbTitle ? ' (TMDb: ' + r.tmdbTitle + ' ' + r.tmdbYear + ')' : ''}`);
  }

  fs.writeFileSync(NEW_TITLES_LOG, JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\nDone. ${ok}/${BATCH.length} fetched successfully, saved as days ${startDay}-${startDay + BATCH.length - 1}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

// Second hand-picked batch — see fetch-new-batch.js for the pattern this
// follows (search/year finds the movie, display is the answer text used
// in-game). Appends starting right after the current highest day number.
//
// Usage: TMDB_KEY=xxxx node fetch-new-batch2.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'muveez', 'images');
const NEW_TITLES_LOG = path.join(__dirname, 'new-batch2-log.json');

const BATCH = [
  { search: 'Alfie', year: 1966, display: 'Alfie' },
  { search: 'The Italian Job', year: 2003, display: 'The Italian Job' },
  { search: 'Blue Velvet', year: 1986, display: 'Blue Velvet' },
  { search: 'The Addams Family', year: 1991, display: 'The Addams Family' },
  { search: 'Blue Jasmine', year: 2013, display: 'Blue Jasmine' },
  { search: 'I, Tonya', year: 2017, display: 'I, Tonya' },
  { search: 'Wuthering Heights', year: 1939, display: 'Wuthering Heights' },
  { search: 'The Great Escape', year: 1963, display: 'The Great Escape' },
  { search: 'Apollo 13', year: 1995, display: 'Apollo 13' },
  { search: 'Cast Away', year: 2000, display: 'Cast Away' },
  { search: 'Jerry Maguire', year: 1996, display: 'Jerry Maguire' },
  { search: 'The Gentlemen', year: 2019, display: 'The Gentlemen' },
  { search: 'Lawrence of Arabia', year: 1962, display: 'Lawrence of Arabia' },
  { search: 'A Fistful of Dollars', year: 1964, display: 'A Fistful of Dollars' },
  { search: 'Million Dollar Baby', year: 2004, display: 'Million Dollar Baby' },
  { search: 'The Running Man', year: 1987, display: 'The Running Man' },
  { search: 'The Witness', year: null, display: 'The Witness' },
  { search: 'Pay It Forward', year: 2000, display: 'Pay It Forward' },
  { search: 'Wilde', year: 1997, display: 'Wilde' },
  { search: 'Bridge of Spies', year: 2015, display: 'Bridge of Spies' },
  { search: 'Much Ado About Nothing', year: 1993, display: 'Much Ado About Nothing' },
  { search: 'Hamlet', year: 1996, display: 'Hamlet' },
  { search: 'Shakespeare in Love', year: 1998, display: 'Shakespeare in Love' },
  { search: 'The Odyssey', year: null, display: 'The Odyssey' },
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

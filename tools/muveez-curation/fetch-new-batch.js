// Fetches a small hand-picked batch of NEW candidates (given directly by
// the user, rather than drawn from candidates.json) and appends them as
// draft images starting right after the current highest day number —
// same review workflow as before: user browses images/, deletes what they
// don't want, then a remove/compact pass folds survivors into the main
// sequence.
//
// Each entry is { search: '<TMDb search query>', year, display: '<answer text>' }
// — `search`/`year` find the right movie on TMDb, `display` is what
// actually gets used as the in-game answer (kept short/guessable even when
// the official title has a long subtitle).
//
// Usage: TMDB_KEY=xxxx node fetch-new-batch.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'muveez', 'images');
const NEW_TITLES_LOG = path.join(__dirname, 'new-batch-log.json');

const BATCH = [
  { search: 'The Color Purple', year: 1985, display: 'The Color Purple' },
  { search: 'The Holiday', year: 2006, display: 'The Holiday' },
  { search: 'Cool Hand Luke', year: 1967, display: 'Cool Hand Luke' },
  { search: 'The Hustler', year: 1961, display: 'The Hustler' },
  { search: 'Wall Street', year: 1987, display: 'Wall Street' },
  { search: 'Captain America: The First Avenger', year: 2011, display: 'Captain America' },
  { search: 'Puss in Boots', year: 2011, display: 'Puss in Boots' },
  { search: 'Thelma & Louise', year: 1991, display: 'Thelma & Louise' },
  { search: 'Tank', year: 1984, display: 'Tank' },
  { search: 'The Full Monty', year: 1997, display: 'The Full Monty' },
  { search: 'Midnight Cowboy', year: 1969, display: 'Midnight Cowboy' },
  { search: 'Johnny English', year: 2003, display: 'Johnny English' },
  { search: 'Austin Powers: International Man of Mystery', year: 1997, display: 'Austin Powers' },
  { search: 'Transformers', year: 2007, display: 'Transformers' },
  { search: 'Rebel Without a Cause', year: 1955, display: 'Rebel Without a Cause' },
  { search: 'On the Waterfront', year: 1954, display: 'On the Waterfront' },
  { search: "Pete's Dragon", year: 2016, display: "Pete's Dragon" },
  { search: 'Annie', year: 1982, display: 'Annie' },
  { search: 'Frankenstein', year: 1931, display: 'Frankenstein' },
  { search: 'Ghost', year: 1990, display: 'Ghost' },
  { search: 'The Wild One', year: 1953, display: 'The Wild One' },
  { search: 'Alien', year: 1979, display: 'Alien' },
];

async function tmdbGet(urlPath, params) {
  const url = new URL(`https://api.themoviedb.org/3${urlPath}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
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
  if (!movie) {
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

  return { dayNumber, display: entry.display, status: 'ok', tmdbTitle: movie.title, tmdbId: movie.id };
}

async function main() {
  const startDay = currentMaxDay() + 1;
  console.log(`Starting new batch at day ${startDay} (${BATCH.length} titles)`);

  const results = [];
  for (let i = 0; i < BATCH.length; i++) {
    const dayNumber = startDay + i;
    const r = await fetchOne(BATCH[i], dayNumber);
    results.push(r);
    console.log(`[day ${dayNumber}] ${BATCH[i].display} -> ${r.status}${r.reason ? ' (' + r.reason + ')' : r.tmdbTitle ? ' (TMDb: ' + r.tmdbTitle + ')' : ''}`);
  }

  fs.writeFileSync(NEW_TITLES_LOG, JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.status === 'ok').length;
  console.log(`\nDone. ${ok}/${BATCH.length} fetched successfully, saved as days ${startDay}-${startDay + BATCH.length - 1}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

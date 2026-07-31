// Ninth hand-picked batch — see fetch-new-batch.js for the pattern.
// Usage: TMDB_KEY=xxxx node fetch-new-batch9.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const IMAGES_DIR = path.join(__dirname, '..', '..', 'games', 'muveez', 'images');
const NEW_TITLES_LOG = path.join(__dirname, 'new-batch9-log.json');

const BATCH = [
  { search: 'Trainspotting', year: 1996, display: 'Trainspotting' },
  { search: 'Sherlock Holmes', year: 2009, display: 'Sherlock Holmes' },
  { search: 'Lucy', year: 2014, display: 'Lucy' },
  { search: 'My Left Foot', year: 1989, display: 'My Left Foot' },
  { search: 'Lincoln', year: 2012, display: 'Lincoln' },
  { search: 'My Beautiful Laundrette', year: 1985, display: 'My Beautiful Laundrette' },
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

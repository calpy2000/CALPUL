// Step 1 of the curation loop: finds the next 'pending' candidate in
// candidates.json, looks it up on TMDb, downloads its best available
// backdrop (a scene/still image — NOT the poster, since posters usually
// have the movie's own title printed on them, which would spoil the
// answer), crops it to a square, and writes that square crop to
// preview.jpg for a human (Claude, in chat) to look at and decide
// add/skip. Does NOT touch candidates.json or the real game files — see
// resolve.js for the step that actually commits a decision.
//
// Usage: TMDB_KEY=xxxx node next.js

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const TMDB_KEY = process.env.TMDB_KEY;
if (!TMDB_KEY) {
  console.error('Set TMDB_KEY environment variable to your TMDb API key.');
  process.exit(1);
}

const CANDIDATES_PATH = path.join(__dirname, 'candidates.json');
const PREVIEW_PATH = path.join(__dirname, 'preview.jpg');
const PENDING_REVIEW_PATH = path.join(__dirname, 'pending-review.json');

async function tmdbGet(urlPath, params) {
  const url = new URL(`https://api.themoviedb.org/3${urlPath}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TMDb ${urlPath} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  const index = data.candidates.findIndex((c) => c.status === 'pending');
  if (index === -1) {
    console.log('No pending candidates left!');
    return;
  }
  const candidate = data.candidates[index];
  console.log(`Candidate #${index}: "${candidate.title}" (${candidate.year})`);

  // 1. Find the movie on TMDb (title + year narrows down remakes/sequels
  // with the same name, e.g. the two different "Little Women"s above).
  const search = await tmdbGet('/search/movie', { query: candidate.title, year: candidate.year });
  const movie = search.results && search.results[0];
  if (!movie) {
    console.log(`NOT_FOUND: no TMDb match for "${candidate.title}" (${candidate.year})`);
    return;
  }
  console.log(`TMDb match: id=${movie.id}, title="${movie.title}", release=${movie.release_date}`);

  // 2. Pull its backdrops (scene stills, landscape, no text) rather than
  // posters. `include_image_language=null` includes backdrops that have no
  // language tag at all, which is where the untouched/textless ones live —
  // TMDb otherwise defaults to only images tagged for the query language.
  const images = await tmdbGet(`/movie/${movie.id}/images`, { include_image_language: 'null' });
  const backdrops = images.backdrops || [];
  if (backdrops.length === 0) {
    console.log(`NOT_FOUND: no backdrop images for "${candidate.title}"`);
    return;
  }
  // Highest-voted backdrop first — TMDb's community voting tends to surface
  // the most iconic/representative shot for the film.
  backdrops.sort((a, b) => b.vote_average - a.vote_average);
  const chosen = backdrops[0];
  const imageUrl = `https://image.tmdb.org/t/p/original${chosen.file_path}`;
  console.log(`Backdrop: ${imageUrl} (${chosen.width}x${chosen.height})`);

  // 3. Download + center-crop to a square (backdrops are landscape scene
  // shots, so unlike posters there's no title-text band to dodge —
  // straightforward center crop keeps the main subject in frame).
  const imgRes = await fetch(imageUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const meta = await sharp(buffer).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.max(0, Math.round((meta.width - side) / 2));
  const top = Math.max(0, Math.round((meta.height - side) / 2));

  await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .resize(500, 500)
    .jpeg({ quality: 88 })
    .toFile(PREVIEW_PATH);

  console.log(`Preview written to ${PREVIEW_PATH}`);
  console.log(`RAW_SOURCE_URL=${imageUrl}`);

  // Remembers exactly what's currently being reviewed so resolve.js (run
  // AFTER a human looks at preview.jpg and decides) knows which candidate
  // and which image URL to commit — without needing to re-run the TMDb
  // lookup or re-guess which backdrop was chosen.
  fs.writeFileSync(PENDING_REVIEW_PATH, JSON.stringify({
    index,
    title: candidate.title,
    year: candidate.year,
    tmdbId: movie.id,
    sourceUrl: imageUrl,
  }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });

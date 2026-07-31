// Batch version of the curation pipeline: instead of reviewing one
// candidate at a time in chat, this fetches+crops ALL 450 candidates in one
// pass, saving image N (1-based, matching candidates.json's array order)
// straight into the real game folder as images/<N>.jpg. The user then
// browses that folder directly and deletes whichever ones they don't want
// — see renumber.js for the step that compacts the survivors back down to
// a gap-free 1..N sequence afterward.
//
// Resumable/idempotent: skips any <N>.jpg that already exists on disk, so
// it's safe to re-run after an interruption (rate limit, network blip)
// without redoing work already done.
//
// Usage: TMDB_KEY=xxxx node fetch-all.js

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
const LOG_PATH = path.join(__dirname, 'fetch-all-log.json');
const CONCURRENCY = 6;

async function tmdbGet(urlPath, params) {
  const url = new URL(`https://api.themoviedb.org/3${urlPath}`);
  url.searchParams.set('api_key', TMDB_KEY);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (res.status === 429) {
    // TMDb rate limit — back off briefly and let the caller retry.
    await new Promise((r) => setTimeout(r, 1000));
    return tmdbGet(urlPath, params);
  }
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchOne(candidate, fileNumber) {
  const outPath = path.join(IMAGES_DIR, `${fileNumber}.jpg`);
  if (fs.existsSync(outPath)) {
    return { fileNumber, title: candidate.title, status: 'already-done' };
  }

  // Search with the year first (disambiguates remakes/sequels sharing a
  // title); if that comes up empty, retry without the year as a fallback —
  // some TMDb release dates don't exactly match the year we guessed.
  let search = await tmdbGet('/search/movie', { query: candidate.title, year: candidate.year });
  let movie = search.results && search.results[0];
  if (!movie) {
    search = await tmdbGet('/search/movie', { query: candidate.title });
    movie = search.results && search.results[0];
  }
  if (!movie) return { fileNumber, title: candidate.title, status: 'failed', reason: 'no TMDb match' };

  const images = await tmdbGet(`/movie/${movie.id}/images`, { include_image_language: 'null' });
  const backdrops = (images.backdrops || []).sort((a, b) => b.vote_average - a.vote_average);
  if (backdrops.length === 0) return { fileNumber, title: candidate.title, status: 'failed', reason: 'no backdrop images' };

  const imageUrl = `https://image.tmdb.org/t/p/original${backdrops[0].file_path}`;
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) return { fileNumber, title: candidate.title, status: 'failed', reason: `image download ${imgRes.status}` };
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const meta = await sharp(buffer).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.max(0, Math.round((meta.width - side) / 2));
  const top = Math.max(0, Math.round((meta.height - side) / 2));

  await sharp(buffer)
    .extract({ left, top, width: side, height: side })
    .resize(500, 500)
    .jpeg({ quality: 88 })
    .toFile(outPath);

  return { fileNumber, title: candidate.title, status: 'ok', tmdbId: movie.id, sourceUrl: imageUrl };
}

// Small hand-rolled concurrency-limited runner — no need for a library for
// just "run these N async jobs, only K at a time".
async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { status: 'failed', reason: err.message };
      }
      const r = results[i];
      console.log(`[${i + 1}/${items.length}] ${r.title || ''} -> ${r.status}${r.reason ? ' (' + r.reason + ')' : ''}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runNext));
  return results;
}

async function main() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8'));
  const jobs = data.candidates.map((c, i) => ({ candidate: c, fileNumber: i + 1 }));

  const results = await runPool(jobs, (job) => fetchOne(job.candidate, job.fileNumber), CONCURRENCY);

  const ok = results.filter((r) => r.status === 'ok').length;
  const already = results.filter((r) => r.status === 'already-done').length;
  const failed = results.filter((r) => r.status === 'failed');

  fs.writeFileSync(LOG_PATH, JSON.stringify({ ok, already, failed }, null, 2));

  console.log('\n=== DONE ===');
  console.log(`ok: ${ok}, already had a file: ${already}, failed: ${failed.length}`);
  if (failed.length) {
    console.log('Failed titles (no image saved for their slot):');
    failed.forEach((f) => console.log(`  #${f.fileNumber} ${f.title}: ${f.reason}`));
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

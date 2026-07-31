// Builds a set of 4-letter proper nouns (place names, first/last names,
// nationalities) to exclude from the word pool — the dictionary source
// (words_alpha.txt) includes lowercased proper nouns like "iowa" and
// "asia" with no way to distinguish them from common words on its own.

const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'proper-noun-sources');
const blocklist = new Set();

// Deliberately whole-token only — NOT split on spaces/hyphens. Splitting
// multi-word names ("Jersey City", "Park City") into individual words was
// tried first and wrongly blocklisted perfectly ordinary common words
// (CITY, PARK, LAKE, HILL, TOWN, FORT, EAST, WEST, VIEW...) that just
// happen to be common components of place names without being proper
// nouns themselves. Only the exact whole name — already a single 4-letter
// token, like "Iowa" or "Chad" — should count.
function add(str) {
  const w = str.trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(w)) blocklist.add(w);
}

const countries = require(path.join(dir, 'countries.json')).countries;
countries.forEach(add);

const nationalities = require(path.join(dir, 'nationalities.json')).nationalities;
nationalities.forEach(add);

const firstNames = require(path.join(dir, 'firstNames.json')).firstNames;
firstNames.forEach(add);

const lastNames = require(path.join(dir, 'lastNames.json')).lastNames;
lastNames.forEach(add);

// neutralNames.json (a "gender-neutral baby names" list) turned out to be
// too noisy to use — it includes huge numbers of ordinary nature/color
// words (BLUE, GOLD, JUNE, LAKE, RAIN, DELL, NAVY...) simply because
// they're sometimes used as trendy given names, which would strip
// perfectly common vocabulary out of the pool. Deliberately not used.

const capitals = require(path.join(dir, 'us_state_capitals.json')).capitals;
capitals.forEach((c) => { add(c.state); add(c.capital); });

const cities = require(path.join(dir, 'us_cities.json')).cities;
cities.forEach((c) => add(c.city));

// A handful of well-known proper nouns/short forms that don't show up in
// any of the structured lists above but are still obviously not "common
// words" for a word-guessing game (continents, common abbreviations-as-
// words, etc.) — added by hand after spotting them in review.
['ASIA', 'IOWA', 'OHIO', 'UTAH', 'CHAD', 'CUBA', 'FIJI', 'IRAN', 'LAOS', 'MALI', 'OMAN', 'PERU', 'TOGO', 'RENO', 'ALEX'].forEach(add);

console.log(`Built blocklist of ${blocklist.size} four-letter proper nouns.`);
fs.writeFileSync(path.join(__dirname, 'proper-noun-blocklist.json'), JSON.stringify([...blocklist].sort(), null, 2));

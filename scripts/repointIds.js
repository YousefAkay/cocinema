import fs from 'fs';
import { GENRES, fetchWithRetry, entityId } from './wikidata.js';

// Moves catalog entries whose Wikidata id points at the wrong film onto the right id, using
// data/id-fixes.json ({ oldId: { to, note } }). The entry keeps its plot, poster, embedding and the
// rest; its year, genres and sitelink count are read again from Wikidata for the new id. Ids that
// other files use are updated too, and everything that was checked against the old id is dropped
// so that it is checked again. Safe to run twice.
//
// Usage: node scripts/repointIds.js

const CATALOG_PATH = 'data/catalog.json';
const FIXES_PATH = 'data/id-fixes.json';
const PROGRESS_PATH = 'data/verify-progress.json';
const AVAILABILITY_PATH = 'data/availability.json';
const ONBOARDING_PATH = 'data/onboarding.json';
const META_PATH = 'data/wikidata-meta.json';

const readJson = path => JSON.parse(fs.readFileSync(path, 'utf8'));
const writeJson = (path, value, space) => fs.writeFileSync(path, JSON.stringify(value, null, space));

async function wikidataFacts(id) {
  const genres = Object.keys(GENRES).map(genre => `wd:${genre}`).join(' ');
  const query = `SELECT ?links ?date ?genre WHERE {
    OPTIONAL { wd:${entityId(id)} wikibase:sitelinks ?links }
    OPTIONAL { wd:${entityId(id)} wdt:P577 ?date }
    OPTIONAL { wd:${entityId(id)} wdt:P136 ?genre . VALUES ?genre { ${genres} } }
  }`;
  const data = await fetchWithRetry(`https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`);
  let year = null;
  let sitelinks = null;
  const genreIds = new Set();
  for (const row of data.results.bindings) {
    if (row.links) sitelinks = Number(row.links.value);
    if (row.date) {
      const value = new Date(row.date.value).getUTCFullYear();
      if (Number.isInteger(value) && (year === null || value < year)) year = value;
    }
    if (row.genre) genreIds.add(entityId(row.genre.value));
  }
  return { year, sitelinks, genreIds: [...genreIds] };
}

async function main() {
  const fixes = readJson(FIXES_PATH);
  const catalog = readJson(CATALOG_PATH);
  const progress = readJson(PROGRESS_PATH);
  const availability = fs.existsSync(AVAILABILITY_PATH) ? readJson(AVAILABILITY_PATH) : null;
  const onboarding = readJson(ONBOARDING_PATH);
  const meta = fs.existsSync(META_PATH) ? readJson(META_PATH) : null;

  for (const [from, { to }] of Object.entries(fixes)) {
    const entry = catalog.find(movie => movie.id === from);
    if (!entry) {
      console.log(`${entityId(from)}: not in the catalog (already moved?), skipping`);
      continue;
    }
    if (catalog.some(movie => movie.id === to)) {
      throw new Error(`${entityId(to)} is already in the catalog; refusing to create a duplicate`);
    }

    const facts = await wikidataFacts(to);
    if (facts.year === null) throw new Error(`Wikidata has no release year for ${entityId(to)}`);
    const before = `${entry.title} (${entry.year}) [${(entry.genres || []).join(', ')}] sitelinks ${entry.sitelinks}`;

    entry.id = to;
    entry.year = facts.year;
    entry.sitelinks = facts.sitelinks;
    entry.genres = facts.genreIds.map(id => GENRES[id]);
    console.log(`${entityId(from)} -> ${entityId(to)}: ${before}  =>  ${entry.title} (${entry.year}) [${entry.genres.join(', ')}] sitelinks ${entry.sitelinks}`);

    delete progress[from];
    delete progress[to];
    if (availability) delete availability.films[from];
    if (meta) delete meta[from];
    for (const pool of onboarding) {
      for (const film of pool.movies) {
        if (film.id === from) {
          film.id = to;
          console.log(`  onboarding "${pool.genre}" pool updated to the new id`);
        }
      }
    }
  }

  writeJson(CATALOG_PATH, catalog);
  writeJson(PROGRESS_PATH, progress, 1);
  if (availability) writeJson(AVAILABILITY_PATH, availability, 1);
  writeJson(ONBOARDING_PATH, onboarding, 2);
  fs.writeFileSync(ONBOARDING_PATH, fs.readFileSync(ONBOARDING_PATH, 'utf8') + '\n');
  if (meta) writeJson(META_PATH, meta, 1);
}

main().catch(error => {
  console.error('Something went wrong:', error.message);
  process.exit(1);
});

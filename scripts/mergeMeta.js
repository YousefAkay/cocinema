import fs from 'fs';

const CATALOG_PATH = 'data/catalog.json';
const META_PATH = 'data/wikidata-meta.json';
const ONBOARDING_PATH = 'data/onboarding.json';
const OVERRIDES_PATH = 'data/overrides.json';

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
const onboarding = JSON.parse(fs.readFileSync(ONBOARDING_PATH, 'utf8')).flatMap(genre => genre.movies);
const overrides = fs.existsSync(OVERRIDES_PATH) ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) : {};

let merged = 0;
let missing = 0;

// New fields are appended after the existing ones; nothing already on an entry is changed.
const result = catalog.map(movie => {
  const found = meta[movie.id];
  if (!found) {
    missing++;
    return movie;
  }
  merged++;
  const { sitelinks, year } = found;
  // addGenres (overrides.json): a tracked genre the film plainly has but Wikidata does not list.
  const added = overrides[movie.id]?.addGenres || [];
  const genres = [...new Set([...found.genres, ...added])];
  return { ...movie, genres, sitelinks, year };
});

const catalogById = new Map(result.map(movie => [movie.id, movie]));
for (const pick of onboarding) {
  const movie = catalogById.get(pick.id);
  if (movie && movie.year !== null && pick.year && Math.abs(movie.year - pick.year) > 1) {
    console.log(`Year disagreement: ${pick.title} onboarding ${pick.year}, Wikidata ${movie.year}`);
  }
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(result));
console.log(`Merged ${merged} entries, ${missing} had no metadata`);

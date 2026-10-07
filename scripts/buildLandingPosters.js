import fs from 'fs';

// Picks the films for the landing page's decorative poster strip: the best-known (most sitelinks)
// catalog films that are verified, have a poster and a title that appears only once.
// Writes src/landing-posters.js. No network; data/catalog.json is only read.

const CATALOG_PATH = 'data/catalog.json';
const PROGRESS_PATH = 'data/verify-progress.json';
const OUTPUT_PATH = 'src/landing-posters.js';
const COUNT = 12;

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));

const titleCounts = new Map();
for (const movie of catalog) {
  titleCounts.set(movie.title, (titleCounts.get(movie.title) || 0) + 1);
}

// Verified by the verify script, or a mismatch the repair script has since fixed.
function isVerified(movie) {
  const entry = progress[movie.id];
  if (!entry) return false;
  return entry.status === 'VERIFIED' || (entry.status === 'MISMATCH' && entry.correct && entry.correct.plot === movie.plot);
}

const films = catalog
  .filter(movie => isVerified(movie) && movie.poster && movie.year && titleCounts.get(movie.title) === 1)
  .sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0) || a.id.localeCompare(b.id))
  .slice(0, COUNT)
  .map(movie => ({ title: movie.title, year: movie.year, poster: movie.poster }));

const text = '// Written by scripts/buildLandingPosters.js (npm run build:landing). Do not edit by hand.\n'
  + `export const LANDING_POSTERS = ${JSON.stringify(films, null, 2)};\n`;
fs.writeFileSync(OUTPUT_PATH, text);
console.log(`Wrote ${films.length} films to ${OUTPUT_PATH}:`);
films.forEach(film => console.log(`  ${film.title} (${film.year})`));

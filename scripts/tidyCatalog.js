import fs from 'fs';
import { decodeEntities } from './matching.js';

// Last clean-up of data/catalog.json after verification and repair. Rules, in order:
//   1. Text fields that still hold HTML entities ("&amp;", "d&apos;Abbadie") are decoded. The plot's
//      meaning is unchanged, so its embedding is kept.
//   2. Entries with no poster, or no usable plot, are removed.
//   3. Entries whose runtime is under 40 minutes are removed: the catalog is for feature films, and a
//      short with a feature's title is the usual sign of a wrong match.
// Anything removed also leaves data/verify-progress.json and data/availability.json.
// Nothing is invented: an entry is either kept as it is or taken out.
//
// Usage: node scripts/tidyCatalog.js

const CATALOG_PATH = 'data/catalog.json';
const PROGRESS_PATH = 'data/verify-progress.json';
const AVAILABILITY_PATH = 'data/availability.json';
const TEXT_FIELDS = ['title', 'plot', 'director', 'runtime', 'rated'];
const MIN_FEATURE_MINUTES = 40;

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const removed = [];
let decoded = 0;

const kept = catalog.filter(movie => {
  for (const field of TEXT_FIELDS) {
    if (typeof movie[field] === 'string') {
      const clean = decodeEntities(movie[field]);
      if (clean !== movie[field]) {
        movie[field] = clean;
        decoded++;
        console.log(`decoded entities in ${field} of "${movie.title}"`);
      }
    }
  }

  const minutes = parseInt(movie.runtime, 10);
  if (!movie.poster) {
    removed.push({ movie, reason: 'no poster' });
    return false;
  }
  if (!movie.plot || movie.plot === 'N/A') {
    removed.push({ movie, reason: 'no plot' });
    return false;
  }
  if (Number.isFinite(minutes) && minutes < MIN_FEATURE_MINUTES) {
    removed.push({ movie, reason: `a ${minutes} minute short` });
    return false;
  }
  return true;
});

for (const { movie, reason } of removed) {
  console.log(`removed "${movie.title}" (${movie.year}) ${movie.id.slice(movie.id.lastIndexOf('/') + 1)}: ${reason}`);
}

fs.writeFileSync(CATALOG_PATH, JSON.stringify(kept));

const gone = new Set(removed.map(({ movie }) => movie.id));
if (gone.size > 0) {
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  for (const id of gone) delete progress[id];
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 1));
  if (fs.existsSync(AVAILABILITY_PATH)) {
    const availability = JSON.parse(fs.readFileSync(AVAILABILITY_PATH, 'utf8'));
    for (const id of gone) delete availability.films[id];
    fs.writeFileSync(AVAILABILITY_PATH, JSON.stringify(availability, null, 1) + '\n');
  }
}

console.log(`Catalog: ${catalog.length} -> ${kept.length} films; ${decoded} text fields decoded; ${removed.length} removed.`);

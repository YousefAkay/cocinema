import fs from 'fs';
import { pathToFileURL } from 'url';
import { onboardingLabel } from '../src/format.js';

// Regenerates data/onboarding.json: every genre keeps its hand-picked films (marked
// handPicked: true, year in the file stays authoritative) and is topped up to TARGET_SIZE
// with the best-known verified catalog films whose primary genre it is.
// No network, and data/catalog.json is only read.

const CATALOG_PATH = 'data/catalog.json';
const ONBOARDING_PATH = 'data/onboarding.json';
const PROGRESS_PATH = 'data/verify-progress.json';
export const TARGET_SIZE = 8;
export const MIN_SIZE = 7;
export const MAX_ONBOARDING_GENRES = 2;

// Verified by the verify script, or a mismatch the repair script has since fixed.
function verifiedIds(catalog, progress) {
  const ids = new Set();
  for (const movie of catalog) {
    const entry = progress[movie.id];
    if (!entry) continue;
    const repaired = entry.status === 'MISMATCH' && entry.correct && entry.correct.plot === movie.plot;
    if (entry.status === 'VERIFIED' || repaired) {
      ids.add(movie.id);
    }
  }
  return ids;
}

// Primary genre: of the film's genres that are onboarding genres, the one that is rarest in
// the catalog. A film tagged drama and western counts as a western, so drama (the most common
// label) does not swallow everything. Ties break alphabetically.
export function primaryGenre(movie, onboardingLabels, genreCounts) {
  return (movie.genres || [])
    .filter(genre => onboardingLabels.has(genre))
    .sort((a, b) => genreCounts.get(a) - genreCounts.get(b) || a.localeCompare(b))[0] || null;
}

// A film is only auto-added when its genre is clear: it carries one or two of the onboarding
// genres. Films tagged with three or more (adventure, fantasy, action, drama, ...) could
// belong anywhere, so they are only ever in a pool if hand-picked.
export function isUnambiguous(movie, onboardingLabels) {
  const count = (movie.genres || []).filter(genre => onboardingLabels.has(genre)).length;
  return count >= 1 && count <= MAX_ONBOARDING_GENRES;
}

// existing: onboarding pools whose hand-picked films carry handPicked: true. Returns { pools, report }.
export function buildPools(catalog, progress, existing, targetSize = TARGET_SIZE) {
  const labels = new Set(existing.map(entry => onboardingLabel(entry.genre)));
  const genreCounts = new Map();
  const titleCounts = new Map();
  for (const movie of catalog) {
    titleCounts.set(movie.title, (titleCounts.get(movie.title) || 0) + 1);
    for (const genre of movie.genres || []) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }

  const verified = verifiedIds(catalog, progress);
  const handPicked = existing.map(entry => entry.movies.filter(movie => movie.handPicked));
  const taken = new Set(handPicked.flat().map(movie => movie.id));

  const eligible = catalog
    .filter(movie => verified.has(movie.id) && movie.poster && movie.plot && movie.year
      && Array.isArray(movie.embedding) && movie.embedding.length > 0
      && titleCounts.get(movie.title) === 1 && !taken.has(movie.id)
      && isUnambiguous(movie, labels))
    .sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0) || a.id.localeCompare(b.id));

  const report = [];
  const pools = existing.map((entry, index) => {
    const label = onboardingLabel(entry.genre);
    const kept = handPicked[index].map(movie => ({ id: movie.id, title: movie.title, year: movie.year, handPicked: true }));
    const added = [];

    for (const movie of eligible) {
      if (kept.length + added.length >= targetSize) break;
      if (taken.has(movie.id) || primaryGenre(movie, labels, genreCounts) !== label) continue;
      taken.add(movie.id);
      added.push({ id: movie.id, title: movie.title, year: movie.year });
    }

    report.push({ genre: entry.genre, kept: kept.length, added: added.map(movie => movie.title), size: kept.length + added.length });
    return { genre: entry.genre, movies: [...kept, ...added] };
  });

  return { pools, report };
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  const existing = JSON.parse(fs.readFileSync(ONBOARDING_PATH, 'utf8'));

  // A file written by an earlier run marks its own films; a file from before that has only
  // hand-picked films, so unmarked entries count as hand-picked unless some are marked.
  const anyMarked = existing.some(entry => entry.movies.some(movie => movie.handPicked));
  const normalised = existing.map(entry => ({
    ...entry,
    movies: entry.movies.map(movie => ({ ...movie, handPicked: anyMarked ? Boolean(movie.handPicked) : true })),
  }));

  const { pools, report } = buildPools(catalog, progress, normalised);
  fs.writeFileSync(ONBOARDING_PATH, JSON.stringify(pools, null, 2) + '\n');

  console.log(`${'genre'.padEnd(11)}${'hand'.padEnd(6)}${'added'.padEnd(7)}total`);
  for (const row of report) {
    console.log(`${row.genre.padEnd(11)}${String(row.kept).padEnd(6)}${String(row.added.length).padEnd(7)}${row.size}`);
    if (row.added.length) console.log(`    + ${row.added.join('; ')}`);
    if (row.size < MIN_SIZE) {
      console.warn(`WARNING: ${row.genre} has only ${row.size} films (wanted ${MIN_SIZE}-${TARGET_SIZE}); rerun after verification finishes.`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

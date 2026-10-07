import fs from 'fs';
import { recommend } from '../src/recommend.js';

// Synthetic "genre-persona" evaluation. No network, fixed seed, so every run prints the same numbers.
// It measures whether the recommender can recover a genre taste from ratings; it is NOT
// accuracy on real users.

const CATALOG_PATH = 'data/catalog.json';
const SEED = 20261007;
const MIN_GENRE_FILMS = 25;
const REPEATS = 50;
const LIKED = 6;
const DISLIKED = 4;
const NEUTRAL = 2;
const TOP_K = 10;
const HIT_WINDOW = 20;

// Small seeded generator (mulberry32).
function makeRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list, count) {
  const pool = [...list];
  const chosen = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(random() * pool.length);
    chosen.push(pool.splice(index, 1)[0]);
  }
  return chosen;
}

function between(random, low, high) {
  return low + Math.floor(random() * (high - low + 1));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pad(text, width) {
  return String(text).padEnd(width);
}

function main() {
  const fullCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const catalog = fullCatalog.filter(movie => Array.isArray(movie.genres) && movie.genres.length > 0);
  const skipped = fullCatalog.length - catalog.length;

  const genreCounts = new Map();
  for (const movie of catalog) {
    for (const genre of movie.genres) {
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  const evaluated = [...genreCounts].filter(([, count]) => count >= MIN_GENRE_FILMS).sort((a, b) => b[1] - a[1]);
  const thin = [...genreCounts].filter(([, count]) => count < MIN_GENRE_FILMS);

  console.log('SYNTHETIC GENRE-PERSONA EVALUATION (not accuracy on real users)');
  console.log(`Seed ${SEED}, ${REPEATS} personas per genre, catalog ${fullCatalog.length} films`);
  console.log(`Skipped ${skipped} films with no genre labels; ${catalog.length} films used`);
  console.log(`Genres with fewer than ${MIN_GENRE_FILMS} films, not evaluated: ${thin.map(([g, c]) => `${g} (${c})`).join(', ') || 'none'}`);
  console.log('');
  console.log(`${pad('genre', 18)}${pad('films', 7)}${pad('P@10', 8)}${pad('baseline', 10)}${pad('lift', 7)}${pad('hidden pct', 12)}top-20 hits`);

  const random = makeRandom(SEED);
  const rows = [];

  for (const [genre, count] of evaluated) {
    const inGenre = catalog.filter(movie => movie.genres.includes(genre));
    const outOfGenre = catalog.filter(movie => !movie.genres.includes(genre));
    const baseline = count / catalog.length;

    const precisions = [];
    const percentiles = [];
    let hits = 0;

    for (let run = 0; run < REPEATS; run++) {
      const likedPool = pick(random, inGenre, LIKED + 1);
      const hidden = likedPool.pop();
      const liked = likedPool;
      const disliked = pick(random, outOfGenre, DISLIKED);

      const used = new Set([hidden, ...liked, ...disliked].map(movie => movie.id));
      const neutralPool = catalog.filter(movie => !used.has(movie.id));
      const neutral = pick(random, neutralPool, NEUTRAL);

      const ratings = [
        ...liked.map(movie => ({ id: movie.id, score: between(random, 9, 10) })),
        ...disliked.map(movie => ({ id: movie.id, score: between(random, 2, 3) })),
        ...neutral.map(movie => ({ id: movie.id, score: between(random, 5, 6) })),
      ];

      const ranked = recommend(ratings, catalog, catalog.length);
      if (ranked.length === 0) {
        throw new Error(`recommend() returned nothing for a ${genre} persona`);
      }

      const top = ranked.slice(0, TOP_K);
      precisions.push(top.filter(result => result.movie.genres.includes(genre)).length / TOP_K);

      const position = ranked.findIndex(result => result.movie.id === hidden.id);
      percentiles.push((1 - position / ranked.length) * 100);
      if (position < HIT_WINDOW) hits++;
    }

    const row = {
      genre,
      count,
      precision: mean(precisions),
      baseline,
      lift: mean(precisions) / baseline,
      percentile: mean(percentiles),
      hitRate: hits / REPEATS,
    };
    rows.push(row);
    console.log(
      `${pad(genre, 18)}${pad(count, 7)}${pad(row.precision.toFixed(3), 8)}${pad(row.baseline.toFixed(3), 10)}`
      + `${pad(row.lift.toFixed(2) + 'x', 7)}${pad(row.percentile.toFixed(1), 12)}${(row.hitRate * 100).toFixed(0)}%`,
    );
  }

  console.log('');
  console.log(`Overall (mean of ${rows.length} genres, ${rows.length * REPEATS} personas)`);
  console.log(`  mean precision@${TOP_K}:        ${mean(rows.map(r => r.precision)).toFixed(3)}`);
  console.log(`  mean baseline share:      ${mean(rows.map(r => r.baseline)).toFixed(3)}`);
  console.log(`  mean lift:                ${mean(rows.map(r => r.lift)).toFixed(2)}x`);
  console.log(`  mean hidden-film percentile: ${mean(rows.map(r => r.percentile)).toFixed(1)} (100 = ranked first)`);
  console.log(`  hidden film in top ${HIT_WINDOW}:      ${(mean(rows.map(r => r.hitRate)) * 100).toFixed(1)}%`);

  const byLift = [...rows].sort((a, b) => b.lift - a.lift);
  console.log(`  best genre by lift:       ${byLift[0].genre} (${byLift[0].lift.toFixed(2)}x)`);
  console.log(`  worst genre by lift:      ${byLift[byLift.length - 1].genre} (${byLift[byLift.length - 1].lift.toFixed(2)}x)`);
  console.log('');
  console.log('Genre labels come from Wikidata and a film can have several, so "belongs to the genre" is a loose proxy for taste.');
}

main();

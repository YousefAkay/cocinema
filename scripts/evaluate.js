import fs from 'fs';
import { pathToFileURL } from 'url';
import { recommend } from '../src/recommend.js';

// Usage:
//   node scripts/evaluate.js                 the standard run (12 ratings per persona); also writes src/evaluation-stats.js
//   node scripts/evaluate.js --ratings 8     the same personas' recipe with 8 ratings in total
//   node scripts/evaluate.js --compare       6, 8, 10, 12 and 15 ratings side by side, on nested personas

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
const STATS_PATH = 'src/evaluation-stats.js';
const COMPARE_TOTALS = [6, 8, 10, 12, 15];

// How a total number of ratings splits up: about half liked, a third disliked, the rest
// neutral, with at least one of each. 12 gives the standard 6 / 4 / 2.
export function ratingCounts(total) {
  const liked = Math.max(1, Math.round(total / 2));
  const disliked = Math.max(1, Math.round(total / 3));
  const neutral = Math.max(1, total - liked - disliked);
  return { liked, disliked, neutral };
}

function parseOptions(argv) {
  const options = { ratings: null, compare: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ratings') {
      options.ratings = Number(argv[++i]);
      if (!Number.isInteger(options.ratings) || options.ratings < 3) {
        throw new Error('--ratings needs a whole number of at least 3');
      }
    } else if (argv[i] === '--compare') {
      options.compare = true;
    } else {
      throw new Error(`Unknown option: ${argv[i]}`);
    }
  }
  return options;
}

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

// Scores one persona's ratings against a hidden liked film; returns the three measures.
function measure(ratings, hidden, genre, catalog) {
  const ranked = recommend(ratings, catalog, catalog.length);
  if (ranked.length === 0) {
    throw new Error(`recommend() returned nothing for a ${genre} persona`);
  }
  const top = ranked.slice(0, TOP_K);
  const position = ranked.findIndex(result => result.movie.id === hidden.id);
  return {
    precision: top.filter(result => result.movie.genres.includes(genre)).length / TOP_K,
    percentile: (1 - position / ranked.length) * 100,
    hit: position < HIT_WINDOW,
  };
}

// The same personas at several totals. Each persona is drawn once at the largest size and the
// smaller totals use the first films of it, so 6 ratings is a subset of 8, and so on.
function compare(catalog, evaluated) {
  const biggest = ratingCounts(Math.max(...COMPARE_TOTALS));
  const random = makeRandom(SEED);
  const perTotal = new Map(COMPARE_TOTALS.map(total => [total, []]));

  for (const [genre, count] of evaluated) {
    const inGenre = catalog.filter(movie => movie.genres.includes(genre));
    const outOfGenre = catalog.filter(movie => !movie.genres.includes(genre));
    const baseline = count / catalog.length;
    const results = new Map(COMPARE_TOTALS.map(total => [total, { precisions: [], percentiles: [], hits: 0 }]));

    for (let run = 0; run < REPEATS; run++) {
      const likedPool = pick(random, inGenre, biggest.liked + 1);
      const hidden = likedPool.shift();
      const disliked = pick(random, outOfGenre, biggest.disliked);
      const used = new Set([hidden, ...likedPool, ...disliked].map(movie => movie.id));
      const neutral = pick(random, catalog.filter(movie => !used.has(movie.id)), biggest.neutral);

      const likedScores = likedPool.map(movie => ({ id: movie.id, score: between(random, 9, 10) }));
      const dislikedScores = disliked.map(movie => ({ id: movie.id, score: between(random, 2, 3) }));
      const neutralScores = neutral.map(movie => ({ id: movie.id, score: between(random, 5, 6) }));

      for (const total of COMPARE_TOTALS) {
        const need = ratingCounts(total);
        const ratings = [
          ...likedScores.slice(0, need.liked),
          ...dislikedScores.slice(0, need.disliked),
          ...neutralScores.slice(0, need.neutral),
        ];
        const outcome = measure(ratings, hidden, genre, catalog);
        const bucket = results.get(total);
        bucket.precisions.push(outcome.precision);
        bucket.percentiles.push(outcome.percentile);
        if (outcome.hit) bucket.hits++;
      }
    }

    for (const total of COMPARE_TOTALS) {
      const bucket = results.get(total);
      perTotal.get(total).push({
        precision: mean(bucket.precisions),
        baseline,
        lift: mean(bucket.precisions) / baseline,
        percentile: mean(bucket.percentiles),
        hitRate: bucket.hits / REPEATS,
      });
    }
  }

  console.log('SYNTHETIC GENRE-PERSONA EVALUATION: how recommendations change with the number of ratings');
  console.log(`Seed ${SEED}, ${REPEATS} personas per genre across ${evaluated.length} genres (${evaluated.length * REPEATS} personas), `
    + 'the same personas at every total (smaller totals use the first films of larger ones)');
  console.log('This describes how picks improve with more ratings for simulated genre tastes, not accuracy for real people.');
  console.log('');
  console.log(`${pad('ratings', 10)}${pad('liked/disliked/neutral', 24)}${pad('P@10', 8)}${pad('baseline', 10)}${pad('lift', 8)}${pad('hidden pct', 12)}top-20 hits`);
  for (const total of COMPARE_TOTALS) {
    const rows = perTotal.get(total);
    const split = ratingCounts(total);
    console.log(
      `${pad(total, 10)}${pad(`${split.liked}/${split.disliked}/${split.neutral}`, 24)}${pad(mean(rows.map(r => r.precision)).toFixed(3), 8)}`
      + `${pad(mean(rows.map(r => r.baseline)).toFixed(3), 10)}${pad(mean(rows.map(r => r.lift)).toFixed(2) + 'x', 8)}`
      + `${pad(mean(rows.map(r => r.percentile)).toFixed(1), 12)}${(mean(rows.map(r => r.hitRate)) * 100).toFixed(1)}%`,
    );
  }
}

// The landing page reads its "better than chance" figure from this file, so the page and the
// README (which quotes the same run) cannot drift apart. Only the standard run writes it.
function writeStats(rows, catalogSize) {
  const stats = {
    seed: SEED,
    genres: rows.length,
    personas: rows.length * REPEATS,
    ratingsPerPersona: LIKED + DISLIKED + NEUTRAL,
    catalogSize,
    precisionAt10: Number(mean(rows.map(r => r.precision)).toFixed(3)),
    baseline: Number(mean(rows.map(r => r.baseline)).toFixed(3)),
    lift: Number(mean(rows.map(r => r.lift)).toFixed(2)),
    hiddenPercentile: Number(mean(rows.map(r => r.percentile)).toFixed(1)),
    top20HitRate: Number(mean(rows.map(r => r.hitRate)).toFixed(3)),
  };
  const text = '// Written by scripts/evaluate.js (npm run evaluate). Do not edit by hand.\n'
    + `export const EVALUATION = ${JSON.stringify(stats, null, 2)};\n`;
  fs.writeFileSync(STATS_PATH, text);
}

function main() {
  const options = parseOptions(process.argv.slice(2));
  const counts = options.ratings ? ratingCounts(options.ratings) : { liked: LIKED, disliked: DISLIKED, neutral: NEUTRAL };
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

  if (options.compare) {
    compare(catalog, evaluated);
    return;
  }

  console.log('SYNTHETIC GENRE-PERSONA EVALUATION (not accuracy on real users)');
  console.log(`Seed ${SEED}, ${REPEATS} personas per genre, catalog ${fullCatalog.length} films`);
  if (options.ratings) {
    console.log(`Ratings per persona: ${options.ratings} (${counts.liked} liked, ${counts.disliked} disliked, ${counts.neutral} neutral)`);
  }
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
      const likedPool = pick(random, inGenre, counts.liked + 1);
      const hidden = likedPool.pop();
      const liked = likedPool;
      const disliked = pick(random, outOfGenre, counts.disliked);

      const used = new Set([hidden, ...liked, ...disliked].map(movie => movie.id));
      const neutralPool = catalog.filter(movie => !used.has(movie.id));
      const neutral = pick(random, neutralPool, counts.neutral);

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
  if (!options.ratings) {
    writeStats(rows, catalog.length);
  }

  console.log('');
  console.log('Genre labels come from Wikidata and a film can have several, so "belongs to the genre" is a loose proxy for taste.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

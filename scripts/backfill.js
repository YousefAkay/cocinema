import fs from 'fs';
import { omdbGet } from './omdb.js';

const CATALOG_PATH = 'data/catalog.json';
const RAW_PATH = 'data/movies-raw.json';
const ONBOARDING_PATH = 'data/onboarding.json';
const REQUEST_DELAY_MS = 500;
const SAVE_EVERY = 25;
const MAX_YEAR_DRIFT = 1;
// Only used for entries with no year: share of the shorter plot's words found in the other.
const MIN_PLOT_OVERLAP = 0.5;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function titlesMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return x.startsWith(y) || y.startsWith(x);
}

function plotWords(text) {
  return new Set((text || '').toLowerCase().match(/[a-z]{4,}/g) || []);
}

function plotOverlap(a, b) {
  const x = plotWords(a);
  const y = plotWords(b);
  const smaller = Math.min(x.size, y.size);
  if (smaller === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of x) {
    if (y.has(word)) shared++;
  }
  return shared / smaller;
}

function readJsonIfExists(path) {
  return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : [];
}

// Years we already know, by movie id, from the catalog's sources.
function loadKnownYears() {
  const raw = readJsonIfExists(RAW_PATH);
  const onboarding = readJsonIfExists(ONBOARDING_PATH).flatMap(genre => genre.movies);
  const years = new Map();
  for (const movie of [...raw, ...onboarding]) {
    if (movie.year) {
      years.set(movie.id, Number(movie.year));
    }
  }
  return years;
}

function clean(value) {
  return value && value !== 'N/A' ? value : null;
}

function pickRottenTomatoes(ratings) {
  const entry = Array.isArray(ratings)
    ? ratings.find(rating => rating.Source === 'Rotten Tomatoes')
    : null;
  return entry ? entry.Value : null;
}

// OMDb's y parameter must match its own release year exactly, while Wikidata gives the
// earliest release (often a festival premiere a year earlier), so neighbouring years are tried too.
async function lookup(movie, year) {
  const years = year ? [year, year + 1, year - 1] : [null];
  let rejectedData = null;
  let notFound = null;

  for (const candidate of years) {
    const params = { t: movie.title, plot: 'full' };
    if (candidate) {
      params.y = candidate;
    }

    let data;
    try {
      data = await omdbGet(params);
    } catch (error) {
      if (!error.message.includes('Movie not found')) {
        throw error;
      }
      notFound = error;
      continue;
    }

    let accepted = titlesMatch(movie.title, data.Title);
    if (accepted && year) {
      accepted = Math.abs(parseInt(data.Year, 10) - year) <= MAX_YEAR_DRIFT;
    } else if (accepted) {
      accepted = plotOverlap(movie.plot, data.Plot) >= MIN_PLOT_OVERLAP;
      if (accepted) {
        console.log(`  accepted without a year (plot overlap): "${movie.title}"`);
      }
    }

    if (accepted) {
      return { data, viaFallback: !year };
    }
    rejectedData = data;
    await sleep(REQUEST_DELAY_MS);
  }

  if (rejectedData) {
    return { rejectedData };
  }
  throw notFound;
}

function save(movies) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(movies));
}

async function main() {
  const movies = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const years = loadKnownYears();

  let done = 0;
  let alreadyDone = 0;
  let noRottenTomatoes = 0;
  let rejected = 0;
  let failed = 0;
  let withoutYear = 0;
  const rejectedTitles = [];
  const fallbackAccepted = [];
  let limitReached = false;
  let sinceSave = 0;

  for (const movie of movies) {
    if ('rottenTomatoes' in movie) {
      alreadyDone++;
      continue;
    }

    const year = movie.year ? Number(movie.year) : years.get(movie.id);
    if (!year) {
      withoutYear++;
    }

    try {
      const result = await lookup(movie, year);

      if (result.rejectedData) {
        const { Title, Year } = result.rejectedData;
        console.warn(`Rejected "${movie.title}": OMDb returned "${Title}" (${Year})`);
        rejectedTitles.push(movie.title);
        rejected++;
        continue;
      }

      const data = result.data;
      if (result.viaFallback) {
        fallbackAccepted.push(movie.title);
      }

      const rottenTomatoes = pickRottenTomatoes(data.Ratings);
      movie.rottenTomatoes = rottenTomatoes;
      movie.runtime = clean(data.Runtime);
      movie.director = clean(data.Director);
      movie.rated = clean(data.Rated);

      if (rottenTomatoes === null) {
        noRottenTomatoes++;
      }
      done++;
      sinceSave++;
      console.log(`[${done}] ${movie.title}: ${rottenTomatoes ?? 'no RT score'}`);

      if (sinceSave >= SAVE_EVERY) {
        save(movies);
        sinceSave = 0;
        console.log(`  (progress saved: ${done} backfilled this run)`);
      }
    } catch (error) {
      if (error.message.includes('Request limit reached')) {
        console.error('OMDb daily limit reached. Saving progress and stopping; run again tomorrow to continue.');
        limitReached = true;
        break;
      }
      console.error(`Failed "${movie.title}": ${error.message}`);
      failed++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  save(movies);

  const remaining = movies.filter(movie => !('rottenTomatoes' in movie)).length;
  console.log('');
  console.log(`Done this run: ${done} (already done before: ${alreadyDone})`);
  console.log(`Remaining: ${remaining}`);
  console.log(`No Rotten Tomatoes score: ${noRottenTomatoes}`);
  console.log(`Rejected by title/year guard: ${rejected}${rejectedTitles.length ? ' -> ' + rejectedTitles.join('; ') : ''}`);
  console.log(`Accepted through the no-year fallback: ${fallbackAccepted.length}`);
  console.log(`Failed requests: ${failed}`);
  console.log(`Requested without a year: ${withoutYear}`);
  if (limitReached) {
    console.log('Stopped early at the OMDb limit. Run the same command again later to continue.');
  }
}

main().catch(err => console.error('Something went wrong:', err.message));

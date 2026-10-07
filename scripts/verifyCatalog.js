import fs from 'fs';
import {
  MIN_PLOT_OVERLAP, loadOverrides, lookupByYear, plotOverlap, posterKey,
  pickRottenTomatoes, clean,
} from './matching.js';

const CATALOG_PATH = 'data/catalog.json';
const PROGRESS_PATH = 'data/verify-progress.json';
export const LOCK_PATH = 'data/verify-progress.lock';
const REQUEST_DELAY_MS = 500;
const SAVE_EVERY = 25;
const MIN_FEATURE_MINUTES = 40;

function sleep(ms = REQUEST_DELAY_MS) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadProgress() {
  return fs.existsSync(PROGRESS_PATH) ? JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8')) : {};
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 1));
}

// Titles that appear more than once come first, since they are the likeliest to be mixed up.
function orderForChecking(catalog) {
  const counts = new Map();
  for (const movie of catalog) {
    counts.set(movie.title, (counts.get(movie.title) || 0) + 1);
  }
  const repeated = catalog.filter(movie => counts.get(movie.title) > 1);
  const rest = catalog.filter(movie => counts.get(movie.title) === 1);
  return [...repeated, ...rest];
}

async function main() {
  if (fs.existsSync(LOCK_PATH)) {
    throw new Error(`${LOCK_PATH} exists: another verify run is active (delete it if that run crashed)`);
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));

  try {
    await run();
  } finally {
    fs.rmSync(LOCK_PATH, { force: true });
  }
}

async function run() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const overrides = loadOverrides();
  const progress = loadProgress();
  const todo = orderForChecking(catalog).filter(movie => !(movie.id in progress));
  console.log(`${catalog.length - todo.length} already checked, ${todo.length} to check`);

  let checked = 0;
  let limitReached = false;

  for (const movie of todo) {
    try {
      const result = await lookupByYear(movie, overrides[movie.id], sleep);

      if (result.notFound) {
        progress[movie.id] = { title: movie.title, status: 'NOT_FOUND', reason: 'no OMDb record for any allowed year' };
      } else if (result.rejected) {
        const { Title, Year } = result.rejected;
        progress[movie.id] = { title: movie.title, status: 'REJECTED', reason: `OMDb returned "${Title}" (${Year})` };
      } else {
        const { data } = result;
        const overlap = plotOverlap(movie.plot, data.Plot);
        const samePoster = posterKey(movie.poster) !== null && posterKey(movie.poster) === posterKey(data.Poster);
        const verified = overlap >= MIN_PLOT_OVERLAP || samePoster;
        const correct = {
          plot: data.Plot,
          poster: clean(data.Poster),
          runtime: clean(data.Runtime),
          director: clean(data.Director),
          rated: clean(data.Rated),
          rottenTomatoes: pickRottenTomatoes(data.Ratings),
        };

        // A year-matched record with no plot, no Rotten Tomatoes score or a short runtime is often
        // an obscure short that shares the title, so it is flagged for a human instead of
        // replacing the entry.
        const minutes = parseInt(correct.runtime, 10);
        const trustworthy = clean(correct.plot) !== null && correct.rottenTomatoes !== null
          && Number.isFinite(minutes) && minutes >= MIN_FEATURE_MINUTES;
        const status = verified ? 'VERIFIED' : trustworthy ? 'MISMATCH' : 'REVIEW';

        progress[movie.id] = {
          title: movie.title,
          status,
          overlap: Number(overlap.toFixed(2)),
          omdbYear: parseInt(data.Year, 10),
          ...(verified ? {} : { correct }),
        };
        if (!verified) {
          console.log(`${status} "${movie.title}" (${movie.year}): overlap ${overlap.toFixed(2)}, OMDb ${data.Title} ${data.Year}`);
        }
      }
    } catch (error) {
      if (error.message.includes('Request limit reached')) {
        console.error('OMDb daily limit reached. Saving progress and stopping; run again after the daily reset.');
        limitReached = true;
        break;
      }
      console.error(`Failed "${movie.title}": ${error.message}`);
      continue;
    }

    checked++;
    if (checked % SAVE_EVERY === 0) {
      saveProgress(progress);
      console.log(`  (progress saved: ${checked} checked this run)`);
    }
    await sleep();
  }

  saveProgress(progress);

  const tally = status => Object.values(progress).filter(entry => entry.status === status).length;
  console.log('');
  console.log(`Verified: ${tally('VERIFIED')}`);
  console.log(`Mismatch: ${tally('MISMATCH')}`);
  console.log(`Not found: ${tally('NOT_FOUND')}`);
  console.log(`Rejected: ${tally('REJECTED')}`);
  console.log(`Needs review: ${tally('REVIEW')}`);
  console.log(`Remaining: ${catalog.length - Object.keys(progress).length}`);
  if (limitReached) {
    console.log('Stopped early at the OMDb limit. Run `node scripts/verifyCatalog.js` again later to continue.');
  }
}

main().catch(err => console.error('Something went wrong:', err.message));

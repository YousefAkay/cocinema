import fs from 'fs';
import { getEmbedding } from './embeddings.js';

const CATALOG_PATH = 'data/catalog.json';
const PROGRESS_PATH = 'data/verify-progress.json';
const LOCK_PATH = 'data/verify-progress.lock';
const ONBOARDING_PATH = 'data/onboarding.json';

function start(text) {
  return JSON.stringify((text || '').slice(0, 80));
}

async function main() {
  if (fs.existsSync(LOCK_PATH)) {
    throw new Error('verifyCatalog.js is still running (data/verify-progress.lock exists); wait for it to finish');
  }
  if (!fs.existsSync(PROGRESS_PATH)) {
    throw new Error('No data/verify-progress.json yet; run verifyCatalog.js first');
  }

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
  const onboardingIds = new Set(
    JSON.parse(fs.readFileSync(ONBOARDING_PATH, 'utf8')).flatMap(genre => genre.movies.map(movie => movie.id)),
  );

  const repairedOnboarding = [];
  let repaired = 0;
  let failed = 0;

  for (const movie of catalog) {
    const entry = progress[movie.id];
    if (!entry || entry.status !== 'MISMATCH' || movie.plot === entry.correct.plot) {
      continue;
    }

    let embedding;
    try {
      embedding = await getEmbedding(entry.correct.plot);
    } catch (error) {
      console.error(`Could not embed "${movie.title}": ${error.message}`);
      failed++;
      continue;
    }

    const oldPlot = movie.plot;
    Object.assign(movie, entry.correct, { embedding });
    repaired++;
    if (onboardingIds.has(movie.id)) {
      repairedOnboarding.push(movie.title);
    }

    console.log(`Repaired "${movie.title}" (${movie.year})`);
    console.log(`  old: ${start(oldPlot)}`);
    console.log(`  new: ${start(movie.plot)}`);
  }

  if (repaired > 0) {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog));
  }

  console.log('');
  console.log(`Repaired: ${repaired}, failed: ${failed}`);
  if (repairedOnboarding.length > 0) {
    console.log(`Onboarding films that were repaired (check these): ${repairedOnboarding.join('; ')}`);
  }
}

main().catch(err => console.error('Something went wrong:', err.message));

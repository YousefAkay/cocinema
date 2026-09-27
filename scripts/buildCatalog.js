import fs from 'fs';
import { getCatalogMovies } from './wikidata.js';
import { omdbGet } from './omdb.js';
import { getEmbedding } from './embeddings.js';

const RAW_PATH = 'data/movies-raw.json';
const CATALOG_PATH = 'data/catalog.json';
const ONBOARDING_PATH = 'data/onboarding.json';
const ENRICH_DELAY_MS = 500;
const EMBEDDING_DIMS = 512;
const SAVE_EVERY = 25;

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

async function loadMovies() {
  if (fs.existsSync(RAW_PATH)) {
    const cached = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
    console.log(`Loaded ${cached.length} movies from cache (${RAW_PATH})`);
    return cached;
  }

  const fresh = await getCatalogMovies();
  fs.writeFileSync(RAW_PATH, JSON.stringify(fresh, null, 2));
  console.log(`Fetched ${fresh.length} movies from Wikidata, cached to ${RAW_PATH}`);
  return fresh;
}

function loadExistingCatalog() {
  if (!fs.existsSync(CATALOG_PATH)) {
    return new Map();
  }

  const existing = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const usable = existing.filter(movie => movie.embedding.length === EMBEDDING_DIMS);
  console.log(`Reusing ${usable.length} of ${existing.length} movies already in ${CATALOG_PATH}`);
  return new Map(usable.map(movie => [movie.id, movie]));
}

function saveCatalog(movies) {
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(movies));
}

async function main() {
  fs.mkdirSync('data', { recursive: true });

  const movies = await loadMovies();
  const onboarding = JSON.parse(fs.readFileSync(ONBOARDING_PATH, 'utf8'));
  const onboardingMovies = onboarding.flatMap(genre => genre.movies);
  console.log(`Loaded ${onboardingMovies.length} onboarding movies from ${ONBOARDING_PATH}`);

  const allMovies = [...movies, ...onboardingMovies];
  const uniqueMovies = Array.from(new Map(allMovies.map(movie => [movie.id, movie])).values());
  console.log(`Unique movies to enrich: ${uniqueMovies.length}`);

  const existingById = loadExistingCatalog();

  const enrichedMovies = [];
  let reused = 0;
  let skipped = 0;
  let failed = 0;
  let stoppedEarly = false;

  for (const movie of uniqueMovies) {
        const existing = existingById.get(movie.id);
    if (existing && titlesMatch(movie.title, existing.title)) {
      enrichedMovies.push(existing);
      reused++;
      continue;
    }

    if (stoppedEarly) {
      continue;
    }

    try {
      const params = { t: movie.title, plot: 'full' };
      if (movie.year) {
        params.y = movie.year;
      }
      const data = await omdbGet(params);

            if (!titlesMatch(movie.title, data.Title)) {
        console.warn(`Skipping "${movie.title}": OMDb returned "${data.Title}"`);
        skipped++;
        continue;
      }

      if (!data.Plot || data.Plot === 'N/A') {
        console.warn(`Skipping "${movie.title}": no plot available`);
        skipped++;
        continue;
      }

      const embedding = await getEmbedding(data.Plot);

      enrichedMovies.push({
        id: movie.id,
        title: data.Title,
        plot: data.Plot,
        poster: data.Poster === 'N/A' ? null : data.Poster,
        embedding: embedding,
      });

      console.log(`[${enrichedMovies.length}] ${data.Title}`);

      if (enrichedMovies.length % SAVE_EVERY === 0) {
        saveCatalog(enrichedMovies);
        console.log(`  (progress saved: ${enrichedMovies.length} movies)`);
      }
    } catch (error) {
      if (error.message.includes('Request limit reached')) {
        console.error('OMDb daily limit reached. Saving progress and stopping; run again tomorrow to continue.');
        stoppedEarly = true;
        continue;
      }
      console.error(`Failed to enrich "${movie.title}": ${error.message}`);
      failed++;
    } finally {
      await sleep(ENRICH_DELAY_MS);
    }
  }

  const enrichedIds = new Set(enrichedMovies.map(m => m.id));
  const missing = onboardingMovies.filter(m => !enrichedIds.has(m.id));
  for (const missingMovie of missing) {
    console.warn(`Missing onboarding movie: ${missingMovie.title} (${missingMovie.id})`);
  }

  if (enrichedMovies.length === 0) {
    throw new Error('No movies were enriched; refusing to overwrite catalog.json');
  }

  saveCatalog(enrichedMovies);
  console.log(`Reused ${reused}, skipped ${skipped} (no plot), failed ${failed}`);
  if (stoppedEarly) {
    console.log('Build is PARTIAL. Run the same command again later to finish.');
  }

  return enrichedMovies;
}

main()
  .then(data => console.log(`Wrote ${data.length} movies to ${CATALOG_PATH}`))
  .catch(err => console.error('Something went wrong:', err.message));
import fs from 'fs';
import { getCatalogMovies } from './wikidata.js';
import { omdbGet } from './omdb.js';
import { getEmbedding } from './embeddings.js';


const RAW_PATH = 'data/movies-raw.json';
const CATALOG_PATH = 'data/catalog.json';
const ENRICH_DELAY_MS = 500;
const ONBOARDING_PATH = 'data/onboarding.json';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function main() {
  fs.mkdirSync('data', { recursive: true });

  const movies = await loadMovies();
  const onboarding = JSON.parse(fs.readFileSync(ONBOARDING_PATH, 'utf8'));

  const onboardingMovies = onboarding.flatMap(genre => genre.movies)
  console.log(`Loaded ${onboardingMovies.length} onboarding movies from ${ONBOARDING_PATH}`);
  
  const allMovies = [...movies, ...onboardingMovies];
  console.log(`Total movies to enrich: ${allMovies.length}`);

  const uniqueMovies = Array.from(new Map(allMovies.map(movie => [movie.id, movie])).values());
  console.log(`Unique movies to enrich: ${uniqueMovies.length}`);

  const enrichedMovies = [];
  let skipped = 0;
  let failed = 0;

  for (const movie of uniqueMovies) {
    try {
      const params = { t: movie.title, plot: 'full' };
      if (movie.year) {
        params.y = movie.year;
      }
      const data = await omdbGet(params);

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
    } catch (error) {
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

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(enrichedMovies));
  console.log(`Skipped ${skipped} (no plot), failed ${failed}`);

  return enrichedMovies;
}



main()
  .then(data => console.log(`Wrote ${data.length} movies to ${CATALOG_PATH}`))
  .catch(err => console.error('Something went wrong:', err.message));
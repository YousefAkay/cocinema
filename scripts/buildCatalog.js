import { getCatalogMovies } from "./wikidata.js";
import { omdbGet } from "./omdb.js";
import { getEmbedding } from "./embeddings.js";
   import fs from 'fs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const movies = await getCatalogMovies();
  console.log(`Got ${movies.length} movies`);

  let enrichedMovies = [];

  for (const movie of movies) {
    try {
    const data = await omdbGet({ t: movie.title
     }); 
    const embedding = await getEmbedding(data.Plot);
    const cleanMovie = {
  id: movie.id,
  title: data.Title,
  plot: data.Plot,
  poster: data.Poster,
  embedding: embedding,
    }
    enrichedMovies = enrichedMovies.concat(cleanMovie);
    }
    catch(error) {
         console.error(`Failed to enrich "${movie.title}": ${error.message}`);
    }
    await sleep(500);
  }

  fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/catalog.json', JSON.stringify(enrichedMovies, null, 2));

  return enrichedMovies;
}

  main()
  .then(data => console.log(`Wrote ${data.length} movies to data/catalog.json`))
  .catch(err => console.error('Something went wrong: ', err.message));
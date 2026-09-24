const USER_AGENT = 'CoCinema/0.3 (akyousef10@gmail.com)';
const GENRE_DELAY_MS = 1500;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function parseResults(data) {
  const bindings = data.results.bindings;

  return bindings.map(entry => ({
    id: entry.item.value,
    title: entry.itemLabel.value,
  }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url) {
  let backoffMs = 1000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;

    try {
      res = await fetch(url, {
        headers: {
          'Accept': 'application/sparql-results+json',
          'User-Agent': USER_AGENT
        }
      });
    } catch (networkError) {
      console.log(`Network error on attempt ${attempt}/${MAX_ATTEMPTS} (${networkError.message}), waiting ${backoffMs}ms...`);
      await sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    if (res.ok) {
      return await res.json();
    }

    if (RETRYABLE_STATUSES.has(res.status)) {
      const retryAfter = res.headers.get('Retry-After');
      const headerMs = retryAfter !== null ? Number(retryAfter) * 1000 : NaN;
      const waitMs = (Number.isNaN(headerMs) || headerMs <= 0) ? backoffMs : headerMs;

      console.log(`Wikidata ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS}, waiting ${waitMs}ms...`);
      await sleep(waitMs);
      backoffMs *= 2;
      continue;
    }

    throw new Error(`WikiData request failed: ${res.status} ${res.statusText}`);
  }

  throw new Error(`WikiData request failed: still failing after ${MAX_ATTEMPTS} attempts`);
}

export async function getMoviesByGenre(genreId, limit) {
  const query = `
    SELECT DISTINCT ?item ?itemLabel WHERE {
      ?item wdt:P31 wd:Q11424.
      ?item wdt:P136 wd:${genreId}.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}`;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchWithRetry(url);
  return parseResults(data);
}

export async function getCatalogMovies() {
  const genreIds = [
    'Q157443',   // comedy
    'Q200092',   // horror
    'Q471839',   // science fiction
    'Q130232',   // drama
    'Q188473',   // action
    'Q2484376',  // thriller
    'Q1054574',  // romance
    'Q202866',   // animated
    'Q319221',   // adventure
    'Q157394',   // fantasy
    'Q959790',   // crime
    'Q93204',    // documentary
    'Q645928',   // biographical
    'Q369747',   // war
    'Q172980',   // western
    'Q1200678',  // mystery
    'Q2143665',  // children's
    'Q1146335',  // teen
    'Q842256',   // musical
    'Q860626',   // romantic comedy
    'Q17013749', // historical
  ];

  let allMovies = [];

   for (const genreId of genreIds) {
    try {
      const movies = await getMoviesByGenre(genreId, 10);
      allMovies = allMovies.concat(movies);
      console.log(`Genre ${genreId}: ${movies.length} movies`);
    } catch (error) {
      console.error(`Skipping genre ${genreId}: ${error.message}`);
    }
    await sleep(GENRE_DELAY_MS);
  }

  if (allMovies.length === 0) {
    throw new Error('Every genre query failed; Wikidata may be down. Try again later.');
  }

  const cleanMovies = allMovies.filter(movie => !/^Q\d+$/.test(movie.title));
  return dedupeMovies(cleanMovies);
}

function dedupeMovies(movies) {
  const seenIds = new Set();
  const unique = [];

  for (const movie of movies) {
    if (!seenIds.has(movie.id)) {
      seenIds.add(movie.id);
      unique.push(movie);
    }
  }

  return unique;
}

/*** getCatalogMovies(10)
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error('Something went wrong:', err.message));

/***getMoviesByGenre('Q157443', 10)
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error('Something went wrong:', err.message));
  
  getMoviesByActor('Q')
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(err => console.error('Something went wrong:', err.message));*/
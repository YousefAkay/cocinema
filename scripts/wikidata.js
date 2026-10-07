const USER_AGENT = 'CoCinema/1.3 (akyousef10@gmail.com)';
const GENRE_DELAY_MS = 1500;
const MAX_ATTEMPTS = 4;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export const GENRES = {
  Q157443: 'comedy',
  Q200092: 'horror',
  Q471839: 'science fiction',
  Q130232: 'drama',
  Q188473: 'action',
  Q2484376: 'thriller',
  Q1054574: 'romance',
  Q202866: 'animated',
  Q319221: 'adventure',
  Q157394: 'fantasy',
  Q959790: 'crime',
  Q645928: 'biographical',
  Q369747: 'war',
  Q172980: 'western',
  Q1200678: 'mystery',
  Q2143665: "children's",
  Q1146335: 'teen',
  Q842256: 'musical',
  Q860626: 'romantic comedy',
  Q17013749: 'historical',
};

export function entityId(uri) {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

// One movie can come back as several rows (one per release date and per genre),
// so rows are folded into a single entry per movie.
function parseResults(data) {
  const byId = new Map();

  for (const entry of data.results.bindings) {
    const id = entry.item.value;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        title: entry.itemLabel.value,
        year: null,
        sitelinks: Number(entry.links.value),
        genres: new Set(),
      });
    }
    const movie = byId.get(id);

    if (entry.date) {
      const year = new Date(entry.date.value).getUTCFullYear();
      if (Number.isInteger(year) && (movie.year === null || year < movie.year)) {
        movie.year = year;
      }
    }
    if (entry.genre) {
      const genreId = entityId(entry.genre.value);
      if (GENRES[genreId]) {
        movie.genres.add(GENRES[genreId]);
      }
    }
  }

  return Array.from(byId.values()).map(movie => ({ ...movie, genres: Array.from(movie.genres) }));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetry(url) {
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
    SELECT ?item ?itemLabel ?links ?date ?genre WHERE {
      {
        SELECT ?item ?links WHERE {
          ?item wdt:P31 wd:Q11424.
          ?item wdt:P136 wd:${genreId}.
          ?item wikibase:sitelinks ?links.
        }
        ORDER BY DESC(?links)
        LIMIT ${limit}
      }
      OPTIONAL { ?item wdt:P577 ?date. }
      OPTIONAL {
        ?item wdt:P136 ?genre.
        VALUES ?genre { ${Object.keys(GENRES).map(id => `wd:${id}`).join(' ')} }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?links)`;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const data = await fetchWithRetry(url);
  return parseResults(data);
}

export async function getCatalogMovies() {
  const genreIds = Object.keys(GENRES);

  let allMovies = [];

   for (const genreId of genreIds) {
    try {
      const movies = await getMoviesByGenre(genreId, 50);
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
  const byId = new Map();

  for (const movie of movies) {
    const seen = byId.get(movie.id);
    if (!seen) {
      byId.set(movie.id, { ...movie, genres: [...movie.genres] });
      continue;
    }
    seen.genres = Array.from(new Set([...seen.genres, ...movie.genres]));
    seen.sitelinks = Math.max(seen.sitelinks, movie.sitelinks);
    if (movie.year !== null && (seen.year === null || movie.year < seen.year)) {
      seen.year = movie.year;
    }
  }

  return Array.from(byId.values());
}

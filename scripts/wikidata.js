function parseResults(data) {
  const bindings = data.results.bindings;

  const parsed = bindings.map(entry => {
    return {
      id: entry.item.value,
      title: entry.itemLabel.value,
    };
  }
);

  return parsed;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function getMoviesByActor(actorId) {
  const query = `
    SELECT DISTINCT ?item ?itemLabel WHERE {
      ?item wdt:P31 wd:Q11424.
      ?item wdt:P161 wd:${actorId}.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`;

    const encodedQuery = encodeURIComponent(query);
    const url = `https://query.wikidata.org/sparql?query=${encodedQuery}&format=json`;

const res = await fetch(url, {
  headers: {
  'Accept': 'application/sparql-results+json',
    'User-Agent': 'Cosinema/0.1, email: akyousef10@gmail.com'
  }} 
);
  if (!res.ok) {
    throw new Error(`WikiData request failed: ${res.status} ${res.statusText}`);
  
  }

  const data = await res.json();
  return parseResults(data);
}

export async function getMoviesByGenre(genreId, limit) {
  const query = `
    SELECT DISTINCT ?item ?itemLabel WHERE {
      ?item wdt:P31 wd:Q11424.
      ?item wdt:P136 wd:${genreId}.
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${limit}`;

  const encodedQuery = encodeURIComponent(query);
  const url = `https://query.wikidata.org/sparql?query=${encodedQuery}&format=json`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'Cosinema/0.1, email: akyousef10@gmail.com'
    }
  });

  if (!res.ok) {
    throw new Error(`WikiData request failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
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
    const movies = await getMoviesByGenre(genreId, 10);
    allMovies = allMovies.concat(movies);
    await sleep(500);
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
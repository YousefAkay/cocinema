const picks = [
  ['sci-fi', 'Interstellar', 2014],
  ['sci-fi', 'The Matrix', 1999],
  ['sci-fi', 'Inception', 2010],
  ['horror', 'It', 2017],
  ['horror', 'Get Out', 2017],
  ['horror', 'Hereditary', 2018],
  ['comedy', 'Superbad', 2007],
  ['comedy', 'Home Alone', 1990],
  ['comedy', 'The Hangover', 2009],
  ['drama', 'The Shawshank Redemption', 1994],
  ['drama', 'Fight Club', 1999],
  ['drama', 'Forrest Gump', 1994],
  ['action', 'Die Hard', 1988],
  ['action', 'John Wick', 2014],
  ['thriller', 'No Country for Old Men', 2007],
  ['thriller', 'Parasite', 2019],
  ['romance', 'Titanic', 1997],
  ['romance', 'The Notebook', 2004],
  ['animation', 'Toy Story', 1995],
  ['animation', 'Ratatouille', 2007],
  ['adventure', 'Jurassic Park', 1993],
  ['adventure', 'Gladiator', 2000],
  ['fantasy', "Pirates of the Caribbean: Dead Man's Chest", 2006],
  ['fantasy', 'The Lord of the Rings: The Fellowship of the Ring', 2001],
  ['crime', 'The Godfather', 1972],
  ['crime', 'The Godfather Part II', 1974],
  ['war', 'Apocalypse Now', 1979],
  ['war', 'Saving Private Ryan', 1998],
  ['war', 'Jarhead', 2005],
  ['musical', 'La La Land', 2016],
  ['musical', 'The Sound of Music', 1965],
  ['mystery', 'Prisoners', 2013],
  ['western', 'Django Unchained', 2012]
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findIds(title, year) {
  const query = `
    SELECT DISTINCT ?item WHERE {
      ?item rdfs:label "${title}"@en .
      ?item wdt:P31/wdt:P279* wd:Q11424 .
      ?item wdt:P577 ?date .
      FILTER(YEAR(?date) = ${year})
    }`;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/sparql-results+json',
      'User-Agent': 'CoCinema/0.1 (akyousef10@gmail.com)'
    }
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.results.bindings.map(b => b.item.value);
}

for (const [genre, title, year] of picks) {
  try {
    const ids = await findIds(title, year);
    const status = ids.length === 1 ? 'OK' : ids.length === 0 ? 'NOT FOUND' : 'MULTIPLE';
    console.log(`${status} | ${genre} | ${title} (${year}) | ${ids.join(', ')}`);
  } catch (err) {
    console.log(`ERROR | ${genre} | ${title} (${year}) | ${err.message}`);
  }
  await sleep(1000);
}
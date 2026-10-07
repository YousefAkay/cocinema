export const EXTRA_COUNT = 5;
export const MAX_PER_GENRE = 2;

function primaryGenre(movie) {
  return (movie.genres && movie.genres[0]) || 'other';
}

// Picks the next film for the "Rate 5 more" flow: the best-known unrated film
// (most sitelinks) that was not skipped or shown already, with at most
// MAX_PER_GENRE films of any primary genre among those rated in this flow.
// Returns null when no film qualifies.
export function pickNextCandidate(catalog, { rated, skipped, shown }) {
  const byId = new Map(catalog.map(movie => [movie.id, movie]));
  const genreCounts = new Map();
  for (const id of shown) {
    if (rated.has(id) && byId.has(id)) {
      const genre = primaryGenre(byId.get(id));
      genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
    }
  }
  const shownSet = new Set(shown);

  const candidates = catalog
    .filter(movie => !rated.has(movie.id) && !skipped.has(movie.id) && !shownSet.has(movie.id))
    .filter(movie => (genreCounts.get(primaryGenre(movie)) || 0) < MAX_PER_GENRE);

  let best = null;
  for (const movie of candidates) {
    if (best === null || (movie.sitelinks || 0) > (best.sitelinks || 0)) {
      best = movie;
    }
  }
  return best;
}

// Wikidata labels for the 15 onboarding genres that differ from the onboarding names.
const ONBOARDING_ALIASES = { 'sci-fi': 'science fiction', animation: 'animated' };
export const MAX_GENRES = 3;

// The catalog label for an onboarding genre name ("Sci-fi" is "science fiction" in the catalog).
export function onboardingLabel(name) {
  const lower = name.toLowerCase();
  return ONBOARDING_ALIASES[lower] || lower;
}

export function titleWithYear(movie) {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

// A film's own genre list has no meaningful order, so genres are ranked once for the whole
// catalog: the genres behind the 15 onboarding picks come first, most common in the catalog
// first, then every other genre, also most common first. Ties break alphabetically.
export function genreOrder(catalog, onboarding) {
  const counts = new Map();
  for (const movie of catalog) {
    for (const genre of movie.genres || []) {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }

  const topLevel = new Set(onboarding.map(entry => onboardingLabel(entry.genre)));

  const byCommonness = (a, b) => (counts.get(b) - counts.get(a)) || a.localeCompare(b);
  const known = [...counts.keys()];
  return [
    ...known.filter(genre => topLevel.has(genre)).sort(byCommonness),
    ...known.filter(genre => !topLevel.has(genre)).sort(byCommonness),
  ];
}

export function topGenres(movie, order, max = MAX_GENRES) {
  const rank = new Map(order.map((genre, index) => [genre, index]));
  return [...(movie.genres || [])]
    .sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b))
    .slice(0, max);
}

export function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const COUNT_STEP = 50;

// A film count for marketing copy: rounded DOWN to the nearest 50 with a plus sign (576 becomes
// "550+", 549 becomes "500+"). Rounding down keeps the label true if films are removed later.
// Returns null when there is no usable count (not a number, or under 50), so the caller can fall
// back to wording without a number.
export function roundedCount(count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < COUNT_STEP) {
    return null;
  }
  return `${Math.floor(count / COUNT_STEP) * COUNT_STEP}+`;
}

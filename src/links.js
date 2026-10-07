const JUSTWATCH_COUNTRIES = [
  { country: 'Canada', code: 'ca' },
  { country: 'United States', code: 'us' },
  { country: 'United Kingdom', code: 'uk' },
];

export function trailerSearchUrl(movie) {
  const query = [movie.title, movie.year, 'trailer'].filter(Boolean).join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

// JustWatch search pages, one per country. These are search links, not a guarantee
// that the film is available there.
export function whereToWatchLinks(movie) {
  return JUSTWATCH_COUNTRIES.map(({ country, code }) => ({
    country,
    code,
    url: `https://www.justwatch.com/${code}/search?q=${encodeURIComponent(movie.title)}`,
  }));
}

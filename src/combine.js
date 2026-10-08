import { recommend } from './recommend.js';
import { percentileRank, topPercent } from './percentile.js';

// Films two people could both enjoy. Each person's taste profile is built by recommend(), which
// uses the same mean-centred profile as the solo results, so a person's score here is exactly
// the score they would see on their own screen.
//
// For every film neither person has rated, each person's score becomes a rank among those same
// films. A film is only as good as its weaker fit, so films are ordered by the worse of the two
// ranks (the larger "Top N%"), then by the average of the two, then by title and id so the order
// is the same every time. Works from Wikidata ids only: nothing depends on catalog order.
//
// Returns { problem, results }. problem is null, 'a' or 'b' when that person's ratings cannot
// make a profile (fewer than 3 known films, or all the same score), and results is then empty.
export function combineTastes(catalog, ratingsA, ratingsB, n = 10) {
  const everyA = recommend(ratingsA, catalog, catalog.length);
  if (everyA.length === 0) return { problem: 'a', results: [] };
  const everyB = recommend(ratingsB, catalog, catalog.length);
  if (everyB.length === 0) return { problem: 'b', results: [] };

  const scoreB = new Map(everyB.map(result => [result.movie.id, result.score]));
  // Candidates are the films neither person rated: unrated for A, and also unrated for B.
  const candidates = everyA
    .filter(result => scoreB.has(result.movie.id))
    .map(result => ({ movie: result.movie, scoreA: result.score, scoreB: scoreB.get(result.movie.id) }));

  const allA = candidates.map(candidate => candidate.scoreA);
  const allB = candidates.map(candidate => candidate.scoreB);

  const ranked = candidates.map(candidate => {
    const rankA = percentileRank(candidate.scoreA, allA);
    const rankB = percentileRank(candidate.scoreB, allB);
    return {
      movie: candidate.movie,
      percentA: topPercent(candidate.scoreA, allA),
      percentB: topPercent(candidate.scoreB, allB),
      scoreA: candidate.scoreA,
      scoreB: candidate.scoreB,
      worst: Math.max(rankA, rankB),
      average: (rankA + rankB) / 2,
    };
  });

  ranked.sort((x, y) => (x.worst - y.worst)
    || (x.average - y.average)
    || x.movie.title.localeCompare(y.movie.title)
    || x.movie.id.localeCompare(y.movie.id));

  return {
    problem: null,
    results: ranked.slice(0, n).map(({ movie, percentA, percentB, scoreA, scoreB }) => ({ movie, percentA, percentB, scoreA, scoreB })),
  };
}

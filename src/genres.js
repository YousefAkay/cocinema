// Genre mode: rate films from one genre and get back only films from that genre. Pure functions,
// no DOM. The ranking itself is recommend() over the whole catalog, unchanged; this module only
// chooses which films to ask about and which ranked films to keep.
import { seededRandom, shuffle } from './shuffle.js';
import { onboardingLabel } from './format.js';

// A genre is offered when at least this many catalog films carry its label.
export const MIN_GENRE_FILMS = 35;

// How many of the best-known films (after any onboarding pool) the session seed shuffles, so a
// repeat visitor sees a different mix that is still made of well-known films.
export const SHUFFLE_WINDOW = 30;

// The genres to offer, as [{ label, count }], largest first; ties break alphabetically.
export function availableGenres(catalog, min = MIN_GENRE_FILMS) {
  const counts = new Map();
  for (const movie of catalog) {
    for (const genre of new Set(movie.genres || [])) {
      counts.set(genre, (counts.get(genre) || 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, count]) => ({ label, count }));
}

// The films to ask about, as catalog ids: films carrying the genre, best known first (sitelinks).
// The genre's onboarding pool, if it has one, comes first in a seeded order; then the next
// SHUFFLE_WINDOW best-known films in a seeded order; then the rest by sitelinks. Same seed, same queue.
export function buildGenreQueue(catalog, onboarding, label, seed) {
  const random = seededRandom(seed);
  const inGenre = catalog
    .filter(movie => (movie.genres || []).includes(label))
    .sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0) || a.id.localeCompare(b.id));
  const known = new Set(inGenre.map(movie => movie.id));

  const pool = onboarding.find(entry => onboardingLabel(entry.genre) === label);
  const poolIds = pool ? pool.movies.map(movie => movie.id).filter(id => known.has(id)) : [];
  const taken = new Set(poolIds);
  const rest = inGenre.map(movie => movie.id).filter(id => !taken.has(id));

  return [
    ...shuffle(poolIds, random),
    ...shuffle(rest.slice(0, SHUFFLE_WINDOW), random),
    ...rest.slice(SHUFFLE_WINDOW),
  ];
}

function ratedInQueue(queue, rated) {
  return queue.filter(id => rated.has(id)).length;
}

function step(queue, movieIndex, label, rated, target, isCurrentRated) {
  const count = ratedInQueue(queue, rated);
  return {
    done: false, genreIndex: 0, movieIndex, movieId: queue[movieIndex], genre: label,
    n: Math.min(target, count + (isCurrentRated ? 0 : 1)), of: target,
  };
}

function finished(target) {
  return { done: true, genreIndex: target, movieIndex: 0, n: target, of: target };
}

// The film at a saved position (genreIndex equal to the target means finished). A film the
// visitor went back to keeps its place in the count.
export function genreStepAt(queue, label, genreIndex, movieIndex, { rated }, target) {
  if (genreIndex >= target || movieIndex >= queue.length) return finished(target);
  return step(queue, movieIndex, label, rated, target, rated.has(queue[movieIndex]));
}

// After any answer: finished once `target` films of the queue are rated or the queue runs out;
// otherwise the first film of the queue not yet rated or skipped.
export function nextGenreStep(queue, label, { rated, skipped }, target) {
  if (ratedInQueue(queue, rated) >= target) return finished(target);
  const movieIndex = queue.findIndex(id => !rated.has(id) && !skipped.has(id));
  if (movieIndex === -1) return finished(target);
  return step(queue, movieIndex, label, rated, target, false);
}

// Results for genre mode: the full ranking, kept to films carrying the genre and never a film the
// visitor rated. The order and scores are recommend()'s own.
export function filterGenreResults(ranked, label, ratedIds) {
  return ranked.filter(result => !ratedIds.has(result.movie.id) && (result.movie.genres || []).includes(label));
}

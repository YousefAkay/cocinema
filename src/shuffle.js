// Seeded randomness for the onboarding order: the same seed always gives the same order,
// so a refresh can rebuild exactly what the user was looking at.

// A random whole number to start a new onboarding session from.
export function newSeed() {
  return Math.floor(Math.random() * 4294967296);
}

// Small seeded random number generator (mulberry32). Returns numbers in [0, 1).
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fisher-Yates: walk from the end, swapping each position with a random position at or
// before it. Every ordering is equally likely. Returns a new array and leaves the input alone.
export function shuffle(list, random) {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// How many genres (and so roughly how many films) a session covers: Quick or Full.
export const LENGTHS = [10, 15];

export function isValidLength(value) {
  return LENGTHS.includes(value);
}

// The onboarding order for one session: genres in a random order, and the films inside each
// genre in a random order. A Quick session (10) takes the first 10 genres of that shuffled
// order, so each session asks about a different 10, and the same seed always gives the same ones.
// Same seed, same pools and same length give the same result.
export function buildSession(onboarding, seed, length = onboarding.length) {
  if (!isValidLength(length) && length !== onboarding.length) {
    throw new Error(`Unsupported session length: ${length}`);
  }
  const random = seededRandom(seed);
  const genres = shuffle(onboarding, random).slice(0, length);
  return genres.map(entry => ({ ...entry, movies: shuffle(entry.movies, random) }));
}

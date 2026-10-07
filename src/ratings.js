import { EXTRA_COUNT } from './candidates.js';

const STORAGE_KEY = 'cocinema:v2';

const ratings = new Map();
const skipped = new Set();
let position = { genreIndex: 0, movieIndex: 0 };
let extra = null;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ratings: Array.from(ratings),
      skipped: Array.from(skipped),
      genreIndex: position.genreIndex,
      movieIndex: position.movieIndex,
      extra,
    }));
  } catch (e) {
    // Storage unavailable (private mode, quota): keep going in memory only.
  }
}

export function saveRating(movieId, score) {
  ratings.set(movieId, score);
  persist();
}

export function getAllRatings() {
  const entries = Array.from(ratings);
  const formatted = entries.map(([movieId, score]) => ({ id: movieId, score: score }));
  return formatted;
}

export function markSkipped(movieId) {
  skipped.add(movieId);
  persist();
}

export function getSkippedIds() {
  return Array.from(skipped);
}

export function savePosition(genreIndex, movieIndex) {
  position = { genreIndex, movieIndex };
  persist();
}

// The "Rate 5 more" flow: { rated: films rated so far, shown: ids shown so far, last one on screen },
// or null when that flow is not running.
export function saveExtra(state) {
  extra = state;
  persist();
}

function validExtra(value, validIds) {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  if (!Number.isInteger(value.rated) || value.rated < 0 || value.rated >= EXTRA_COUNT) return false;
  if (!Array.isArray(value.shown) || value.shown.length === 0 || value.shown.length > 500) return false;
  if (new Set(value.shown).size !== value.shown.length) return false;
  return value.shown.every(id => typeof id === 'string' && validIds.has(id));
}

// Returns the saved { genreIndex, movieIndex, extra } and refills the ratings, or null
// if nothing usable was saved. Anything malformed is ignored as a whole.
export function loadSavedState(validIds, genreCount) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return null;
  }

  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.ratings) || !Array.isArray(saved.skipped)) {
    return null;
  }
  const { genreIndex, movieIndex } = saved;
  if (!Number.isInteger(genreIndex) || genreIndex < 0 || genreIndex > genreCount) return null;
  if (!Number.isInteger(movieIndex) || movieIndex < 0) return null;

  const restored = [];
  for (const entry of saved.ratings) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, score] = entry;
    if (typeof id !== 'string' || !validIds.has(id)) return null;
    if (!Number.isInteger(score) || score < 1 || score > 10) return null;
    restored.push([id, score]);
  }

  if (!saved.skipped.every(id => typeof id === 'string' && validIds.has(id))) return null;

  // The extra flow only exists once onboarding is finished.
  if (!validExtra(saved.extra, validIds)) return null;
  if (saved.extra !== null && genreIndex !== genreCount) return null;

  ratings.clear();
  for (const [id, score] of restored) ratings.set(id, score);
  skipped.clear();
  for (const id of saved.skipped) skipped.add(id);
  position = { genreIndex, movieIndex };
  extra = saved.extra;
  return { genreIndex, movieIndex, extra };
}

export function clearSavedState() {
  ratings.clear();
  skipped.clear();
  position = { genreIndex: 0, movieIndex: 0 };
  extra = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Nothing to clear if storage is unavailable.
  }
}

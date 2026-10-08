import { EXTRA_COUNT } from './candidates.js';
import { isValidLength } from './shuffle.js';
import { SAMPLE_KEYS } from './samples.js';

const STORAGE_KEY = 'cocinema:v4';

const ratings = new Map();
const skipped = new Set();
let position = { genreIndex: 0, movieIndex: 0 };
let extra = null;
let seed = null;
let length = null;
let friend = null;

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ratings: Array.from(ratings),
      seed,
      length,
      skipped: Array.from(skipped),
      genreIndex: position.genreIndex,
      movieIndex: position.movieIndex,
      extra,
      friend: friend ? { ratings: friend.ratings.map(item => [item.id, item.score]), skipped: friend.skipped, sample: friend.sample } : null,
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

// The number the onboarding order is built from, so a refresh rebuilds the same order.
export function saveSeed(value) {
  seed = value;
  persist();
}

// Quick (10) or Full (15): how many genres this session covers. Anything else is ignored.
export function saveLength(value) {
  if (!isValidLength(value)) return;
  length = value;
  persist();
}

// A friend's shared taste, kept apart from the visitor's own ratings: it is never added to them
// and never changes the visitor's own profile. { ratings: [{ id, score }], skipped, sample }.
export function saveFriend(value) {
  friend = value ? { ratings: value.ratings.map(item => ({ id: item.id, score: item.score })), skipped: value.skipped, sample: value.sample || null } : null;
  persist();
}

export function getFriend() {
  return friend ? { ratings: friend.ratings.map(item => ({ ...item })), skipped: friend.skipped, sample: friend.sample } : null;
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

function validSeed(value) {
  return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

// Returns the friend as stored, or null when it is missing or not valid. Unlike the other fields,
// a bad friend never costs the visitor their own saved ratings: it is simply dropped.
function readFriend(value, validIds) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.ratings)) return null;
  if (value.ratings.length === 0 || value.ratings.length > 120) return null;
  if (!Number.isInteger(value.skipped) || value.skipped < 0 || value.skipped > 1000) return null;
  if (value.sample !== null && value.sample !== undefined && !SAMPLE_KEYS.includes(value.sample)) return null;
  const seen = new Set();
  const list = [];
  for (const entry of value.ratings) {
    if (!Array.isArray(entry) || entry.length !== 2) return null;
    const [id, score] = entry;
    if (typeof id !== 'string' || !validIds.has(id) || seen.has(id)) return null;
    if (!Number.isInteger(score) || score < 1 || score > 10) return null;
    seen.add(id);
    list.push({ id, score });
  }
  return { ratings: list, skipped: value.skipped, sample: value.sample || null };
}

function validExtra(value, validIds) {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  if (!Number.isInteger(value.rated) || value.rated < 0 || value.rated >= EXTRA_COUNT) return false;
  if (!Array.isArray(value.shown) || value.shown.length === 0 || value.shown.length > 500) return false;
  if (new Set(value.shown).size !== value.shown.length) return false;
  return value.shown.every(id => typeof id === 'string' && validIds.has(id));
}

// Returns the saved { seed, length, genreIndex, movieIndex, extra } and refills the ratings, or null
// if nothing usable was saved. Anything malformed is ignored as a whole.
export function loadSavedState(validIds) {
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
  if (!validSeed(saved.seed)) return null;
  if (!isValidLength(saved.length)) return null;
  const genreCount = saved.length;
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
  friend = readFriend(saved.friend, validIds);
  seed = saved.seed;
  length = saved.length;
  return { seed, length, genreIndex, movieIndex, extra };
}

export function clearSavedState() {
  ratings.clear();
  skipped.clear();
  position = { genreIndex: 0, movieIndex: 0 };
  extra = null;
  seed = null;
  length = null;
  friend = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Nothing to clear if storage is unavailable.
  }
}

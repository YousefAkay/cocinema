const STORAGE_KEY = 'cocinema:v1';

const ratings = new Map();
let position = { genreIndex: 0, movieIndex: 0 };

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ratings: Array.from(ratings),
      genreIndex: position.genreIndex,
      movieIndex: position.movieIndex,
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

export function savePosition(genreIndex, movieIndex) {
  position = { genreIndex, movieIndex };
  persist();
}

// Returns the saved { genreIndex, movieIndex } and refills the ratings, or null
// if nothing usable was saved. Anything malformed is ignored as a whole.
export function loadSavedState(validIds, genreCount) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    return null;
  }

  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.ratings)) {
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

  ratings.clear();
  for (const [id, score] of restored) ratings.set(id, score);
  position = { genreIndex, movieIndex };
  return { genreIndex, movieIndex };
}

export function clearSavedState() {
  ratings.clear();
  position = { genreIndex: 0, movieIndex: 0 };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    // Nothing to clear if storage is unavailable.
  }
}

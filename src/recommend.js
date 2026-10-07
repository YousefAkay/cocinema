import { cosineSimilarity, dotProduct, magnitude } from './similarity.js';

// Builds the taste profile shared by recommend() and explainMatch(), so the
// explanation can never disagree with the ranking. Returns null when there is
// nothing to rank with (fewer than 3 usable ratings, or an all-zero profile).
function buildProfile(ratings, movieById) {
  const usableRatings = ratings.filter(rating => movieById.has(rating.id));

  if (usableRatings.length < 3) {
    return null;
  }

  const averageScore = usableRatings.reduce((sum, rating) => sum + rating.score, 0) / usableRatings.length;

  const weightedRatings = usableRatings.map(rating => {
    const movie = movieById.get(rating.id);
    return { id: rating.id, score: rating.score, weight: rating.score - averageScore, embedding: movie.embedding };
  });

  const profile = new Array(weightedRatings[0].embedding.length).fill(0);

  for (const item of weightedRatings) {
    for (let k = 0; k < item.embedding.length; k++) {
      profile[k] += item.weight * item.embedding[k];
    }
  }

  const profileMagnitude = magnitude(profile);
  if (profileMagnitude === 0) {
    return null;
  }

  return { usableRatings, weightedRatings, profile, profileMagnitude };
}

export function recommend(ratings, catalog, n) {
  const movieIdToMovieMap = new Map(catalog.map(movie => [movie.id, movie]));

  const built = buildProfile(ratings, movieIdToMovieMap);
  if (!built) {
    return [];
  }

  const ratedIds = new Set(built.usableRatings.map(rating => rating.id));

  return catalog
    .filter(movie => !ratedIds.has(movie.id))
    .map(movie => {
      const score = cosineSimilarity(built.profile, movie.embedding);
      return { movie, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

// Splits a movie's match score into one contribution per rated movie.
// The score is cos(profile, movie) = dot(profile, movie) / (|profile| * |movie|), and the
// profile is a sum of weight * embedding, so the dot product distributes over that sum:
//   contribution_i = weight_i * dot(embedding_i, movie) / (|profile| * |movie|)
// and the contributions add up exactly to the match score. Sorted from the largest
// positive contribution to the most negative. Returns [] where recommend() would
// not rank (too few ratings, zero profile), or for unknown or already-rated movies.
export function explainMatch(movieId, ratings, catalog) {
  const movieIdToMovieMap = new Map(catalog.map(movie => [movie.id, movie]));

  const movie = movieIdToMovieMap.get(movieId);
  if (!movie) {
    return [];
  }

  const built = buildProfile(ratings, movieIdToMovieMap);
  if (!built || built.usableRatings.some(rating => rating.id === movieId)) {
    return [];
  }

  const movieMagnitude = magnitude(movie.embedding);
  if (movieMagnitude === 0) {
    return [];
  }

  const denominator = built.profileMagnitude * movieMagnitude;

  return built.weightedRatings
    .map(item => ({
      id: item.id,
      title: movieIdToMovieMap.get(item.id).title,
      year: movieIdToMovieMap.get(item.id).year,
      score: item.score,
      weight: item.weight,
      contribution: item.weight * dotProduct(item.embedding, movie.embedding) / denominator,
    }))
    .sort((a, b) => b.contribution - a.contribution);
}

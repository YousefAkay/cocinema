import { cosineSimilarity, magnitude } from './similarity.js';

export function recommend(ratings, catalog, n) {
  const movieIdToMovieMap = new Map(catalog.map(movie => [movie.id, movie]));

  const usableRatings = ratings.filter(rating => movieIdToMovieMap.has(rating.id));

  if (usableRatings.length < 3) {
    return [];
  }

  const averageScore = usableRatings.reduce((sum, rating) => sum + rating.score, 0) / usableRatings.length;

  const weightedRatings = usableRatings.map(rating => {
    const movie = movieIdToMovieMap.get(rating.id);
    return { weight: rating.score - averageScore, embedding: movie.embedding };
  });

  const profile = new Array(weightedRatings[0].embedding.length).fill(0);

  for (const item of weightedRatings) {
    for (let k = 0; k < item.embedding.length; k++) {
      profile[k] += item.weight * item.embedding[k];
    }
  }

 if (magnitude(profile) === 0) {
    return [];
  }

    const recommendations = catalog .filter(movie => !usableRatings.some(rating => rating.id === movie.id))
    .map(movie => {
      const score = cosineSimilarity(profile, movie.embedding);
      return { movie, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n)

return recommendations;
}

// console.log(movieIdToMovieMap.size);             // 3
// console.log(movieIdToMovieMap.get(2).title);     // "Inception"

 // return weightedRatings.map(item => item.weight);
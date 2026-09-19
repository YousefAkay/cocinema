const ratings = new Map();

function saveRating(movieId, score) {
  ratings.set(movieId, score);
}

function getAllRatings() {
  const entries = Array.from(ratings);
  const formatted = entries.map(([movieId, score]) => ({ id: movieId, score: score }));
  return formatted;
}

/*saveRating('Q123', 8);
saveRating('Q456', 5);
console.log(getAllRatings()); */

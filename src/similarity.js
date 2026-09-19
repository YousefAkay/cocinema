function dotProduct(a, b) {
  const products = a.map((value, index) => value * b[index]);
  const total = products.reduce((sum, current) => sum + current, 0);
  return total;
}

function magnitude(vector) {
  const squared = vector.map((value) => value * value);
   const sumOfSquares = squared.reduce((sum, current) => sum + current, 0);
  const squareRoot = Math.sqrt(sumOfSquares);
  return squareRoot;
}

function cosineSimilarity(a, b) {
  const dot = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);
  return dot / (magA * magB);
}


/* Identical vectors — same direction, should be exactly 1
console.log(cosineSimilarity([1, 2, 3], [1, 2, 3])); // expect: 1

// Opposite direction — should be exactly -1
console.log(cosineSimilarity([1, 0], [-1, 0])); // expect: -1

// Perpendicular vectors — no relationship in direction, should be exactly 0
console.log(cosineSimilarity([1, 0], [0, 1])); // expect: 0

// Same direction, different magnitude — cosine similarity ignores length, should still be 1
console.log(cosineSimilarity([1, 2, 3], [2, 4, 6])); // expect: 1

// Partially similar — some overlap, not identical or opposite — should land between 0 and 1
console.log(cosineSimilarity([1, 2, 0], [1, 0, 2])); // expect: 0.2 (roughly) */
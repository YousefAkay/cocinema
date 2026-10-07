import test from 'node:test';
import assert from 'node:assert/strict';
import { dotProduct, magnitude, cosineSimilarity } from '../src/similarity.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} !~ ${expected}`);

test('dotProduct multiplies matching positions and sums them', () => {
  assert.equal(dotProduct([1, 2, 3], [4, 5, 6]), 32); // 4 + 10 + 18
  assert.equal(dotProduct([1, 0], [0, 1]), 0);
  assert.equal(dotProduct([], []), 0);
});

test('magnitude is the Euclidean length', () => {
  assert.equal(magnitude([3, 4]), 5);
  assert.equal(magnitude([0, 0, 0]), 0);
  assert.equal(magnitude([-3, -4]), 5);
  assert.equal(magnitude([]), 0);
});

test('cosineSimilarity of identical vectors is 1', () => {
  close(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test('cosineSimilarity ignores length, only direction matters', () => {
  close(cosineSimilarity([1, 2, 3], [2, 4, 6]), 1);
});

test('cosineSimilarity of orthogonal vectors is 0', () => {
  close(cosineSimilarity([1, 0], [0, 1]), 0);
});

test('cosineSimilarity of opposite vectors is -1', () => {
  close(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test('cosineSimilarity of a partial overlap is between 0 and 1', () => {
  // dot = 1, both lengths sqrt(5), so 1 / 5
  close(cosineSimilarity([1, 2, 0], [1, 0, 2]), 0.2);
});

test('cosineSimilarity with a zero vector or empty vectors is 0, not NaN', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 2], [0, 0]), 0);
  assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});

test('cosineSimilarity stays finite when the first vector is the shorter one', () => {
  // Mismatched lengths never happen with catalog data (every embedding has 512 numbers).
  // This only pins down that the shorter-first case does not produce NaN.
  assert.ok(Number.isFinite(cosineSimilarity([1], [1, 2])));
});

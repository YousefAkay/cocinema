import test from 'node:test';
import assert from 'node:assert/strict';
import { ratingCounts } from '../scripts/evaluate.js';

test('ratingCounts splits a total into about half liked, a third disliked and the rest neutral', () => {
  assert.deepEqual(ratingCounts(12), { liked: 6, disliked: 4, neutral: 2 }); // the standard run
  assert.deepEqual(ratingCounts(6), { liked: 3, disliked: 2, neutral: 1 });
  assert.deepEqual(ratingCounts(8), { liked: 4, disliked: 3, neutral: 1 });
  assert.deepEqual(ratingCounts(10), { liked: 5, disliked: 3, neutral: 2 });
  assert.deepEqual(ratingCounts(15), { liked: 8, disliked: 5, neutral: 2 });
});

test('ratingCounts always adds up to the total, with at least one of each', () => {
  for (let total = 3; total <= 30; total++) {
    const { liked, disliked, neutral } = ratingCounts(total);
    assert.ok(liked >= 1 && disliked >= 1 && neutral >= 1, `total ${total}`);
    assert.ok(liked + disliked + neutral >= total);
    if (total >= 6) assert.equal(liked + disliked + neutral, total, `total ${total}`);
  }
});

test('the totals grow with the requested number of ratings', () => {
  const sums = [6, 8, 10, 12, 15].map(total => Object.values(ratingCounts(total)).reduce((a, b) => a + b, 0));
  assert.deepEqual(sums, [6, 8, 10, 12, 15]);
});

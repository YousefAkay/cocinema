import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNextCandidate, MAX_PER_GENRE } from '../src/candidates.js';

const movie = (id, sitelinks, genres) => ({ id, title: id, sitelinks, genres });
const none = () => new Set();

const catalog = [
  movie('low', 10, ['drama']),
  movie('top', 100, ['drama']),
  movie('mid', 50, ['comedy']),
  movie('drama2', 90, ['drama']),
  movie('drama3', 80, ['drama']),
  movie('noGenre', 70, []),
];

test('picks the best-known unrated film first', () => {
  const next = pickNextCandidate(catalog, { rated: none(), skipped: none(), shown: [] });
  assert.equal(next.id, 'top');
});

test('never picks a rated, skipped or already shown film', () => {
  const next = pickNextCandidate(catalog, {
    rated: new Set(['top']), skipped: new Set(['drama2']), shown: ['top', 'drama3'],
  });
  assert.equal(next.id, 'noGenre');
});

test('allows at most two films of one primary genre among those rated in the flow', () => {
  assert.equal(MAX_PER_GENRE, 2);
  const next = pickNextCandidate(catalog, {
    rated: new Set(['top', 'drama2']), skipped: none(), shown: ['top', 'drama2'],
  });
  // drama3 and low are drama, so they are blocked.
  assert.equal(next.id, 'noGenre');
});

test('skipped films do not count towards the genre limit', () => {
  const next = pickNextCandidate(catalog, {
    rated: new Set(['top']), skipped: new Set(['drama2']), shown: ['top', 'drama2'],
  });
  assert.equal(next.id, 'drama3');
});

test('returns null when nothing qualifies', () => {
  const only = [movie('a', 5, ['drama'])];
  assert.equal(pickNextCandidate(only, { rated: new Set(['a']), skipped: none(), shown: [] }), null);
  assert.equal(pickNextCandidate([], { rated: none(), skipped: none(), shown: [] }), null);
});

test('films without sitelinks or genres are still eligible', () => {
  const sparse = [{ id: 'x', title: 'x' }];
  assert.equal(pickNextCandidate(sparse, { rated: none(), skipped: none(), shown: [] }).id, 'x');
});

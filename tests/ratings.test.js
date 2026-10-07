import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveRating, getAllRatings, markSkipped, getSkippedIds, savePosition, saveExtra, loadSavedState, clearSavedState,
} from '../src/ratings.js';

const KEY = 'cocinema:v2';
const ids = new Set(['a', 'b', 'c']);
let store;

function useWorkingStorage() {
  store = {};
  globalThis.localStorage = {
    getItem: key => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: key => { delete store[key]; },
  };
}

function useThrowingStorage() {
  const boom = () => { throw new Error('storage unavailable'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
}

beforeEach(() => {
  useWorkingStorage();
  clearSavedState();
});

test('saveRating and savePosition write one JSON record under the versioned key', () => {
  saveRating('a', 7);
  savePosition(2, 1);
  assert.deepEqual(JSON.parse(store[KEY]), { ratings: [['a', 7]], skipped: [], genreIndex: 2, movieIndex: 1, extra: null });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
});

test('a saved state loads back with its ratings and position', () => {
  store[KEY] = JSON.stringify({ ratings: [['a', 7], ['b', 3]], skipped: ['c'], genreIndex: 2, movieIndex: 1, extra: null });
  assert.deepEqual(loadSavedState(ids, 5), { genreIndex: 2, movieIndex: 1, extra: null });
  assert.deepEqual(getSkippedIds(), ['c']);
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }, { id: 'b', score: 3 }]);
});

test('a position at the end (genreIndex equal to the genre count) is accepted', () => {
  store[KEY] = JSON.stringify({ ratings: [], skipped: [], genreIndex: 5, movieIndex: 0, extra: null });
  assert.deepEqual(loadSavedState(ids, 5), { genreIndex: 5, movieIndex: 0, extra: null });
});

test('nothing saved gives null', () => {
  assert.equal(loadSavedState(ids, 5), null);
});

test('invalid saves are ignored whole and leave the ratings empty', () => {
  const good = { skipped: [], genreIndex: 0, movieIndex: 0, extra: null };
  const bad = {
    'not JSON': 'garbage{',
    'not an object': '42',
    'null': 'null',
    'ratings not an array': JSON.stringify({ ratings: 'x', ...good }),
    'missing positions': JSON.stringify({ ratings: [], skipped: [] }),
    'missing skipped list': JSON.stringify({ ratings: [], genreIndex: 0, movieIndex: 0, extra: null }),
    'skipped has an unknown id': JSON.stringify({ ratings: [], ...good, skipped: ['zzz'] }),
    'extra before onboarding is finished': JSON.stringify({ ratings: [], ...good, extra: { rated: 1, shown: ['a'] } }),
    'extra with rated out of range': JSON.stringify({ ratings: [], ...good, genreIndex: 5, extra: { rated: 5, shown: ['a'] } }),
    'extra with no shown films': JSON.stringify({ ratings: [], ...good, genreIndex: 5, extra: { rated: 0, shown: [] } }),
    'extra with an unknown shown id': JSON.stringify({ ratings: [], ...good, genreIndex: 5, extra: { rated: 0, shown: ['zzz'] } }),
    'extra with a repeated shown id': JSON.stringify({ ratings: [], ...good, genreIndex: 5, extra: { rated: 0, shown: ['a', 'a'] } }),
    'extra of the wrong type': JSON.stringify({ ratings: [], ...good, genreIndex: 5, extra: 'yes' }),
    'negative genreIndex': JSON.stringify({ ratings: [], ...good, genreIndex: -1 }),
    'genreIndex too large': JSON.stringify({ ratings: [], ...good, genreIndex: 6 }),
    'fractional movieIndex': JSON.stringify({ ratings: [], ...good, movieIndex: 1.5 }),
    'negative movieIndex': JSON.stringify({ ratings: [], ...good, movieIndex: -2 }),
    'rating entry wrong shape': JSON.stringify({ ratings: [['a']], ...good }),
    'rating entry not an array': JSON.stringify({ ratings: ['a'], ...good }),
    'unknown movie id': JSON.stringify({ ratings: [['zzz', 5]], ...good }),
    'non-string id': JSON.stringify({ ratings: [[1, 5]], ...good }),
    'score below range': JSON.stringify({ ratings: [['a', 0]], ...good }),
    'score above range': JSON.stringify({ ratings: [['a', 11]], ...good }),
    'fractional score': JSON.stringify({ ratings: [['a', 5.5]], ...good }),
    'string score': JSON.stringify({ ratings: [['a', '5']], ...good }),
    'one good and one bad rating': JSON.stringify({ ratings: [['a', 5], ['zzz', 5]], ...good }),
  };

  for (const [name, value] of Object.entries(bad)) {
    store[KEY] = value;
    assert.equal(loadSavedState(ids, 5), null, name);
    assert.deepEqual(getAllRatings(), [], `${name}: ratings must stay empty`);
  }
});

test('an extra flow in progress is saved and loaded back', () => {
  markSkipped('c');
  saveExtra({ rated: 2, shown: ['a', 'b'] });
  assert.deepEqual(JSON.parse(store[KEY]).extra, { rated: 2, shown: ['a', 'b'] });
  store[KEY] = JSON.stringify({ ratings: [], skipped: [], genreIndex: 5, movieIndex: 0, extra: { rated: 2, shown: ['a', 'b'] } });
  assert.deepEqual(loadSavedState(ids, 5), { genreIndex: 5, movieIndex: 0, extra: { rated: 2, shown: ['a', 'b'] } });
});

test('an old version-1 save is ignored, not loaded', () => {
  store['cocinema:v1'] = JSON.stringify({ ratings: [['a', 7]], genreIndex: 2, movieIndex: 1 });
  assert.equal(loadSavedState(ids, 5), null);
  assert.deepEqual(getAllRatings(), []);
});

test('clearSavedState removes the save and empties the ratings', () => {
  saveRating('a', 7);
  savePosition(1, 1);
  clearSavedState();
  assert.equal(KEY in store, false);
  assert.deepEqual(getAllRatings(), []);
});

test('a storage that throws never crashes; ratings stay in memory', () => {
  useThrowingStorage();
  assert.doesNotThrow(() => saveRating('a', 7));
  assert.doesNotThrow(() => savePosition(1, 0));
  assert.equal(loadSavedState(ids, 5), null);
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
  assert.doesNotThrow(() => clearSavedState());
  assert.deepEqual(getAllRatings(), []);
});

test('a missing localStorage object (not just a throwing one) does not crash', () => {
  delete globalThis.localStorage;
  assert.doesNotThrow(() => saveRating('a', 7));
  assert.equal(loadSavedState(ids, 5), null);
  assert.doesNotThrow(() => clearSavedState());
});

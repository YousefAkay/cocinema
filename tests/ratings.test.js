import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { saveRating, getAllRatings, savePosition, loadSavedState, clearSavedState } from '../src/ratings.js';

const KEY = 'cocinema:v1';
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
  assert.deepEqual(JSON.parse(store[KEY]), { ratings: [['a', 7]], genreIndex: 2, movieIndex: 1 });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
});

test('a saved state loads back with its ratings and position', () => {
  store[KEY] = JSON.stringify({ ratings: [['a', 7], ['b', 3]], genreIndex: 2, movieIndex: 1 });
  assert.deepEqual(loadSavedState(ids, 5), { genreIndex: 2, movieIndex: 1 });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }, { id: 'b', score: 3 }]);
});

test('a position at the end (genreIndex equal to the genre count) is accepted', () => {
  store[KEY] = JSON.stringify({ ratings: [], genreIndex: 5, movieIndex: 0 });
  assert.deepEqual(loadSavedState(ids, 5), { genreIndex: 5, movieIndex: 0 });
});

test('nothing saved gives null', () => {
  assert.equal(loadSavedState(ids, 5), null);
});

test('invalid saves are ignored whole and leave the ratings empty', () => {
  const good = { genreIndex: 0, movieIndex: 0 };
  const bad = {
    'not JSON': 'garbage{',
    'not an object': '42',
    'null': 'null',
    'ratings not an array': JSON.stringify({ ratings: 'x', ...good }),
    'missing positions': JSON.stringify({ ratings: [] }),
    'negative genreIndex': JSON.stringify({ ratings: [], genreIndex: -1, movieIndex: 0 }),
    'genreIndex too large': JSON.stringify({ ratings: [], genreIndex: 6, movieIndex: 0 }),
    'fractional movieIndex': JSON.stringify({ ratings: [], genreIndex: 0, movieIndex: 1.5 }),
    'negative movieIndex': JSON.stringify({ ratings: [], genreIndex: 0, movieIndex: -2 }),
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

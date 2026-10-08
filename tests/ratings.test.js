import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveRating, getAllRatings, markSkipped, getSkippedIds, savePosition, saveExtra, saveSeed, saveLength, saveFriend, getFriend, loadSavedState, clearSavedState,
} from '../src/ratings.js';

const KEY = 'cocinema:v4';
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
  saveSeed(123);
  saveLength(10);
  saveRating('a', 7);
  savePosition(2, 1);
  assert.deepEqual(JSON.parse(store[KEY]), { ratings: [['a', 7]], seed: 123, length: 10, skipped: [], genreIndex: 2, movieIndex: 1, extra: null, friend: null });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
});

test('a saved state loads back with its ratings and position', () => {
  store[KEY] = JSON.stringify({ ratings: [['a', 7], ['b', 3]], seed: 42, length: 10, skipped: ['c'], genreIndex: 2, movieIndex: 1, extra: null });
  assert.deepEqual(loadSavedState(ids), { seed: 42, length: 10, genreIndex: 2, movieIndex: 1, extra: null });
  assert.deepEqual(getSkippedIds(), ['c']);
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }, { id: 'b', score: 3 }]);
});

test('a position at the end (genreIndex equal to the genre count) is accepted', () => {
  store[KEY] = JSON.stringify({ ratings: [], seed: 0, length: 10, skipped: [], genreIndex: 10, movieIndex: 0, extra: null });
  assert.deepEqual(loadSavedState(ids), { seed: 0, length: 10, genreIndex: 10, movieIndex: 0, extra: null });
});

test('nothing saved gives null', () => {
  assert.equal(loadSavedState(ids), null);
});

test('invalid saves are ignored whole and leave the ratings empty', () => {
  const good = { seed: 7, length: 10, skipped: [], genreIndex: 0, movieIndex: 0, extra: null };
  const bad = {
    'not JSON': 'garbage{',
    'not an object': '42',
    'null': 'null',
    'ratings not an array': JSON.stringify({ ratings: 'x', ...good }),
    'missing seed': JSON.stringify({ ratings: [], length: 10, skipped: [], genreIndex: 0, movieIndex: 0, extra: null }),
    'missing length': JSON.stringify({ ratings: [], seed: 7, skipped: [], genreIndex: 0, movieIndex: 0, extra: null }),
    'length 12': JSON.stringify({ ratings: [], ...good, length: 12 }),
    'length 0': JSON.stringify({ ratings: [], ...good, length: 0 }),
    'string length': JSON.stringify({ ratings: [], ...good, length: '10' }),
    'null length': JSON.stringify({ ratings: [], ...good, length: null }),
    'Quick session with a Full-sized position': JSON.stringify({ ratings: [], ...good, genreIndex: 11 }),
    'fractional seed': JSON.stringify({ ratings: [], ...good, seed: 1.5 }),
    'negative seed': JSON.stringify({ ratings: [], ...good, seed: -1 }),
    'seed too large': JSON.stringify({ ratings: [], ...good, seed: 4294967296 }),
    'string seed': JSON.stringify({ ratings: [], ...good, seed: '7' }),
    'null seed': JSON.stringify({ ratings: [], ...good, seed: null }),
    'missing positions': JSON.stringify({ ratings: [], skipped: [] }),
    'missing skipped list': JSON.stringify({ ratings: [], genreIndex: 0, movieIndex: 0, extra: null }),
    'skipped has an unknown id': JSON.stringify({ ratings: [], ...good, skipped: ['zzz'] }),
    'extra before onboarding is finished': JSON.stringify({ ratings: [], ...good, extra: { rated: 1, shown: ['a'] } }),
    'extra with rated out of range': JSON.stringify({ ratings: [], ...good, genreIndex: 10, extra: { rated: 5, shown: ['a'] } }),
    'extra with no shown films': JSON.stringify({ ratings: [], ...good, genreIndex: 10, extra: { rated: 0, shown: [] } }),
    'extra with an unknown shown id': JSON.stringify({ ratings: [], ...good, genreIndex: 10, extra: { rated: 0, shown: ['zzz'] } }),
    'extra with a repeated shown id': JSON.stringify({ ratings: [], ...good, genreIndex: 10, extra: { rated: 0, shown: ['a', 'a'] } }),
    'extra of the wrong type': JSON.stringify({ ratings: [], ...good, genreIndex: 10, extra: 'yes' }),
    'negative genreIndex': JSON.stringify({ ratings: [], ...good, genreIndex: -1 }),
    'genreIndex too large': JSON.stringify({ ratings: [], ...good, genreIndex: 11 }),
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
    assert.equal(loadSavedState(ids), null, name);
    assert.deepEqual(getAllRatings(), [], `${name}: ratings must stay empty`);
  }
});

test('an extra flow in progress is saved and loaded back', () => {
  markSkipped('c');
  saveExtra({ rated: 2, shown: ['a', 'b'] });
  assert.deepEqual(JSON.parse(store[KEY]).extra, { rated: 2, shown: ['a', 'b'] });
  store[KEY] = JSON.stringify({ ratings: [], seed: 9, length: 10, skipped: [], genreIndex: 10, movieIndex: 0, extra: { rated: 2, shown: ['a', 'b'] } });
  assert.deepEqual(loadSavedState(ids), { seed: 9, length: 10, genreIndex: 10, movieIndex: 0, extra: { rated: 2, shown: ['a', 'b'] } });
});

test('older saves (versions 1 and 2) are ignored, not loaded', () => {
  store['cocinema:v1'] = JSON.stringify({ ratings: [['a', 7]], genreIndex: 2, movieIndex: 1 });
  store['cocinema:v2'] = JSON.stringify({ ratings: [['a', 7]], skipped: [], genreIndex: 2, movieIndex: 1, extra: null });
  assert.equal(loadSavedState(ids), null);
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
  assert.equal(loadSavedState(ids), null);
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
  assert.doesNotThrow(() => clearSavedState());
  assert.deepEqual(getAllRatings(), []);
});

test('a missing localStorage object (not just a throwing one) does not crash', () => {
  delete globalThis.localStorage;
  assert.doesNotThrow(() => saveRating('a', 7));
  assert.equal(loadSavedState(ids), null);
  assert.doesNotThrow(() => clearSavedState());
});

test('the session length is saved and both Quick (10) and Full (15) load back', () => {
  saveSeed(5);
  saveLength(15);
  assert.equal(JSON.parse(store[KEY]).length, 15);
  store[KEY] = JSON.stringify({ ratings: [], seed: 5, length: 15, skipped: [], genreIndex: 15, movieIndex: 0, extra: null });
  assert.deepEqual(loadSavedState(ids), { seed: 5, length: 15, genreIndex: 15, movieIndex: 0, extra: null });
  store[KEY] = JSON.stringify({ ratings: [], seed: 5, length: 10, skipped: [], genreIndex: 10, movieIndex: 0, extra: null });
  assert.deepEqual(loadSavedState(ids), { seed: 5, length: 10, genreIndex: 10, movieIndex: 0, extra: null });
});

test('saveLength ignores anything but 10 or 15', () => {
  saveSeed(5);
  saveLength(10);
  for (const bad of [0, 5, 12, 16, '10', null, undefined, NaN, 10.5]) {
    saveLength(bad);
    assert.equal(JSON.parse(store[KEY]).length, 10, String(bad));
  }
});

test('a Full session accepts positions up to 15 but a Quick session stops at 10', () => {
  const save = (length, genreIndex) => JSON.stringify({ ratings: [], seed: 1, length, skipped: [], genreIndex, movieIndex: 0, extra: null });
  store[KEY] = save(15, 12);
  assert.equal(loadSavedState(ids).genreIndex, 12);
  store[KEY] = save(10, 12);
  assert.equal(loadSavedState(ids), null);
});

// ---- A friend's shared taste, kept apart from the visitor's own ratings ----
const goodSession = { ratings: [['a', 7]], seed: 5, length: 10, skipped: [], genreIndex: 3, movieIndex: 0, extra: null };
const goodFriend = { ratings: [['b', 9], ['c', 2]], skipped: 4, sample: null };

test('a save from before the friend field existed still loads, with no friend', () => {
  store[KEY] = JSON.stringify(goodSession); // no friend key at all
  assert.deepEqual(loadSavedState(ids), { seed: 5, length: 10, genreIndex: 3, movieIndex: 0, extra: null });
  assert.equal(getFriend(), null);
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
});

test('a saved friend loads back, and never joins the visitor\'s own ratings', () => {
  store[KEY] = JSON.stringify({ ...goodSession, friend: goodFriend });
  loadSavedState(ids);
  assert.deepEqual(getFriend(), { ratings: [{ id: 'b', score: 9 }, { id: 'c', score: 2 }], skipped: 4, sample: null });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
});

test('saveFriend writes the friend next to, not into, the visitor\'s ratings', () => {
  saveRating('a', 7);
  saveFriend({ ratings: [{ id: 'b', score: 9 }], skipped: 0, sample: 'horror' });
  const saved = JSON.parse(store[KEY]);
  assert.deepEqual(saved.ratings, [['a', 7]]);
  assert.deepEqual(saved.friend, { ratings: [['b', 9]], skipped: 0, sample: 'horror' });
  assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }]);
  saveFriend(null);
  assert.equal(JSON.parse(store[KEY]).friend, null);
  assert.equal(getFriend(), null);
});

test('saving ratings later keeps the friend, and a friend does not change what the visitor rated', () => {
  saveFriend({ ratings: [{ id: 'b', score: 9 }], skipped: 0, sample: null });
  saveRating('c', 4);
  assert.deepEqual(JSON.parse(store[KEY]).friend.ratings, [['b', 9]]);
  assert.deepEqual(getAllRatings(), [{ id: 'c', score: 4 }]);
});

test('a bad friend is dropped without losing the visitor\'s own saved ratings', () => {
  const badFriends = {
    'not an object': 'yes',
    'no ratings list': { skipped: 0, sample: null },
    'empty ratings': { ratings: [], skipped: 0, sample: null },
    'unknown film': { ratings: [['zzz', 5]], skipped: 0, sample: null },
    'bad score': { ratings: [['b', 11]], skipped: 0, sample: null },
    'fractional score': { ratings: [['b', 5.5]], skipped: 0, sample: null },
    'repeated film': { ratings: [['b', 5], ['b', 6]], skipped: 0, sample: null },
    'wrong entry shape': { ratings: [['b']], skipped: 0, sample: null },
    'negative skipped': { ratings: [['b', 5]], skipped: -1, sample: null },
    'fractional skipped': { ratings: [['b', 5]], skipped: 1.5, sample: null },
    'unknown sample': { ratings: [['b', 5]], skipped: 0, sample: 'nobody' },
    'too many films': { ratings: Array.from({ length: 121 }, (_, i) => [`id${i}`, 5]), skipped: 0, sample: null },
  };
  for (const [name, friend] of Object.entries(badFriends)) {
    store[KEY] = JSON.stringify({ ...goodSession, friend });
    assert.deepEqual(loadSavedState(ids), { seed: 5, length: 10, genreIndex: 3, movieIndex: 0, extra: null }, name);
    assert.equal(getFriend(), null, name);
    assert.deepEqual(getAllRatings(), [{ id: 'a', score: 7 }], name);
  }
});

test('a known sample friend is accepted and starting over clears the friend', () => {
  store[KEY] = JSON.stringify({ ...goodSession, friend: { ratings: [['b', 5]], skipped: 0, sample: 'scifi' } });
  loadSavedState(ids);
  assert.equal(getFriend().sample, 'scifi');
  clearSavedState();
  assert.equal(getFriend(), null);
  assert.equal(KEY in store, false);
});

test('getFriend returns a copy, so changing it cannot change the saved friend', () => {
  saveFriend({ ratings: [{ id: 'b', score: 9 }], skipped: 0, sample: null });
  getFriend().ratings[0].score = 1;
  assert.equal(getFriend().ratings[0].score, 9);
});

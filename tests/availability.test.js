import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStale, formatFetchedAt, availabilityFor, countryBlocks, streamingView, loadAvailability,
  resetAvailabilityCache, NOT_FOUND_TEXT,
} from '../src/availability.js';

const day = text => new Date(`${text}T12:00:00Z`);

test('isStale: a snapshot is fresh for 30 days and stale after that', () => {
  assert.equal(isStale('2026-10-07', day('2026-10-07')), false);
  assert.equal(isStale('2026-10-07', day('2026-11-06')), false); // exactly 30 days
  assert.equal(isStale('2026-10-07', day('2026-11-07')), true); // 31 days
  assert.equal(isStale('2026-10-07', day('2027-03-01')), true);
});

test('isStale: a missing or unreadable date counts as stale, a future date as fresh', () => {
  for (const bad of [undefined, null, '', 'yesterday', '2026-13-01', '2026-02-31', '07/10/2026', 20261007]) {
    assert.equal(isStale(bad, day('2026-10-07')), true, String(bad));
  }
  assert.equal(isStale('2026-10-09', day('2026-10-07')), false);
});

test('isStale honours a different limit', () => {
  assert.equal(isStale('2026-10-01', day('2026-10-09'), 7), true);
  assert.equal(isStale('2026-10-01', day('2026-10-08'), 7), false);
});

test('formatFetchedAt writes the date in plain English', () => {
  assert.equal(formatFetchedAt('2026-10-07'), '7 October 2026');
  assert.equal(formatFetchedAt('2027-01-31'), '31 January 2027');
  assert.equal(formatFetchedAt('nonsense'), null);
  assert.equal(formatFetchedAt(undefined), null);
});

const entry = {
  matched: true,
  CA: { subscription: ['Crave'], rentOrBuy: ['Apple TV', 'Google Play Movies'] },
  US: { subscription: ['Netflix', 'Hulu'], rentOrBuy: [] },
  GB: { subscription: [], rentOrBuy: [] },
};
const data = { fetchedAt: '2026-10-07', films: { m1: entry, m2: { matched: false } } };

test('availabilityFor finds an entry, and returns null for missing data or films', () => {
  assert.equal(availabilityFor(data, 'm1'), entry);
  assert.equal(availabilityFor(data, 'nope'), null);
  assert.equal(availabilityFor(null, 'm1'), null);
  assert.equal(availabilityFor(undefined, 'm1'), null);
  assert.equal(availabilityFor({}, 'm1'), null);
  assert.equal(availabilityFor({ films: 'x' }, 'm1'), null);
  assert.equal(availabilityFor({ films: { m1: 5 } }, 'm1'), null);
});

test('countryBlocks builds "Included with" and "Rent or buy on" lines per country', () => {
  const blocks = countryBlocks(entry);
  assert.deepEqual(blocks.map(block => block.name), ['Canada', 'United States', 'United Kingdom']);
  assert.deepEqual(blocks[0].lines, [
    { label: 'Included with', text: 'Crave' },
    { label: 'Rent or buy on', text: 'Apple TV, Google Play Movies' },
  ]);
  assert.deepEqual(blocks[1].lines, [{ label: 'Included with', text: 'Netflix, Hulu' }]);
});

test('countryBlocks says "Not found" when both lists are empty, and copes with missing parts', () => {
  assert.deepEqual(countryBlocks(entry)[2].lines, [{ label: null, text: NOT_FOUND_TEXT }]);
  for (const odd of [null, undefined, {}, { matched: false }, { CA: null, US: { subscription: 'x', rentOrBuy: [1, null, ''] } }]) {
    const blocks = countryBlocks(odd);
    assert.equal(blocks.length, 3);
    assert.ok(blocks.every(block => block.lines.length === 1 && block.lines[0].text === NOT_FOUND_TEXT));
  }
});

test('countryBlocks shortens very long lists and keeps long names whole', () => {
  const many = { CA: { subscription: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], rentOrBuy: [] } };
  assert.equal(countryBlocks(many)[0].lines[0].text, 'A, B, C, D, E, F and 2 more');
  const longName = 'Amazon Prime Video (Via a Very Long Channel Name Subscription Add-on)';
  assert.equal(countryBlocks({ CA: { subscription: [longName], rentOrBuy: [] } })[0].lines[0].text, longName);
  assert.equal(countryBlocks(many, 3)[0].lines[0].text, 'A, B, C and 5 more');
});

test('countryBlocks does not alter the entry and passes names through as plain text', () => {
  const tricky = { CA: { subscription: ['<b>Evil</b> & "Co"'], rentOrBuy: [] } };
  const before = JSON.stringify(tricky);
  assert.equal(countryBlocks(tricky)[0].lines[0].text, '<b>Evil</b> & "Co"');
  assert.equal(JSON.stringify(tricky), before);
});

test('streamingView: show, stale or none', () => {
  const now = day('2026-10-20');
  const shown = streamingView(data, 'm1', now);
  assert.equal(shown.mode, 'show');
  assert.equal(shown.asOf, '7 October 2026');
  assert.equal(shown.blocks.length, 3);
  assert.deepEqual(streamingView(data, 'nope', now), { mode: 'none' });
  assert.deepEqual(streamingView(null, 'm1', now), { mode: 'none' });
  assert.deepEqual(streamingView(data, 'm1', day('2026-12-25')), { mode: 'stale' });
  assert.deepEqual(streamingView({ films: { m1: entry } }, 'm1', now), { mode: 'stale' }); // no date
});

test('a film with an unmatched entry still shows "Not found" blocks while the data is fresh', () => {
  const view = streamingView(data, 'm2', day('2026-10-08'));
  assert.equal(view.mode, 'show');
  assert.ok(view.blocks.every(block => block.lines[0].text === NOT_FOUND_TEXT));
});

beforeEach(() => resetAvailabilityCache());

const respond = (body, ok = true) => async () => ({ ok, json: async () => body });

test('loadAvailability returns the data and caches it', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return { ok: true, json: async () => data }; };
  assert.equal(await loadAvailability('x', fetchFn), data);
  assert.equal(await loadAvailability('x', fetchFn), data);
  assert.equal(calls, 1);
});

test('loadAvailability resolves to null, never rejects, when loading fails', async () => {
  assert.equal(await loadAvailability('x', async () => { throw new Error('offline'); }), null);
  assert.equal(await loadAvailability('x', respond(null, false)), null);
  assert.equal(await loadAvailability('x', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })), null);
  assert.equal(await loadAvailability('x', respond({ nothing: true })), null);
  assert.equal(await loadAvailability('x', respond([1, 2])), null);
});

test('a failed load is retried on the next request', async () => {
  assert.equal(await loadAvailability('x', async () => { throw new Error('offline'); }), null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await loadAvailability('x', respond(data)), data);
});

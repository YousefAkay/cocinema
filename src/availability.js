// Streaming availability snapshot (data/availability.json): loading it, deciding whether it is
// too old to show, and turning an entry into the text for each country.

export const COUNTRIES = [
  { code: 'CA', name: 'Canada' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
];
export const MAX_AGE_DAYS = 30;
export const MAX_NAMES = 6;
export const NOT_FOUND_TEXT = 'Not found';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || '');
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? date : null;
}

// True when the snapshot is more than MAX_AGE_DAYS old, or its date is missing or unreadable,
// so old or undated data is never shown. A date in the future counts as fresh.
export function isStale(fetchedAt, now = new Date(), maxAgeDays = MAX_AGE_DAYS) {
  const date = parseDate(fetchedAt);
  if (!date) return true;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return (today - date.getTime()) / DAY_MS > maxAgeDays;
}

// "2026-10-07" becomes "7 October 2026"; null when the date is not readable.
export function formatFetchedAt(fetchedAt) {
  const date = parseDate(fetchedAt);
  return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : null;
}

// The entry for a film, or null when there is no data or no entry for it.
export function availabilityFor(data, movieId) {
  if (!data || typeof data !== 'object' || !data.films || typeof data.films !== 'object') return null;
  const entry = data.films[movieId];
  return entry && typeof entry === 'object' ? entry : null;
}

function cleanNames(list) {
  return Array.isArray(list)
    ? list.filter(name => typeof name === 'string' && name.trim() !== '').map(name => name.trim())
    : [];
}

function joinNames(names, max) {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

// One block per country: lines of { label, text }. A country with nothing gets a single
// "Not found" line. Long lists are cut to `max` names with "and N more".
export function countryBlocks(entry, max = MAX_NAMES) {
  return COUNTRIES.map(({ code, name }) => {
    const included = cleanNames(entry && entry[code] && entry[code].subscription);
    const rentOrBuy = cleanNames(entry && entry[code] && entry[code].rentOrBuy);
    const lines = [];
    if (included.length > 0) lines.push({ label: 'Included with', text: joinNames(included, max) });
    if (rentOrBuy.length > 0) lines.push({ label: 'Rent or buy on', text: joinNames(rentOrBuy, max) });
    if (lines.length === 0) lines.push({ label: null, text: NOT_FOUND_TEXT });
    return { code, name, lines };
  });
}

// What the film page should do with the snapshot: 'none' (no data or no entry: show only the
// JustWatch links), 'stale' (too old: links only, plus a note), or 'show'.
export function streamingView(data, movieId, now = new Date()) {
  const entry = availabilityFor(data, movieId);
  if (!entry) return { mode: 'none' };
  if (isStale(data.fetchedAt, now)) return { mode: 'stale' };
  return { mode: 'show', blocks: countryBlocks(entry), asOf: formatFetchedAt(data.fetchedAt) };
}

let cached = null;

// Loads the snapshot the first time a film page needs it, then keeps it in memory.
// Never rejects: any failure resolves to null, and is retried on the next film page.
export function loadAvailability(url = '../data/availability.json', fetchFn = fetch) {
  if (cached) return cached;
  const request = (async () => {
    try {
      const response = await fetchFn(url);
      if (!response.ok) return null;
      const data = await response.json();
      return data && typeof data === 'object' && data.films && typeof data.films === 'object' ? data : null;
    } catch (error) {
      return null;
    }
  })();
  cached = request;
  request.then(data => {
    if (data === null && cached === request) cached = null;
  });
  return request;
}

export function resetAvailabilityCache() {
  cached = null;
}

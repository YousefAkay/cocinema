import fs from 'fs';
import { omdbGet } from './omdb.js';

export const MAX_YEAR_DRIFT = 1;
export const MIN_PLOT_OVERLAP = 0.5;
const OVERRIDES_PATH = 'data/overrides.json';

export function normalize(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function titlesMatch(a, b) {
  const x = normalize(a);
  const y = normalize(b);
  return x.startsWith(y) || y.startsWith(x);
}

function plotWords(text) {
  return new Set((text || '').toLowerCase().match(/[a-z]{4,}/g) || []);
}

// Share of the shorter plot's words that also appear in the other plot.
export function plotOverlap(a, b) {
  const x = plotWords(a);
  const y = plotWords(b);
  const smaller = Math.min(x.size, y.size);
  if (smaller === 0) {
    return 0;
  }
  let shared = 0;
  for (const word of x) {
    if (y.has(word)) shared++;
  }
  return shared / smaller;
}

// The image part of a poster URL, which stays the same when the host or size changes.
export function posterKey(url) {
  const match = /\/images\/M\/([^.]+)\./.exec(url || '');
  return match ? match[1] : null;
}

export function loadOverrides() {
  return fs.existsSync(OVERRIDES_PATH) ? JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8')) : {};
}

export function pickRottenTomatoes(ratings) {
  const entry = Array.isArray(ratings)
    ? ratings.find(rating => rating.Source === 'Rotten Tomatoes')
    : null;
  return entry ? entry.Value : null;
}

export function clean(value) {
  return value && value !== 'N/A' ? value : null;
}

// OMDb's y must equal its own release year, while Wikidata gives the earliest release
// (often a festival premiere a year earlier), so neighbouring years are tried as well.
// An override can name the exact OMDb year and title to expect.
// Returns { data } for an accepted record, { rejected } for a wrong film, or { notFound }.
export async function lookupByYear(movie, override, sleep) {
  const expected = override && override.omdbYear ? override.omdbYear : movie.year;
  const wantedTitle = override?.omdbTitle || movie.title;
  const candidates = [expected, expected + 1, expected - 1];
  let rejected = null;

  for (const candidate of candidates) {
    let data;
    try {
      data = await omdbGet({ t: wantedTitle, y: candidate, plot: 'full' });
    } catch (error) {
      if (!error.message.includes('Movie not found')) {
        throw error;
      }
      await sleep();
      continue;
    }

    const omdbYear = parseInt(data.Year, 10);
    const yearOk = Math.abs(omdbYear - expected) <= MAX_YEAR_DRIFT;
    if (titlesMatch(wantedTitle, data.Title) && yearOk) {
      return { data };
    }
    rejected = data;
    await sleep();
  }

  return rejected ? { rejected } : { notFound: true };
}

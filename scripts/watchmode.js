import 'dotenv/config';
import fs from 'fs';
import { pathToFileURL } from 'url';

// Fetches where each catalog film can be watched (Canada, United States, United Kingdom)
// from Watchmode and stores only service names in data/availability.json.
//
// Per film: 1 search call (1 credit) to find the Watchmode title by name, confirmed with the
// Wikidata year, and 1 sources call for all three countries together (1 credit).
// No IMDb, TMDB or other external ids are used for matching or stored; Watchmode's own title
// id is only used in memory to make the sources call.
//
// Usage: node scripts/watchmode.js [--max-credits 2000] [--limit N] [--ids Q123,Q456]
// The API key comes from WATCHMODE_API_KEY in .env and is never printed.

const CATALOG_PATH = 'data/catalog.json';
const OUTPUT_PATH = 'data/availability.json';
const BASE_URL = 'https://api.watchmode.com/v1/';
const REGIONS = ['CA', 'US', 'GB'];
const SAVE_EVERY = 25;
const CALL_DELAY_MS = 150;
const MAX_ATTEMPTS = 4;
const MAX_YEAR_DRIFT = 1;
const DEFAULT_MAX_CREDITS = 2000;

function normalize(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Picks the Watchmode search result for a catalog film: the name must match exactly (ignoring
// case and punctuation) and the year must be within a year of the Wikidata year. The closest
// year wins. Returns the result, or null.
export function pickMatch(results, movie) {
  const wanted = normalize(movie.title);
  const candidates = (results || [])
    .filter(result => result && typeof result.name === 'string' && normalize(result.name) === wanted)
    .filter(result => Number.isInteger(result.year) && Math.abs(result.year - movie.year) <= MAX_YEAR_DRIFT)
    .sort((a, b) => Math.abs(a.year - movie.year) - Math.abs(b.year - movie.year));
  return candidates[0] || null;
}

function uniqueSorted(names) {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

// Per country: names of subscription services, and names of services where the film can be
// rented or bought. Names only: no prices, links or ids. Rows without a name are skipped.
export function summariseSources(rows) {
  const summary = {};
  for (const region of REGIONS) {
    const named = (Array.isArray(rows) ? rows : []).filter(row =>
      row && row.region === region && typeof row.name === 'string' && row.name.trim() !== '');
    summary[region] = {
      subscription: uniqueSorted(named.filter(row => row.type === 'sub').map(row => row.name.trim())),
      rentOrBuy: uniqueSorted(named.filter(row => row.type === 'rent' || row.type === 'buy').map(row => row.name.trim())),
    };
  }
  return summary;
}

export function emptyAvailability(matched) {
  return { matched, ...summariseSources([]) };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class StopRun extends Error {}

function createClient(apiKey) {
  const redact = text => String(text).split(apiKey).join('<key>');
  let quotaUsed = null;

  async function get(path, params) {
    const url = new URL(path, BASE_URL);
    url.searchParams.set('apiKey', apiKey);
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(name, value);
    }

    let backoffMs = 1000;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let res;
      try {
        res = await fetch(url);
      } catch (error) {
        console.log(`  network error (${redact(error.message)}), attempt ${attempt}/${MAX_ATTEMPTS}`);
        await sleep(backoffMs);
        backoffMs *= 2;
        continue;
      }

      const used = Number(res.headers.get('x-account-quota-used'));
      if (Number.isFinite(used)) quotaUsed = used;

      if (res.ok) {
        return res.json();
      }
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new StopRun(`Watchmode refused the request (HTTP ${res.status}); check the key and plan.`);
      }
      if (res.status === 429) {
        if (attempt === MAX_ATTEMPTS) {
          throw new StopRun('Watchmode rate limit or monthly quota reached (HTTP 429).');
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs);
        backoffMs *= 2;
        continue;
      }
      if (res.status >= 500) {
        console.log(`  Watchmode ${res.status}, attempt ${attempt}/${MAX_ATTEMPTS}`);
        await sleep(backoffMs);
        backoffMs *= 2;
        continue;
      }
      throw new Error(`Watchmode request failed: HTTP ${res.status}`);
    }
    throw new Error('Watchmode request failed: still failing after retries');
  }

  return { get, quotaUsed: () => quotaUsed };
}

function parseArgs(argv) {
  const options = { maxCredits: DEFAULT_MAX_CREDITS, limit: Infinity, ids: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--max-credits') options.maxCredits = Number(argv[++i]);
    else if (argv[i] === '--limit') options.limit = Number(argv[++i]);
    else if (argv[i] === '--ids') options.ids = new Set(argv[++i].split(',').map(id => id.trim()));
  }
  if (!Number.isFinite(options.maxCredits) || options.maxCredits <= 0) {
    throw new Error('--max-credits must be a positive number');
  }
  return options;
}

function loadOutput() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    return { fetchedAt: new Date().toISOString().slice(0, 10), films: {} };
  }
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
}

function saveOutput(output) {
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 1) + '\n');
}

async function main() {
  const apiKey = process.env.WATCHMODE_API_KEY;
  if (!apiKey) {
    console.error('Missing WATCHMODE_API_KEY. Add it to your .env file.');
    process.exit(1);
  }

  const options = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  const output = loadOutput();
  const client = createClient(apiKey);

  const todo = catalog
    .filter(movie => !(movie.id in output.films))
    .filter(movie => !options.ids || options.ids.has(movie.id.slice(movie.id.lastIndexOf('/') + 1)))
    .slice(0, options.limit);
  console.log(`${Object.keys(output.films).length} films already done, ${todo.length} to fetch (credit cap ${options.maxCredits})`);

  let credits = 0;
  let sinceSave = 0;
  const perFilm = [];
  const countryMatches = { CA: 0, US: 0, GB: 0 };
  let stopReason = null;

  async function counted(path, params) {
    const before = client.quotaUsed();
    const data = await client.get(path, params);
    const after = client.quotaUsed();
    credits += before !== null && after !== null && after >= before ? after - before : 1;
    await sleep(CALL_DELAY_MS);
    return data;
  }

  try {
    for (const movie of todo) {
      if (credits + 2 > options.maxCredits) {
        stopReason = `credit cap of ${options.maxCredits} reached`;
        break;
      }

      const creditsBefore = credits;
      const search = await counted('search/', { search_field: 'name', search_value: movie.title, types: 'movie' });
      const match = pickMatch(search.title_results, movie);

      let entry = emptyAvailability(false);
      if (match) {
        const rows = await counted(`title/${match.id}/sources/`, { regions: REGIONS.join(',') });
        entry = { matched: true, ...summariseSources(rows) };
      }
      output.films[movie.id] = entry;

      const found = REGIONS.filter(region => entry[region].subscription.length + entry[region].rentOrBuy.length > 0);
      found.forEach(region => countryMatches[region]++);
      perFilm.push({ title: `${movie.title} (${movie.year})`, credits: credits - creditsBefore, matched: entry.matched, found });
      console.log(`${movie.title} (${movie.year}): ${entry.matched ? 'matched' : 'no match'}, `
        + `sources in ${found.join(', ') || 'none'}, ${credits - creditsBefore} credits`);

      if (++sinceSave >= SAVE_EVERY) {
        saveOutput(output);
        sinceSave = 0;
      }
    }
  } catch (error) {
    if (error instanceof StopRun) {
      stopReason = error.message;
    } else {
      stopReason = `unexpected error: ${error.message.split(apiKey).join('<key>')}`;
    }
  }

  saveOutput(output);

  const done = perFilm.length;
  const remaining = catalog.filter(movie => !(movie.id in output.films)).length;
  console.log('');
  console.log(`Fetched this run: ${done}, credits used this run: ${credits}, films still to do overall: ${remaining}`);
  const titleOf = new Map(catalog.map(movie => [movie.id, `${movie.title} (${movie.year})`]));
  const stored = Object.entries(output.films);
  const noMatch = stored.filter(([, entry]) => !entry.matched).map(([id]) => titleOf.get(id));
  const noSources = stored
    .filter(([, entry]) => entry.matched && REGIONS.every(region => entry[region].subscription.length + entry[region].rentOrBuy.length === 0))
    .map(([id]) => titleOf.get(id));
  console.log(`No match (${noMatch.length}): ${noMatch.join('; ') || 'none'}`);
  console.log(`Matched but no sources anywhere (${noSources.length}): ${noSources.join('; ') || 'none'}`);
  console.log(`Films with sources per country this run: CA ${countryMatches.CA}, US ${countryMatches.US}, GB ${countryMatches.GB}`);
  if (done > 0) {
    const average = credits / done;
    console.log(`Average ${average.toFixed(2)} credits per film; projected for the ${remaining + done} films `
      + `without data: ${Math.ceil(average * (remaining + done))} credits`);
  }
  if (client.quotaUsed() !== null) {
    console.log(`Account quota used so far this month: ${client.quotaUsed()}`);
  }
  if (stopReason) {
    console.log(`Stopped: ${stopReason}. Run the same command again later to continue.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Something went wrong:', String(error.message).replace(process.env.WATCHMODE_API_KEY || '\u0000', '<key>'));
    process.exit(1);
  });
}

import 'dotenv/config';

const API_KEY = process.env.OMDB_API_KEY;
const BASE_URL = 'https://www.omdbapi.com/';

if (!API_KEY) {
  console.error('Missing OMDB_API_KEY. Copy .env.example to .env and add your key.');
  process.exit(1);
}

export async function omdbGet(params = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.set('apikey', API_KEY);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url);
  if (!res.ok) {
    // OMDb reports its daily limit as a 401 with the reason in the body.
    const body = await res.json().catch(() => ({}));
    throw new Error(body.Error || `OMDb request failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data.Response === 'False') {
    throw new Error(`OMDb error: ${data.Error}`);
  }
  return data;
}

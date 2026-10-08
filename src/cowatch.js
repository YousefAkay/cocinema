// Sharing a person's ratings in a link, and reading one back. No DOM code here.
//
// Format, version 1: the text "v1", then one token per rated film, each written as a dot and the
// film's Wikidata number in base 36 followed by one digit for the rating (1 to 10 is written
// 0 to 9). For example "v1.2fk3.x07". The whole text is then base64-url encoded without padding.
// Nothing is sent anywhere: the ratings live inside the link itself.

export const FORMAT_VERSION = 1;
export const MAX_FILMS = 120;
export const MAX_PAYLOAD_CHARS = 1400;
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
export const ID_PREFIX = 'http://www.wikidata.org/entity/Q';

const MAX_ID_NUMBER = 2147483647;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOKEN_PATTERN = /^[0-9a-z]{2,}$/;

function toBase64Url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(payload) {
  const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (payload.length % 4)) % 4);
  return atob(padded);
}

function idNumber(id) {
  if (typeof id !== 'string' || !id.startsWith(ID_PREFIX)) return null;
  const digits = id.slice(ID_PREFIX.length);
  if (!/^[1-9][0-9]*$/.test(digits)) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) && number <= MAX_ID_NUMBER ? number : null;
}

// ratings: [{ id: 'http://www.wikidata.org/entity/Q123', score: 1..10 }]. Throws on invalid input,
// because the caller built it from its own saved ratings.
export function encodeTaste(ratings) {
  if (!Array.isArray(ratings) || ratings.length === 0) {
    throw new Error('There are no ratings to share');
  }
  if (ratings.length > MAX_FILMS) {
    throw new Error(`Too many ratings to share (the limit is ${MAX_FILMS})`);
  }

  const seen = new Set();
  const tokens = ratings.map(({ id, score }) => {
    const number = idNumber(id);
    if (number === null) throw new Error(`Not a Wikidata film id: ${id}`);
    if (!Number.isInteger(score) || score < MIN_SCORE || score > MAX_SCORE) throw new Error(`Rating out of range: ${score}`);
    if (seen.has(number)) throw new Error(`Film listed twice: ${id}`);
    seen.add(number);
    return `.${number.toString(36)}${score - 1}`;
  });

  return toBase64Url(`v${FORMAT_VERSION}${tokens.join('')}`);
}

const fail = error => ({ ok: false, error });

// Reads a payload back. Never throws. knownIds (a Set of full Wikidata ids) is the current
// catalog: films not in it are skipped and counted. Returns { ok: true, ratings, skipped } or
// { ok: false, error } where error is a short code.
export function decodeTaste(payload, knownIds) {
  if (typeof payload !== 'string' || payload.length === 0) return fail('empty');
  if (payload.length > MAX_PAYLOAD_CHARS) return fail('too-long');
  if (!PAYLOAD_PATTERN.test(payload) || payload.length % 4 === 1) return fail('bad-characters');

  let text;
  try {
    text = fromBase64Url(payload);
  } catch (error) {
    return fail('bad-encoding');
  }
  // Only the exact text we would have written is accepted.
  if (toBase64Url(text) !== payload) return fail('bad-encoding');

  const version = /^v(\d+)(?=\.|$)/.exec(text);
  if (!version) return fail('bad-format');
  if (Number(version[1]) !== FORMAT_VERSION) return fail('unsupported-version');

  const rest = text.slice(version[0].length);
  if (rest === '') return fail('empty');
  if (!rest.startsWith('.')) return fail('bad-format');
  const tokens = rest.slice(1).split('.');
  if (tokens.length > MAX_FILMS) return fail('too-many');

  const seen = new Set();
  const ratings = [];
  let skipped = 0;

  for (const token of tokens) {
    if (!TOKEN_PATTERN.test(token)) return fail('bad-format');
    const digit = token.slice(-1);
    if (!/[0-9]/.test(digit)) return fail('bad-rating');
    const idText = token.slice(0, -1);
    if (idText.startsWith('0')) return fail('bad-format');
    const number = parseInt(idText, 36);
    if (!Number.isSafeInteger(number) || number < 1 || number > MAX_ID_NUMBER || number.toString(36) !== idText) return fail('bad-format');
    if (seen.has(number)) return fail('duplicate');
    seen.add(number);

    const id = `${ID_PREFIX}${number}`;
    if (knownIds && !knownIds.has(id)) {
      skipped++;
    } else {
      ratings.push({ id, score: Number(digit) + 1 });
    }
  }

  return { ok: true, ratings, skipped };
}

// The full link for a payload: the page the visitor is on, with the taste after #/with/.
export function shareLink(pageUrl, payload) {
  return `${pageUrl.split('#')[0]}#/with/${payload}`;
}

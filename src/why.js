import { titleWithYear } from './format.js';

// The "why" line under each top pick. Every film and number in it comes from explainMatch():
// the films the person rated and their own scores. Nothing else is claimed. The wording is
// chosen from the film's id, so the same list always reads the same way, and a set of lines can
// be built so no two share an opening.

const ENOUGH_OF_POSITIVE = 0.7;
const MAX_TITLES = 3;

// The film that held a pick back is only named when its negative pull is at least this share of
// the total positive pull. Below it the held-back film is a rounding error, not a reason.
export const HELD_BACK_SHARE = 0.25;

export const NEUTRAL_LINE = 'A broad match to the overall shape of your ratings.';

// Each template gets the chosen films as [{ name, score }] and returns one sentence. "opening"
// names how the sentence starts, so two cards in one list can avoid the same opening.
export const TEMPLATES = {
  1: [
    { opening: 'your', build: ([a]) => `Your ${a.score} for ${a.name} did most of the work here.` },
    { opening: 'thisone', build: ([a]) => `This one is mostly down to ${a.name}, which you rated ${a.score}.` },
    { opening: 'title', build: ([a]) => `${a.name} at ${a.score} is what puts this on your list.` },
    { opening: 'because', build: ([a]) => `Because you gave ${a.name} a ${a.score}, this one rose up your list.` },
    { opening: 'abig', build: ([a]) => `A big ${a.score} for ${a.name} is doing the heavy lifting here.` },
    { opening: 'itall', build: ([a]) => `It all starts with ${a.name}, which you rated ${a.score}.` },
  ],
  2: [
    { opening: 'your', build: ([a, b]) => `Your ${a.score} for ${a.name} did most of the work here, with a nudge from ${b.name} (${b.score}).` },
    { opening: 'title', build: ([a, b]) => `${a.name} (${a.score}) and ${b.name} (${b.score}) are the reason this made your list.` },
    { opening: 'start', build: ([a, b]) => `Start with your ${a.score} for ${a.name}, add your ${b.score} for ${b.name}, and this follows.` },
    { opening: 'itall', build: ([a, b]) => `It all comes back to ${a.name} at ${a.score}, helped by ${b.name} at ${b.score}.` },
    { opening: 'because', build: ([a, b]) => `Because you gave ${a.name} a ${a.score} and ${b.name} a ${b.score}, this one rose up your list.` },
    { opening: 'abig', build: ([a, b]) => `A big ${a.score} for ${a.name} leads the way, with ${b.name} (${b.score}) right behind.` },
  ],
  3: [
    { opening: 'mostly', build: ([a, b, c]) => `Mostly your ${a.score} for ${a.name}, then ${b.name} (${b.score}) and ${c.name} (${c.score}).` },
    { opening: 'title', build: ([a, b, c]) => `${a.name}, ${b.name} and ${c.name} (your ${a.score}, ${b.score} and ${c.score}) all point here, with ${a.name} leading.` },
    { opening: 'your', build: ([a, b, c]) => `Your ${a.score} for ${a.name} leads, with ${b.name} (${b.score}) and ${c.name} (${c.score}) adding to it.` },
    { opening: 'itall', build: ([a, b, c]) => `It all starts with ${a.name} at ${a.score}, then ${b.name} at ${b.score} and ${c.name} at ${c.score}.` },
    { opening: 'because', build: ([a, b, c]) => `Because you gave ${a.name} a ${a.score}, ${b.name} a ${b.score} and ${c.name} a ${c.score}, this one rose up your list.` },
    { opening: 'abig', build: ([a, b, c]) => `A big ${a.score} for ${a.name} leads the way, backed by ${b.name} (${b.score}) and ${c.name} (${c.score}).` },
  ],
};

// A small, stable hash of the film id (FNV-1a), so the wording never depends on list order.
export function hashId(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function chosenContributions(contributions) {
  const positives = contributions.filter(item => item.contribution > 0);
  const positiveTotal = positives.reduce((sum, item) => sum + item.contribution, 0);
  const chosen = [];
  let running = 0;
  for (const item of positives) {
    chosen.push(item);
    running += item.contribution;
    if (chosen.length === MAX_TITLES || running >= ENOUGH_OF_POSITIVE * positiveTotal) {
      break;
    }
  }
  return { chosen, positiveTotal };
}

// How the held-back film is worded. Each takes the score and name of the rated film.
export const HELD_BACK_PHRASES = [
  (score, name) => ` Your ${score} for ${name} held it back a little.`,
  (score, name) => ` Only your ${score} for ${name} held it back.`,
  (score, name) => ` The one drag: your ${score} for ${name}.`,
  (score, name) => ` Your ${score} for ${name} pulled the other way.`,
];

// At most this many cards in one list carry a held-back clause: the ones with the largest share.
export const MAX_HELD_BACK_CARDS = 2;

// The last three words of a line, so two cards can be kept from ending alike.
export function endingOf(line) {
  return line.toLowerCase().replace(/[.!]+$/, '').split(/\s+/).slice(-3).join(' ');
}

// Templates for this film in the order to try them: the one its id hashes to first.
function templateOrder(count, filmId) {
  const templates = TEMPLATES[count];
  const start = hashId(filmId) % templates.length;
  return templates.map((_, step) => templates[(start + step) % templates.length]);
}

// A title is shown with its year only when two of the rated films in play share a title.
function namer(contributions) {
  const counts = new Map();
  for (const item of contributions) {
    counts.set(item.title, (counts.get(item.title) || 0) + 1);
  }
  return item => (counts.get(item.title) > 1 ? titleWithYear(item) : item.title);
}

// The film that pulled this pick down the most, and its share of the positive pull, or null when
// there is none or the share is under HELD_BACK_SHARE.
export function heldBackBy(contributions) {
  const positiveTotal = contributions.filter(item => item.contribution > 0).reduce((sum, item) => sum + item.contribution, 0);
  const negatives = contributions.filter(item => item.contribution < 0);
  const worst = negatives[negatives.length - 1];
  if (!worst || positiveTotal <= 0) return null;
  const share = -worst.contribution / positiveTotal;
  return -worst.contribution >= HELD_BACK_SHARE * positiveTotal ? { film: worst, share } : null;
}

function usedSets(used) {
  if (used instanceof Set) return { openings: used, endings: new Set() };
  return { openings: used.openings || new Set(), endings: used.endings || new Set() };
}

// Builds the "why" sentence from explainMatch() output (sorted, largest positive first) for one
// film. used holds the openings and endings already taken by earlier cards (a Set is read as the
// openings); the line avoids them where it can and adds its own. heldBack: false leaves out the
// held-back clause even when it would qualify. Plain text only: the caller must put it on the
// page with textContent, never innerHTML.
export function buildWhyLine(contributions, filmId = '', used = new Set(), { heldBack = true } = {}) {
  if (!contributions.some(item => item.contribution > 0)) {
    return NEUTRAL_LINE;
  }

  const taken = usedSets(used);
  const { chosen } = chosenContributions(contributions);
  const nameOf = namer(contributions);
  const names = chosen.map(item => ({ name: nameOf(item), score: item.score }));
  const held = heldBack ? heldBackBy(contributions) : null;

  // The phrasing of the held-back clause, in the order to try: the one the id hashes to first.
  const phrases = HELD_BACK_PHRASES.map((_, step) => HELD_BACK_PHRASES[(hashId(`${filmId}:held`) + step) % HELD_BACK_PHRASES.length]);
  const clauses = held ? phrases.map(phrase => phrase(held.film.score, nameOf(held.film))) : [''];

  const candidates = [];
  for (const template of templateOrder(chosen.length, filmId)) {
    for (const clause of clauses) {
      candidates.push({ template, line: template.build(names) + clause });
    }
  }
  // Best first: a new opening and a new ending, then a new opening, then anything.
  const best = candidates.find(item => !taken.openings.has(item.template.opening) && !taken.endings.has(endingOf(item.line)))
    || candidates.find(item => !taken.openings.has(item.template.opening))
    || candidates[0];
  taken.openings.add(best.template.opening);
  taken.endings.add(endingOf(best.line));
  return best.line;
}

// Lines for a whole list of cards, in order, so no two cards open or end the same way (as far as
// the templates allow). Only the MAX_HELD_BACK_CARDS cards with the largest negative share carry a
// held-back clause (ties go to the higher rank), so one low rating does not end every line alike.
// items: [{ id, contributions }].
export function buildWhyLines(items) {
  const ranked = items
    .map((item, index) => ({ index, held: heldBackBy(item.contributions) }))
    .filter(entry => entry.held)
    .sort((a, b) => b.held.share - a.held.share || a.index - b.index)
    .slice(0, MAX_HELD_BACK_CARDS);
  const allowed = new Set(ranked.map(entry => entry.index));
  const used = { openings: new Set(), endings: new Set() };
  return items.map((item, index) => buildWhyLine(item.contributions, item.id, used, { heldBack: allowed.has(index) }));
}

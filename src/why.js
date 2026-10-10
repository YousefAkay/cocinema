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

// The template for this film: the one its id hashes to, or the next one whose opening is not
// already taken.
function pickTemplate(count, filmId, usedOpenings) {
  const templates = TEMPLATES[count];
  const start = hashId(filmId) % templates.length;
  for (let step = 0; step < templates.length; step++) {
    const candidate = templates[(start + step) % templates.length];
    if (!usedOpenings.has(candidate.opening)) {
      return candidate;
    }
  }
  return templates[start];
}

// A title is shown with its year only when two of the rated films in play share a title.
function namer(contributions) {
  const counts = new Map();
  for (const item of contributions) {
    counts.set(item.title, (counts.get(item.title) || 0) + 1);
  }
  return item => (counts.get(item.title) > 1 ? titleWithYear(item) : item.title);
}

// Builds the "why" sentence from explainMatch() output (sorted, largest positive first) for one
// film. usedOpenings is the set of openings already taken by earlier cards; the line avoids them
// where it can and adds its own. Plain text only: the caller must put it on the page with
// textContent, never innerHTML.
export function buildWhyLine(contributions, filmId = '', usedOpenings = new Set()) {
  if (!contributions.some(item => item.contribution > 0)) {
    return NEUTRAL_LINE;
  }

  const { chosen, positiveTotal } = chosenContributions(contributions);
  const template = pickTemplate(chosen.length, filmId, usedOpenings);
  usedOpenings.add(template.opening);

  const nameOf = namer(contributions);
  let line = template.build(chosen.map(item => ({ name: nameOf(item), score: item.score })));

  const negatives = contributions.filter(item => item.contribution < 0);
  const worst = negatives[negatives.length - 1];
  if (worst && -worst.contribution >= HELD_BACK_SHARE * positiveTotal) {
    line += ` Your ${worst.score} for ${nameOf(worst)} held it back a little.`;
  }
  return line;
}

// Lines for a whole list of cards, in order, so no two cards open the same way (as far as the
// templates allow). items: [{ id, contributions }].
export function buildWhyLines(items) {
  const used = new Set();
  return items.map(item => buildWhyLine(item.contributions, item.id, used));
}

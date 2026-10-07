import { titleWithYear } from './format.js';

const ENOUGH_OF_POSITIVE = 0.7;
const MAX_TITLES = 3;
const MEANINGFUL_NEGATIVE = 0.15;

export const NEUTRAL_LINE = 'A broad match to the overall shape of your ratings.';

function joinList(items) {
  if (items.length === 1) {
    return items[0];
  }
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Builds the "why" sentence from explainMatch() output (sorted, largest positive first).
// Plain text only: the caller must put it on the page with textContent, never innerHTML.
export function buildWhyLine(contributions) {
  const positives = contributions.filter(item => item.contribution > 0);
  if (positives.length === 0) {
    return NEUTRAL_LINE;
  }

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

  let line = `Because you rated ${joinList(chosen.map(item => `"${titleWithYear(item)}" ${item.score}`))}`;

  const negatives = contributions.filter(item => item.contribution < 0);
  const worst = negatives[negatives.length - 1];
  if (worst && -worst.contribution >= MEANINGFUL_NEGATIVE * positiveTotal) {
    line += `; held back by your ${worst.score} for "${titleWithYear(worst)}"`;
  }

  return `${line}.`;
}

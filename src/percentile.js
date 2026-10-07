// Where a score sits among all candidate scores, as "Top N%".
// Rank is 1 plus the number of strictly better scores, so tied films share a rank.
// Returns a whole number from 1 to 100 (never 0), or null when there are no scores.
export function topPercent(score, allScores) {
  if (allScores.length === 0) {
    return null;
  }
  const better = allScores.filter(other => other > score).length;
  const percent = Math.round((100 * (better + 1)) / allScores.length);
  return Math.min(100, Math.max(1, percent));
}

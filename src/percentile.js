// Where a score sits among all candidate scores, as a share of the list: 1 / n for the best,
// 1 for the worst. Rank is 1 plus the number of strictly better scores, so tied films share a rank.
// Not rounded, so it can be used to order films. Returns null when there are no scores.
export function percentileRank(score, allScores) {
  if (allScores.length === 0) {
    return null;
  }
  const better = allScores.filter(other => other > score).length;
  return (better + 1) / allScores.length;
}

// The same thing as a whole-number "Top N%" from 1 to 100 (never 0), or null when there are no scores.
export function topPercent(score, allScores) {
  const rank = percentileRank(score, allScores);
  if (rank === null) {
    return null;
  }
  return Math.min(100, Math.max(1, Math.round(100 * rank)));
}

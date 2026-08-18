// KR-8 · score helpers shared by /inbox and /operating-score.
//
// selfScore is LIFTED from OperatingScore.js's module-private _selfScore, not
// re-derived — the founder's dashboard and the Ops page must never disagree
// about the same person's number. OperatingScore imports it back from here.
export function selfScore(stats) {
  if (!stats || stats.actionable === 0) return null;
  const completion = (stats.completion_rate || 0) / 100;
  const overdueRatio = stats.open > 0 ? stats.overdue / stats.open : 0;
  const raw = completion * 100 - overdueRatio * 40;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// The reference's "Excellent / Checked Daily" caption, derived honestly from
// the score alone — no fabricated delta required.
export function scoreBand(score) {
  if (score == null) return null;
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 40) return "Fair";
  return "Needs work";
}

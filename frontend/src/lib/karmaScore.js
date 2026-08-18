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

/**
 * KR-9 · scoreActions — what to do first, derived from real stats.
 *
 * REPLACES `demoActions`, which shipped hardcoded point-lifts ("+6 pts") for
 * a tenant named Kapoor Retail. Those numbers were not modelled, estimated or
 * even sampled — they were typed, and printed next to real figures on a page
 * whose whole job is to be trusted about numbers.
 *
 * What survives is the useful half: the ORDER. Each item below is true when
 * it renders and links where it says. None of them claims a lift, because
 * nothing in the system can compute one — the score has no history to fit a
 * counterfactual against (see the plan's data audit).
 *
 * @param {object} stats       the payload's stats block
 * @param {object} categories  company.categories, when the viewer is an owner
 */
export function scoreActions(stats, categories = null) {
  const out = [];
  if (!stats) return out;

  if (stats.overdue > 0) {
    out.push({
      key: "overdue",
      label: `Clear ${stats.overdue} overdue task${stats.overdue === 1 ? "" : "s"}`,
      why: "Overdue work is the single biggest drag on Execution.",
      to: "/my-work?filter=overdue",
    });
  }
  if (stats.open_complaints > 0) {
    out.push({
      key: "complaints",
      label: `Close ${stats.open_complaints} open complaint${stats.open_complaints === 1 ? "" : "s"}`,
      why: "Responsiveness counts open complaints against you directly.",
      to: "/crm",
    });
  }

  // The weakest scored category, named — but only when there IS one and it is
  // actually weak. "Your weakest is 91" is not an action.
  const scored = Object.entries(categories || {}).filter(([, v]) => v != null);
  const weakest = scored.sort((a, b) => a[1] - b[1])[0];
  if (weakest && weakest[1] < 70) {
    out.push({
      key: "weakest",
      label: `${weakest[0][0].toUpperCase()}${weakest[0].slice(1)} is at ${weakest[1]}`,
      why: "Your lowest-scoring category — open it to see what is pulling it down.",
      to: null,           // handled in-page: opens that category's drill-down
      drill: weakest[0],
    });
  }

  if (stats.open > 0 && stats.done === 0) {
    out.push({
      key: "first-close",
      label: "Close your first task",
      why: "Completion rate has no denominator until something finishes.",
      to: "/my-work",
    });
  }
  return out;
}

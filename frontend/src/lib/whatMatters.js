/**
 * The editorial layer: what matters today, and why.
 *
 * Grouping answered "when is this due?". It did not answer "what should I do
 * first?", which is the question a founder opens the app with. This module
 * answers that one.
 *
 * TIERS, NOT A SCORE. A weighted score would rank better on average and be
 * useless the first time it ranked something wrong, because nobody could see
 * why. Tiers are explainable in a sentence — "someone is blocked on you" beats
 * "0.87" — and every item carries the reason it placed where it did. If the
 * ranking is wrong, the reason shows you exactly which rule to argue with.
 *
 * The tiers, in order:
 *   1. Decisions awaiting your approval — someone else's work is blocked
 *   2. Escalations addressed to you — a person explicitly asked
 *   3. Overdue work — promises already broken, worst first
 *   4. Due today — breaks today if ignored
 *
 * Everything else is "not today". That is a claim, not an omission: the counts
 * of what is not shown travel with the result so the caller can always say how
 * much is behind the fold.
 *
 * IMPORTANT — this ranks whatever it is given. It cannot make an inflated or
 * contradictory dataset trustworthy. If "96 delayed / 0 completed" reaches this
 * function, it will rank 96 delayed items with perfect confidence. The counts
 * have to be right at source (see MIGRATION-FOLLOWUPS.md B1/B3); a calm
 * presentation over wrong numbers is worse than an ugly one, because it earns
 * trust the data has not.
 */

/** @typedef {'approval'|'escalation'|'overdue'|'today'} MatterTier */

const TIER_ORDER = ["approval", "escalation", "overdue", "today"];

const isTerminal = (t) => t?.status === "done" || t?.status === "cancelled";

/** Days a task is past due; 0 if not overdue. */
function daysLate(due) {
  if (!due) return 0;
  const ms = Date.now() - new Date(due).getTime();
  return ms > 0 ? Math.floor(ms / 86400000) : 0;
}

function isDueToday(due) {
  if (!due) return false;
  const d = new Date(due);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

/**
 * Rank decisions and tasks into "what matters today".
 *
 * @param {{decisions?: any[], tasks?: any[], limit?: number}} input
 * @returns {{
 *   items: Array<{id: string, kind: 'decision'|'task', tier: MatterTier, reason: string, title: string, ref: any}>,
 *   hidden: number,
 *   counts: Record<MatterTier, number>,
 *   summary: string
 * }}
 *
 * @example
 * const { items, summary, hidden } = whatMatters({ decisions, tasks });
 * // summary → "2 decisions need you and 1 task is overdue."
 */
export function whatMatters({ decisions = [], tasks = [], limit = 3 } = {}) {
  const candidates = [];

  for (const d of decisions) {
    if (d?.status !== "pending_approval") continue;
    candidates.push({
      id: d.id,
      kind: "decision",
      tier: "approval",
      // The reason is the point: it says whose problem this is, not how urgent a model thinks it is.
      reason: "Waiting on your approval — work is blocked until you decide",
      title: d.title,
      ref: d,
      sort: 0,
    });
  }

  for (const t of tasks) {
    if (isTerminal(t)) continue;

    if (t.source === "escalation") {
      candidates.push({
        id: t.id,
        kind: "task",
        tier: "escalation",
        reason: `${t.assignee_name || "Someone"} escalated this to you`,
        title: t.title,
        ref: t,
        sort: 0,
      });
      continue;
    }

    const late = daysLate(t.due_date);
    if (late > 0) {
      candidates.push({
        id: t.id,
        kind: "task",
        tier: "overdue",
        reason: late === 1 ? "1 day overdue" : `${late} days overdue`,
        title: t.title,
        ref: t,
        // Worst first, and within the same day count the larger amount leads.
        sort: -(late * 1e6 + (Number(t.amount) || 0)),
      });
      continue;
    }

    if (isDueToday(t.due_date)) {
      candidates.push({
        id: t.id,
        kind: "task",
        tier: "today",
        reason: "Due today",
        title: t.title,
        ref: t,
        sort: -(Number(t.amount) || 0),
      });
    }
  }

  candidates.sort((a, b) => {
    const ta = TIER_ORDER.indexOf(a.tier);
    const tb = TIER_ORDER.indexOf(b.tier);
    return ta !== tb ? ta - tb : a.sort - b.sort;
  });

  const counts = TIER_ORDER.reduce((acc, t) => {
    acc[t] = candidates.filter((c) => c.tier === t).length;
    return acc;
  }, {});

  const items = candidates.slice(0, limit);

  return {
    items,
    hidden: Math.max(0, candidates.length - items.length),
    counts,
    summary: summarise(counts),
  };
}

/**
 * One sentence describing the day. Written to be readable when everything is
 * zero, because "nothing needs you" is the most valuable thing this can say and
 * the state the product should be trying to reach.
 *
 * @param {Record<MatterTier, number>} counts
 * @returns {string}
 */
export function summarise(counts) {
  const parts = [];
  if (counts.approval) parts.push(`${counts.approval} decision${counts.approval === 1 ? "" : "s"} need${counts.approval === 1 ? "s" : ""} you`);
  if (counts.escalation) parts.push(`${counts.escalation} escalated to you`);
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  if (counts.today) parts.push(`${counts.today} due today`);

  if (!parts.length) return "Nothing needs you right now. You're clear.";
  if (parts.length === 1) return `${parts[0]}.`;
  const last = parts.pop();
  return `${parts.join(", ")} and ${last}.`;
}

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
 *   2. Escalations and handoffs addressed to you — a person explicitly asked
 *   3. Overdue work — promises already broken, worst first
 *   4. Due today — breaks today if ignored
 *
 * Tier order decides who gets a slot, but not how many: the shortlist gives
 * every populated tier one slot before any tier takes a second. Six pending
 * approvals should not be able to hide the thing that is five days late.
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

/**
 * Tier, then lateness, then amount — as three separate comparisons.
 *
 * This used to be one packed number, `-(late * 1e6 + amount)`, which quietly
 * assumed every amount was under ten lakh. Indian SME amounts are routinely
 * larger, and a ₹18,00,000 task three days late then outranked one four days
 * late — the amount had leaked out of its tie-break role and into the day
 * ordering. Packing two ranks into one integer only works while you can
 * guarantee the range of the lower one, and here you cannot.
 *
 * Approvals and escalations have no within-tier ranking on purpose. "Who is
 * waiting" is not a quantity, and ordering a colleague's escalation by rupees
 * would be a judgement the data does not support. Array.prototype.sort is
 * stable, so they hold the order they arrived in.
 */
function compare(a, b) {
  const ta = TIER_ORDER.indexOf(a.tier);
  const tb = TIER_ORDER.indexOf(b.tier);
  if (ta !== tb) return ta - tb;
  if (a.tier !== "overdue" && a.tier !== "today") return 0;
  if (a.late !== b.late) return b.late - a.late;
  return b.amount - a.amount;
}

/**
 * Fill the shortlist with one slot per populated tier before letting any tier
 * take a second.
 *
 * Straight rank order meant six pending approvals filled all three slots and a
 * founder's morning brief never showed the thing that was five days late. Tier
 * order still decides who gets a slot when there are more populated tiers than
 * slots — it just no longer lets one tier monopolise the list while another is
 * shut out entirely.
 *
 * @param {any[]} candidates Already sorted by `compare`.
 */
function oneSlotPerTier(candidates, limit) {
  const chosen = [];
  const taken = new Set();

  for (const tier of TIER_ORDER) {
    if (chosen.length >= limit) break;
    const best = candidates.find((c) => c.tier === tier);
    if (best) {
      chosen.push(best);
      taken.add(best.id);
    }
  }

  // Slots left over after every tier has been represented go to the best of
  // the rest, which is the old behaviour and the right one at that point.
  for (const c of candidates) {
    if (chosen.length >= limit) break;
    if (!taken.has(c.id)) {
      chosen.push(c);
      taken.add(c.id);
    }
  }

  return chosen.sort(compare);
}

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
      late: 0,
      amount: Number(d.amount) || 0,
    });
  }

  for (const t of tasks) {
    if (isTerminal(t)) continue;

    /* Escalations and handoffs are one tier, because they are one situation:
       a named person has put this in front of you and is waiting. The Desk
       already treats them together in its "Needs your attention" section, and
       two definitions of the same thing is how counts start disagreeing. The
       verb still differs, because being escalated to and being handed
       something are not the same social act. */
    if (t.source === "escalation" || t.source === "handoff") {
      const who = t.raised_by_name || t.assignee_name || "Someone";
      candidates.push({
        id: t.id,
        kind: "task",
        tier: "escalation",
        reason: `${who} ${t.source === "handoff" ? "handed this to you" : "escalated this to you"}`,
        title: t.title,
        ref: t,
        late: 0,
        amount: Number(t.amount) || 0,
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
        late,
        amount: Number(t.amount) || 0,
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
        late: 0,
        amount: Number(t.amount) || 0,
      });
    }
  }

  candidates.sort(compare);

  const counts = TIER_ORDER.reduce((acc, t) => {
    acc[t] = candidates.filter((c) => c.tier === t).length;
    return acc;
  }, {});

  const items = oneSlotPerTier(candidates, limit);

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

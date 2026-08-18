// KR-8.7 · deskInsight — what Dex leads with on /inbox.
//
// THE HONESTY RULE THAT SHAPES THIS FILE. NM-14 deleted the old "2 things
// worth knowing…" block because it restated, in prose, the numbers printed
// directly beneath it. The founder now wants Dex back — but as a READ, not a
// readout: the single most critical thing, said plainly, with what to do
// about it.
//
// So this is a RANKER, not a generator. Every figure it prints comes from an
// endpoint the page already calls (no new requests, and by construction it
// can never disagree with the tiles). Nothing is modelled, projected or
// invented — the judgement it adds is only WHICH fact leads, and that is a
// fixed severity order:
//
//   money already earned  >  decisions blocking others  >  slipped work  >
//   losing money  >  unhappy customers  >  the weakest score
//
// Cash tops it because an overdue invoice is the only item on the list that
// is purely someone else's inaction, and it compounds daily.
import { inrCompact } from "./format";

/**
 * @param {object} m           the useDeskMetrics() bag
 * @param {number} pending     decisions waiting on the founder (desk counters)
 * @returns {{headline: string, lines: string[], to: string, cta: string, tone: "urgent"|"calm"}|null}
 *          null while the data is still arriving — the card shows a skeleton.
 */
export function deskInsight(m, pending = 0) {
  if (!m || (!m.cash && !m.work && !m.ledger && !m.complaints)) return null;

  const cash = m.cash;
  const work = m.work;
  const ledger = m.ledger;
  const complaints = m.complaints;
  const weakest = m.ops?.view === "owner" ? m.ops.weakest : null;

  // Each candidate is a fact that is TRUE right now, in severity order.
  const candidates = [];

  if (cash?.overdue > 0) {
    candidates.push({
      headline: `${inrCompact(cash.overdue)} is sitting in invoices already past due.`,
      line: `${inrCompact(cash.overdue)} overdue — money you have already earned.`,
      to: "/finance?tab=revenue&filter=overdue",
      cta: "Chase it",
      tone: "urgent",
    });
  }

  if (pending > 0) {
    candidates.push({
      headline: `${pending} decision${pending === 1 ? " is" : "s are"} parked on you.`,
      line: `${pending} decision${pending === 1 ? "" : "s"} waiting — everything downstream is holding.`,
      to: "/inbox",
      cta: "Clear them",
      tone: "urgent",
    });
  }

  const overdueTasks = work?.overdue ?? 0;
  if (overdueTasks > 0) {
    // work.worst is [task_type, count] — name it only when one type actually
    // dominates, otherwise "spread across the board" would be the honest read.
    const worst = work.worst;
    const dominates = worst && worst[1] >= Math.ceil(overdueTasks / 2);
    candidates.push({
      headline: `${overdueTasks} task${overdueTasks === 1 ? " has" : "s have"} slipped past their due date.`,
      line: dominates
        ? `${overdueTasks} tasks late, most of them ${String(worst[0]).replace(/_/g, " ")}.`
        : `${overdueTasks} task${overdueTasks === 1 ? "" : "s"} late across the board.`,
      to: "/my-work?filter=overdue",
      cta: "See the list",
      tone: "urgent",
    });
  }

  if (ledger && Number.isFinite(ledger.netProfit) && ledger.netProfit < 0) {
    candidates.push({
      headline: `You are running at a loss of ${inrCompact(Math.abs(ledger.netProfit))} this period.`,
      line: `Net profit is negative — ${inrCompact(Math.abs(ledger.netProfit))} down.`,
      to: "/finance",
      cta: "Open the books",
      tone: "urgent",
    });
  }

  if (complaints?.new_7d > 0) {
    const n = complaints.new_7d;
    candidates.push({
      headline: `${n} new complaint${n === 1 ? "" : "s"} landed this week.`,
      line: `${n} new complaint${n === 1 ? "" : "s"} in the last seven days.`,
      to: "/crm",
      cta: "Read them",
      tone: "urgent",
    });
  }

  if (weakest) {
    candidates.push({
      headline: `${cap(weakest[0])} is your weakest score at ${weakest[1]} out of 100.`,
      line: `${cap(weakest[0])} is the score dragging hardest, at ${weakest[1]}.`,
      to: "/operating-score",
      cta: "See why",
      tone: "calm",
    });
  }

  if (!candidates.length) {
    return {
      headline: "Nothing is on fire.",
      lines: [
        "No overdue money, no late work, no decisions parked on you.",
        "Good time to look further out than today.",
      ],
      to: "/operating-score",
      cta: "Check the score",
      tone: "calm",
    };
  }

  const lead = candidates[0];
  return {
    headline: lead.headline,
    // The next two facts, in their own words — never a re-run of the lead.
    lines: candidates.slice(1, 3).map((c) => c.line),
    to: lead.to,
    cta: lead.cta,
    tone: lead.tone,
  };
}

const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

export default deskInsight;

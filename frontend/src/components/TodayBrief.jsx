import { ArrowRight, CheckCircle } from "@phosphor-icons/react";
import { whatMatters } from "../lib/whatMatters";
import { money } from "../lib/format";
import { Card, Button } from "@/components/ds";

/**
 * The first thing on the Decision Desk: one sentence about the day, then the
 * three things that matter most, each carrying the reason it placed there.
 *
 * WHY THIS IS FIRST. Measured on the real DOM at 1440×900, the Desk's first
 * viewport was 57% capture block — the founder's morning screen opened on
 * three ways to type something in and nothing about their business. The first
 * approval card began at 669px, below the fold. This block inverts that: the
 * business first, the input below it.
 *
 * WHY THREE. Not because three is a nice number — because a list you can hold
 * in your head is a decision and a list you scroll is a queue. The count of
 * what is not shown travels with it, always, so shortening the list never
 * becomes hiding the work.
 *
 * WHAT THE COLOUR MEANS. The left edge is urgency and only urgency, so it
 * appears on overdue and due-today and nowhere else. Approvals and escalations
 * are not urgency states — they are who is waiting — and giving them an edge
 * would be a colour encoding a category, which is the disease this system
 * removed. Their reason line says it in words instead.
 *
 * This component ranks what it is handed and cannot make a bad dataset good.
 * The counts feeding it are known to disagree across endpoints
 * (MIGRATION-FOLLOWUPS.md B1/B3) — a calm brief over wrong numbers is worse
 * than an ugly one, because it earns trust the data has not got.
 */

/** Only the tiers that genuinely are urgency get the coloured edge. */
const EDGE_FOR_TIER = { overdue: "overdue", today: "today" };

function MatterRow({ item, rank, onOpenDecision }) {
  const { ref, kind, tier, reason, title } = item;
  const amount = ref?.amount;
  const who = ref?.assignee_name;
  const isDecision = kind === "decision";

  return (
    <Card
      urgency={EDGE_FOR_TIER[tier]}
      padding="sm"
      data-testid={`today-brief-item-${item.id}`}
    >
      <div className="flex items-start gap-3">
        {/* The ordinal is the answer to "what first", so it is the one number
            in this block that is allowed to be prominent. */}
        <span
          aria-hidden="true"
          className="shrink-0 w-6 h-6 mt-0.5 flex items-center justify-center rounded-pill bg-surface-sunken text-text-secondary text-xs font-semibold"
        >
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold tracking-tight truncate" data-testid={`today-brief-title-${item.id}`}>
              {title}
            </p>
            {amount != null && amount !== "" && (
              <span className="shrink-0 text-sm text-text-secondary tabular-nums">{money(amount)}</span>
            )}
          </div>

          {/* The reason is the point of the whole module: every item can say
              why it placed where it did, which is what makes the ranking
              arguable instead of oracular. */}
          <p className="mt-1 text-sm text-text-secondary" data-testid={`today-brief-reason-${item.id}`}>
            {reason}
            {who && !isDecision ? ` · ${who}` : ""}
          </p>

          {isDecision && onOpenDecision && (
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenDecision(ref.id)}
                data-testid={`today-brief-review-${item.id}`}
              >
                Review <ArrowRight size={14} weight="bold" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * @param {object} props
 * @param {any[]} props.decisions
 * @param {any[]} props.tasks
 * @param {(id: string) => void} [props.onOpenDecision]
 * @param {() => void} [props.onSeeRest] Scrolls to the full lists further down the page.
 */
export function TodayBrief({ decisions = [], tasks = [], onOpenDecision, onSeeRest }) {
  const { items, hidden, summary } = whatMatters({ decisions, tasks });
  const clear = items.length === 0;

  return (
    <section className="mb-8" data-testid="today-brief" aria-labelledby="today-brief-heading">
      <h1 id="today-brief-heading" className="text-2xl font-extrabold tracking-tight">
        Today
      </h1>

      {/* One sentence, and it carries the full breakdown — so the three cards
          below can be a shortlist without the shortlist being the only thing
          the founder is told. */}
      <p className="mt-1 text-lg text-text-secondary" data-testid="today-brief-summary">
        {summary}
      </p>

      {clear ? (
        <div className="mt-4 flex items-center gap-2 text-text-secondary" data-testid="today-brief-clear">
          <CheckCircle size={20} weight="fill" className="text-status-completed-fg" />
          <span className="text-sm">Nothing is overdue, escalated or waiting on your approval.</span>
        </div>
      ) : (
        <>
          <div className="mt-4 space-y-3" data-testid="today-brief-items">
            {items.map((item, i) => (
              <MatterRow key={item.id} item={item} rank={i + 1} onOpenDecision={onOpenDecision} />
            ))}
          </div>

          {/* Never a bare "3 of 16". Subtraction is only legitimate while the
              remainder is both counted and reachable. */}
          {hidden > 0 && (
            <div className="mt-3">
              <Button variant="tertiary" size="sm" onClick={onSeeRest} data-testid="today-brief-show-rest">
                See the other {hidden} <ArrowRight size={14} weight="bold" />
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

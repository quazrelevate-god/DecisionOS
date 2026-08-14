// MPWA-04 · MobileCard — the three-line collapsed card (§5.2.6, §7).
//
//   line 1  title, clamped to TWO lines (§3.4: never one — single-line
//           clamping makes near-identical items indistinguishable)
//   line 2  status chip + relative due
//   line 3  context chip (who / what it unblocks) + amount, right-aligned
//
// The whole card is one tap target with one chevron (§5.2.4 — never a corner
// chevron *and* a "View details" link). Actions live in the sheet the card
// opens, not on the card.
import * as React from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { inr } from "@/lib/format";
import { StatusChip } from "./StatusChip";

/** Relative inside 7 days, absolute beyond — §5.4. Never a midnight stamp. */
export function dueLabel(input, now = new Date()) {
  if (!input) return null;
  const d = new Date(String(input).length <= 10 ? `${input}T12:00:00` : input);
  if (Number.isNaN(d.getTime())) return null;
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((startOf(d) - startOf(now)) / 86400000);
  if (days === 0) return { text: "Due today", tone: "pending" };
  if (days === 1) return { text: "Due tomorrow", tone: "pending" };
  if (days === -1) return { text: "1 day late", tone: "overdue" };
  if (days < -1 && days >= -7) return { text: `${Math.abs(days)} days late`, tone: "overdue" };
  if (days > 1 && days <= 7) {
    return {
      text: `Due ${d.toLocaleDateString(undefined, { weekday: "long" })}`,
      tone: "pending",
    };
  }
  const abs = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return days < 0
    ? { text: `Late since ${abs}`, tone: "overdue" }
    : { text: `Due ${abs}`, tone: "neutral" };
}

/** Initials avatar. No image dependency — these are colleagues, not profiles. */
function Avatar({ name, className }) {
  const initials = String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-pill bg-neutral-100 text-[length:var(--text-label)] font-semibold text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200",
        className
      )}
    >
      {initials}
    </span>
  );
}

/**
 * @param {string}  title
 * @param {string}  [status]     status chip key — pending|overdue|completed|directive|rejected
 * @param {string}  [statusLabel] overrides the chip's text
 * @param {string}  [due]        ISO date or datetime
 * @param {string}  [context]    the third line — "From Suresh · Unblocks 3 tasks"
 * @param {string}  [person]     name for the avatar on the row
 * @param {number}  [amount]     right-aligned, tabular, always exact (§5.3)
 * @param {Function} onOpen      whole-card tap
 */
export function MobileCard({
  title,
  status,
  statusLabel,
  due,
  context,
  person,
  amount,
  onOpen,
  className,
  "data-testid": testId,
}) {
  const d = dueLabel(due);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left",
        "transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <span className="min-w-0 flex-1">
        {/* line 1 — two-line clamp, never one */}
        <span className="block font-heading text-[0.9375rem] font-semibold leading-snug tracking-tight line-clamp-2">
          {title}
        </span>

        {/* line 2 — status + relative due */}
        {(status || d) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-touch-gap">
            {status && <StatusChip status={status} label={statusLabel} />}
            {d && (
              <span
                className={cn(
                  "text-sm",
                  d.tone === "overdue" ? "font-semibold text-danger-700" : "text-muted-foreground"
                )}
              >
                {d.text}
              </span>
            )}
          </span>
        )}

        {/* line 3 — context + person */}
        {(context || person) && (
          <span className="mt-1.5 flex items-center gap-2 min-w-0">
            {person && <Avatar name={person} />}
            {context && (
              <span className="min-w-0 truncate text-sm text-muted-foreground">{context}</span>
            )}
          </span>
        )}
      </span>

      {/* tabular-nums so amounts align down a list (§5.3), but NOT font-mono —
          §3.4 reserves mono for code, and IBM Plex Mono's wide comma makes
          "₹4,80,000" read as three separate groups. */}
      {amount != null && amount !== "" && Number(amount) !== 0 && (
        <span className="shrink-0 self-start text-right text-sm font-semibold tabular-nums">
          {inr(amount)}
        </span>
      )}

      {/* exactly one chevron, and it is not its own tap target */}
      <CaretRight
        size={20}
        weight="bold"
        aria-hidden="true"
        className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}

export default MobileCard;

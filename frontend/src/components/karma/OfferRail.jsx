// KR-8 · OfferRail — the decision queue wearing the reference's "Credit
// Offers" grammar: a count headline, the four desk chips as glass pills with
// live count badges, and the selected chip's cards as a horizontal snap-
// scroll of tinted glass cards.
//
// FUNCTIONALITY OUTRANKS THE PICTURE (the plan's standing rule): every card
// keeps the whole DeskCard action surface — the entire card is the button,
// the verb is written on it, busy shows a spinner — and the row-end circle
// toggles a wrapped "see all" grid, which is how the old board's
// see-everything-at-once survives inside the reference's one-row layout.
import * as React from "react";
import { CheckCircle, CaretRight, Spinner } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const TINTS = ["kr-glass--warm", "kr-glass--olive", "kr-glass--blue"];

export function GlassActionCard({ card, verb, icon: Icon, busy, onAction, tint, className }) {
  return (
    <button
      type="button"
      data-testid={`desk-card-${card.id}`}
      onClick={onAction}
      disabled={busy}
      className={cn(
        "kr-glass kr-lift flex w-[264px] shrink-0 snap-start flex-col p-4 text-left",
        "disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
        tint,
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/30">
          <Icon size={16} weight="regular" aria-hidden="true" />
        </span>
        {card.amount_formatted && (
          <span className="font-mono text-sm font-medium">{card.amount_formatted}</span>
        )}
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-medium leading-snug">{card.title}</p>
      <p className="mt-1 truncate text-xs opacity-70">{card.context_line}</p>
      <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold">
        {busy ? <Spinner size={12} className="animate-spin" /> : null}
        {busy ? "Working…" : verb}
        {!busy && <CaretRight size={11} weight="bold" aria-hidden="true" />}
      </p>
    </button>
  );
}

/**
 * @param {Array}    chips     [{key,label,icon,count}]
 * @param {string}   active
 * @param {Function} onChip
 * @param {Array}    cards     the active chip's cards
 * @param {Function} verbFor   (card) => label   (effectiveCta logic lives with the page)
 * @param {Function} iconFor   (card) => Icon
 * @param {Function} onCard
 * @param {string}   busyId
 * @param {string}   emptyLabel
 */
export function OfferRail({
  headline, chips, active, onChip, cards = [], verbFor, iconFor,
  onCard, busyId, emptyLabel, loading, className, testid,
}) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={cn("min-w-0", className)} data-testid={testid}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h2">{headline}</h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Back to one row" : "See all as a grid"}
          data-testid="desk-rail-expand"
          className="ml-auto grid h-10 w-10 place-items-center rounded-full border border-kr-outline transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
        >
          <CaretRight size={16} weight="bold" className={cn("transition-transform", expanded && "rotate-90")} />
        </button>
      </div>

      {/* the four questions, as the reference's range pills */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onChip(c.key)}
            aria-pressed={active === c.key}
            data-testid={`desk-pill-${c.key}`}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
              active === c.key
                ? "bg-white font-medium text-kr-ink"
                : "border border-kr-outline text-current/80 hover:text-current"
            )}
          >
            {c.label}
            <span
              className={cn(
                "grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10px] font-bold leading-none",
                active === c.key ? "bg-kr-ink text-white" : c.count > 0 ? "bg-kr-accent text-white" : "bg-white/15"
              )}
            >
              {c.count ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div
        className={cn(
          "mt-4",
          expanded
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            : "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-webkit-overflow-scrolling:touch]"
        )}
        data-testid="desk-rail-cards"
      >
        {loading && Array.from({ length: 3 }, (_, i) => (
          <div key={i} className={cn("ds-skeleton h-[150px] rounded-tile", expanded ? "" : "w-[264px] shrink-0")} />
        ))}

        {!loading && cards.length === 0 && (
          <div className="flex h-[150px] w-full flex-col items-center justify-center rounded-tile border border-white/10 text-center" data-testid={`desk-rail-empty-${active}`}>
            <CheckCircle size={20} className="mb-1.5 opacity-60" />
            <p className="text-sm opacity-70">{emptyLabel}</p>
          </div>
        )}

        {!loading && cards.map((card, i) => (
          <GlassActionCard
            key={card.id}
            card={card}
            tint={TINTS[i % TINTS.length]}
            verb={verbFor(card)}
            icon={iconFor(card)}
            busy={busyId === card.id}
            onAction={() => onCard(card)}
            className={expanded ? "w-full" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export default OfferRail;

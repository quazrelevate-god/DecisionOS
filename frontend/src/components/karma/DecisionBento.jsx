// KR-8.5 · DecisionBento — the desk, rebuilt on the founder's brief:
// "no clickable filter option — all four at one screen, not separate screens…
//  instead of list view use the entire real estate for a BentoGrid style box
//  grid… based on the high priority the box size will be increased."
//
// WHAT THIS REPLACED. A chip rail: four pills where three of the four lists
// were always one click away, and the cards were a single-file horizontal
// row. Everything is on screen now — all four sections, every card, sized by
// how much it matters.
//
// SIZE IS EARNED, NOT DECORATIVE. The rank comes from data the backend
// already sorts by: the section itself (a decision waiting on you outranks a
// flagged item), the card's position inside its section (desk.py sorts
// decisions oldest-first and on-fire by amount desc), and the money on it.
// Tier A gets half a row and 20px type; tier C gets a quarter and 14px. No
// tier is allowed below the width its text needs — that is what the min
// column spans and min-heights below are protecting.
//
// EACH SECTION OWNS A GRADIENT. Colour is the grouping, so the sections need
// no filter UI to stay legible: amber = waiting on you, red = on fire, blue =
// due today, olive = flagged.
//
// ACTED CARDS GO QUIET. Once a card's action fires, it dims and desaturates
// with a tick — "I dealt with this" — instead of vanishing, so the founder
// keeps their place in the grid.
import * as React from "react";
import { CheckCircle, Spinner, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/** Tier → grid span + type scale. Never narrower than the text can carry. */
const TIER = {
  a: {
    span: "col-span-2 sm:col-span-4 xl:col-span-6",
    minH: "min-h-[178px] xl:min-h-[196px]",
    title: "text-lg xl:text-xl font-semibold leading-snug",
    clamp: "line-clamp-3",
  },
  b: {
    span: "col-span-2 sm:col-span-2 xl:col-span-3",
    minH: "min-h-[178px] xl:min-h-[196px]",
    title: "text-base font-semibold leading-snug",
    clamp: "line-clamp-3",
  },
  c: {
    span: "col-span-1 sm:col-span-2 xl:col-span-3",
    minH: "min-h-[140px]",
    title: "text-sm font-medium leading-snug",
    clamp: "line-clamp-3",
  },
};

/**
 * Rank a section's cards into tiers. The backend has already ordered them by
 * its own urgency rule, so position carries real signal; money breaks ties
 * for the top slot.
 */
function tiersFor(cards, sectionRank) {
  const withMoney = cards.some((c) => Number(c.amount) > 0);
  return cards.map((c, i) => {
    // The first card of the two most urgent sections is the page's headline.
    if (i === 0 && sectionRank <= 1) return "a";
    if (i === 0) return "b";
    if (i <= 2 && (withMoney ? Number(c.amount) > 0 : true)) return "b";
    return "c";
  });
}

function DecisionBox({ card, tier, tint, verb, icon: Icon, busy, done, onAction }) {
  const t = TIER[tier] || TIER.c;
  return (
    <button
      type="button"
      data-testid={`desk-card-${card.id}`}
      data-tier={tier}
      onClick={onAction}
      disabled={busy || done}
      aria-label={done ? `${card.title} — actioned` : card.title}
      className={cn(
        "kr-glass kr-lift group relative flex flex-col p-4 text-left xl:p-5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
        tint, t.span, t.minH,
        // The acted state: quieter, desaturated, no longer inviting a click.
        done && "kr-done pointer-events-none"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/30">
          {done
            ? <CheckCircle size={17} weight="fill" aria-hidden="true" />
            : <Icon size={16} weight="regular" aria-hidden="true" />}
        </span>
        {card.amount_formatted && (
          <span className={cn("font-mono font-medium", tier === "a" ? "text-base" : "text-sm")}>
            {card.amount_formatted}
          </span>
        )}
      </div>

      <p className={cn("mt-3.5", t.title, t.clamp)}>{card.title}</p>

      <p className="mt-auto pt-3 text-xs leading-relaxed opacity-75">{card.context_line}</p>

      <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
        {busy && <Spinner size={12} className="animate-spin" aria-hidden="true" />}
        {done ? "Done" : busy ? "Working…" : verb}
        {!busy && !done && (
          <CaretRight size={11} weight="bold" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
        )}
      </p>
    </button>
  );
}

/**
 * @param {Array} sections [{key,label,tint,icon,count,cards,loading,empty}]
 */
export function DecisionBento({ sections, verbFor, iconFor, onCard, busyId, doneIds, className, testid }) {
  return (
    <div className={cn("min-w-0", className)} data-testid={testid}>
      {sections.map((s, si) => (
        <section key={s.key} className={cn(si > 0 && "mt-8")} data-testid={`desk-section-${s.key}`}>
          <div className="mb-3 flex items-center gap-2.5">
            <span aria-hidden="true" className={cn("h-3 w-3 rounded-full", s.dot)} />
            <h3 className="text-base font-semibold">{s.label}</h3>
            <span className="rounded-pill bg-white/10 px-2 py-0.5 text-xs font-semibold tabular-nums">
              {s.count ?? 0}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-12">
            {s.loading && Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={cn("ds-skeleton rounded-tile", TIER[i === 0 ? "a" : "b"].span, TIER.b.minH)} />
            ))}

            {!s.loading && (s.cards || []).length === 0 && (
              <div
                data-testid={`desk-section-empty-${s.key}`}
                className="col-span-2 flex min-h-[92px] items-center gap-2.5 rounded-tile border border-white/10 px-4 sm:col-span-4 xl:col-span-12"
              >
                <CheckCircle size={17} className="opacity-55" aria-hidden="true" />
                <p className="text-sm opacity-65">{s.empty}</p>
              </div>
            )}

            {!s.loading && (() => {
              const tiers = tiersFor(s.cards || [], si);
              return (s.cards || []).map((card, i) => (
                <DecisionBox
                  key={card.id}
                  card={card}
                  tier={tiers[i]}
                  verb={verbFor(card)}
                  icon={iconFor(card)}
                  busy={busyId === card.id}
                  done={doneIds?.has(card.id)}
                  onAction={() => onCard(card)}
                  tint={s.tint}
                />
              ));
            })()}
          </div>
        </section>
      ))}
    </div>
  );
}

export default DecisionBento;

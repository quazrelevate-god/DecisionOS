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
//
// ONE ROW, THEN ON DEMAND (KR-8.6). Four sections' worth of every open card
// is a wall. The founder: "for each section it's showing the entire list of
// bento boxes — I just want only one row shown, and the ability to expand."
// So each section collapses to EXACTLY one full grid row and keeps a
// "+N more" toggle. "One row" is computed, not guessed: the tiers below have
// known column spans per breakpoint, so the collapsed slice is the longest
// prefix whose spans still fit the row — which is why the count changes with
// width instead of leaving a ragged half-row.
import * as React from "react";
import { CheckCircle, Spinner, CaretRight, CaretDown } from "@phosphor-icons/react";
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

/* The same spans as TIER above, as NUMBERS — the row-fitting maths needs
   them arithmetically and Tailwind needs them as literal classes, so the two
   forms are kept adjacent and must be edited together. */
const COLS = { base: 2, sm: 4, xl: 12 };
const SPAN = {
  a: { base: 2, sm: 4, xl: 6 },
  b: { base: 2, sm: 2, xl: 3 },
  c: { base: 1, sm: 2, xl: 3 },
};

/** Which of the three grid widths is live. Media queries, not a resize
 *  listener — this fires on the two crossings only, never per pixel. */
function useBreakpoint() {
  const read = () =>
    typeof window === "undefined" ? "xl"
      : window.matchMedia("(min-width: 1280px)").matches ? "xl"
      : window.matchMedia("(min-width: 640px)").matches ? "sm"
      : "base";
  const [bp, setBp] = React.useState(read);
  React.useEffect(() => {
    const mqs = [window.matchMedia("(min-width: 1280px)"), window.matchMedia("(min-width: 640px)")];
    const onChange = () => setBp(read());
    mqs.forEach((mq) => mq.addEventListener("change", onChange));
    onChange();
    return () => mqs.forEach((mq) => mq.removeEventListener("change", onChange));
  }, []);
  return bp;
}

/** The longest prefix of `tiers` that fits one row at this width. */
function firstRowCount(tiers, bp) {
  const cols = COLS[bp];
  let used = 0;
  let n = 0;
  for (const t of tiers) {
    const w = SPAN[t]?.[bp] ?? 1;
    if (used + w > cols) break;
    used += w;
    n += 1;
  }
  return Math.max(1, n);   // a card wider than the row still shows, alone
}

function DecisionBox({ card, tier, tint, verb, icon: Icon, busy, done, onAction }) {
  const t = TIER[tier] || TIER.c;
  return (
    /* KM-3 — THE CARD IS NO LONGER THE BUTTON, below lg.
       The founder's ask: a dedicated action button living in a bite cut out of
       the card's bottom-right corner — "Review" on Needs your decision, "Chase"
       on On fire — so the action is taken deliberately rather than by tapping
       anywhere on the card. That forces the outer element from <button> to
       <div>: a button inside a button is invalid HTML and hands screen readers
       two overlapping targets for one action.

       WHY THE SURFACE IS ITS OWN LAYER. A CSS mask applies to the element AND
       everything inside it, so with .kr-cut-br on the card the action button —
       being a child, and sitting exactly in the cut — was masked away with the
       corner. Measured: the bite rendered, the button did not. So the glass
       surface is an absolutely-positioned sibling that carries the mask alone,
       the content sits above it unmasked, and the button is a sibling of both.
       Desktop is unchanged: .kr-cut-br drops its mask at lg and the button
       becomes a normal static footer action. */
    <div
      data-testid={`desk-card-${card.id}`}
      data-tier={tier}
      className={cn("group relative flex flex-col", t.span, t.minH)}
    >
      {/* The masked surface. aria-hidden: it is paint, not content. */}
      <span
        aria-hidden="true"
        className={cn("kr-glass kr-cut-br absolute inset-0", tint, done && "kr-done")}
      />

      <div className="relative flex flex-1 flex-col p-4 text-left xl:p-5">
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

        {/* pr-28 keeps the context line clear of the cut: the bite is 118px
            wide and text running under it would be sliced mid-word. */}
        <p className="mt-auto pr-28 pt-3 text-xs leading-relaxed opacity-75 lg:pr-0">
          {card.context_line}
        </p>
      </div>

      {/* THE ACTION. 102x40 inside a 118x56 cut, leaving the 8px ring of
          clearance that makes the card's edge read as tracing the button
          rather than colliding with it. White on the ink band, because this
          is the one thing on the card you are meant to hit. */}
      <button
        type="button"
        onClick={onAction}
        disabled={busy || done}
        data-testid={`desk-card-action-${card.id}`}
        aria-label={done ? `${card.title} — actioned` : `${verb}: ${card.title}`}
        className={cn(
          "absolute bottom-2 right-2 z-10 flex h-10 w-[102px] items-center justify-center gap-1.5",
          "rounded-pill text-xs font-semibold",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          done ? "bg-white/15 text-white/70" : "bg-white text-kr-ink disabled:opacity-60",
          "lg:static lg:mt-2 lg:mb-4 lg:ml-4 lg:w-fit lg:px-3.5"
        )}
      >
        {busy && <Spinner size={12} className="animate-spin" aria-hidden="true" />}
        {done ? "Done" : busy ? "Working…" : verb}
        {!busy && !done && (
          <CaretRight size={11} weight="bold" aria-hidden="true"
            className="transition-transform group-hover:translate-x-0.5" />
        )}
      </button>
    </div>
  );
}

/**
 * @param {Array} sections [{key,label,tint,icon,count,cards,loading,empty}]
 */
export function DecisionBento({ sections, verbFor, iconFor, onCard, busyId, doneIds, className, testid }) {
  const bp = useBreakpoint();
  const [open, setOpen] = React.useState(() => new Set());
  const toggle = (key) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    /* KM-3 — BELOW lg THE FOUR SECTIONS SCROLL SIDEWAYS, one per screen.
       Stacked vertically they made the band ~1,800px tall: four headings and
       their cards, so reaching "Important" meant scrolling past everything
       else. Horizontally they cost one screen each and the band's height is
       set by the tallest visible panel — which, collapsed, is one card.
       .kr-snap carries the snap + gutter bleed; at lg it turns itself back
       into a plain block and the sections stack exactly as they do today. */
    <div className={cn("min-w-0 kr-snap", className)} data-testid={testid}>
      {sections.map((s, si) => {
        const cards = s.cards || [];
        const tiers = tiersFor(cards, si);
        const rowN = firstRowCount(tiers, bp);
        const expanded = open.has(s.key);
        const shown = expanded ? cards : cards.slice(0, rowN);
        const hidden = cards.length - rowN;

        return (
          <section key={s.key} className={cn("min-w-0", si > 0 && "lg:mt-8")} data-testid={`desk-section-${s.key}`}>
            <div className="mb-3 flex items-center gap-2.5">
              <span aria-hidden="true" className={cn("h-3 w-3 rounded-full", s.dot)} />
              <h3 className="text-base font-semibold">{s.label}</h3>
              <span className="rounded-pill bg-white/10 px-2 py-0.5 text-xs font-semibold tabular-nums">
                {s.count ?? 0}
              </span>

              {/* The expander only exists when there is something behind the
                  fold — a permanent "show less" on a one-card section would
                  be a control that does nothing. */}
              {!s.loading && hidden > 0 && (
                <button
                  type="button"
                  onClick={() => toggle(s.key)}
                  aria-expanded={expanded}
                  data-testid={`desk-expand-${s.key}`}
                  className="ml-auto flex h-8 items-center gap-1.5 rounded-pill border border-white/20 px-3 text-xs font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {expanded ? "Show less" : `+${hidden} more`}
                  <CaretDown
                    size={11}
                    weight="bold"
                    aria-hidden="true"
                    className={cn("transition-transform duration-200", expanded && "rotate-180")}
                  />
                </button>
              )}
            </div>

            {/* Collapsed, the panel is exactly one card tall — the founder's
                "fixed to accommodate one single card". Expanded (via +N more)
                it becomes a capped, freely-scrolling column. Both caps are
                lg:-reset so desktop keeps its full grid. */}
            <div className={cn(
              "grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-12",
              expanded
                ? "max-h-[60vh] overflow-y-auto lg:max-h-none lg:overflow-visible"
                : "overflow-hidden"
            )}>
              {s.loading && Array.from({ length: 3 }, (_, i) => (
                <div key={i} className={cn("ds-skeleton rounded-tile", TIER[i === 0 ? "a" : "b"].span, TIER.b.minH)} />
              ))}

              {!s.loading && cards.length === 0 && (
                <div
                  data-testid={`desk-section-empty-${s.key}`}
                  className="col-span-2 flex min-h-[92px] items-center gap-2.5 rounded-tile border border-white/10 px-4 sm:col-span-4 xl:col-span-12"
                >
                  <CheckCircle size={17} className="opacity-55" aria-hidden="true" />
                  <p className="text-sm opacity-65">{s.empty}</p>
                </div>
              )}

              {!s.loading && shown.map((card, i) => (
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
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default DecisionBento;

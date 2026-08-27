// KR-8 · StatTile — the reference's KPI tile, exactly: outlined icon chip
// top-left, arrow circle top-right, label (italic in the grid), big numeral
// bottom-left, mini-viz bottom-right. One of the six is glass.
//
// THE WHOLE TILE IS THE LINK — the founder's standing pattern since the
// bento ("the row is the button"). The arrow circle is therefore
// PRESENTATIONAL (aria-hidden span, not a nested button): nesting a second
// interactive element inside a link is both invalid HTML and a worse target.
// It still rotates on hover because .kr-lift owns the .kr-arrow glyph.
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { IconChip } from "./IconChip";
import { BigNumeral } from "./BigNumeral";

/**
 * @param {Component} icon
 * @param {boolean|number} alert   orange badge on the chip
 * @param {string}  label
 * @param {string}  value          formatted string for BigNumeral
 * @param {boolean} urgent         numeral goes accent (alert grammar)
 * @param {node}    viz            mini-viz for the bottom-right corner
 * @param {string}  to             the FILTERED destination (bento rule kept)
 * @param {boolean} glass          the one frosted tile per grid
 * @param {string}  meaning        optional one-line "so what"
 */
export function StatTile({
  icon, alert = false, label, value, urgent = false, viz, to,
  glass = false, countUp = false, meaning, className, testid,
}) {
  const arrow = (
    <span
      aria-hidden="true"
      className={cn(
        // KM-1 — DESKTOP ONLY. This was always presentational (see the header
        // note: the whole tile is the Link), and its one behaviour is a hover
        // translate owned by .kr-lift — hover does not exist on a phone. At
        // 165px it was a 40px circle eating 30% of the header row, next to a
        // 40px chip, leaving a 41px hole between them and forcing every label
        // onto its own line below. Press feedback survives without it:
        // .kr-lift:active gives translateY(-1px) scale(.99), and :active DOES
        // fire on touch.
        "hidden h-10 w-10 shrink-0 place-items-center rounded-full lg:grid",
        glass
          ? "bg-white text-kr-ink"
          : "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]"
      )}
    >
      <ArrowRight size={18} weight="bold" className="kr-arrow transition-transform duration-200" />
    </span>
  );

  return (
    <Link
      to={to}
      data-testid={testid}
      className={cn(
        // KR-8.1: min-height + a flex spacer give the reference's air — the
        // numeral sits at the BOTTOM of a tall tile, not under the label.
        // Labels go roman: the full-res reference is not italic.
        // KR-8.6: the lg floor drops to 170 because the grid now stretches
        // its rows (auto-rows-fr) — the min-height is a floor for short
        // columns, not the thing that sets tile height.
        // KM-1: 120 is the arithmetic of the reshaped tile, not a guess —
        // p-4 16 + chip 40 + pt-3 12 + numeral 36 + p-4 16 = 120.
        "kr-lift flex min-h-[120px] flex-col p-4 sm:p-5 lg:min-h-[170px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
        glass ? "kr-glass kr-glass--blue" : "nm-tile",
        className
      )}
    >
      {/* KM-1 — on a phone the chip sits INLINE with the label, so one row
          says "this is the Delayed tile" and the number below owns the floor
          alone. The label gets 133.5 - 40 - 12 = 81.5px, which wraps every
          existing label to at most two lines (38.5px) — inside the 40px the
          chip already dictates, so two-line labels cost nothing and no copy
          changed. line-clamp-2 is the hard guarantee.
          From lg the row is exactly what it was: items-start, justify-between,
          chip left, arrow right, label on its own line beneath. */}
      <div className="flex items-center gap-3 lg:items-start lg:justify-between">
        <IconChip icon={icon} alert={alert} />
        <p className={cn("min-w-0 text-sm leading-snug line-clamp-2 lg:hidden", glass ? "opacity-90" : "text-foreground/80")}>
          {label}
        </p>
        {arrow}
      </div>

      <p className={cn("mt-4 hidden text-base lg:block", glass ? "opacity-90" : "text-foreground/80")}>
        {label}
      </p>

      {/* KM-1 — the viz is desktop-only. At 165px this row had to fit a
          text-4xl numeral (~84px for a rupee compact) plus gap-3 plus a 64px
          MiniBars into 133.5px: it collided, and CircleDots (74px) and
          TinySpark (72px) made it worse. Four 6px bars beside a 36px number is
          texture, not information; the number is the point, and dropping the
          chart is the only fix that holds no matter how long the string gets. */}
      <div className="mt-auto flex items-end justify-between gap-3 pt-3 lg:pt-4">
        <BigNumeral text={value} size="md" accent={urgent && !glass} countUp={countUp} />
        {viz && <span className={cn("hidden shrink-0 pb-0.5 lg:block", glass ? "text-white" : "text-foreground")}>{viz}</span>}
      </div>

      {meaning && (
        <p className={cn("mt-2 text-xs leading-relaxed", glass ? "opacity-70" : "text-muted-foreground")}>
          {meaning}
        </p>
      )}
    </Link>
  );
}

export default StatTile;

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
import { ArrowUpRight } from "@phosphor-icons/react";
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
        "grid h-10 w-10 shrink-0 place-items-center rounded-full",
        glass
          ? "bg-white text-kr-ink"
          : "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]"
      )}
    >
      <ArrowUpRight size={18} weight="bold" className="kr-arrow transition-transform duration-200" />
    </span>
  );

  return (
    <Link
      to={to}
      data-testid={testid}
      className={cn(
        "kr-lift flex flex-col p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
        glass ? "kr-glass kr-glass--blue" : "nm-tile",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={icon} alert={alert} />
        {arrow}
      </div>

      <p className={cn("mt-5 text-sm italic", glass ? "opacity-80" : "text-muted-foreground")}>
        {label}
      </p>

      <div className="mt-1.5 flex items-end justify-between gap-3">
        <BigNumeral text={value} size="md" accent={urgent && !glass} countUp={countUp} />
        {viz && <span className={cn("shrink-0 pb-0.5", glass ? "text-white" : "text-foreground")}>{viz}</span>}
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

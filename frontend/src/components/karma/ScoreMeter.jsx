// KR-9 · ScoreMeter — the horizontal reading of a 0..100 value, and the
// chart primitive Ops and Finance both lean on.
//
// WHY A METER AND NOT A BAR CHART. A category score is one number against a
// fixed ceiling, not a series. Recharts here would ship an axis, a tooltip
// and a responsive container to draw a rectangle. This is a div.
//
// MONOCHROME BY DEFAULT, and that is a decision rather than a shortcut: four
// categories in four hues turn the page into a chart legend, and the number
// printed beside the meter already says whether it is good. The `alert` flag
// is the one exception — it exists so a genuinely failing figure can raise a
// hand, and the founder's standing rule is that colour is for alerts only.
//
// The track is an inset well and the fill sits in it, so the meter belongs
// to the same material as the neumorphic cards it lives inside.
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * @param {number|null} value   0..100; null renders an empty track (no claim)
 * @param {boolean} alert       raise the fill to the accent — alerts only
 * @param {'sm'|'md'} size
 * @param {number} target       optional benchmark tick, 0..100
 */
export function ScoreMeter({ value, alert = false, size = "md", target = null, className, testid }) {
  const has = value != null && Number.isFinite(Number(value));
  const pct = has ? Math.max(0, Math.min(100, Number(value))) : 0;
  const h = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-pill bg-foreground/10", h, className)}
      data-testid={testid}
      role="progressbar"
      aria-valuenow={has ? Math.round(pct) : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-pill transition-[width] duration-700 ease-out",
          alert ? "bg-kr-accent" : "bg-foreground/70"
        )}
        style={{ width: `${pct}%` }}
      />
      {target != null && (
        <span
          aria-hidden="true"
          className="absolute top-0 h-full w-px bg-foreground/45"
          style={{ left: `${Math.max(0, Math.min(100, target))}%` }}
        />
      )}
    </div>
  );
}

export default ScoreMeter;

// KR-4 · MiniViz — the reference tiles' bottom-right corner instruments.
// Three shapes, all inline SVG/DOM, all monochrome-with-one-accent, all
// sized for a corner (≤96×28). Recharts is deliberately not here — see
// Sparkline's own header for the argument; these are even smaller.
//
// HONESTY RULE (carried from the plan): a mini-viz is only ever fed real
// arrays/scalars. None of these synthesize motion or shape from nothing.
import * as React from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "../mobile/blocks/Pulse";

/**
 * DotProgress — the reference's "9% ● ○ ○ ○" meter: N dots, the active one
 * enlarged and filled. value/total are clamped; dots default to 5.
 */
export function DotProgress({ value = 0, total = 100, dots = 5, className }) {
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const active = Math.min(dots - 1, Math.floor(pct * dots));
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-hidden="true">
      {Array.from({ length: dots }, (_, i) => (
        <span
          key={i}
          className={cn(
            "rounded-full transition-all duration-300",
            i === active
              ? "h-3 w-3 bg-current"
              : "h-1.5 w-1.5 bg-current opacity-30"
          )}
        />
      ))}
    </span>
  );
}

/**
 * MiniBars — up to 6 bars normalised to the tallest. `accentIndex` marks one
 * bar orange (the alert grammar: the biggest month, the worst category).
 */
export function MiniBars({ values = [], accentIndex = -1, width = 72, height = 26, className }) {
  const vals = values.map(Number).filter((v) => Number.isFinite(v)).slice(-6);
  if (!vals.length) return null;
  const max = Math.max(...vals, 1);
  const bw = Math.max(4, Math.floor(width / vals.length) - 3);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      {vals.map((v, i) => {
        const h = Math.max(2, (v / max) * height);
        return (
          <rect
            key={i}
            x={i * (bw + 3)}
            y={height - h}
            width={bw}
            height={h}
            rx={2}
            className={i === accentIndex ? "fill-kr-accent" : "fill-current opacity-25"}
          />
        );
      })}
    </svg>
  );
}

/**
 * CircleDots — the reference's "0 ○ ○ ○ ○ ○" row: outline dots, one filled
 * per counted item (Derogatory Marks / Complaints grammar). Capped at `max`.
 */
export function CircleDots({ count = 0, max = 5, className }) {
  const n = Math.max(0, Math.min(max, count));
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-2.5 w-2.5 rounded-full border border-current",
            i < n ? "bg-kr-accent border-transparent" : "opacity-35"
          )}
        />
      ))}
    </span>
  );
}

/** TinySpark — the existing hand-rolled Sparkline, re-exported at tile scale. */
export function TinySpark({ points, tone = "neutral", className }) {
  return <Sparkline points={points} tone={tone} width={72} height={24} className={className} />;
}

export default { DotProgress, MiniBars, CircleDots, TinySpark };

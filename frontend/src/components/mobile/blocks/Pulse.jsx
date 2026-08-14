// MPWA-12b · Pulse block (§3).
//
// 120px, 2-up, surface-raised: big number + 7-point sparkline + delta chip.
// "always in twos, never alone" — a single stat has nothing to be compared
// against, which is the whole point of the shape.
import * as React from "react";
import { TrendUp, TrendDown, Minus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { MoneySkeleton } from "../Skeleton";

/**
 * Sparkline. Inline SVG rather than a chart library: this is seven points in
 * 96x28, and recharts would cost a re-render budget and a font-size override
 * (see MPWA-01) for no gain.
 */
export function Sparkline({ points = [], tone = "neutral", className, width = 96, height = 28 }) {
  const values = points.map((p) => (typeof p === "number" ? p : p.v));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");
  const stroke = {
    success: "stroke-success-600",
    danger: "stroke-danger-600",
    caution: "stroke-caution-600",
    neutral: "stroke-neutral-400",
  }[tone];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={stroke} />
      <circle
        cx={width}
        cy={(height - ((values[values.length - 1] - min) / span) * height).toFixed(1)}
        r="2.5"
        className={cn(stroke, "fill-current")}
      />
    </svg>
  );
}

function Delta({ value, invert = false }) {
  if (value == null || value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 rounded-md bg-neutral-100 px-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-200">
        <Minus size={12} weight="bold" aria-hidden="true" />
        flat
      </span>
    );
  }
  // `invert` is for figures where up is bad — outstanding money rising is not
  // good news, and colouring it green would be a lie.
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendUp : TrendDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1.5 text-[length:var(--text-label)] font-semibold leading-4",
        good
          ? "bg-success-50 text-success-800 dark:bg-success-900/40 dark:text-success-100"
          : "bg-danger-50 text-danger-800 dark:bg-danger-900/40 dark:text-danger-100"
      )}
    >
      <Icon size={12} weight="bold" aria-hidden="true" />
      {value > 0 ? "+" : ""}
      {typeof value === "number" ? `${Math.abs(value)}%` : value}
    </span>
  );
}

function Stat({ label, value, series, tone, delta, invertDelta, onOpen, loading, progress, testid }) {
  const Tag = onOpen ? "button" : "div";
  return (
    <Tag
      {...(onOpen ? { type: "button", onClick: onOpen } : {})}
      data-testid={testid}
      {...(progress ? { "data-progress": progress } : {})}
      className={cn(
        "flex min-h-[7.5rem] flex-col justify-between rounded-xl border border-border bg-card p-3 text-left",
        onOpen && "transition-colors hover:bg-accent"
      )}
    >
      <span className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 block font-heading text-[1.375rem] font-bold leading-tight tabular-nums">
        {loading ? <MoneySkeleton /> : value}
      </span>
      <span className="mt-1.5 flex items-end justify-between gap-2">
        <Delta value={delta} invert={invertDelta} />
        <Sparkline points={series} tone={tone} width={72} height={22} />
      </span>
    </Tag>
  );
}

/**
 * @param {Array<{label,value,series,tone,delta,invertDelta,onOpen,loading,progress}>} stats
 *        Exactly two. More than two and it becomes a Grid, which §3 reserves for
 *        comparable entities you scan and pick, not for paired stats.
 */
export function Pulse({ stats = [], className, "data-testid": testId = "block-pulse" }) {
  const pair = stats.slice(0, 2);
  if (pair.length < 2) return null; // "always in twos, never alone"
  return (
    <section
      data-block="pulse"
      data-testid={testId}
      className={cn("mb-3 grid grid-cols-2 gap-3", className)}
    >
      {pair.map((s, i) => (
        <Stat key={s.label || i} {...s} testid={`${testId}-${i}`} />
      ))}
    </section>
  );
}

export default Pulse;

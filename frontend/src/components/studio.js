import { useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, MoreHorizontal } from "lucide-react";

import { cn } from "../lib/utils";

/* ============================================================================
   Studio kit — the reference's component vocabulary
   ----------------------------------------------------------------------------
   Every pattern lifted from the supplied design, so pages compose rather than
   invent:

     AccentCard    tinted hero card with a delta badge and a sparkline
     CardRail      horizontally swipeable rail of those cards, neighbours peeking
     SectionHead   section title + "See All"
     Row           icon/avatar · name · timestamp · amount
     LiftedRow     one row raised out of the list as a floating white card
     Donut         thick ring with black value pills on the rim
     Legend        n-column legend with thin progress bars
     Bars          bar chart with a black tooltip pill over the selected bar
     IconTile      small tinted rounded square holding an icon
     Pill          small dark/tinted chip
     StatTriple    the three-across Spent / Earned / Cashback strip

   Accent names map to the palette: butter, peri (periwinkle), sage, ink.
   ========================================================================== */

export const ACCENT = {
  butter: { bg: "bg-butter", fg: "text-butter-foreground", subtle: "bg-butter-subtle", stroke: "hsl(var(--butter))" },
  peri: { bg: "bg-primary", fg: "text-primary-foreground", subtle: "bg-primary-subtle", stroke: "hsl(var(--primary))" },
  sage: { bg: "bg-sage", fg: "text-sage-foreground", subtle: "bg-sage-subtle", stroke: "hsl(var(--sage))" },
  ink: { bg: "bg-ink", fg: "text-ink-foreground", subtle: "bg-muted", stroke: "hsl(var(--ink))" },
};

/* -------------------------------------------------------------------------- */

/** Small tinted square holding an icon — used in stat strips and list rows. */
export function IconTile({ icon: Icon, accent = "butter", size = "md", className }) {
  const dim = size === "sm" ? "h-8 w-8 rounded-xl" : size === "lg" ? "h-12 w-12 rounded-2xl" : "h-10 w-10 rounded-2xl";
  const ic = size === "sm" ? 15 : size === "lg" ? 21 : 18;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", dim, ACCENT[accent].subtle, className)}
      aria-hidden="true"
    >
      <Icon size={ic} strokeWidth={2} className={cn(accent === "ink" ? "text-foreground" : ACCENT[accent].fg)} />
    </span>
  );
}

/** Dark or tinted chip. The reference uses these for deltas and dropdowns. */
export function Pill({ children, tone = "ink", className, ...rest }) {
  const tones = {
    ink: "bg-ink text-ink-foreground",
    butter: "bg-butter text-butter-foreground",
    peri: "bg-primary text-primary-foreground",
    sage: "bg-sage text-sage-foreground",
    plain: "bg-card text-foreground border border-border",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none",
        tones[tone],
        className
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Section title with an optional right-hand link — "Last Orders / See all". */
export function SectionHead({ title, subtitle, action, onAction, actionLabel = "See all", className }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[19px] font-bold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {(action || onAction) &&
        (action || (
          <button
            onClick={onAction}
            className="shrink-0 text-xs font-semibold text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            {actionLabel}
          </button>
        ))}
    </div>
  );
}

/** Dropdown-looking chip, e.g. "Every 3 Hours ⌄". Presentational by default. */
export function SelectChip({ children, onClick, className }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5",
        "text-xs font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground",
        className
      )}
    >
      {children} <ChevronDown size={13} strokeWidth={2.2} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */

/** Minimal area sparkline. Pure SVG — no chart library for eight points. */
function Sparkline({ values = [], stroke = "currentColor", className }) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / span) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("h-7 w-full", className)} aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={stroke} opacity="0.18" />
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The hero card: tinted fill, small label with icon, a delta badge, a very
 * large figure, and a sparkline sitting along the bottom.
 */
export function AccentCard({
  label,
  value,
  delta,
  icon: Icon,
  accent = "butter",
  spark,
  onClick,
  className,
  ...rest
}) {
  const a = ACCENT[accent];
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "relative flex w-full flex-col overflow-hidden rounded-2xl p-4 text-left",
        a.bg,
        a.fg,
        onClick && "transition-transform duration-200 active:scale-[0.98]",
        className
      )}
      {...rest}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold opacity-90">
          {Icon && <Icon size={14} strokeWidth={2.4} />}
          {label}
        </span>
        {delta != null && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-card/60 px-2 py-1 text-[11px] font-bold leading-none">
            <ArrowUpRight size={11} strokeWidth={3} />
            {delta}
          </span>
        )}
      </div>
      <span data-numeric className="text-figure">
        {value}
      </span>
      {spark?.length > 1 && <Sparkline values={spark} stroke="currentColor" className="mt-3 opacity-70" />}
    </Comp>
  );
}

/** Horizontally swipeable rail — neighbouring cards peek in at the edges. */
export function CardRail({ children, className }) {
  return (
    <div
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** A list row: leading visual, name, timestamp, trailing amount. */
export function Row({
  leading,
  title,
  subtitle,
  amount,
  amountTone = "default",
  trailing,
  onClick,
  className,
  ...rest
}) {
  const tones = {
    default: "text-foreground",
    positive: "text-success",
    negative: "text-destructive",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 py-3 text-left",
        onClick && "transition-colors duration-200",
        className
      )}
      {...rest}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>}
      </span>
      {amount != null && (
        <span data-numeric className={cn("shrink-0 text-sm font-bold", tones[amountTone])}>
          {amount}
        </span>
      )}
      {trailing}
    </Comp>
  );
}

/** One row lifted out of the list as a floating card — the reference's accent. */
export function LiftedRow({ children, className, ...rest }) {
  return (
    <div
      className={cn(
        "-mx-1 my-1 flex items-center gap-3 rounded-2xl bg-card px-4 py-3 shadow-lg ring-1 ring-border/60",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** White sheet that overlaps the section above it — the transactions panel. */
export function Sheet({ children, className }) {
  return (
    <div className={cn("rounded-3xl bg-card px-4 py-4 shadow-sm", className)}>{children}</div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Thick donut with black value pills on the rim.
 * `segments`: [{ key, label, value, accent }]
 */
export function Donut({ segments = [], total, totalLabel = "Total", size = 224, thickness = 30, format = (v) => v }) {
  const sum = segments.reduce((n, s) => n + (s.value || 0), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  // Pill anchors sit at each segment's mid-angle, pushed just outside the ring.
  const pills = segments.map((s) => {
    const mid = offset + s.value / 2;
    const angle = (mid / sum) * 2 * Math.PI - Math.PI / 2;
    offset += s.value;
    return {
      key: s.key,
      display: format(s.value),
      x: 50 + (Math.cos(angle) * (r + thickness * 0.15) * 100) / size,
      y: 50 + (Math.sin(angle) * (r + thickness * 0.15) * 100) / size,
    };
  });

  offset = 0;
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        {segments.map((s) => {
          const len = (s.value / sum) * c;
          const el = (
            <circle
              key={s.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={ACCENT[s.accent || "peri"].stroke}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-((offset / sum) * c)}
              strokeLinecap="butt"
            />
          );
          offset += s.value;
          return el;
        })}
      </svg>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-medium text-muted-foreground">{totalLabel}</span>
        <span data-numeric className="mt-1 text-[1.75rem] font-extrabold tracking-tight">
          {total}
        </span>
      </div>

      {pills.map((p) => (
        <span
          key={p.key}
          data-numeric
          className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-bold text-ink-foreground shadow-md"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
        >
          {p.display}
        </span>
      ))}
    </div>
  );
}

/** n-column legend with a thin progress bar under each figure. */
export function Legend({ items = [], className }) {
  return (
    <div className={cn("grid gap-3", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
      {items.map((it) => (
        <div key={it.key}>
          <p className="truncate text-[11px] text-muted-foreground">{it.label}</p>
          <p data-numeric className="mt-1 text-[17px] font-bold tracking-tight">
            {it.percent}%
          </p>
          <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{ width: `${it.percent}%`, background: ACCENT[it.accent || "peri"].stroke }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Bar chart with a black tooltip pill over the selected bar, matching the
 * reference. Tapping a bar moves the selection.
 */
export function Bars({ data = [], selected, onSelect, format = (v) => v, height = 150, axis = true }) {
  const [local, setLocal] = useState(null);
  const sel = selected ?? local ?? data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const max = Math.max(...data.map((d) => d.value), 1);
  const ticks = [max, max / 2, 0];

  return (
    <div className="flex gap-3">
      {axis && (
        <div className="flex shrink-0 flex-col justify-between py-1 text-[10px] text-muted-foreground" style={{ height }}>
          {ticks.map((tv) => (
            <span key={tv} data-numeric>
              {format(tv)}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-1 items-end justify-between gap-1.5" style={{ height }}>
        {data.map((d, i) => {
          const active = i === sel;
          return (
            <button
              key={d.label}
              onClick={() => {
                setLocal(i);
                onSelect?.(i, d);
              }}
              className="group relative flex h-full flex-1 flex-col items-center justify-end gap-2"
              aria-label={`${d.label}: ${format(d.value)}`}
            >
              {active && (
                <span
                  data-numeric
                  className="absolute -top-1 z-10 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-[11px] font-bold text-ink-foreground shadow-md"
                >
                  {format(d.value)}
                </span>
              )}
              <span
                className={cn(
                  "w-full max-w-[26px] rounded-full transition-[height,background-color] duration-300",
                  active ? "bg-ink" : "bg-ink/20"
                )}
                style={{ height: `${Math.max((d.value / max) * (height - 40), 14)}px` }}
              />
              <span className={cn("text-[10px]", active ? "font-bold text-foreground" : "text-muted-foreground")}>
                {d.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The three-across figure strip: Spent / Earned / Cashback. */
export function StatTriple({ items = [], className, onItem }) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onItem?.(it)}
          className="flex flex-col items-start gap-2 rounded-2xl px-1 py-1 text-left transition-transform duration-200 active:scale-[0.97]"
        >
          {it.icon && <IconTile icon={it.icon} accent={it.accent || "butter"} size="sm" />}
          <span className="text-[11px] text-muted-foreground">{it.label}</span>
          <span data-numeric className="-mt-1 text-sm font-bold tracking-tight">
            {it.value}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Circular icon button — the reference's "+" and quick-action buttons. */
export function RoundButton({ icon: Icon, accent = "plain", label, onClick, className }) {
  const tones = {
    plain: "border border-dashed border-border-strong text-foreground",
    peri: "bg-primary text-primary-foreground",
    sage: "bg-sage text-sage-foreground",
    butter: "bg-butter text-butter-foreground",
    ink: "bg-ink text-ink-foreground",
  };
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-12 w-12 items-center justify-center rounded-2xl",
        "transition-transform duration-200 active:scale-90",
        tones[accent],
        className
      )}
    >
      <Icon size={20} strokeWidth={2.2} />
    </button>
  );
}

/** Keeps a rail's scroll position addressable without prop drilling. */
export function useRail() {
  const ref = useRef(null);
  return ref;
}

export { MoreHorizontal };

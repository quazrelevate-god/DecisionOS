/* The Finance period picker (2026-10-29, founder): not a long dropdown.
 * A panel of big buttons — first the kind (financial year, half, quarter,
 * last 30 days, custom, all time), then which one. Halves and quarters come
 * with a year switcher (◀ FY 2026–27 ▶) that goes back to the company's oldest
 * record, so on 1 April the year that just closed is one tap away. Standard
 * labels ("FY 2026–27", "Q2 FY 2026–27"); a half or quarter that hasn't started
 * is shown but can't be picked; a custom range can't run past today. The year
 * follows Settings › Company › Financial year starts in, and rolls over by
 * itself (ledgerMath.periodWindow). */
import { useState } from "react";
import { CalendarBlank, CaretDown, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { DRAWER_FIELD, GLASS_MENU, GLASS_PILL, INK_PILL } from "../../components/neuglass/glass";
import { customPeriod, fyLabel, periodChoices, periodWindow, todayYmd } from "./ledgerMath";

const KINDS = [
  { key: "fy", label: "Financial year" },
  { key: "half", label: "Half year" },
  { key: "quarter", label: "Quarter" },
  { key: "30d", label: "Last 30 days" },
  { key: "custom", label: "Custom range" },
  { key: "all", label: "All time" },
];

const TILE = "flex min-h-[3.5rem] flex-col items-start justify-center rounded-2xl px-4 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-40";
const ON = cn(INK_PILL, "text-white");
const OFF = "bg-slate-500/[0.07] text-slate-800 ring-1 ring-inset ring-slate-900/[0.05] hover:bg-slate-500/[0.13]";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500";
const STEP = "grid h-9 w-9 place-items-center rounded-full text-slate-700 transition-colors hover:bg-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-30";

export function PeriodPicker({ value, onChange, fyStartMonth, earliest, now = Date.now(), testid = "finance-period" }) {
  const current = periodWindow(value, fyStartMonth, now);
  const choices = periodChoices(fyStartMonth, earliest, now);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(current.kind);
  const [year, setYear] = useState(current.year ?? choices.current);
  const today = todayYmd(now);
  const [from, setFrom] = useState(current.from || "");
  const [to, setTo] = useState(current.to || today);

  const pick = (v) => { onChange(v); setOpen(false); };
  const openChange = (o) => {
    setOpen(o);
    if (o) {
      setKind(current.kind);
      setYear(current.year ?? choices.current);
      setFrom(current.from || "");
      setTo(current.to || today);
    }
  };
  const chooseKind = (k) => {
    setKind(k);
    if (k === "30d" || k === "all") pick(k);          // nothing more to choose
  };
  const oldest = choices.years[choices.years.length - 1];

  const option = (w, title, sub) => {
    const on = current.value === w.value;
    return (
      <button key={w.value} type="button" disabled={w.future} onClick={() => pick(w.value)}
        data-testid={`period-${w.value.replace(":", "-")}`} aria-pressed={on}
        title={w.future ? `Starts on ${w.range.split(" – ")[0]}` : w.range}
        className={cn(TILE, "items-center text-center", on ? ON : OFF)}>
        <span className="text-base font-semibold leading-tight">{title}</span>
        {sub && <span className={cn("mt-0.5 whitespace-nowrap text-[11px] leading-tight", on ? "text-white/70" : "text-slate-500")}>{sub}</span>}
      </button>
    );
  };

  const yearSwitch = (
    <div className="flex items-center justify-between gap-2" data-testid="period-year">
      <button type="button" className={STEP} onClick={() => setYear((y) => y - 1)} disabled={year <= oldest}
        aria-label="Earlier year" data-testid="period-year-prev"><CaretLeft size={16} weight="bold" /></button>
      <span className="text-sm font-semibold text-slate-900" data-testid="period-year-label">
        {fyLabel(year, fyStartMonth)}{year === choices.current ? <span className="font-normal text-slate-500"> · this year</span> : null}
      </span>
      <button type="button" className={STEP} onClick={() => setYear((y) => y + 1)} disabled={year >= choices.current}
        aria-label="Later year" data-testid="period-year-next"><CaretRight size={16} weight="bold" /></button>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button type="button" data-testid={testid} aria-label={`Period: ${current.label}`}
          className={cn("flex h-11 min-w-[11rem] items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25", GLASS_PILL)}>
          <CalendarBlank size={16} aria-hidden="true" className="text-slate-500" />
          <span className="min-w-0 flex-1 truncate text-left">{current.label}</span>
          <CaretDown size={13} weight="bold" aria-hidden="true" className={cn("text-slate-500 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} collisionPadding={12} data-testid={`${testid}-panel`}
        className={cn(GLASS_MENU, "w-[min(28rem,calc(100vw-1.5rem))] p-4")}>
        <p className={cn(LABEL, "mb-2")}>Period</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Kind of period">
          {KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => chooseKind(k.key)} aria-pressed={kind === k.key}
              data-testid={`period-kind-${k.key}`}
              className={cn(TILE, "text-sm font-semibold", kind === k.key ? ON : OFF)}>
              {k.label}
            </button>
          ))}
        </div>

        {kind === "fy" && (
          <div className="mt-4">
            <p className={cn(LABEL, "mb-2")}>Which year</p>
            <div className="grid max-h-[13.5rem] grid-cols-2 gap-2 overflow-y-auto">
              {choices.fy.map((w, i) => option(w, w.label, i === 0 ? "This year" : i === 1 ? "Last year" : w.months))}
            </div>
          </div>
        )}
        {(kind === "half" || kind === "quarter") && (
          <div className="mt-4 space-y-2">
            <p className={LABEL}>Which {kind === "half" ? "half" : "quarter"}</p>
            {yearSwitch}
            <div className={cn("grid gap-2", kind === "half" ? "grid-cols-2" : "grid-cols-4")}>
              {(kind === "half" ? choices.half(year) : choices.quarter(year))
                .map((w) => option(w, w.value.split(":")[0].toUpperCase(), w.months))}
            </div>
          </div>
        )}
        {kind === "custom" && (
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); if (from && to) pick(customPeriod(from, to)); }}>
            <p className={cn(LABEL, "mb-2")}>Dates</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">From
                <input type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)}
                  data-testid="period-custom-from" className={cn(DRAWER_FIELD, "mt-1 py-2.5 text-sm")} required />
              </label>
              <label className="text-xs text-slate-600">To
                <input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)}
                  data-testid="period-custom-to" className={cn(DRAWER_FIELD, "mt-1 py-2.5 text-sm")} required />
              </label>
            </div>
            <button type="submit" disabled={!from || !to || from > to} data-testid="period-custom-apply"
              className={cn("mt-3 h-11 w-full rounded-pill text-sm font-semibold disabled:opacity-40", INK_PILL)}>
              Show this period
            </button>
          </form>
        )}

        {current.range && <p className="mt-4 text-xs text-slate-500" data-testid={`${testid}-range`}>Showing {current.range}</p>}
      </PopoverContent>
    </Popover>
  );
}

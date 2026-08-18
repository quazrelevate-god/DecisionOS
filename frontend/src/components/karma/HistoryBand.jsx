// KR-8 · HistoryBand — the dark zone's chart: dashed-outline bars, an orange
// cap on the biggest month, and a PINNED tooltip chip (the reference's
// "816 +14%" card) rather than a hover tooltip — hover tooltips die on touch,
// and the founder demos on a laptop trackpad and a phone in the same meeting.
//
// DATA HONESTY (the plan's call, restated where it bites): this renders the
// ONLY dated series the backend owns — /ledger/summary by_month, six months
// of real expenses. The range pills are 3/6 months because that is what
// exists; the reference's "1 year" pill is not drawn, because a pill that
// promises data the backend cannot produce is a lie with rounded corners.
import * as React from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, Cell } from "recharts";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { chartTheme } from "../../lib/chartTheme";
import { inrCompact } from "../../lib/format";
import { KDeltaChip } from "./KDeltaChip";

const MONTH_LABEL = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  return new Date(y, (m || 1) - 1, 1).toLocaleString("en-IN", { month: "short" });
};

/** Dashed-outline bar with an accent cap when it is the pinned month. */
function DashedBar({ x, y, width, height, active, accent, line }) {
  if (height <= 0) return null;
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={height} rx={5}
        fill="transparent"
        stroke={line}
        strokeDasharray="4 4"
        strokeWidth="1.25"
      />
      {active && <rect x={x} y={y - 5} width={width} height={3} rx={1.5} fill={accent} />}
    </g>
  );
}

/**
 * @param {Array}  series  [{month:"YYYY-MM", amount:number}] — real data only
 * @param {string} title
 */
export function HistoryBand({ series = [], title = "Spend history", loading = false, className, testid }) {
  const t = chartTheme();
  const [months, setMonths] = React.useState(6);
  const [pinned, setPinned] = React.useState(null);   // index into `data`
  const [chipOpen, setChipOpen] = React.useState(true);

  const data = React.useMemo(() => series.slice(-months), [series, months]);
  const maxIdx = React.useMemo(
    () => data.reduce((m, d, i) => (d.amount > (data[m]?.amount ?? -1) ? i : m), 0),
    [data]
  );
  const idx = pinned == null ? data.length - 1 : Math.min(pinned, data.length - 1);
  const cur = data[idx];
  const prev = data[idx - 1];
  const momPct = cur && prev && prev.amount > 0
    ? Math.round(((cur.amount - prev.amount) / prev.amount) * 100)
    : null;

  return (
    <div className={cn("min-w-0", className)} data-testid={testid}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-h2 mr-2">{title}</h2>
        {[3, 6].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMonths(m); setPinned(null); }}
            aria-pressed={months === m}
            data-testid={`history-range-${m}`}
            className={cn(
              "h-9 rounded-pill px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline",
              months === m
                ? "bg-white font-medium text-kr-ink"
                : "border border-kr-outline text-current/80 hover:text-current"
            )}
          >
            {m} months
          </button>
        ))}
      </div>

      <div className="relative mt-4 h-[220px]">
        {loading ? (
          <div className="flex h-full items-end gap-3 opacity-40" aria-hidden="true">
            {Array.from({ length: months }, (_, i) => (
              <div key={i} className="ds-skeleton w-full rounded-md" style={{ height: `${30 + (i % 3) * 22}%` }} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <p className="pt-10 text-sm text-muted-foreground">
            No spend recorded yet — bills logged in Finance land here month by month.
          </p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 14, right: 4, left: 4, bottom: 0 }}>
                <XAxis
                  dataKey="month"
                  tickFormatter={MONTH_LABEL}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: t.onInk.tick, fontSize: 12 }}
                  dy={6}
                />
                <Bar
                  dataKey="amount"
                  isAnimationActive={false}
                  onClick={(_, i) => { setPinned(i); setChipOpen(true); }}
                  shape={(p) => (
                    <DashedBar
                      {...p}
                      active={p.index === idx}
                      accent={t.accent}
                      line={p.index === maxIdx ? t.onInk.barLine : t.onInk.bar}
                    />
                  )}
                >
                  {data.map((d) => <Cell key={d.month} cursor="pointer" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* the pinned chip — reference's floating "816 +14%" card */}
            {chipOpen && cur && (
              <div
                data-testid="history-chip"
                className="kr-glass kr-glass--warm absolute left-3 top-0 flex items-center gap-2.5 px-3.5 py-2.5"
              >
                <div>
                  <p className="flex items-baseline gap-2 text-base font-semibold leading-none">
                    {inrCompact(cur.amount)}
                    {momPct != null && (
                      <KDeltaChip pct={momPct} direction={momPct > 0 ? "up" : momPct < 0 ? "down" : "flat"} downIsBad={false} testid="history-chip-delta" />
                    )}
                  </p>
                  <p className="mt-1 text-xs opacity-70">
                    {MONTH_LABEL(cur.month)} spend{momPct != null ? " · vs prior month" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setChipOpen(false)}
                  aria-label="Dismiss"
                  className="grid h-6 w-6 place-items-center rounded-full opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
                >
                  <X size={13} weight="bold" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default HistoryBand;

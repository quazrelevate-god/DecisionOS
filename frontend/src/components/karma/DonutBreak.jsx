// KR-10 · DonutBreak — where the money went, in ONE hue.
//
// WHAT THIS REPLACES. Ledger.js carried a twelve-entry hex palette
// (#E63946, #457B9D, #2A9D8F…) and dealt it out to categories by index.
// Three things were wrong with that: the colours came from nowhere the token
// file knows about, the assignment was positional so a category changed
// colour the moment a bigger one appeared, and twelve hues on a page about
// cash made spend look like a subway map.
//
// Here the ramp is opacity on a single ink, darkest first. That makes the
// order itself the encoding — the biggest slice is always the strongest —
// and it survives the founder's standing rule that colour is for alerts.
//
// Recharts earns its place here (unlike ScoreMeter): arcs need real
// trigonometry, and the Pie already handles the sweep, the labels and the
// hit areas.
import * as React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { chartTheme } from "../../lib/chartTheme";
import { cn } from "@/lib/utils";

/** Darkest → faintest across however many slices there are, floor 0.14. */
const rampAlpha = (i, n) => Math.max(0.14, 0.82 - (i * (0.68 / Math.max(1, n - 1))));

/**
 * @param {Array}    data     [{ label, amount }] — pre-sorted, biggest first
 * @param {Function} format   amount → display string
 * @param {number}   max      legend rows to print (the donut still shows all)
 */
export function DonutBreak({ data = [], format = (v) => v, max = 6, className, testid }) {
  const t = chartTheme();
  const rows = React.useMemo(
    () => data.map((d, i) => ({ ...d, fill: `rgba(12,12,13,${rampAlpha(i, data.length).toFixed(3)})` })),
    [data]
  );
  const total = React.useMemo(() => rows.reduce((s, r) => s + (r.amount || 0), 0), [rows]);

  if (!rows.length) return null;

  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-center", className)} data-testid={testid}>
      <div className="relative h-[196px] w-full shrink-0 sm:w-[196px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={rows}
              dataKey="amount"
              nameKey="label"
              cx="50%" cy="50%"
              innerRadius={56} outerRadius={88}
              paddingAngle={1.5}
              stroke="none"
              isAnimationActive={false}
            >
              {rows.map((r, i) => <Cell key={r.label || i} fill={r.fill} />)}
            </Pie>
            <Tooltip
              formatter={(v, n) => [format(v), n]}
              contentStyle={{
                borderRadius: 12, border: "none", fontSize: 12,
                background: t.ink, color: "#fff", padding: "8px 10px",
              }}
              itemStyle={{ color: "#fff" }}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* The hole earns its keep: the total belongs in the middle of a
            breakdown, not in a caption beside it. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Total</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{format(total)}</p>
          </div>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1.5">
        {rows.slice(0, max).map((r) => (
          <li key={r.label} className="flex items-center gap-2.5 text-xs">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.fill }} />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="font-mono font-semibold tabular-nums">{format(r.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DonutBreak;

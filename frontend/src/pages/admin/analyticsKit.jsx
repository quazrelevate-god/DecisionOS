import { CARD_BASE, ADMIN_H3 } from "./adminStyle";
/* The analytics pages' charts (2026-10-23, admin console v2 P3), on recharts.
 *
 * One palette (fixed order, never cycled), one y-axis per chart, thin marks,
 * recessive grid, values in the text colours -- colour carries identity, a
 * label always says what it is. Money in rupees. */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import { CaretDown, CaretUp } from "@phosphor-icons/react";
import { fmtInr, fmtNum } from "./adminUi";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const MOVE = { new: "#1baf7a", expansion: "#2a78d6", contraction: "#eda100", churn: "#e34948" };
const GRID = "#e5e7eb";
const TICK = { fontSize: 11, fill: "#94a3b8" };
const TIP = { borderRadius: 12, fontSize: 12, border: "1px solid rgba(15,23,42,.08)", boxShadow: "0 10px 30px -18px rgba(0,0,0,.35)" };

export const pct = (v, digits = 0) => (v == null ? "—" : `${(v * 100).toFixed(digits)}%`);
export const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const shortMonth = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
export const inrTick = (v) => `₹${Math.round(v || 0).toLocaleString("en-IN")}`;

export function Sparkline({ data, color = SERIES[0], height = 32 }) {
  const pts = (data || []).map((v, i) => ({ i, v: v ?? 0 }));
  if (pts.length < 2) return <div style={{ height }} />;
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer>
        <AreaChart data={pts} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* A number, how it moved and its shape. `good` says which direction is good news. */
export function KpiTile({ label, value, change, changeLabel, good = "up", spark, sparkColor, sub, onClick, testid }) {
  const has = change != null && change !== 0;
  const better = has && ((good === "up" && change > 0) || (good === "down" && change < 0));
  const body = (
    <>
      <div className={ADMIN_H3 + " mb-1"}>{label}</div>
      <div className="font-display text-[1.8rem] leading-none tabular-nums text-slate-900">{value}</div>
      <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-x-2 text-xs text-slate-500">
        {change != null && (
          <span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${!has ? "" : better ? "text-[#116329]" : "text-[#b91c1c]"}`}>
            {has ? (change > 0 ? <CaretUp size={11} weight="fill" /> : <CaretDown size={11} weight="fill" />) : null}
            {has ? (changeLabel || `${change > 0 ? "+" : ""}${change}`) : "No change"}
          </span>
        )}
        {sub && <span>{sub}</span>}
      </div>
      {spark && <div className="mt-2"><Sparkline data={spark} color={sparkColor} /></div>}
    </>
  );
  const cls = `${CARD_BASE} block w-full min-w-0 p-4 text-left`;
  return onClick
    ? <button type="button" onClick={onClick} data-testid={testid} className={`${cls} transition-shadow hover:shadow-[0_14px_34px_-16px_hsl(0_0%_10%/0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25`}>{body}</button>
    : <div data-testid={testid} className={cls}>{body}</div>;
}

export function Legend({ items }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: it.color, opacity: it.dashed ? 0.6 : 1 }} />
          {it.label}{it.value != null ? <strong className="font-medium tabular-nums text-slate-900">{it.value}</strong> : null}
        </span>
      ))}
    </div>
  );
}

/* series: [{ key, label, color, dashed }] */
export function LinesChart({ data, x, series, height = 240, yFormat = fmtNum, xFormat = shortDay, ariaLabel, tickFormat }) {
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} tickFormatter={xFormat} tick={TICK} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={tickFormat || yFormat} tick={TICK} tickLine={false} axisLine={false} width={56} allowDecimals={false} />
          <Tooltip contentStyle={TIP} labelFormatter={xFormat} formatter={(v, n) => [yFormat(v), series.find((s) => s.key === n)?.label || n]} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={false}
              strokeDasharray={s.dashed ? "5 4" : undefined} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, x, bars, height = 220, yFormat = fmtNum, xFormat = shortDay, stacked = false, ariaLabel, tickFormat }) {
  return (
    <div style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap="28%">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} tickFormatter={xFormat} tick={TICK} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tickFormatter={tickFormat || yFormat} tick={TICK} tickLine={false} axisLine={false} width={56} allowDecimals={false} />
          <Tooltip contentStyle={TIP} labelFormatter={xFormat} cursor={{ fill: "rgba(15,23,42,.04)" }}
            formatter={(v, n) => [yFormat(v), bars.find((b) => b.key === n)?.label || n]} />
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} fill={b.color} stackId={stacked ? "s" : undefined} maxBarSize={24}
              radius={stacked && i < bars.length - 1 ? 0 : [4, 4, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* MRR movement: gains above the line, losses below. */
export function MovementChart({ data, height = 240 }) {
  const keys = [["new", "New"], ["expansion", "Expansion"], ["contraction", "Contraction"], ["churn", "Churn"]];
  return (
    <>
      <Legend items={keys.map(([k, l]) => ({ label: l, color: MOVE[k] }))} />
      <div style={{ height }} role="img" aria-label="Monthly recurring revenue gained and lost each month">
        <ResponsiveContainer>
          <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="month" tickFormatter={shortMonth} tick={TICK} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={inrTick} tick={TICK} tickLine={false} axisLine={false} width={64} />
            <ReferenceLine y={0} stroke="#cbd5e1" />
            <Tooltip contentStyle={TIP} labelFormatter={shortMonth} cursor={{ fill: "rgba(15,23,42,.04)" }}
              formatter={(v, n) => [fmtInr(v), keys.find(([k]) => k === n)?.[1] || n]} />
            {keys.map(([k]) => <Bar key={k} dataKey={k} stackId="m" fill={MOVE[k]} maxBarSize={28} isAnimationActive={false} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/* Steps from the first: a bar each, the share of the first, and what was lost on the way. */
export function Funnel({ steps, testid }) {
  const first = steps[0]?.count || 0;
  return (
    <ol className="space-y-2.5" data-testid={testid}>
      {steps.map((s, i) => {
        const share = first ? s.count / first : 0;
        const prev = i ? steps[i - 1].count : null;
        const lost = prev != null ? prev - s.count : null;
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-slate-800">{s.label}</span>
              <span className="tabular-nums text-slate-900"><strong className="font-semibold">{fmtNum(s.count)}</strong>
                <span className="ml-2 text-xs text-slate-500">{pct(share)}</span></span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded-md bg-slate-500/[0.08]">
              <div className="h-full rounded-md" style={{ width: `${Math.max(share * 100, s.count ? 2 : 0)}%`, background: SERIES[0], opacity: 1 - i * 0.1 }} />
            </div>
            {lost > 0 && <div className="mt-0.5 text-[11px] text-slate-500">{fmtNum(lost)} didn&apos;t reach this step</div>}
          </li>
        );
      })}
    </ol>
  );
}

const heat = (v) => {
  if (v == null) return "transparent";
  const stops = ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8"];
  return stops[Math.min(stops.length - 1, Math.floor(v * (stops.length - 0.001)))];
};
const ink = (v) => (v != null && v >= 0.6 ? "#fff" : "#0f172a");

/* Weekly cohorts: rows = sign-up week, columns = weeks since. */
export function CohortGrid({ cohorts, testid }) {
  const maxCols = Math.max(0, ...cohorts.map((c) => c.cells.length));
  return (
    <div className="overflow-x-auto" data-testid={testid}>
      <table className="border-separate border-spacing-1 text-xs tabular-nums">
        <thead>
          <tr className="text-slate-500">
            <th className="pr-3 text-left font-normal">Signed up week of</th>
            <th className="pr-2 text-right font-normal">Companies</th>
            {Array.from({ length: maxCols }, (_, k) => <th key={k} className="w-12 font-normal">{k === 0 ? "Week 0" : `+${k}`}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.filter((c) => c.size).map((c) => (
            <tr key={c.week}>
              <td className="pr-3 text-slate-700">{shortDay(c.week)}</td>
              <td className="pr-2 text-right text-slate-500">{c.size || "—"}</td>
              {Array.from({ length: maxCols }, (_, k) => {
                const v = c.cells[k];
                return (
                  <td key={k} className="h-8 w-12 rounded text-center" title={v == null ? "" : `${pct(v)} still active`}
                    style={{ background: c.size ? heat(v) : "transparent", color: ink(v) }}>
                    {c.size && v != null ? pct(v) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AREA_LABEL = {
  tasks: "Tasks", decisions: "Decisions", requests: "Requests", workflows: "Workflows", finance: "Finance",
  crm: "Contacts", voice: "Voice", captures: "Captures",
};

/* Share of active companies using each area, week by week. */
export function AdoptionHeat({ weeks, areas, testid }) {
  return (
    <div className="overflow-x-auto" data-testid={testid}>
      <table className="border-separate border-spacing-1 text-xs tabular-nums">
        <thead>
          <tr className="text-slate-500">
            <th className="pr-3 text-left font-normal" />
            {weeks.map((w) => <th key={w.week} className="w-12 font-normal">{shortDay(w.week)}</th>)}
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a}>
              <td className="pr-3 text-slate-700">{AREA_LABEL[a] || a}</td>
              {weeks.map((w) => {
                const v = w.areas[a];
                return <td key={w.week} className="h-8 w-12 rounded text-center" title={`${AREA_LABEL[a]}: ${pct(v)} of ${w.active_workspaces} active companies`}
                  style={{ background: heat(v), color: ink(v) }}>{v ? pct(v) : ""}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* AI cost against what each customer pays; above the dashed line, AI costs more than 30% of revenue. */
export function CostScatter({ rows, onPick, height = 280 }) {
  const pts = rows.map((r) => ({ ...r, x: r.mrr_inr, y: r.ai_cost_month_inr }));
  const maxX = Math.max(1000, ...pts.map((p) => p.x));
  return (
    <div style={{ height }} role="img" aria-label="AI cost per month against monthly revenue, one dot per customer">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 16, bottom: 10, left: 4 }}>
          <CartesianGrid stroke={GRID} />
          <XAxis type="number" dataKey="x" name="Revenue a month" tickFormatter={inrTick} tick={TICK} tickLine={false} axisLine={false} domain={[0, Math.ceil(maxX * 1.1)]} />
          <YAxis type="number" dataKey="y" name="AI cost a month" tickFormatter={inrTick} tick={TICK} tickLine={false} axisLine={false} width={64} />
          <ZAxis range={[60, 60]} />
          <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxX * 1.1, y: maxX * 1.1 * 0.3 }]} stroke="#e34948" strokeDasharray="5 4" ifOverflow="extendDomain" />
          <Tooltip contentStyle={TIP} cursor={{ strokeDasharray: "3 3" }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload;
              if (!p) return null;
              return (
                <div style={TIP} className="bg-white px-3 py-2">
                  <div className="text-sm font-medium text-slate-900">{p.name}</div>
                  <div className="text-xs text-slate-600">Pays {fmtInr(p.mrr_inr)} a month · AI {fmtInr(p.ai_cost_month_inr)} a month</div>
                </div>
              );
            }} />
          <Scatter data={pts} onClick={(p) => onPick && onPick(p)} isAnimationActive={false}>
            {pts.map((p) => <Cell key={p.id} fill={p.flag ? "#e34948" : SERIES[0]} cursor="pointer" />)}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Note({ children }) {
  return <p className="mt-2 text-xs text-slate-500">{children}</p>;
}

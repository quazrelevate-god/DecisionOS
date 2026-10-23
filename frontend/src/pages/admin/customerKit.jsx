/* The pieces the customer screens share (2026-10-23, admin console v2 P2):
 * health and stage chips, the health breakdown that says WHY a score is what
 * it is, a 30-day activity chart and the product-area adoption grid.
 * Health and stage are worked out server-side (services/customer_health). */
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Chip, fmtNum } from "./adminUi";

export const STAGE = {
  trial: { label: "Not activated", tone: "neutral" },
  activated: { label: "Activated", tone: "info" },
  paying: { label: "Paying", tone: "good" },
  at_risk: { label: "At risk", tone: "bad" },
  churned: { label: "Churned", tone: "warn" },
  suspended: { label: "Suspended", tone: "bad" },
  test: { label: "Test", tone: "neutral" },
};
export const STAGE_OPTIONS = Object.entries(STAGE).map(([value, s]) => ({ value, label: s.label }));
export const stageLabel = (s) => STAGE[s]?.label || "—";

const BAND = { healthy: { tone: "good", label: "Healthy" }, watch: { tone: "warn", label: "Watch" }, at_risk: { tone: "bad", label: "At risk" } };
const PART_LABEL = {
  activity: "Activity", breadth: "Breadth", momentum: "Momentum", setup: "Setup", friction: "Friction",
};
const PART_HINT = {
  activity: "People here in the last 7 days, against seats in use",
  breadth: "Product areas used in the last 14 days, of 8",
  momentum: "Actions in the last 14 days against the 14 before",
  setup: "Key milestones reached, of 6",
  friction: "Starts full; urgent tickets, failed payments and AI errors take it down",
};

export function StageChip({ stage }) {
  const s = STAGE[stage];
  return s ? <Chip tone={s.tone}>{s.label}</Chip> : <span className="text-slate-400">—</span>;
}

export function HealthChip({ health, testid }) {
  if (!health) return <span className="text-slate-400">—</span>;
  const b = BAND[health.band] || BAND.watch;
  const why = Object.entries(health.parts || {}).map(([k, v]) => `${PART_LABEL[k]} ${v}/${health.weights?.[k] ?? ""}`).join(" · ");
  return (
    <span title={why} data-testid={testid}>
      <Chip tone={b.tone}><span className="tabular-nums">{health.score}</span> {b.label}</Chip>
    </span>
  );
}

export function HealthBreakdown({ health }) {
  if (!health) return null;
  const b = BAND[health.band] || BAND.watch;
  return (
    <div data-testid="health-breakdown">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-display text-[2.2rem] leading-none tabular-nums text-slate-900">{health.score}</span>
        <Chip tone={b.tone}>{b.label}</Chip>
        <span className="text-xs text-slate-500">of 100</span>
      </div>
      <ul className="space-y-2.5">
        {Object.entries(health.parts).map(([k, v]) => {
          const max = health.weights?.[k] || 1;
          return (
            <li key={k} title={PART_HINT[k]}>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-800">{PART_LABEL[k]}</span>
                <span className="tabular-nums text-slate-500">{v} / {max}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-500/[0.1]">
                <div className="h-full rounded-full bg-slate-800" style={{ width: `${Math.round((v / max) * 100)}%` }} />
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">{PART_HINT[k]}</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/* 30 days of the daily count. Gaps are days nobody was counted -- drawn as 0. */
export function ActivityChart({ daily, days = 30 }) {
  const by = Object.fromEntries((daily || []).map((r) => [r.day, r]));
  const today = new Date();
  const points = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(today);
    dt.setDate(today.getDate() - i);
    const key = dt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const r = by[key] || {};
    points.push({ day: key, label: shortDay(key), people: r.active_people || 0, actions: r.actions_total || 0 });
  }
  const any = points.some((p) => p.people || p.actions);
  if (!any) return <div className="py-10 text-center text-sm text-slate-500">No activity counted in the last {days} days.</div>;
  return (
    <div className="h-48 w-full" role="img" aria-label={`Active people per day over the last ${days} days`}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} interval={6} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} width={40} />
          <Tooltip formatter={(v, n) => [fmtNum(v), n === "people" ? "Active people" : "Actions"]}
            labelFormatter={(l) => l} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
          <Area type="monotone" dataKey="people" stroke="#2a78d6" strokeWidth={2} fill="#2a78d6" fillOpacity={0.1} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const AREA_LABEL = {
  tasks: "Tasks", decisions: "Decisions", requests: "Requests", workflows: "Workflows", finance: "Finance",
  crm: "Contacts", voice: "Voice", captures: "Captures", people: "People", billing: "Billing", other: "Other",
};
const SHADES = ["#f1f5f9", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"];

/* Product area x week; darker = more actions. */
export function AdoptionGrid({ weeks, areas }) {
  const max = Math.max(1, ...weeks.flatMap((w) => Object.values(w.areas || {})));
  const shade = (n) => (n ? SHADES[Math.min(4, 1 + Math.floor((n / max) * 3.999))] : SHADES[0]);
  return (
    <div className="overflow-x-auto" data-testid="adoption-grid">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="pr-3 text-left font-normal text-slate-500" />
            {weeks.map((w) => <th key={w.week_start} className="w-10 font-normal text-slate-400">{shortDay(w.week_start)}</th>)}
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a}>
              <td className="pr-3 text-slate-600">{AREA_LABEL[a] || a}</td>
              {weeks.map((w) => {
                const n = (w.areas || {})[a] || 0;
                return <td key={w.week_start} title={`${AREA_LABEL[a] || a}, week of ${shortDay(w.week_start)}: ${n} actions`}
                  className="h-6 w-10 rounded" style={{ background: shade(n) }} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        Fewer {SHADES.map((c) => <span key={c} className="inline-block h-3 w-3 rounded-sm" style={{ background: c }} />)} more actions
      </div>
    </div>
  );
}

export { AREA_LABEL };

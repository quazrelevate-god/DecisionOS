import { CARD_BASE } from "./adminStyle";
/* Home (2026-10-23, admin console v2 P3; replaces Overview). Opens on what
 * needs an operator today, ranked -- money first, then customers waiting on
 * us, then customers slipping -- each with the place to act one click away;
 * then the numbers that matter with their trend; then whose health moved. */
import {
  WarningCircle, CurrencyInr, Lifebuoy, Hourglass, TrendDown, CalendarCheck, Flag, CheckCircle, ArrowRight, ArrowUp, ArrowDown,
} from "@phosphor-icons/react";
import { useAdmin, useAdminGet, usePersisted, fmtNum, fmtInr, Chip, Toggle, AdminPage, Panel, Loading, LoadError, Empty } from "./adminUi";
import { KpiTile, SERIES, pct, shortMonth } from "./analyticsKit";
import { STAGE } from "./customerKit";

const KIND = {
  outage: { icon: WarningCircle, label: "AI problem", tone: "bad" },
  payment_failed: { icon: CurrencyInr, label: "Payment failed", tone: "bad" },
  ticket: { icon: Lifebuoy, label: "Waiting on us", tone: "warn" },
  at_risk: { icon: TrendDown, label: "Slipping", tone: "bad" },
  trial_ending: { icon: Hourglass, label: "Trial ending", tone: "warn" },
  follow_up: { icon: CalendarCheck, label: "Follow up", tone: "info" },
  reports: { icon: Flag, label: "Reports", tone: "neutral" },
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function HomeSection() {
  const { go, admin } = useAdmin();
  const [includeTest, setIncludeTest] = usePersisted("analytics_include_test", false);
  const { data: h, error, reload } = useAdminGet(`/admin/home?include_test=${includeTest}`);
  const who = (admin?.name && admin.name !== admin.email ? admin.name.split(" ")[0] : "") || "";
  const title = `${greeting()}${who ? `, ${who}` : ""}`;
  const controls = <Toggle checked={includeTest} onChange={setIncludeTest} label="Include test" testid="home-include-test" />;
  if (error && !h) return <AdminPage title={title} testid="admin-overview" actions={controls}><LoadError what="Home" onRetry={reload} /></AdminPage>;
  if (!h) return <AdminPage title={title} testid="admin-overview" actions={controls}><Loading label="Looking at every customer…" /></AdminPage>;
  const k = h.kpis;
  const n = h.needs_total;
  return (
    <AdminPage title={title} testid="admin-overview" actions={controls}
      subtitle={n ? `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you · ${fmtNum(h.customers)} customers` : `Nothing needs you right now · ${fmtNum(h.customers)} customers`}>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Monthly recurring revenue" value={fmtInr(k.mrr.value)} spark={k.mrr.series} onClick={() => go("revenue")} testid="kpi-mrr"
          change={k.mrr.change} changeLabel={k.mrr.change != null ? `${k.mrr.change >= 0 ? "+" : "−"}${fmtInr(Math.abs(k.mrr.change))}` : null}
          sub={k.mrr.labels?.length > 1 ? `since ${shortMonth(k.mrr.labels[k.mrr.labels.length - 2])}` : null} />
        <KpiTile label="People active this week" value={fmtNum(k.wau.value)} spark={k.wau.series} sparkColor={SERIES[1]} change={k.wau.change}
          sub="vs a week ago" onClick={() => go("engagement")} testid="kpi-wau" />
        <KpiTile label="Sign-ups this week" value={fmtNum(k.signups.value)} spark={k.signups.series} sparkColor={SERIES[2]} change={k.signups.change}
          sub="vs last week" onClick={() => go("growth")} testid="kpi-signups" />
        <KpiTile label="AI cost, share of revenue" value={k.ai_share.value == null ? "—" : pct(k.ai_share.value, 1)} good="down"
          sub={`${fmtInr(k.ai_share.cost_month_inr)} a month`} onClick={() => go("ai-economics")} testid="kpi-ai" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Needs you today" className="lg:col-span-2" testid="home-needs"
          hint="Money first, then customers waiting on us, then customers slipping">
          {h.needs.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-emerald-600/[0.06] px-4 py-5 text-sm text-[#116329]">
              <CheckCircle size={22} weight="fill" /> All clear. No failed payments, no one waiting on a reply, no paying customer slipping.
            </div>
          ) : (
            <ul className="-mx-2 divide-y divide-slate-900/[0.05]">
              {h.needs.map((x, i) => {
                const meta = KIND[x.kind] || KIND.reports;
                return (
                  <li key={`${x.kind}-${x.tenant_id || ""}-${i}`}>
                    <button type="button" onClick={() => go(x.to)} data-testid={`need-${x.kind}`}
                      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${meta.tone === "bad" ? "bg-[#cf222e]/[0.08] text-[#b91c1c]" : meta.tone === "warn" ? "bg-amber-500/[0.12] text-[#7d4e00]" : "bg-slate-500/[0.08] text-slate-600"}`}>
                        <meta.icon size={17} weight="bold" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{x.title}</span>
                        <span className="block truncate text-xs text-slate-500">{x.detail}</span>
                      </span>
                      <Chip tone={meta.tone}>{meta.label}</Chip>
                      <ArrowRight size={14} className="shrink-0 text-slate-300 group-hover:text-slate-600" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {h.needs_total > h.needs.length && <p className="mt-2 text-xs text-slate-500">Showing the first {h.needs.length} of {h.needs_total}.</p>}
        </Panel>

        <div className="space-y-4">
          <Panel title="Customers by stage" testid="home-stages">
            <ul className="space-y-1.5">
              {Object.entries(STAGE).filter(([s]) => s !== "test" && h.stages[s]).map(([s, meta]) => (
                <li key={s}>
                  <button type="button" onClick={() => go("workspaces")} className="flex w-full items-center gap-3 text-left text-sm">
                    <Chip tone={meta.tone}>{meta.label}</Chip>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-500/[0.1]">
                      <span className="block h-full rounded-full bg-slate-700" style={{ width: `${Math.round((h.stages[s] / Math.max(1, h.customers)) * 100)}%` }} />
                    </span>
                    <span className="w-8 text-right tabular-nums text-slate-700">{h.stages[s]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Health movers" hint="Biggest change in health this week" testid="home-movers">
            {h.movers.up.length + h.movers.down.length === 0 ? (
              <Empty compact title="Not enough history yet."
                hint={`Health is recorded once a day${h.movers.since_snapshots ? ` since ${h.movers.since_snapshots}` : " from today"}; movers show after a few days.`} />
            ) : (
              <ul className="space-y-1">
                {[...h.movers.down, ...h.movers.up].map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => go(`workspaces/${m.id}`)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm hover:bg-slate-900/[0.04]">
                      {m.change < 0 ? <ArrowDown size={14} className="text-[#b91c1c]" /> : <ArrowUp size={14} className="text-[#116329]" />}
                      <span className="min-w-0 flex-1 truncate text-slate-800">{m.name}</span>
                      <span className="tabular-nums text-xs text-slate-500">{m.from} → {m.to}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <div className={`${CARD_BASE} mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-xs text-slate-500`}>
        <span>Activation, 90 days: <strong className="font-semibold text-slate-800">{pct(k.activation.value)}</strong></span>
        <span>Paying customers: <strong className="font-semibold text-slate-800">{fmtNum(k.paying.value)}</strong></span>
        <span>Active companies today: <strong className="font-semibold text-slate-800">{fmtNum(k.active_workspaces.value)}</strong></span>
        <button type="button" onClick={() => go("growth")} className="ml-auto font-medium text-slate-700 underline-offset-2 hover:underline">All analytics</button>
      </div>
    </AdminPage>
  );
}

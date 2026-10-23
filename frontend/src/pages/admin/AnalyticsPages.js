import { CARD_BASE } from "./adminStyle";
/* The analytics pages (2026-10-23, admin console v2 P3): Growth, Engagement,
 * Retention, Revenue and AI economics. Counted server-side by
 * services/analytics from what P1 keeps; test companies left out unless the
 * switch says otherwise. Each page says how far back its history goes. */
import { useState } from "react";
import { ChartLineUp, Users as UsersIcon, ArrowsClockwise, CurrencyInr, Robot } from "@phosphor-icons/react";
import {
  useAdmin, useAdminGet, usePersisted, fmtNum, fmtInr, fmtDate, fmtAgo, Chip, Segmented, Toggle, AdminPage, Panel,
  Loading, LoadError, Empty, DataTable,
} from "./adminUi";
import { planLabel, providerLabel } from "./adminLabels";
import {
  AdoptionHeat, BarsChart, CohortGrid, CostScatter, Funnel, KpiTile, Legend, LinesChart, MovementChart, Note,
  SERIES, inrTick, pct, shortMonth,
} from "./analyticsKit";

function useIncludeTest() {
  return usePersisted("analytics_include_test", false);
}

function Controls({ range, setRange, ranges, includeTest, setIncludeTest }) {
  return (
    <>
      {ranges && <Segmented value={range} onChange={setRange} options={ranges} ariaLabel="Period" testid="analytics-range" />}
      <Toggle checked={includeTest} onChange={setIncludeTest} label="Include test" testid="analytics-include-test" />
    </>
  );
}

function Page({ title, subtitle, testid, controls, state, children }) {
  return (
    <AdminPage title={title} subtitle={subtitle} testid={testid} actions={controls}>
      {state.error && !state.data ? <LoadError what={title.toLowerCase()} onRetry={state.reload} />
        : !state.data ? <Loading label="Counting…" /> : children(state.data)}
    </AdminPage>
  );
}

const DAY_RANGES = [{ value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 180, label: "180 days" }];

// --- Growth -------------------------------------------------------------------------------
export function GrowthSection() {
  const [days, setDays] = usePersisted("growth_days", 90);
  const [includeTest, setIncludeTest] = useIncludeTest();
  const state = useAdminGet(`/admin/analytics/growth?days=${days}&include_test=${includeTest}`);
  return (
    <Page title="Growth" subtitle="New companies, and how many of them reach value" testid="admin-growth" state={state}
      controls={<Controls range={days} setRange={setDays} ranges={DAY_RANGES} includeTest={includeTest} setIncludeTest={setIncludeTest} />}>
      {(g) => {
        const activated = g.funnel.find((f) => f.key === "activated");
        const paying = g.funnel.find((f) => f.key === "paying");
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label={`Sign-ups · ${days} days`} value={fmtNum(g.signups)} spark={g.weeks.map((w) => w.signups)} />
              <KpiTile label="Activated" value={pct(activated?.rate)} sub={`${fmtNum(activated?.count)} companies`}
                spark={g.weeks.map((w) => w.activation_rate ?? 0)} sparkColor={SERIES[2]} />
              <KpiTile label="Days to activate" value={g.median_days_to_activate == null ? "—" : fmtNum(g.median_days_to_activate)} sub="median" />
              <KpiTile label="Trial to paid" value={pct(g.trial_to_paid.rate)} sub={`${fmtNum(g.trial_to_paid.paying)} of ${fmtNum(g.trial_to_paid.trials_ended)} past their trial`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-5">
              <Panel title="From sign-up to paying" className="lg:col-span-2" testid="growth-funnel"
                hint={`Companies that signed up in the last ${days} days`}>
                {g.signups === 0 ? <Empty compact icon={ChartLineUp} title="No sign-ups in this period." /> : <Funnel steps={g.funnel} testid="funnel" />}
                <Note>Each step counts companies that reached it and every step above it. Activated: a decision approved and a teammate invited within 14 days of signing up.
                  {g.too_new_for_week2 ? ` ${g.too_new_for_week2} signed up less than 2 weeks ago, too new for "active in week 2".` : ""}</Note>
              </Panel>
              <Panel title="Sign-ups and activation by week" className="lg:col-span-3" testid="growth-weeks">
                <Legend items={[{ label: "Sign-ups", color: SERIES[0] }, { label: "Activated", color: SERIES[2] }]} />
                <BarsChart data={g.weeks} x="week" bars={[{ key: "signups", label: "Sign-ups", color: SERIES[0] }, { key: "activated", label: "Activated", color: SERIES[2] }]}
                  ariaLabel="Sign-ups and activated companies per week" />
              </Panel>
            </div>
            {paying && paying.count === 0 && g.signups > 0 && <Note>None of these companies pay yet.</Note>}
          </>
        );
      }}
    </Page>
  );
}

// --- Engagement ---------------------------------------------------------------------------
export function EngagementSection() {
  const { go } = useAdmin();
  const [days, setDays] = usePersisted("engagement_days", 90);
  const [includeTest, setIncludeTest] = useIncludeTest();
  const state = useAdminGet(`/admin/analytics/engagement?days=${days}&include_test=${includeTest}`);
  return (
    <Page title="Engagement" subtitle="Who uses DecisionOS, how often, and which parts" testid="admin-engagement" state={state}
      controls={<Controls range={days} setRange={setDays} ranges={DAY_RANGES.slice(0, 3)} includeTest={includeTest} setIncludeTest={setIncludeTest} />}>
      {(e) => {
        const s = e.series;
        const now = e.now || {};
        const wk = s.length >= 8 ? s[s.length - 8] : null;
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="Active today" value={fmtNum(now.dau)} spark={s.slice(-28).map((x) => x.dau)} />
              <KpiTile label="Active this week" value={fmtNum(now.wau)} change={wk ? now.wau - wk.wau : null} sub="vs a week ago" spark={s.slice(-28).map((x) => x.wau)} />
              <KpiTile label="Active this month" value={fmtNum(now.mau)} spark={s.slice(-28).map((x) => x.mau)} />
              <KpiTile label="Stickiness" value={pct(e.stickiness)} sub="daily ÷ monthly, last 30 days" />
            </div>
            <Panel title="Active people" className="mb-4" testid="engagement-active">
              <Legend items={[{ label: "Daily", color: SERIES[0] }, { label: "Weekly", color: SERIES[1] }, { label: "Monthly", color: SERIES[2] }]} />
              <LinesChart data={s} x="day" series={[{ key: "dau", label: "Daily", color: SERIES[0] }, { key: "wau", label: "Weekly", color: SERIES[1] },
                { key: "mau", label: "Monthly", color: SERIES[2] }]} ariaLabel="Daily, weekly and monthly active people" />
              <Note>A person is active on a day they signed in, used the app (from 23 Oct 2026) or did something recorded in the activity log.</Note>
            </Panel>
            <div className="grid gap-4 lg:grid-cols-3">
              <Panel title="Which parts companies use" className="lg:col-span-2" testid="engagement-adoption"
                hint="Share of the week's active companies that used each area">
                {e.adoption.length === 0 ? <Empty compact title="Nothing counted yet." /> : <AdoptionHeat weeks={e.adoption.slice(-10)} areas={e.areas} testid="adoption-heat" />}
              </Panel>
              <Panel title="Most active companies" hint="Most people in a day, last 7 days">
                {e.top.length === 0 ? <Empty compact icon={UsersIcon} title="No one this week." /> : (
                  <ol className="-mx-2">
                    {e.top.map((t, i) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => go(`workspaces/${t.id}`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                          <span className="w-4 text-xs tabular-nums text-slate-400">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{t.name}</span>
                          <span className="text-xs tabular-nums text-slate-500">{fmtNum(t.active_people)} people</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>
            <Panel title="Active companies per day" className="mt-4">
              <BarsChart data={s} x="day" bars={[{ key: "active_workspaces", label: "Active companies", color: SERIES[0] }]} height={180}
                ariaLabel="Companies with any activity, per day" />
            </Panel>
          </>
        );
      }}
    </Page>
  );
}

// --- Retention ----------------------------------------------------------------------------
export function RetentionSection() {
  const [weeks, setWeeks] = usePersisted("retention_weeks", 12);
  const [includeTest, setIncludeTest] = useIncludeTest();
  const state = useAdminGet(`/admin/analytics/retention?weeks=${weeks}&include_test=${includeTest}`);
  return (
    <Page title="Retention" subtitle="Of the companies that signed up each week, how many are still active" testid="admin-retention" state={state}
      controls={<Controls range={weeks} setRange={setWeeks} ranges={[{ value: 8, label: "8 weeks" }, { value: 12, label: "12 weeks" }, { value: 26, label: "26 weeks" }]}
        includeTest={includeTest} setIncludeTest={setIncludeTest} />}>
      {(r) => {
        const withSize = r.cohorts.filter((c) => c.size);
        const avg = (k) => {
          const vals = withSize.map((c) => c.cells[k]).filter((v) => v != null);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="Active in their first week" value={pct(avg(0))} />
              <KpiTile label="Still active after 1 week" value={pct(avg(1))} />
              <KpiTile label="After 4 weeks" value={pct(avg(4))} />
              <KpiTile label="After 8 weeks" value={pct(avg(8))} />
            </div>
            <Panel title="Weekly cohorts" testid="retention-cohorts"
              hint="Each row is a sign-up week; each cell, the share of those companies with any activity that week">
              {withSize.length === 0 ? <Empty compact icon={ArrowsClockwise} title="No sign-ups in this window." /> : <CohortGrid cohorts={r.cohorts} testid="cohort-grid" />}
              <Note>Darker is better. A company counts as active in a week if anyone in it did anything that week. Weeks with no sign-ups are left out.</Note>
            </Panel>
          </>
        );
      }}
    </Page>
  );
}

// --- Revenue ------------------------------------------------------------------------------
export function RevenueSection() {
  const { go } = useAdmin();
  const [months, setMonths] = usePersisted("revenue_months", 6);
  const [includeTest, setIncludeTest] = useIncludeTest();
  const state = useAdminGet(`/admin/analytics/revenue?months=${months}&include_test=${includeTest}`);
  return (
    <Page title="Revenue" subtitle="Monthly recurring revenue, and what moved it" testid="admin-revenue" state={state}
      controls={<Controls range={months} setRange={setMonths} ranges={[{ value: 6, label: "6 months" }, { value: 12, label: "12 months" }]}
        includeTest={includeTest} setIncludeTest={setIncludeTest} />}>
      {(v) => {
        const m = v.months;
        const now = v.now || { mrr: 0, paying: 0, arpa: 0 };
        const prev = m.length > 1 ? m[m.length - 2] : null;
        const net = v.movement.length ? Object.values(v.movement[v.movement.length - 1]).filter((x) => typeof x === "number").reduce((a, b) => a + b, 0) : 0;
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="Monthly recurring revenue" value={fmtInr(now.mrr)} change={prev ? Math.round(now.mrr - prev.mrr) : null}
                changeLabel={prev ? `${now.mrr >= prev.mrr ? "+" : "−"}${fmtInr(Math.abs(now.mrr - prev.mrr))}` : null} sub="vs last month" spark={m.map((x) => x.mrr)} />
              <KpiTile label="Annual run rate" value={fmtInr(now.mrr * 12)} />
              <KpiTile label="Paying companies" value={fmtNum(now.paying)} change={prev ? now.paying - prev.paying : null} spark={m.map((x) => x.paying)} sparkColor={SERIES[2]} />
              <KpiTile label="Revenue per paying company" value={fmtInr(now.arpa)} sub={`Net this month ${net >= 0 ? "+" : "−"}${fmtInr(Math.abs(net))}`} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="MRR by month" testid="revenue-mrr">
                <LinesChart data={m} x="month" xFormat={shortMonth} yFormat={(x) => fmtInr(x)} tickFormat={inrTick} series={[{ key: "mrr", label: "MRR", color: SERIES[0] }]}
                  ariaLabel="Monthly recurring revenue at the end of each month" />
              </Panel>
              <Panel title="What moved it" testid="revenue-movement" hint="New and expansion above the line; contraction and churn below">
                <MovementChart data={v.movement} />
              </Panel>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Panel title="Plan mix">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-[0.1em] text-slate-500">
                    <th className="pb-2 text-left font-semibold">Plan</th><th className="pb-2 text-right font-semibold">Companies</th><th className="pb-2 text-right font-semibold">MRR</th>
                  </tr></thead>
                  <tbody>
                    {v.plan_mix.map((p) => (
                      <tr key={p.plan} className="border-t border-slate-900/[0.05]">
                        <td className="py-2 text-slate-800">{p.plan === "none" ? "No plan" : planLabel(p.plan)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtNum(p.companies)}</td>
                        <td className="py-2 text-right tabular-nums">{fmtInr(p.mrr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Payments to chase" hint="Failed in the last 30 days and not paid since" testid="revenue-chase">
                {v.to_chase.length === 0 ? <Empty compact icon={CurrencyInr} title="Nothing to chase." /> : (
                  <ul className="-mx-2">
                    {v.to_chase.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => go(`workspaces/${c.id}/billing`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-900/[0.04]">
                          <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{c.name}</span>
                          <Chip tone="bad">Failed {fmtAgo(c.failed_at).toLowerCase()}</Chip>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
            <Note>MRR is the list price of each paying plan. Plan changes are recorded from {fmtDate(v.history_from)}; earlier months use today&apos;s plans.
              {!v.prices_configured ? " Razorpay prices aren't configured, so every price reads as ₹0." : ""}</Note>
          </>
        );
      }}
    </Page>
  );
}

// --- AI economics -------------------------------------------------------------------------
export function AiEconomicsSection() {
  const { go } = useAdmin();
  const [days, setDays] = usePersisted("ai_econ_days", 30);
  const [includeTest, setIncludeTest] = useIncludeTest();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const state = useAdminGet(`/admin/analytics/ai?days=${days}&include_test=${includeTest}`);
  return (
    <Page title="AI economics" subtitle="What AI costs us for each customer, against what they pay" testid="admin-ai-economics" state={state}
      controls={<Controls range={days} setRange={setDays} ranges={[{ value: 30, label: "30 days" }, { value: 90, label: "90 days" }]}
        includeTest={includeTest} setIncludeTest={setIncludeTest} />}>
      {(a) => {
        const providers = [...new Set(a.by_provider.flatMap((w) => Object.keys(w).filter((k) => k !== "week")))];
        const rows = onlyFlagged ? a.customers.filter((r) => r.flag) : a.customers;
        const cols = [
          { key: "name", label: "Customer", render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
          { key: "plan", label: "Plan", sortValue: (r) => planLabel(r.plan), render: (r) => planLabel(r.plan) },
          { key: "mrr_inr", label: "Pays a month", align: "right", render: (r) => (r.mrr_inr ? fmtInr(r.mrr_inr) : "—") },
          { key: "ai_cost_month_inr", label: "AI a month", align: "right", render: (r) => fmtInr(r.ai_cost_month_inr) },
          { key: "share_of_revenue", label: "Share of revenue", align: "right", render: (r) => (r.share_of_revenue == null ? "—" : pct(r.share_of_revenue)) },
          { key: "flag", label: "", sortable: false, render: (r) => (r.flag ? <Chip tone="bad">{r.mrr_inr ? "Over 30%" : "Costly, not paying"}</Chip> : null) },
        ];
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiTile label="AI cost a month" value={fmtInr(a.cost_month_inr)} sub={`at ₹${a.usd_inr} to the dollar`} />
              <KpiTile label="Share of revenue" value={a.share_of_revenue == null ? "—" : pct(a.share_of_revenue, 1)} good="down" sub={`of ${fmtInr(a.total_mrr_inr)} MRR`} />
              <KpiTile label="Per active person" value={a.cost_per_active_person_inr == null ? "—" : fmtInr(a.cost_per_active_person_inr)} sub={`over ${days} days`} />
              <KpiTile label="Customers flagged" value={fmtNum(a.flagged)} sub="AI over 30% of what they pay" onClick={() => setOnlyFlagged(true)} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Cost against revenue" testid="ai-scatter" hint="One dot per customer; above the dashed line AI costs more than 30% of what they pay">
                {a.customers.length === 0 ? <Empty compact icon={Robot} title="No customers." /> : <CostScatter rows={a.customers} onPick={(p) => go(`workspaces/${p.id}`)} />}
              </Panel>
              <Panel title="Cost by provider, week by week">
                {a.by_provider.length === 0 ? <Empty compact title="No AI use counted." /> : (
                  <>
                    <Legend items={providers.map((p, i) => ({ label: providerLabel(p), color: SERIES[i % SERIES.length] }))} />
                    <BarsChart data={a.by_provider} x="week" stacked yFormat={(v) => fmtInr(v)} tickFormat={inrTick}
                      bars={providers.map((p, i) => ({ key: p, label: providerLabel(p), color: SERIES[i % SERIES.length] }))}
                      ariaLabel="AI cost per week, by provider" />
                  </>
                )}
              </Panel>
            </div>
            <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Every customer</h2>
              <Toggle checked={onlyFlagged} onChange={setOnlyFlagged} label="Only the flagged ones" testid="ai-only-flagged" />
            </div>
            <div className={CARD_BASE}>
              <DataTable rows={rows} columns={cols} onRowClick={(r) => go(`workspaces/${r.id}`)} initialSort={{ key: "ai_cost_month_inr", dir: "desc" }}
                empty={<Empty compact title={onlyFlagged ? "No customer is flagged." : "No customers."} />} />
            </div>
            <Note>Estimates: providers bill in dollars, shown at the rate set in Config. "A month" scales the period to 30 days.</Note>
          </>
        );
      }}
    </Page>
  );
}


// Finance — Overview, on the founder's reference (2026-09-14): six KPI tiles
// with a change chip and a trend, the AI Finance Brief with ledger facts
// beside its headline, spend by category and top vendors.
//
// Every figure answers the page's period (ledgerMath): the window's rows, or
// the server's all-time totals. The brief is the one exception — the model
// reads everything on record, and its facts are labelled as all-time figures
// by what they are (profit to date, what is owed now, the oldest overdue).
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import {
  ChartPieSlice, CurrencyCircleDollar, CurrencyInr, Cube, DownloadSimple, Package, Robot, Storefront, TrendUp,
} from "@phosphor-icons/react";
import { AiPanel } from "./FinanceAi";
import { CARD, DeltaChip, EmptyNote, SMALL_PILL, Sparkline, TONE_CHIP, compactMoney, fmt } from "./financeKit";
import { LIST_LIMIT, categorySlices, financeMetrics, latestEntryAt, receivableFacts } from "./ledgerMath";

export function OverviewTab({ summary, revenue, expenses, assets, inventory, period, cur, onViewExpenses }) {
  const { t } = useTranslation();
  const f = useMemo(() => fmt(cur), [cur]);
  const short = useMemo(() => compactMoney(cur), [cur]);
  const m = useMemo(
    () => financeMetrics({ summary, revenue, expenses, assets, inventory, period }),
    [summary, revenue, expenses, assets, inventory, period],
  );
  const facts = useMemo(() => receivableFacts(revenue, summary), [revenue, summary]);
  const changedAt = useMemo(() => latestEntryAt(revenue, expenses), [revenue, expenses]);
  const slices = useMemo(() => categorySlices(m.byCategory, m.allCategories), [m]);
  const p = m.period;
  const trendSpan = p.days ? p.label.toLowerCase() : "the last 12 months";
  const totals = summary?.totals || {};
  // J2-06 — revenue minus what it costs to RUN the place; stock and equipment
  // are money out, not money gone, and are counted on their own tiles.
  const profitToDate = totals.net_profit
    ?? ((totals.revenue_billed || 0) - (totals.operating_spend ?? totals.total_spend ?? 0));
  const setAside = (totals.stock_spend || 0) + (totals.capital_spend || 0);

  const tiles = [
    { id: "revenue", icon: cur === "INR" ? CurrencyInr : CurrencyCircleDollar, tone: "emerald", label: "Revenue billed", metric: m.billed, to: "/finance?tab=revenue" },
    { id: "received", icon: DownloadSimple, tone: "sky", label: "Received", metric: m.received, to: "/finance?tab=revenue" },
    { id: "net-profit", icon: ChartPieSlice, tone: "orange", label: "Net profit", metric: m.net, to: "/finance?tab=expenses",
      // J2-06 — say what it leaves out, on the tile, so nobody has to guess
      // why it does not match revenue minus spend.
      note: setAside > 0 ? "stock & equipment not counted as a loss" : undefined },
    { id: "spend", icon: TrendUp, tone: "slate", label: t("finance.k_spend"), metric: m.spend, to: "/finance?tab=expenses", goodWhenUp: false },
    { id: "assets", icon: Cube, tone: "violet", label: t("finance.k_asset"), metric: m.assets, to: "/finance?tab=assets", neutral: true },
    { id: "inventory", icon: Package, tone: "amber", label: t("finance.k_inv"), metric: m.stock, to: "/finance?tab=inventory", neutral: true },
  ];

  return (
    <div className="space-y-5" data-testid="ledger-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4 xl:grid-cols-6" data-testid="ledger-kpis">
        {tiles.map((tile) => (
          <KpiTile key={tile.id} {...tile} value={f(tile.metric.value)} prevLabel={p.prevLabel}
            trendLabel={`${tile.label}, ${tile.neutral ? "running total" : "per interval"} over ${trendSpan}`} />
        ))}
      </div>
      {m.truncated && p.days && (
        <p className="text-xs text-slate-500">
          Period figures count the newest {LIST_LIMIT.toLocaleString()} records of each kind; anything older than that isn't in them.
        </p>
      )}

      {/* JOURNEY-1 J7 — "Estimated profit" sat beside the period's Net profit
          tile and disagreed with it by six times, because it is everything to
          date. Its name now says so. */}
      <AiPanel scope="brief" variant="brief" positive={profitToDate >= 0} changedAt={changedAt}
        facts={[
          { label: "Profit to date", value: short(profitToDate), testid: "brief-fact-profit" },
          { label: "Outstanding receivables", value: short(facts.outstanding || 0), testid: "brief-fact-receivables" },
          { label: "Oldest overdue", value: facts.oldestOverdueDays != null ? `${facts.oldestOverdueDays} days` : "None", testid: "brief-fact-overdue" },
        ]} />

      <div className="grid gap-5 lg:grid-cols-2">
        <SpendByCategory slices={slices} f={f} periodLabel={p.label} title={t("finance.spend_by_category", "Spend by category")} />
        <TopVendors rows={m.byVendor} f={f} periodLabel={p.label} title={t("finance.top_vendors")} onViewAll={onViewExpenses} />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Robot size={14} aria-hidden="true" /> {t("finance.auto_flow")}
      </p>
    </div>
  );
}

function KpiTile({ id, icon: Icon, tone, label, value, metric, to, goodWhenUp = true, neutral = false, prevLabel, trendLabel, note }) {
  return (
    <Link to={to} data-testid={`kpi-${id}`}
      className={`group flex min-w-0 flex-col p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_hsl(150_15%_20%/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 motion-reduce:transition-none sm:p-5 ${CARD}`}>
      <span className="flex items-start justify-between gap-2">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ring-1 ring-inset ${TONE_CHIP[tone]}`}>
          <Icon size={19} aria-hidden="true" />
        </span>
        <DeltaChip change={metric.change} goodWhenUp={goodWhenUp} neutral={neutral} prevLabel={prevLabel} />
      </span>
      <span className="mt-4 text-sm text-slate-600">{label}</span>
      {/* JOURNEY-1 J13 — never cut a money figure short. At a phone's larger
          text size "Revenue billed" read "₹22,85,0…"; a figure that does not
          fit now takes a second line instead of losing its last digits, and
          breaks after a comma ("₹22,85," / "000") rather than mid-group. At
          the normal size it fits, and nothing moves. */}
      <span className="mt-1 text-[1.35rem] font-semibold leading-tight text-slate-900 [overflow-wrap:anywhere] sm:text-[1.45rem]" title={value}>
        {String(value ?? "").replace(/,/g, ",\u200B")}
      </span>
      {/* J2-06 — a figure that leaves something out says so on its own face. */}
      {note && <span className="mt-1 text-[11px] leading-snug text-slate-500">{note}</span>}
      <Sparkline points={metric.trend} tone={tone} label={trendLabel} className="mt-3" />
    </Link>
  );
}

function SliceTip({ active, payload, f, total }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  const share = total ? (s.amount / total) * 100 : 0;
  return (
    <div className="rounded-xl bg-white/95 px-3 py-2 text-xs shadow-[0_12px_30px_-12px_hsl(0_0%_0%/0.35)] ring-1 ring-slate-900/[0.06]">
      <p className="text-sm font-semibold text-slate-900">
        {f(s.amount)} <span className="font-normal text-slate-500">· {share < 1 ? "<1" : Math.round(share)}%</span>
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-slate-600">
        <span aria-hidden="true" className="h-0.5 w-3 rounded" style={{ background: s.color }} /> {s.label}
      </p>
    </div>
  );
}

function SpendByCategory({ slices, f, periodLabel, title }) {
  const total = slices.reduce((s, x) => s + x.amount, 0);
  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-500">{periodLabel}</span>
      </div>
      {slices.length ? (
        <div className="mt-5 flex flex-col items-center gap-6 lg:flex-row lg:items-center" data-testid="ledger-category-donut">
          <div className="relative h-[220px] w-[220px] shrink-0">
            <PieChart width={220} height={220}>
              {/* A 2px white stroke is the gap between slices — no border
                  drawn around a mark, the surface does the separating. */}
              <Pie data={slices} dataKey="amount" nameKey="label" cx="50%" cy="50%" innerRadius={70} outerRadius={104}
                startAngle={90} endAngle={-270} stroke="#ffffff" strokeWidth={2} isAnimationActive={false}>
                {slices.map((s) => <Cell key={s.label} fill={s.color} />)}
              </Pie>
              <Tooltip content={<SliceTip f={f} total={total} />} wrapperStyle={{ outline: "none", zIndex: 10 }} />
            </PieChart>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="text-xs text-slate-500">Total</p>
                <p className="text-lg font-semibold text-slate-900">{f(total)}</p>
              </div>
            </div>
          </div>
          <ul className="w-full min-w-0 flex-1 space-y-2.5" aria-label={`${title}, ${periodLabel}`}>
            {slices.map((s) => {
              const share = total ? (s.amount / total) * 100 : 0;
              return (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700">{s.label}</span>
                  <span className="font-medium tabular-nums text-slate-900">{f(s.amount)}</span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-slate-500">{share < 1 ? "<1" : Math.round(share)}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <EmptyNote icon={ChartPieSlice} title="No spend in this period" hint="Expenses dated in this period show up here by category." />
      )}
    </section>
  );
}

function TopVendors({ rows, f, periodLabel, title, onViewAll }) {
  const max = rows[0]?.amount || 1;
  return (
    <section className={`p-5 sm:p-6 ${CARD}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-500">{periodLabel}</p>
        </div>
        <button type="button" onClick={onViewAll} data-testid="ledger-vendors-viewall" className={SMALL_PILL}>View all</button>
      </div>
      {rows.length ? (
        <ol className="mt-5 space-y-3" data-testid="ledger-vendors">
          {rows.map((v, i) => (
            <li key={v.label} className="grid grid-cols-[1.5rem_minmax(0,8rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm lg:grid-cols-[1.5rem_minmax(0,11rem)_minmax(0,1fr)_auto]">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-900/[0.05] text-xs tabular-nums text-slate-600">{i + 1}</span>
              <span className="truncate text-slate-700" title={v.label}>{v.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-slate-900/[0.06]" aria-hidden="true">
                <span className="block h-full rounded-r-[4px] bg-[#2f7a4f]" style={{ width: `${Math.max(2, (v.amount / max) * 100)}%` }} />
              </span>
              <span className="text-right font-medium tabular-nums text-slate-900">{f(v.amount)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyNote icon={Storefront} title="No vendor spend in this period" hint="Expenses with a vendor name show up here, largest first." />
      )}
    </section>
  );
}

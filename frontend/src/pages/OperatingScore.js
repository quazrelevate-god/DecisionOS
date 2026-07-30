import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import { Gauge, Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots, Trophy, Sparkle, CaretRight } from "@phosphor-icons/react";

const CATS = [
  { key: "execution", label: "Execution", icon: Lightning, color: "bg-primary" },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar, color: "bg-success-600" },
  { key: "sales", label: "Sales", icon: TrendUp, color: "bg-status-pending-bg" },
  { key: "responsiveness", label: "Responsiveness", icon: ChatCenteredDots, color: "bg-purple-600" },
];

const scoreColor = (v) => v == null ? "text-text-tertiary" : v >= 70 ? "text-status-completed-fg" : v >= 40 ? "text-status-pending-fg" : "text-primary-text";

export default function OperatingScore() {
  const { data, isLoading } = useQuery({
    queryKey: ["operating-score"],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });

  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data]
  );

  if (isLoading || !data) return <div className="text-label uppercase text-sm py-20 text-center">Computing operating score…</div>;

  const { company, stats } = data;
  const overall = company.overall;
  const enough = company.enough_data !== false;

  return (
    <div>
      <PageHeader eyebrow="How well the business is running" title="Operating Score" />

      {!enough ? (
        <div className="rounded-lg border border-hairline bg-surface p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-overall">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-hairline bg-surface-hover text-center px-3">
              <Gauge size={30} weight="bold" className="text-text-secondary mb-1" />
              <span className="text-label uppercase text-text-secondary leading-tight" data-testid="operating-overall-score">Not enough data yet</span>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Gauge size={16} weight="bold" className="text-primary-text" />
              <span className="font-extrabold uppercase tracking-tight text-sm">Company Health</span>
            </div>
          </div>
          <div className="flex-1 w-full" data-testid="operating-not-ready">
            <p className="font-extrabold uppercase tracking-tight text-lg mb-2">We're still learning your business</p>
            <p className="text-sm text-text-secondary leading-relaxed">
              The Operating Score kicks in once there's enough real activity to measure — roughly <strong>3+ actionable tasks</strong> or your <strong>first invoices</strong>.
              Capture a few decisions on the Decision Desk and import or add invoices, and your score will start tracking automatically.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="border border-hairline p-3 text-center">
                <p className="text-2xl font-black">{stats.done + stats.open}</p>
                <p className="text-label uppercase text-text-secondary">Actionable tasks</p>
              </div>
              <div className="border border-hairline p-3 text-center">
                <p className="text-2xl font-black">{stats.done}</p>
                <p className="text-label uppercase text-text-secondary">Completed</p>
              </div>
              <div className="border border-hairline p-3 text-center">
                <p className="text-2xl font-black">{stats.total_decisions}</p>
                <p className="text-label uppercase text-text-secondary">Decisions</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
      /* Company overall */
      <div className="rounded-lg border border-hairline bg-surface p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-overall">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-hairline bg-surface">
            <span className={` text-6xl font-black leading-none ${scoreColor(overall)}`} data-testid="operating-overall-score">{overall}</span>
            <span className="text-label uppercase text-text-secondary mt-1">/ 100</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-primary-text" />
            <span className="font-extrabold uppercase tracking-tight text-sm">Company Health</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-4">
          {CATS.map((c) => {
            const v = company.categories[c.key];
            const has = v != null;
            return (
              <div key={c.key} data-testid={`operating-cat-${c.key}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                    <c.icon size={15} weight="bold" className="text-text-secondary" /> {c.label}
                  </span>
                  <span className={` font-black ${scoreColor(v)}`}>{has ? v : "—"}</span>
                </div>
                <div className="h-3 bg-surface-sunken border border-hairline">
                  <div className={`h-full ${c.color}`} style={{ width: `${has ? v : 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Tasks Done", value: stats.done },
          { label: "Open Tasks", value: stats.open },
          { label: "Overdue", value: stats.overdue, accent: stats.overdue > 0 ? "text-primary-text" : "" },
          { label: "Open Complaints", value: stats.open_complaints, accent: stats.open_complaints > 0 ? "text-text-secondary" : "" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-hairline bg-surface p-4">
            <p className="text-label uppercase text-text-secondary">{s.label}</p>
            <p className={` text-2xl font-black tracking-tight mt-1 ${s.accent || ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Employee leaderboard */}
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={18} weight="bold" className="text-primary-text" />
        <h2 className="text-xl font-extrabold uppercase tracking-tight">Team Execution</h2>
      </div>
      <p className="text-label uppercase text-text-secondary mb-3">Tap any member to see their full activity &amp; AI coaching.</p>
      <div className="rounded-lg border border-hairline bg-surface divide-y divide-black/10" data-testid="operating-employees">
        {rankedEmployees.map((e, i) => (
          <Link key={e.id} to={`/coach?user=${e.id}`} data-testid={`operating-emp-${e.id}`}
            className="p-4 flex items-center gap-4 hover:bg-black/[0.03] transition-colors group cursor-pointer">
            <span className="text-lg font-black text-text-tertiary w-6">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate group-hover:text-destructive-text transition-colors">{e.name}</p>
              <p className="text-label uppercase text-text-secondary">{e.role} · {e.done} done · {e.open} open{e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}</p>
            </div>
            <span className="hidden sm:flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-text-secondary group-hover:text-destructive-text transition-colors shrink-0">
              <Sparkle size={13} weight="bold" /> Details
            </span>
            <div className="w-14 h-14 flex flex-col items-center justify-center border-2 border-hairline bg-surface shrink-0">
              <span className={` text-2xl font-black leading-none ${scoreColor(e.score)}`}>{e.score != null ? e.score : "—"}</span>
            </div>
            <CaretRight size={16} weight="bold" className="text-text-tertiary group-hover:text-destructive-text transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

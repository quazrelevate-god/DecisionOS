import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import { Gauge, Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots, Trophy, Sparkle, CaretRight } from "@phosphor-icons/react";

const CATS = [
  { key: "execution", label: "Execution", icon: Lightning, color: "bg-brand-blue" },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar, color: "bg-green-600" },
  { key: "sales", label: "Sales", icon: TrendUp, color: "bg-brand-yellow" },
  { key: "responsiveness", label: "Responsiveness", icon: ChatCenteredDots, color: "bg-purple-600" },
];

const scoreColor = (v) => v == null ? "text-black/30" : v >= 70 ? "text-green-600" : v >= 40 ? "text-amber-600" : "text-brand-red";

export default function OperatingScore() {
  const { data, isLoading } = useQuery({
    queryKey: ["operating-score"],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });

  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data]
  );

  if (isLoading || !data) return <div className="font-mono text-sm py-20 text-center">Computing operating score…</div>;

  const { company, stats } = data;
  // `stats` can be {} on a brand-new tenant — every read below is guarded.
  const overall = company.overall;
  const enough = company.enough_data !== false;

  return (
    <div>
      <PageHeader eyebrow="How well the business is running" title="Operating Score" />

      {!enough ? (
        <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-overall">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-black bg-black/5 text-center px-3">
              <Gauge size={30} weight="bold" className="text-muted-foreground mb-1" />
              <span className="label-mono text-muted-foreground leading-tight" data-testid="operating-overall-score">Not enough data yet</span>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Gauge size={16} weight="bold" className="text-brand-red" />
              <span className="font-heading font-extrabold uppercase tracking-tight text-sm">Company Health</span>
            </div>
          </div>
          <div className="flex-1 w-full" data-testid="operating-not-ready">
            <p className="font-heading font-extrabold uppercase tracking-tight text-lg mb-2">We're still learning your business</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The Operating Score kicks in once there's enough real activity to measure — roughly <strong>3+ actionable tasks</strong> or your <strong>first invoices</strong>.
              Capture a few decisions on the Decision Desk and import or add invoices, and your score will start tracking automatically.
            </p>
            {/* MPWA-12i: two bugs lived in this block.
                1. `stats.done + stats.open` is NaN whenever the API returns
                   `stats: {}` — which is exactly what a tenant with no activity
                   gets, i.e. the only tenant that ever sees this panel. It read
                   "NaN Actionable tasks" on desktop too.
                2. At 390px the three columns give each label a 63px box for a
                   94px string, so every label was clipped. One column below lg;
                   desktop is untouched. */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
              <div className="border border-black/30 p-3 text-center">
                <p className="font-heading text-2xl font-black">{(stats?.done || 0) + (stats?.open || 0)}</p>
                <p className="label-mono text-muted-foreground">Actionable tasks</p>
              </div>
              <div className="border border-black/30 p-3 text-center">
                <p className="font-heading text-2xl font-black">{stats?.done || 0}</p>
                <p className="label-mono text-muted-foreground">Completed</p>
              </div>
              <div className="border border-black/30 p-3 text-center">
                <p className="font-heading text-2xl font-black">{stats?.total_decisions || 0}</p>
                <p className="label-mono text-muted-foreground">Decisions</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
      /* Company overall */
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-overall">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-black bg-white">
            <span className={`font-heading text-6xl font-black leading-none ${scoreColor(overall)}`} data-testid="operating-overall-score">{overall}</span>
            <span className="label-mono text-muted-foreground mt-1">/ 100</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-brand-red" />
            <span className="font-heading font-extrabold uppercase tracking-tight text-sm">Company Health</span>
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
                    <c.icon size={15} weight="bold" className="text-muted-foreground" /> {c.label}
                  </span>
                  <span className={`font-heading font-black ${scoreColor(v)}`}>{has ? v : "—"}</span>
                </div>
                <div className="h-3 bg-black/10 border border-black">
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
          { label: "Overdue", value: stats.overdue, accent: stats.overdue > 0 ? "text-brand-red" : "" },
          { label: "Open Complaints", value: stats.open_complaints, accent: stats.open_complaints > 0 ? "text-purple-600" : "" },
        ].map((s) => (
          <div key={s.label} className="card-brutal p-4">
            <p className="label-mono text-muted-foreground">{s.label}</p>
            <p className={`font-heading text-2xl font-black tracking-tight mt-1 ${s.accent || ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Employee leaderboard */}
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={18} weight="bold" className="text-brand-red" />
        <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight">Team Execution</h2>
      </div>
      <p className="label-mono text-muted-foreground mb-3">Tap any member to see their full activity &amp; AI coaching.</p>
      <div className="card-brutal divide-y divide-black/10" data-testid="operating-employees">
        {rankedEmployees.map((e, i) => (
          <Link key={e.id} to={`/coach?user=${e.id}`} data-testid={`operating-emp-${e.id}`}
            className="p-4 flex items-center gap-4 hover:bg-black/[0.03] transition-colors group cursor-pointer">
            <span className="font-heading text-lg font-black text-black/30 w-6">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate group-hover:text-brand-red transition-colors">{e.name}</p>
              <p className="label-mono text-muted-foreground">{e.role} · {e.done} done · {e.open} open{e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}</p>
            </div>
            <span className="hidden sm:flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-brand-red transition-colors shrink-0">
              <Sparkle size={13} weight="bold" /> Details
            </span>
            <div className="w-14 h-14 flex flex-col items-center justify-center border-2 border-black bg-white shrink-0">
              <span className={`font-heading text-2xl font-black leading-none ${scoreColor(e.score)}`}>{e.score != null ? e.score : "—"}</span>
            </div>
            <CaretRight size={16} weight="bold" className="text-black/30 group-hover:text-brand-red transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

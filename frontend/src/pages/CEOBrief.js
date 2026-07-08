import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import { Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr, XCircle, TrendUp, Trophy } from "@phosphor-icons/react";

const PERIODS = [
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const ROWS = [
  { key: "delayed", label: "delayed tasks", bg: "bg-brand-red", on: "text-white", accent: "text-brand-red", icon: Clock },
  { key: "completed", label: "completed", bg: "bg-green-600", on: "text-white", accent: "text-green-600", icon: CheckCircle },
  { key: "awaiting_approval", label: "waiting for your approval", bg: "bg-brand-yellow", on: "text-black", accent: "text-amber-600", icon: Stamp },
  { key: "absent", label: "employees absent", bg: "bg-brand-blue", on: "text-white", accent: "text-brand-blue", icon: UserMinus },
  { key: "complaints", label: "customer complaint(s)", bg: "bg-purple-600", on: "text-white", accent: "text-purple-600", icon: Warning },
  { key: "payment_overdue", label: "payment(s) overdue", bg: "bg-orange-500", on: "text-white", accent: "text-orange-500", icon: CurrencyInr },
];

export default function CEOBrief() {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState("morning");
  const { data, isLoading } = useQuery({ queryKey: ["brief", period], queryFn: () => api.get(`/brief?period=${period}`).then((r) => r.data) });
  const { data: complaints } = useQuery({ queryKey: ["complaints", "open"], queryFn: () => api.get("/complaints?status=open").then((r) => r.data) });
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/dashboard").then((r) => r.data) });

  const decide = async (id, action) => {
    try {
      await api.post(`/decisions/${id}/${action}`);
      toast.success(`Decision ${action === "approve" ? "approved — tasks unblocked" : "rejected"}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["brief"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action failed");
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Your company at a glance" title="CEO Brief" />

      <div className="flex border border-black mb-8 w-fit">
        {PERIODS.map((p) => (
          <button key={p.key} onClick={() => setPeriod(p.key)} data-testid={`brief-period-${p.key}`}
            className={`px-5 py-2.5 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${period === p.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <p className="font-mono text-sm">Loading brief…</p>
      ) : (
        <div data-testid="ceo-brief-card">
          <h2 className="font-heading text-3xl font-black tracking-tighter">{data.greeting}</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-6">Today you have</p>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {ROWS.map((r) => {
              const val = data.counters[r.key];
              const label = r.key === "completed" ? (data.completed_label || "completed") : r.label;
              return (
                <div key={r.key} data-testid={`brief-row-${r.key}`} className="card-brutal p-6 shadow-hover">
                  <div className="flex items-center justify-between">
                    <div className={`w-11 h-11 flex items-center justify-center border border-black ${r.bg} ${r.on}`}>
                      <r.icon size={22} weight="bold" />
                    </div>
                    <span className={`w-3 h-3 rounded-full ${r.bg}`} />
                  </div>
                  <p className={`font-heading text-5xl font-black tracking-tighter mt-4 ${r.accent}`} data-testid={`brief-count-${r.key}`}>{val}</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-tight">{label}</p>
                </div>
              );
            })}
          </div>

          <p className="mt-8 text-sm text-muted-foreground italic">That's it. Exactly like a CEO.</p>

          {(complaints || []).length > 0 && (
            <div className="mt-8 max-w-2xl">
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">Open Complaints</h3>
              <div className="card-brutal divide-y divide-black/10">
                {complaints.map((c) => (
                  <div key={c.id} className="p-4">
                    <p className="text-sm">{c.text}</p>
                    <p className="text-xs text-muted-foreground mt-1">{c.customer_name || "Unknown"} · {c.severity}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actionable blocks (merged from Daily Brief) */}
      {dash && (
        <div className="mt-12 pt-10 border-t-2 border-black" data-testid="brief-actionable">
          <p className="label-mono text-muted-foreground mb-6">Live · needs action now</p>
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Approvals */}
            <section>
              <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Pending Approvals</h2>
              <div className="space-y-4">
                {dash.pending_decisions.length === 0 && dash.pending_purchases.length === 0 && (
                  <EmptyState title="All clear" hint="No decisions or purchases waiting." />
                )}
                {dash.pending_decisions.map((d) => (
                  <div key={d.id} data-testid={`approval-decision-${d.id}`} className="card-brutal p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Chip value="decision" className="bg-brand-blue text-white mb-2" />
                        <p className="font-heading font-bold text-lg leading-tight">{d.title}</p>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{d.summary}</p>
                    <p className="label-mono text-muted-foreground mt-3">{d.tasks?.length || 0} task(s) blocked</p>
                    {user?.role === "owner" && (
                      <div className="flex gap-2 mt-4">
                        <button onClick={() => decide(d.id, "approve")} data-testid={`approve-decision-${d.id}`}
                          className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
                          <CheckCircle size={16} weight="bold" /> Approve
                        </button>
                        <button onClick={() => decide(d.id, "reject")} data-testid={`reject-decision-${d.id}`}
                          className="flex items-center justify-center gap-2 bg-white py-2 px-4 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
                          <XCircle size={16} weight="bold" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {dash.pending_purchases.map((w) => (
                  <div key={w.id} data-testid={`approval-purchase-${w.id}`} className="card-brutal p-5">
                    <Chip value="purchase" className="bg-brand-yellow text-black mb-2" />
                    <p className="font-heading font-bold text-lg leading-tight">{w.title}</p>
                    <p className="text-sm text-muted-foreground mt-1">{w.counterparty} · {money(w.amount || 0, tenant?.currency)}</p>
                    <Link to="/workflows" className="inline-block mt-3 text-sm text-brand-blue font-semibold hover:underline">Review in Workflows →</Link>
                  </div>
                ))}
              </div>
            </section>

            {/* Overdue + Activity */}
            <section className="space-y-8">
              <div>
                <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
                  <Warning size={22} weight="bold" className="text-brand-red" /> Overdue Tasks
                </h2>
                <div className="space-y-2">
                  {dash.overdue_tasks.length === 0 && <EmptyState title="Nothing overdue" />}
                  {dash.overdue_tasks.map((t) => (
                    <div key={t.id} data-testid={`overdue-task-${t.id}`} className="card-brutal p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-sm">{t.title}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t.assignee_role || "unassigned"}</p>
                      </div>
                      <Chip value={t.priority} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
                  <Trophy size={22} weight="bold" className="text-brand-blue" /> Wins Today
                </h2>
                <div className="card-brutal divide-y divide-black/10" data-testid="wins-list">
                  {(dash.wins || []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No wins logged yet today — go close something!</p>}
                  {(dash.wins || []).map((w) => (
                    <div key={w.id} className="p-4 flex items-start gap-3">
                      <CheckCircle size={16} weight="fill" className="mt-0.5 text-brand-blue shrink-0" />
                      <p className="text-sm">{w.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
                  <Clock size={22} weight="bold" /> Recent Activity
                </h2>
                <div className="card-brutal divide-y divide-black/10">
                  {dash.activity.length === 0 && <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>}
                  {dash.activity.map((a) => (
                    <div key={a.id} className="p-4 flex items-start gap-3">
                      <TrendUp size={16} weight="bold" className="mt-0.5 text-brand-blue shrink-0" />
                      <p className="text-sm">{a.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

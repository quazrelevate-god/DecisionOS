import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { CheckCircle, XCircle, Warning, Clock, TrendUp } from "@phosphor-icons/react";

function Stat({ label, value, accent }) {
  return (
    <div className="card-brutal p-6">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className={`font-heading text-5xl font-black tracking-tighter mt-2 ${accent}`}>{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api.get("/dashboard").then((r) => r.data) });

  const decide = async (id, action) => {
    try {
      await api.post(`/decisions/${id}/${action}`);
      toast.success(`Decision ${action === "approve" ? "approved — tasks unblocked" : "rejected"}`);
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action failed");
    }
  };

  if (isLoading) return <p className="font-mono text-sm">Loading brief…</p>;
  const s = data.stats;

  return (
    <div>
      <PageHeader eyebrow={`Good day, ${user?.name?.split(" ")[0]}`} title="Daily Brief" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <Stat label="Pending Approvals" value={s.pending_approvals} accent="text-brand-red" />
        <Stat label="Open Tasks" value={s.open_tasks} accent="" />
        <Stat label="Overdue" value={data.overdue_tasks.length} accent="text-brand-red" />
        <Stat label="Active Workflows" value={s.active_workflows} accent="text-brand-blue" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Approvals */}
        <section>
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Pending Approvals</h2>
          <div className="space-y-4">
            {data.pending_decisions.length === 0 && data.pending_purchases.length === 0 && (
              <EmptyState title="All clear" hint="No decisions or purchases waiting." />
            )}
            {data.pending_decisions.map((d) => (
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
            {data.pending_purchases.map((w) => (
              <div key={w.id} data-testid={`approval-purchase-${w.id}`} className="card-brutal p-5">
                <Chip value="purchase" className="bg-brand-yellow text-black mb-2" />
                <p className="font-heading font-bold text-lg leading-tight">{w.title}</p>
                <p className="text-sm text-muted-foreground mt-1">{w.counterparty} · ₹{(w.amount || 0).toLocaleString("en-IN")}</p>
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
              {data.overdue_tasks.length === 0 && <EmptyState title="Nothing overdue" />}
              {data.overdue_tasks.map((t) => (
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
              <Clock size={22} weight="bold" /> Recent Activity
            </h2>
            <div className="card-brutal divide-y divide-black/10">
              {data.activity.length === 0 && <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>}
              {data.activity.map((a) => (
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
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/common";
import { Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr } from "@phosphor-icons/react";

const PERIODS = [
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const ROWS = [
  { key: "delayed", label: "delayed tasks", dot: "bg-brand-red", icon: Clock },
  { key: "completed", label: "completed", dot: "bg-green-600", icon: CheckCircle },
  { key: "awaiting_approval", label: "waiting for your approval", dot: "bg-brand-yellow", icon: Stamp },
  { key: "absent", label: "employees absent", dot: "bg-brand-blue", icon: UserMinus },
  { key: "complaints", label: "customer complaint(s)", dot: "bg-purple-600", icon: Warning },
  { key: "payment_overdue", label: "payment(s) overdue", dot: "bg-orange-500", icon: CurrencyInr },
];

export default function CEOBrief() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("morning");
  const { data, isLoading } = useQuery({ queryKey: ["brief", period], queryFn: () => api.get(`/brief?period=${period}`).then((r) => r.data) });
  const { data: complaints } = useQuery({ queryKey: ["complaints", "open"], queryFn: () => api.get("/complaints?status=open").then((r) => r.data) });

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
        <div className="max-w-2xl">
          <div className="card-brutal p-8" data-testid="ceo-brief-card">
            <h2 className="font-heading text-3xl font-black tracking-tighter mb-1">{data.greeting}</h2>
            <p className="text-sm text-muted-foreground mb-6">Today you have</p>
            <ul className="space-y-3">
              {ROWS.map((r) => {
                const val = data.counters[r.key];
                const label = r.key === "completed" ? data.completed_label || "completed" : r.label;
                return (
                  <li key={r.key} data-testid={`brief-row-${r.key}`} className="flex items-center gap-4 text-lg">
                    <span className={`w-3 h-3 rounded-full ${r.dot} shrink-0`} />
                    <span className="font-heading font-black text-2xl w-10 text-right">{val}</span>
                    <span className="text-base">{label}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-8 text-sm text-muted-foreground italic">That's it. Exactly like a CEO.</p>
          </div>

          {(complaints || []).length > 0 && (
            <div className="mt-6">
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
    </div>
  );
}

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr, XCircle, ArrowClockwise, CaretRight } from "@phosphor-icons/react";

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

function DetailDialog({ row, period, open, onClose }) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = row?.key;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["brief-details", key, period],
    queryFn: () => api.get(`/brief/details?key=${key}&period=${period}`).then((r) => r.data),
    enabled: open && !!key,
  });

  const afterAction = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["brief"] });
  };

  const decide = async (id, action) => {
    try {
      await api.post(`/decisions/${id}/${action}`);
      toast.success(`Decision ${action === "approve" ? "approved — tasks unblocked" : "rejected"}`);
      afterAction();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  const resolveComplaint = async (id) => {
    try {
      await api.patch(`/complaints/${id}/resolve`);
      toast.success("Complaint resolved");
      afterAction();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  const items = data?.items || [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-black" data-testid={`brief-detail-dialog-${key}`}>
        <DialogHeader>
          <DialogTitle className="font-heading text-2xl font-black tracking-tighter uppercase flex items-center gap-2">
            {row?.icon && <row.icon size={22} weight="bold" className={row.accent} />}
            {row?.label}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <p className="font-mono text-sm py-6">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6" data-testid={`brief-detail-empty-${key}`}>Nothing here right now. All clear.</p>
        ) : (
          <div className="space-y-3 mt-2">
            {items.map((it) => (
              <div key={it.id} data-testid={`brief-detail-item-${it.id}`} className="border border-black p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading font-bold leading-tight">{it.title}</p>
                    {it.subtitle && <p className="text-sm text-muted-foreground mt-1">{it.subtitle}</p>}
                  </div>
                  {it.kind === "task" && it.meta && <Chip value={it.meta} className="shrink-0" />}
                  {it.kind === "complaint" && it.meta && <Chip value={it.meta} className="shrink-0 bg-purple-600 text-white" />}
                  {(it.kind === "purchase" || it.kind === "payment") && it.meta != null && (
                    <span className="text-sm font-semibold shrink-0">{money(it.meta, tenant?.currency)}</span>
                  )}
                </div>

                {it.kind === "decision" && (
                  <>
                    {it.meta && <p className="label-mono text-muted-foreground mt-2">{it.meta}</p>}
                    {user?.role === "owner" && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => decide(it.id, "approve")} data-testid={`brief-approve-${it.id}`}
                          className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
                          <CheckCircle size={16} weight="bold" /> Approve
                        </button>
                        <button onClick={() => decide(it.id, "reject")} data-testid={`brief-reject-${it.id}`}
                          className="flex items-center gap-2 bg-white py-2 px-4 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
                          <XCircle size={16} weight="bold" /> Reject
                        </button>
                      </div>
                    )}
                  </>
                )}

                {it.kind === "purchase" && (
                  <button onClick={() => { onClose(); navigate("/workflows"); }} data-testid={`brief-purchase-${it.id}`}
                    className="mt-3 text-sm text-brand-blue font-semibold hover:underline">Review in Workflows →</button>
                )}

                {it.kind === "complaint" && (user?.role === "owner" || user?.role === "sales") && (
                  <button onClick={() => resolveComplaint(it.id)} data-testid={`brief-resolve-${it.id}`}
                    className="mt-3 flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-red transition-colors">
                    <CheckCircle size={15} weight="bold" /> Mark resolved
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CEOBrief() {
  useAuth();
  const [period, setPeriod] = useState("morning");
  const [activeRow, setActiveRow] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["brief", period],
    queryFn: () => api.get(`/brief?period=${period}`).then((r) => r.data),
    refetchInterval: 30000,
  });

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
          <p className="text-sm text-muted-foreground mt-1 mb-6">Tap any block to see the details and act on them.</p>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {ROWS.map((r) => {
              const val = data.counters[r.key];
              const label = r.key === "completed" ? (data.completed_label || "completed") : r.label;
              return (
                <button key={r.key} type="button" onClick={() => setActiveRow(r)} data-testid={`brief-row-${r.key}`}
                  className="card-brutal p-6 shadow-hover text-left transition-all hover:-translate-y-0.5 focus:outline-none">
                  <div className="flex items-center justify-between">
                    <div className={`w-11 h-11 flex items-center justify-center border border-black ${r.bg} ${r.on}`}>
                      <r.icon size={22} weight="bold" />
                    </div>
                    <CaretRight size={18} weight="bold" className="text-black/40" />
                  </div>
                  <p className={`font-heading text-5xl font-black tracking-tighter mt-4 ${r.accent}`} data-testid={`brief-count-${r.key}`}>{val}</p>
                  <p className="text-sm text-muted-foreground mt-1 leading-tight">{label}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-brand-blue">
                    View details <CaretRight size={12} weight="bold" />
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-8 text-sm text-muted-foreground italic flex items-center gap-2">
            <ArrowClockwise size={14} /> Auto-refreshes every 30s. That's it. Exactly like a CEO.
          </p>
        </div>
      )}

      <DetailDialog row={activeRow} period={period} open={!!activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

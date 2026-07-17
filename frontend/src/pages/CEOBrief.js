import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr, XCircle, ArrowClockwise, CaretRight, Fire, BookOpen, ListChecks, WarningCircle, ArrowBendUpRight, Sparkle, Paperclip } from "@phosphor-icons/react";

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

const EMP_ROWS = [
  { key: "delayed", label: "overdue tasks", bg: "bg-brand-red", on: "text-white", accent: "text-brand-red", icon: Clock },
  { key: "in_progress", label: "in progress", bg: "bg-brand-blue", on: "text-white", accent: "text-brand-blue", icon: ArrowClockwise },
  { key: "todo", label: "to do", bg: "bg-brand-yellow", on: "text-black", accent: "text-amber-600", icon: ListChecks },
  { key: "completed", label: "completed", bg: "bg-green-600", on: "text-white", accent: "text-green-600", icon: CheckCircle },
  { key: "escalations", label: "escalated to you", bg: "bg-brand-red", on: "text-white", accent: "text-brand-red", icon: WarningCircle },
  { key: "handoffs", label: "handed to you", bg: "bg-purple-600", on: "text-white", accent: "text-purple-600", icon: ArrowBendUpRight },
];

const FIRES = { key: "fires", label: "fires to put out today", accent: "text-brand-red", icon: Fire };

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

  const NAV = {
    decision: (id) => `/?focus=approval:${id}`,
    escalation: (id) => `/?focus=attention:${id}`,
    purchase: () => `/workflows`,
    payment: () => `/workflows`,
    task: () => `/my-work`,
    complaint: () => `/contacts`,
    absent: () => `/contacts`,
    activity: () => `/my-work`,
  };
  const go = (it) => {
    const fn = NAV[it.kind];
    if (!fn) return;
    onClose();
    navigate(fn(it.id));
  };

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
            {items.map((it) => {
              const clickable = !!NAV[it.kind];
              return (
              <div key={it.id} data-testid={`brief-detail-item-${it.id}`}
                onClick={() => clickable && go(it)}
                className={`border border-black p-4 transition-colors ${clickable ? "cursor-pointer hover:bg-black/5" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading font-bold leading-tight">{it.title}</p>
                    {it.subtitle && <p className="text-sm text-muted-foreground mt-1">{it.subtitle}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {it.kind === "task" && it.meta && <Chip value={it.meta} />}
                    {it.kind === "escalation" && it.meta && <Chip value={it.meta} className="bg-brand-red text-white" />}
                    {it.kind === "complaint" && it.meta && <Chip value={it.meta} className="bg-purple-600 text-white" />}
                    {(it.kind === "purchase" || it.kind === "payment") && it.meta != null && (
                      <span className="text-sm font-semibold">{money(it.meta, tenant?.currency)}</span>
                    )}
                    {clickable && <CaretRight size={16} weight="bold" className="text-black/40" />}
                  </div>
                </div>

                {Array.isArray(it.proof) && it.proof.length > 0 && (
                  <div className="mt-3 border-t border-black/10 pt-3" data-testid={`brief-proof-${it.id}`} onClick={(e) => e.stopPropagation()}>
                    <p className="label-mono text-muted-foreground mb-2 flex items-center gap-1"><Paperclip size={12} weight="bold" /> Proof of work · {it.proof.length}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {it.proof.map((a, idx) => (
                        a.kind === "photo"
                          ? <a key={a.url || idx} href={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} target="_blank" rel="noreferrer" data-testid={`brief-proof-photo-${it.id}-${idx}`}>
                              <img src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-16 h-16 object-cover border border-black hover:shadow-brutal-sm transition-all" />
                            </a>
                          : <audio key={a.url || idx} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`brief-proof-voice-${it.id}-${idx}`} />
                      ))}
                    </div>
                  </div>
                )}

                {it.kind === "decision" && (
                  <>
                    {it.meta && <p className="label-mono text-muted-foreground mt-2">{it.meta}</p>}
                    {user?.role === "owner" && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={(e) => { e.stopPropagation(); decide(it.id, "approve"); }} data-testid={`brief-approve-${it.id}`}
                          className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
                          <CheckCircle size={16} weight="bold" /> Approve
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); decide(it.id, "reject"); }} data-testid={`brief-reject-${it.id}`}
                          className="flex items-center gap-2 bg-white py-2 px-4 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
                          <XCircle size={16} weight="bold" /> Reject
                        </button>
                        <button onClick={() => go(it)} data-testid={`brief-open-${it.id}`}
                          className="flex items-center gap-1 px-3 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-black/5" title="Open in Inbox to assign team">
                          Assign <CaretRight size={14} weight="bold" />
                        </button>
                      </div>
                    )}
                  </>
                )}

                {it.kind === "complaint" && (user?.role === "owner" || user?.role === "sales") && (
                  <button onClick={(e) => { e.stopPropagation(); resolveComplaint(it.id); }} data-testid={`brief-resolve-${it.id}`}
                    className="mt-3 flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-red transition-colors">
                    <CheckCircle size={15} weight="bold" /> Mark resolved
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CEOBrief() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = user?.role === "owner";
  const rows = isOwner ? ROWS : EMP_ROWS;
  const [period, setPeriod] = useState("morning");
  const [activeRow, setActiveRow] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["brief", period],
    queryFn: () => api.get(`/brief?period=${period}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  return (
    <div>
      <PageHeader eyebrow={isOwner ? "Your company at a glance" : "Your day at a glance"} title={isOwner ? "CEO Brief" : "My Brief"}>
        {isOwner ? (
          <button onClick={() => navigate("/journal")} data-testid="brief-open-journal"
            className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
            <BookOpen size={16} weight="bold" /> CEO Journal
          </button>
        ) : (
          <button onClick={() => navigate("/coach")} data-testid="brief-open-coach"
            className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
            <Sparkle size={16} weight="bold" /> AI Coach
          </button>
        )}
      </PageHeader>

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
          <p className="text-sm text-muted-foreground mt-1 mb-6">Tap any block to see the details{isOwner ? " and act on them." : "."}</p>

          {isOwner && data.counters.fires > 0 && (
            <button type="button" onClick={() => setActiveRow(FIRES)} data-testid="brief-row-fires"
              className="w-full card-brutal p-5 mb-6 bg-brand-red text-white flex items-center justify-between gap-4 text-left transition-all hover:-translate-y-0.5 focus:outline-none">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 flex items-center justify-center border border-white/60 bg-white/10 shrink-0">
                  <Fire size={26} weight="fill" />
                </div>
                <div>
                  <p className="font-heading text-4xl font-black tracking-tighter" data-testid="brief-count-fires">{data.counters.fires}</p>
                  <p className="text-sm font-semibold uppercase tracking-wider mt-0.5">Fires to put out today</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wider shrink-0">
                Handle now <CaretRight size={16} weight="bold" />
              </span>
            </button>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {rows.map((r) => {
              const val = data.counters[r.key] ?? 0;
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
            <ArrowClockwise size={14} /> Auto-refreshes every 30s.{isOwner ? " That's it. Exactly like a CEO." : ""}
          </p>
        </div>
      )}

      <DetailDialog row={activeRow} period={period} open={!!activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

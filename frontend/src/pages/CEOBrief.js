import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr, XCircle, ArrowClockwise, CaretRight, Fire, BookOpen, ListChecks, WarningCircle, ArrowBendUpRight, Sparkle, Paperclip, Gauge, Receipt, HandCoins, Coins } from "@phosphor-icons/react";

const PERIODS = [
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

const ROWS = [
  { key: "delayed", label: "delayed tasks", bg: "bg-primary", on: "text-white", accent: "text-primary-text", icon: Clock },
  { key: "completed", label: "completed", bg: "bg-success-600", on: "text-white", accent: "text-status-completed-fg", icon: CheckCircle },
  { key: "awaiting_approval", label: "waiting for your approval", bg: "bg-status-pending-bg", on: "text-text", accent: "text-status-pending-fg", icon: Stamp },
  { key: "absent", label: "employees absent", bg: "bg-primary", on: "text-white", accent: "text-primary-text", icon: UserMinus },
  { key: "complaints", label: "customer complaint(s)", bg: "bg-surface-sunken", on: "text-white", accent: "text-text-secondary", icon: Warning },
  { key: "payment_overdue", label: "payment(s) overdue", bg: "bg-surface-sunken", on: "text-white", accent: "text-status-pending-fg", icon: CurrencyInr },
  { key: "receivables_overdue", label: "overdue receivable(s)", bg: "bg-surface-sunken", on: "text-white", accent: "text-text-secondary", icon: Receipt, money: true },
  { key: "bills_due", label: "supplier bill(s) to pay", bg: "bg-surface-sunken", on: "text-white", accent: "text-text-secondary", icon: HandCoins, money: true },
  { key: "unmatched_payments", label: "payment(s) to match", bg: "bg-surface-sunken", on: "text-white", accent: "text-text-secondary", icon: Coins, money: true },
];

const EMP_ROWS = [
  { key: "delayed", label: "overdue tasks", bg: "bg-status-overdue-bg", on: "text-status-overdue-fg", accent: "text-primary-text", icon: Clock },
  { key: "in_progress", label: "in progress", bg: "bg-primary", on: "text-white", accent: "text-primary-text", icon: ArrowClockwise },
  { key: "todo", label: "to do", bg: "bg-status-pending-bg", on: "text-text", accent: "text-status-pending-fg", icon: ListChecks },
  { key: "completed", label: "completed", bg: "bg-success-600", on: "text-white", accent: "text-status-completed-fg", icon: CheckCircle },
  { key: "escalations", label: "escalated to you", bg: "bg-status-overdue-bg", on: "text-status-overdue-fg", accent: "text-primary-text", icon: WarningCircle },
  { key: "handoffs", label: "handed to you", bg: "bg-surface-sunken", on: "text-white", accent: "text-text-secondary", icon: ArrowBendUpRight },
];

const FIRES = { key: "fires", label: "fires to put out today", accent: "text-primary-text", icon: Fire };

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
    decision: (it) => `/?focus=approval:${it.id}`,
    escalation: (it) => `/?focus=attention:${it.id}`,
    purchase: (it) => `/my-work?view=workflows&wf=${it.id}${it.wf_type ? `&wf_type=${it.wf_type}` : ""}`,
    payment: (it) => `/my-work?view=workflows&wf=${it.id}${it.wf_type ? `&wf_type=${it.wf_type}` : ""}`,
    task: (it) => `/my-work?task=${it.id}`,
    complaint: (it) => (it.customer_id ? `/contacts/${it.customer_id}` : `/contacts`),
    absent: () => `/contacts`,
    activity: () => `/my-work`,
    leave: () => `/my-work?view=leave`,
    receivable: () => `/ledger?tab=revenue`,
    bill: () => `/ledger?tab=expenses`,
    unmatched: (it) => (it.direction === "out" ? `/ledger?tab=expenses` : `/ledger?tab=revenue`),
  };
  const go = (it) => {
    const fn = NAV[it.kind];
    if (!fn) return;
    onClose();
    navigate(fn(it));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto border-hairline" data-testid={`brief-detail-dialog-${key}`}>
        <DialogHeader>
          <DialogTitle className="text-2xl font-black tracking-tighter flex items-center gap-2">
            {row?.icon && <row.icon size={22} weight="bold" className={row.accent} />}
            {row?.label}
          </DialogTitle>
          <DialogDescription className="sr-only">Details for {row?.label}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-label text-sm py-6">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-secondary py-6" data-testid={`brief-detail-empty-${key}`}>Nothing here right now. All clear.</p>
        ) : (
          <div className="space-y-3 mt-2">
            {items.map((it) => {
              const clickable = !!NAV[it.kind];
              return (
              <div key={it.id} data-testid={`brief-detail-item-${it.id}`}
                onClick={() => clickable && go(it)}
                className={`border border-hairline p-4 transition-colors ${clickable ? "cursor-pointer hover:bg-surface-hover" : ""} rounded-md`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold leading-tight">{it.title}</p>
                    {it.subtitle && <p className="text-sm text-text-secondary mt-1">{it.subtitle}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {it.kind === "task" && it.meta && <Chip value={it.meta} />}
                    {it.kind === "escalation" && it.meta && <Chip value={it.meta} />}
                    {it.kind === "complaint" && it.meta && <Chip value={it.meta} />}
                    {(it.kind === "purchase" || it.kind === "payment" || it.kind === "receivable" || it.kind === "bill" || it.kind === "unmatched") && it.meta != null && (
                      <span className="text-sm font-semibold">{money(it.meta, tenant?.currency)}</span>
                    )}
                    {clickable && <CaretRight size={16} weight="bold" className="text-text-tertiary" />}
                  </div>
                </div>

                {Array.isArray(it.proof) && it.proof.length > 0 && (
                  <div className="mt-3 border-t-hairline pt-3" data-testid={`brief-proof-${it.id}`} onClick={(e) => e.stopPropagation()}>
                    <p className="text-label text-text-secondary mb-2 flex items-center gap-1"><Paperclip size={12} weight="bold" /> Proof of work · {it.proof.length}</p>
                    <div className="flex flex-wrap gap-2 items-center">
                      {it.proof.map((a, idx) => (
                        a.kind === "photo"
                          ? <a key={a.url || idx} href={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} target="_blank" rel="noreferrer" data-testid={`brief-proof-photo-${it.id}-${idx}`}>
                              <img src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-16 h-16 object-cover border border-hairline hover:shadow-xs transition-all rounded-md" />
                            </a>
                          : <audio key={a.url || idx} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`brief-proof-voice-${it.id}-${idx}`} />
                      ))}
                    </div>
                  </div>
                )}

                {it.kind === "decision" && (
                  <>
                    {it.meta && <p className="text-label text-text-secondary mt-2">{it.meta}</p>}
                    {user?.role === "owner" && (
                      <div className="flex gap-2 mt-3">
                        <button onClick={(e) => { e.stopPropagation(); decide(it.id, "approve"); }} data-testid={`brief-approve-${it.id}`}
                          className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
                          <CheckCircle size={16} weight="bold" /> Approve
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); decide(it.id, "reject"); }} data-testid={`brief-reject-${it.id}`}
                          className="flex items-center gap-2 bg-surface py-2 px-4 text-sm font-semibold border border-hairline hover:bg-surface-hover transition-colors rounded-md">
                          <XCircle size={16} weight="bold" /> Reject
                        </button>
                        <button onClick={() => go(it)} data-testid={`brief-open-${it.id}`}
                          className="flex items-center gap-1 px-3 py-2 text-sm font-semibold border border-hairline hover:bg-surface-hover rounded-md" title="Open in Inbox to assign team">
                          Assign <CaretRight size={14} weight="bold" />
                        </button>
                      </div>
                    )}
                  </>
                )}

                {it.kind === "complaint" && (user?.role === "owner" || user?.role === "sales") && (
                  <button onClick={(e) => { e.stopPropagation(); resolveComplaint(it.id); }} data-testid={`brief-resolve-${it.id}`}
                    className="mt-3 flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-hairline hover:bg-primary-hover transition-colors rounded-md">
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
  const { user, tenant } = useAuth();
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
    <div className="flex flex-col">
      {/* Controls: period tabs + action buttons — top on desktop, bottom on mobile */}
      <div className="order-2 lg:order-1 mt-8 lg:mt-0 lg:mb-8 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between" data-testid="brief-controls">
        <div className="flex border border-hairline w-full lg:w-fit rounded-md">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} data-testid={`brief-period-${p.key}`}
              className={`flex-1 lg:flex-none px-4 lg:px-5 py-2.5 text-sm font-semibold  border-r-hairline last:border-r-0 transition-colors ${period === p.key ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:items-center">
          {isOwner ? (
            <>
              <button onClick={() => navigate("/operating-score")} data-testid="brief-operating-score"
                className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
                <Gauge size={16} weight="bold" /> Operating Score
              </button>
              <button onClick={() => navigate("/journal")} data-testid="brief-open-journal"
                className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
                <BookOpen size={16} weight="bold" /> CEO Journal
              </button>
            </>
          ) : (
            <button onClick={() => navigate("/coach")} data-testid="brief-open-coach"
              className="col-span-2 flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
              <Sparkle size={16} weight="bold" /> AI Coach
            </button>
          )}
        </div>
      </div>

      <div className="order-1 lg:order-2">
        {isLoading || !data ? (
          <p className="text-label text-sm">Loading brief…</p>
        ) : (
          <div data-testid="ceo-brief-card">
            {isOwner && data.counters.fires > 0 && (
              <button type="button" onClick={() => setActiveRow(FIRES)} data-testid="brief-row-fires"
                className="w-full rounded-lg border border-hairline bg-surface p-5 mb-6 bg-primary text-primary-foreground flex items-center justify-between gap-4 text-left transition-all hover:-translate-y-0.5 focus:outline-none">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 flex items-center justify-center border border-white/60 bg-surface/10 shrink-0 rounded-md">
                    <Fire size={26} weight="fill" />
                  </div>
                  <div>
                    <p className="text-4xl font-black tracking-tighter" data-testid="brief-count-fires">{data.counters.fires}</p>
                    <p className="text-sm font-semibold mt-0.5">Fires to put out today</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-sm font-semibold shrink-0">
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
                    className="rounded-lg border border-hairline bg-surface p-6 shadow-hover text-left transition-all hover:-translate-y-0.5 focus:outline-none">
                    <div className="flex items-center justify-between">
                      <div className={`w-11 h-11 flex items-center justify-center border border-hairline ${r.bg} ${r.on} rounded-md`}>
                        <r.icon size={22} weight="bold" />
                      </div>
                      <CaretRight size={18} weight="bold" className="text-text-tertiary" />
                    </div>
                    <p className={` text-5xl font-black tracking-tighter mt-4 ${r.accent}`} data-testid={`brief-count-${r.key}`}>{val}</p>
                    <p className="text-sm text-text-secondary mt-1 leading-tight">{label}</p>
                    {r.money && (data.finance_amounts?.[r.key] ?? 0) > 0 && (
                      <p className={`text-sm font-bold mt-1 ${r.accent}`} data-testid={`brief-amount-${r.key}`}>{money(data.finance_amounts[r.key], tenant?.currency)}</p>
                    )}
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-text">
                      View details <CaretRight size={12} weight="bold" />
                    </span>
                  </button>
                );
              })}
            </div>

            <p className="mt-8 text-sm text-text-secondary italic flex items-center gap-2">
              <ArrowClockwise size={14} /> Auto-refreshes every 30s.{isOwner ? " That's it. Exactly like a CEO." : ""}
            </p>
          </div>
        )}
      </div>

      <DetailDialog row={activeRow} period={period} open={!!activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

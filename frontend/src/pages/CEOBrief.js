import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip, PageHeader, SegmentedControl, StatTile, EmptyState, Skeleton } from "../components/common";
import { money } from "../lib/format";
import { cn } from "../lib/utils";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import {
  Clock, CheckCircle, Stamp, UserMinus, Warning, CurrencyInr, XCircle, ArrowClockwise,
  CaretRight, Fire, BookOpen, ListChecks, WarningCircle, ArrowBendUpRight, Sparkle,
  Paperclip, Gauge, Receipt, HandCoins, Coins,
} from "@phosphor-icons/react";

const PERIODS = [
  { value: "morning", label: "Morning", testid: "brief-period-morning" },
  { value: "evening", label: "Evening", testid: "brief-period-evening" },
  { value: "weekly", label: "Weekly", testid: "brief-period-weekly" },
  { value: "monthly", label: "Monthly", testid: "brief-period-monthly" },
];

/**
 * Each counter carries a semantic tone rather than an arbitrary colour. The old
 * grid used nine unrelated hues (teal, rose, indigo, purple…) which made every
 * tile shout equally loudly; tones now encode urgency, so the eye lands on what
 * is actually on fire.
 */
const ROWS = [
  { key: "delayed", label: "delayed tasks", tone: "danger", icon: Clock },
  { key: "completed", label: "completed", tone: "success", icon: CheckCircle },
  { key: "awaiting_approval", label: "waiting for your approval", tone: "warning", icon: Stamp },
  { key: "absent", label: "employees absent", tone: "neutral", icon: UserMinus },
  { key: "complaints", label: "customer complaint(s)", tone: "danger", icon: Warning },
  { key: "payment_overdue", label: "payment(s) overdue", tone: "danger", icon: CurrencyInr },
  { key: "receivables_overdue", label: "overdue receivable(s)", tone: "warning", icon: Receipt, money: true },
  { key: "bills_due", label: "supplier bill(s) to pay", tone: "warning", icon: HandCoins, money: true },
  { key: "unmatched_payments", label: "payment(s) to match", tone: "primary", icon: Coins, money: true },
];

const EMP_ROWS = [
  { key: "delayed", label: "overdue tasks", tone: "danger", icon: Clock },
  { key: "in_progress", label: "in progress", tone: "primary", icon: ArrowClockwise },
  { key: "todo", label: "to do", tone: "neutral", icon: ListChecks },
  { key: "completed", label: "completed", tone: "success", icon: CheckCircle },
  { key: "escalations", label: "escalated to you", tone: "danger", icon: WarningCircle },
  { key: "handoffs", label: "handed to you", tone: "warning", icon: ArrowBendUpRight },
];

const FIRES = { key: "fires", label: "fires to put out today", tone: "danger", icon: Fire };

const ACCENT = {
  neutral: "text-foreground",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

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
      <DialogContent
        className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-xl border-border"
        data-testid={`brief-detail-dialog-${key}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-heading">
            {row?.icon && (
              <span className={cn("shrink-0", ACCENT[row.tone])}>
                <row.icon size={20} weight="bold" />
              </span>
            )}
            <span className="capitalize">{row?.label}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Details for {row?.label}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border p-4">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="mt-2.5 h-3 w-3/5" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid={`brief-detail-empty-${key}`}>
            Nothing here right now. All clear.
          </p>
        ) : (
          <div className="mt-1 space-y-2.5">
            {items.map((it) => {
              const clickable = !!NAV[it.kind];
              return (
                <div
                  key={it.id}
                  data-testid={`brief-detail-item-${it.id}`}
                  onClick={() => clickable && go(it)}
                  className={cn(
                    "rounded-lg border border-border bg-card p-4",
                    "transition-[background-color,border-color] duration-200",
                    clickable && "cursor-pointer hover:border-border-strong hover:bg-accent"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-snug">{it.title}</p>
                      {it.subtitle && <p className="mt-1 text-sm text-muted-foreground">{it.subtitle}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {it.kind === "task" && it.meta && <Chip value={it.meta} />}
                      {it.kind === "escalation" && it.meta && <Chip value={it.meta} tone="danger" />}
                      {it.kind === "complaint" && it.meta && <Chip value={it.meta} tone="warning" />}
                      {(it.kind === "purchase" || it.kind === "payment" || it.kind === "receivable" || it.kind === "bill" || it.kind === "unmatched") && it.meta != null && (
                        <span data-numeric className="text-sm font-semibold">{money(it.meta, tenant?.currency)}</span>
                      )}
                      {clickable && <CaretRight size={15} weight="bold" className="text-muted-foreground" />}
                    </div>
                  </div>

                  {Array.isArray(it.proof) && it.proof.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3" data-testid={`brief-proof-${it.id}`} onClick={(e) => e.stopPropagation()}>
                      <p className="label-mono mb-2 flex items-center gap-1 text-muted-foreground">
                        <Paperclip size={12} weight="bold" /> Proof of work · {it.proof.length}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {it.proof.map((a, idx) =>
                          a.kind === "photo" ? (
                            <a key={a.url || idx} href={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} target="_blank" rel="noreferrer" data-testid={`brief-proof-photo-${it.id}-${idx}`}>
                              <img
                                src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`}
                                alt="Proof of work"
                                className="h-16 w-16 rounded-lg border border-border object-cover transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                              />
                            </a>
                          ) : (
                            <audio key={a.url || idx} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`brief-proof-voice-${it.id}-${idx}`} />
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {it.kind === "decision" && (
                    <>
                      {it.meta && <p className="label-mono mt-2 text-muted-foreground">{it.meta}</p>}
                      {user?.role === "owner" && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); decide(it.id, "approve"); }}
                            data-testid={`brief-approve-${it.id}`}
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,transform] duration-200 hover:bg-primary-emphasis active:scale-[0.98]"
                          >
                            <CheckCircle size={16} weight="bold" /> Approve
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); decide(it.id, "reject"); }}
                            data-testid={`brief-reject-${it.id}`}
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                          >
                            <XCircle size={16} weight="bold" /> Reject
                          </button>
                          <button
                            onClick={() => go(it)}
                            data-testid={`brief-open-${it.id}`}
                            title="Open in the Decision Desk to assign a team"
                            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-foreground"
                          >
                            Assign <CaretRight size={14} weight="bold" />
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {it.kind === "complaint" && (user?.role === "owner" || user?.role === "sales") && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resolveComplaint(it.id); }}
                      data-testid={`brief-resolve-${it.id}`}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
                    >
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

  const fires = data?.counters?.fires || 0;
  // "Nothing needs you" is a real, reachable state for this screen — it deserves
  // to be said plainly rather than rendered as a wall of zeroes.
  const allClear = data && rows.every((r) => (data.counters[r.key] ?? 0) === 0) && fires === 0;

  const secondaryAction = isOwner ? (
    <>
      <button
        onClick={() => navigate("/operating-score")}
        data-testid="brief-operating-score"
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
      >
        <Gauge size={16} weight="bold" /> Operating Score
      </button>
      <button
        onClick={() => navigate("/journal")}
        data-testid="brief-open-journal"
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
      >
        <BookOpen size={16} weight="bold" /> CEO Journal
      </button>
    </>
  ) : (
    <button
      onClick={() => navigate("/coach")}
      data-testid="brief-open-coach"
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium shadow-xs transition-[background-color,border-color,transform] duration-200 hover:border-border-strong hover:bg-accent active:scale-[0.98]"
    >
      <Sparkle size={16} weight="bold" /> AI Coach
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={isOwner ? "Your company, right now" : "Your day, right now"}
        title="CEO Brief"
        description={
          isOwner
            ? "Everything competing for your attention, counted and ranked. Open any tile to act on it."
            : "What's on you today — and what's been sent your way."
        }
      >
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center" data-testid="brief-controls">
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            testid="brief-periods"
            className="w-full sm:w-auto"
          />
          <div className="flex flex-wrap items-center gap-2">{secondaryAction}</div>
        </div>
      </PageHeader>

      {isLoading || !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3" data-testid="brief-loading">
          {rows.map((r) => (
            <div key={r.key} className="surface-card p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-8 w-14" />
              <Skeleton className="mt-3 h-3 w-32" />
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="ceo-brief-card">
          {/* Fires are the only thing allowed to interrupt the grid. */}
          {isOwner && fires > 0 && (
            <button
              type="button"
              onClick={() => setActiveRow(FIRES)}
              data-testid="brief-row-fires"
              className={cn(
                "mb-6 flex w-full items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive-subtle p-5 text-left",
                "transition-[transform,border-color,box-shadow] duration-200",
                "hover:-translate-y-0.5 hover:border-destructive/50 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-2"
              )}
            >
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground">
                  <Fire size={24} weight="fill" />
                </span>
                <span>
                  <span
                    data-numeric
                    data-testid="brief-count-fires"
                    className="block text-[2.25rem] font-semibold leading-none tracking-tight text-destructive"
                  >
                    {fires}
                  </span>
                  <span className="mt-1.5 block text-sm font-medium text-destructive/90">
                    Fires to put out today
                  </span>
                </span>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-destructive">
                Handle now <CaretRight size={15} weight="bold" />
              </span>
            </button>
          )}

          {allClear ? (
            <EmptyState
              icon={CheckCircle}
              title="Nothing needs you right now"
              hint="No delays, no approvals waiting, no overdue money. This brief refreshes every 30 seconds."
              data-testid="brief-all-clear"
            />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              {rows.map((r, i) => {
                const val = data.counters[r.key] ?? 0;
                const label = r.key === "completed" ? data.completed_label || "completed" : r.label;
                const amount =
                  r.money && (data.finance_amounts?.[r.key] ?? 0) > 0
                    ? money(data.finance_amounts[r.key], tenant?.currency)
                    : null;
                return (
                  <StatTile
                    key={r.key}
                    label={label}
                    value={val}
                    // Zero is information too — mute it so live numbers carry the eye.
                    tone={val === 0 ? "neutral" : r.tone}
                    icon={r.icon}
                    onClick={() => setActiveRow(r)}
                    data-testid={`brief-row-${r.key}`}
                    valueTestId={`brief-count-${r.key}`}
                    className={cn("es-reveal", val === 0 && "opacity-70")}
                    style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                    hint={
                      amount ? (
                        <span data-testid={`brief-amount-${r.key}`} data-numeric className={cn("font-medium", ACCENT[r.tone])}>
                          {amount}
                        </span>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}

          <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
            <ArrowClockwise size={13} aria-hidden="true" /> Auto-refreshes every 30 seconds.
          </p>
        </div>
      )}

      <DetailDialog row={activeRow} period={period} open={!!activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

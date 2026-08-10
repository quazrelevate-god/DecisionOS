import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Clock, CircleCheck, Stamp, UserMinus, TriangleAlert, IndianRupee, Receipt,
  HandCoins, Coins, Flame, ListChecks, RefreshCw, CircleAlert, CornerUpRight,
  BookOpen, Gauge, Sparkles, ChevronRight, Paperclip, X,
} from "lucide-react";

import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Skeleton } from "../components/common";
import {
  AccentCard, CardRail, SectionHead, SelectChip, Row, IconTile, Bars,
} from "../components/studio";
import { ResponsiveSheet } from "../components/ResponsiveSheet";
import { useSwipe } from "../lib/gestures";
import { money } from "../lib/format";
import { cn } from "../lib/utils";

const PERIODS = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/* Each counter maps to an accent from the reference palette rather than an
   arbitrary hue. Red is reserved for things that are genuinely late. */
const ROWS = [
  { key: "delayed", label: "Delayed tasks", accent: "butter", icon: Clock, urgent: true },
  { key: "completed", label: "Completed", accent: "sage", icon: CircleCheck },
  { key: "awaiting_approval", label: "Awaiting you", accent: "peri", icon: Stamp },
  { key: "absent", label: "Absent today", accent: "sage", icon: UserMinus },
  { key: "complaints", label: "Complaints", accent: "butter", icon: TriangleAlert, urgent: true },
  { key: "payment_overdue", label: "Payments overdue", accent: "peri", icon: IndianRupee, urgent: true },
  { key: "receivables_overdue", label: "Receivables overdue", accent: "butter", icon: Receipt, money: true, urgent: true },
  { key: "bills_due", label: "Bills to pay", accent: "peri", icon: HandCoins, money: true },
  { key: "unmatched_payments", label: "Payments to match", accent: "sage", icon: Coins, money: true },
];

const EMP_ROWS = [
  { key: "delayed", label: "Overdue tasks", accent: "butter", icon: Clock, urgent: true },
  { key: "in_progress", label: "In progress", accent: "peri", icon: RefreshCw },
  { key: "todo", label: "To do", accent: "sage", icon: ListChecks },
  { key: "completed", label: "Completed", accent: "sage", icon: CircleCheck },
  { key: "escalations", label: "Escalated to you", accent: "butter", icon: CircleAlert, urgent: true },
  { key: "handoffs", label: "Handed to you", accent: "peri", icon: CornerUpRight },
];

const FIRES = { key: "fires", label: "Fires to put out", accent: "butter", icon: Flame, urgent: true };

const compact = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));

/* -------------------------------------------------------------------------- */

function DetailSheet({ row, period, open, onClose }) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = row?.key;
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["brief-details", key, period],
    queryFn: () => api.get(`/brief/details?key=${key}&period=${period}`).then((r) => r.data),
    enabled: open && !!key,
  });

  const after = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["brief"] });
  };
  const decide = async (id, action) => {
    try {
      await api.post(`/decisions/${id}/${action}`);
      toast.success(action === "approve" ? "Approved — tasks unblocked" : "Rejected");
      after();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };
  const resolveComplaint = async (id) => {
    try {
      await api.patch(`/complaints/${id}/resolve`);
      toast.success("Complaint resolved");
      after();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  const items = data?.items || [];
  const NAV = {
    decision: (it) => `/?focus=approval:${it.id}`,
    escalation: (it) => `/?focus=attention:${it.id}`,
    purchase: (it) => `/my-work?view=workflows&wf=${it.id}`,
    payment: (it) => `/my-work?view=workflows&wf=${it.id}`,
    task: (it) => `/my-work?task=${it.id}`,
    complaint: (it) => (it.customer_id ? `/contacts/${it.customer_id}` : "/contacts"),
    absent: () => "/contacts",
    activity: () => "/my-work",
    leave: () => "/my-work?view=leave",
    receivable: () => "/ledger?tab=revenue",
    bill: () => "/ledger?tab=expenses",
    unmatched: (it) => (it.direction === "out" ? "/ledger?tab=expenses" : "/ledger?tab=revenue"),
  };
  const go = (it) => {
    const fn = NAV[it.kind];
    if (!fn) return;
    onClose();
    navigate(fn(it));
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      testid={`brief-detail-dialog-${key}`}
      title={row?.label}
      description={`Details for ${row?.label}`}
      icon={row?.icon ? <IconTile icon={row.icon} accent={row.accent} size="sm" /> : null}
    >
      {isLoading ? (
        <div className="space-y-3 py-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl bg-muted/60 p-4">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2.5 h-3 w-3/5" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid={`brief-detail-empty-${key}`}>
          Nothing here right now. All clear.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {items.map((it) => {
            const clickable = !!NAV[it.kind];
            const isMoney = ["purchase", "payment", "receivable", "bill", "unmatched"].includes(it.kind);
            return (
              <div key={it.id} data-testid={`brief-detail-item-${it.id}`} className="py-1">
                <Row
                  onClick={clickable ? () => go(it) : undefined}
                  leading={<IconTile icon={row?.icon || Clock} accent={row?.accent || "peri"} size="sm" />}
                  title={it.title}
                  subtitle={it.subtitle}
                  amount={isMoney && it.meta != null ? money(it.meta, tenant?.currency) : undefined}
                  amountTone={isMoney ? "negative" : "default"}
                  trailing={
                    clickable && !isMoney ? (
                      <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                    ) : null
                  }
                />

                {Array.isArray(it.proof) && it.proof.length > 0 && (
                  <div className="pb-3 pl-11" data-testid={`brief-proof-${it.id}`}>
                    <p className="mb-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Paperclip size={11} strokeWidth={2} /> Proof · {it.proof.length}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {it.proof.map((a, idx) =>
                        a.kind === "photo" ? (
                          <a key={a.url || idx} href={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} target="_blank" rel="noreferrer" data-testid={`brief-proof-photo-${it.id}-${idx}`}>
                            <img src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="Proof of work" className="h-14 w-14 rounded-xl object-cover" />
                          </a>
                        ) : (
                          <audio key={a.url || idx} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`brief-proof-voice-${it.id}-${idx}`} />
                        )
                      )}
                    </div>
                  </div>
                )}

                {it.kind === "decision" && user?.role === "owner" && (
                  <div className="flex gap-2 pb-3 pl-11">
                    <button
                      onClick={() => decide(it.id, "approve")}
                      data-testid={`brief-approve-${it.id}`}
                      className="flex-1 rounded-full bg-ink px-4 py-2.5 text-xs font-bold text-ink-foreground transition-transform duration-200 active:scale-[0.97]"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => decide(it.id, "reject")}
                      data-testid={`brief-reject-${it.id}`}
                      className="rounded-full border border-border px-4 py-2.5 text-xs font-bold transition-colors duration-200 hover:bg-accent"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => go(it)}
                      data-testid={`brief-open-${it.id}`}
                      className="rounded-full px-3 py-2.5 text-xs font-bold text-muted-foreground transition-colors duration-200 hover:text-foreground"
                    >
                      Assign
                    </button>
                  </div>
                )}

                {it.kind === "complaint" && (user?.role === "owner" || user?.role === "sales") && (
                  <div className="pb-3 pl-11">
                    <button
                      onClick={() => resolveComplaint(it.id)}
                      data-testid={`brief-resolve-${it.id}`}
                      className="rounded-full bg-sage px-4 py-2 text-xs font-bold text-sage-foreground transition-transform duration-200 active:scale-[0.97]"
                    >
                      Mark resolved
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ResponsiveSheet>
  );
}

/* -------------------------------------------------------------------------- */

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

  const stepPeriod = useCallback((dir) => {
    setPeriod((p) => {
      const i = PERIODS.findIndex((x) => x.value === p);
      return PERIODS[i + dir]?.value ?? p;
    });
  }, []);
  const periodSwipe = useSwipe({ onLeft: () => stepPeriod(1), onRight: () => stepPeriod(-1) });

  const counters = data?.counters || {};
  const fires = counters.fires || 0;

  // Hero rail: the three figures worth a full tinted card, biggest first.
  const heroes = useMemo(() => {
    const pick = rows.filter((r) => (counters[r.key] ?? 0) > 0).slice(0, 3);
    const base = pick.length ? pick : rows.slice(0, 3);
    return base.map((r, i) => ({
      ...r,
      accent: ["butter", "peri", "sage"][i % 3],
      count: counters[r.key] ?? 0,
    }));
  }, [rows, counters]);

  // Weekly workload — the reference's bar chart, driven by whatever the brief
  // reports rather than invented numbers.
  const bars = useMemo(
    () =>
      rows.slice(0, 7).map((r) => ({
        label: r.label.split(" ")[0].slice(0, 3),
        value: counters[r.key] ?? 0,
        row: r,
      })),
    [rows, counters]
  );

  const secondary = rows.filter((r) => !heroes.some((h) => h.key === r.key));

  return (
    <div className="mx-auto max-w-3xl pb-4">
      {/* Greeting + period */}
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">
            {isOwner ? "Your company, right now" : "Your day, right now"}
          </p>
          <h1 className="mt-1 truncate text-[26px] font-extrabold tracking-tight">CEO Brief</h1>
        </div>
        <SelectChip onClick={() => stepPeriod(1)} data-testid="brief-periods">
          {PERIODS.find((p) => p.value === period)?.label}
        </SelectChip>
      </div>

      <div key={period} {...periodSwipe} className="animate-fade-in" style={{ touchAction: "pan-y" }}>
        {/* Hero rail */}
        {isLoading || !data ? (
          <div className="mb-6 flex gap-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-36 w-[78%] shrink-0 rounded-2xl" />
            ))}
          </div>
        ) : (
          <CardRail className="mb-6" data-testid="brief-hero-rail">
            {fires > 0 && isOwner && (
              <AccentCard
                label="Fires to put out"
                value={fires}
                icon={Flame}
                accent="butter"
                spark={[3, 5, 4, 7, 6, 9, fires || 4]}
                onClick={() => setActiveRow(FIRES)}
                data-testid="brief-row-fires"
                className="w-[78%] shrink-0 snap-start sm:w-[46%]"
              />
            )}
            {heroes.map((h) => (
              <AccentCard
                key={h.key}
                label={h.label}
                value={h.count}
                delta={h.money && data.finance_amounts?.[h.key] ? money(data.finance_amounts[h.key], tenant?.currency) : undefined}
                icon={h.icon}
                accent={h.accent}
                spark={[2, 6, 4, 8, 5, 9, Math.max(h.count, 1)]}
                onClick={() => setActiveRow(h)}
                data-testid={`brief-row-${h.key}`}
                className="w-[78%] shrink-0 snap-start sm:w-[46%]"
              />
            ))}
          </CardRail>
        )}

        {/* Load across the brief — bar chart with the black tooltip pill */}
        <div className="mb-7">
          <div className="mb-1 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Open items by area</p>
              <p data-numeric className="mt-1 text-[28px] font-extrabold tracking-tight">
                {rows.reduce((n, r) => n + (counters[r.key] ?? 0), 0)}
              </p>
            </div>
            <button
              onClick={() => navigate(isOwner ? "/operating-score" : "/coach")}
              className="text-xs font-semibold text-muted-foreground transition-colors duration-200 hover:text-foreground"
            >
              See all
            </button>
          </div>
          {isLoading ? (
            <Skeleton className="h-[150px] w-full rounded-2xl" />
          ) : (
            <Bars data={bars} format={compact} onSelect={(_, d) => setActiveRow(d.row)} />
          )}
        </div>

        {/* Everything else as rows */}
        <SectionHead title="Needs a look" />
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
          </div>
        ) : (
          <div className="divide-y divide-border rounded-3xl bg-card px-4 shadow-sm" data-testid="ceo-brief-card">
            {secondary.map((r) => {
              const val = counters[r.key] ?? 0;
              const amt = r.money && (data.finance_amounts?.[r.key] ?? 0) > 0
                ? money(data.finance_amounts[r.key], tenant?.currency)
                : null;
              return (
                <Row
                  key={r.key}
                  onClick={() => setActiveRow(r)}
                  data-testid={`brief-row-${r.key}`}
                  leading={<IconTile icon={r.icon} accent={r.accent} />}
                  title={r.label}
                  subtitle={amt || (val === 0 ? "All clear" : undefined)}
                  amount={val}
                  amountTone={val > 0 && r.urgent ? "negative" : "default"}
                  className={cn(val === 0 && "opacity-55")}
                />
              );
            })}
          </div>
        )}

        {/* Shortcuts */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          {isOwner ? (
            <>
              <button
                onClick={() => navigate("/operating-score")}
                data-testid="brief-operating-score"
                className="flex items-center gap-2.5 rounded-2xl bg-card p-4 text-left shadow-sm transition-transform duration-200 active:scale-[0.98]"
              >
                <IconTile icon={Gauge} accent="peri" size="sm" />
                <span className="text-sm font-bold">Operating Score</span>
              </button>
              <button
                onClick={() => navigate("/journal")}
                data-testid="brief-open-journal"
                className="flex items-center gap-2.5 rounded-2xl bg-card p-4 text-left shadow-sm transition-transform duration-200 active:scale-[0.98]"
              >
                <IconTile icon={BookOpen} accent="sage" size="sm" />
                <span className="text-sm font-bold">CEO Journal</span>
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate("/coach")}
              data-testid="brief-open-coach"
              className="col-span-2 flex items-center gap-2.5 rounded-2xl bg-card p-4 text-left shadow-sm transition-transform duration-200 active:scale-[0.98]"
            >
              <IconTile icon={Sparkles} accent="peri" size="sm" />
              <span className="text-sm font-bold">AI Coach</span>
            </button>
          )}
        </div>

        <p className="mt-5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <RefreshCw size={11} strokeWidth={2} /> Auto-refreshes every 30 seconds · swipe to change period
        </p>
      </div>

      <DetailSheet row={activeRow} period={period} open={!!activeRow} onClose={() => setActiveRow(null)} />
    </div>
  );
}

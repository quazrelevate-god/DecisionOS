// Epic 2 Sprint 2 (E2-16 / E2-18 / E2-19 / E2-22) — Decision Desk redesign.
//
// Founder mocks 2026-08-14:
//   - Header: "Decision Desk" + counter subline
//     ("6 decisions waiting on you · 8 on fire · 3 due today")
//   - Four mutually-exclusive chips:
//     Needs Your Decision · On Fire · Due Today · Important
//   - Card grid per chip (title · context line · amount · primary CTA).
//
// Founder ask 2026-08-13 (revised): "we will have the approval of decision
// option here alone" -> the Desk stops being a mixed activity feed.
// Founder confirmation 2026-08-14: keep CAPTURE on the Desk (recording a
// decision is Desk-native). CAPTURE is a compact bar at the top; the
// 4 chips + card grid dominate the page.
//
// Data source: single GET /api/desk?chip=<chip> aggregation endpoint
// (E2-17) — counters + cards in one call.
// Nudge/Chase actions: POST /api/desk/nudge/{item_id} (E2-22).
//
// The old Inbox.js is left orphaned in the tree for one commit so
// nothing breaks in the interim; a follow-up will delete it.

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { toast } from "sonner";
import { SkeletonCard, DexBadge } from "../components/common";
import { DecisionDialog } from "../components/DecisionDialog";
import { useIsMobile } from "../hooks/useIsMobile";
import DeskMobile from "./mobile/DeskMobile";
import {
  Fire, Sun, Star, CheckCircle, ArrowClockwise, Spinner,
  // Epic 2 Sprint 6 (E2-43..E2-45): Desk absorbs CEO Brief header
  Sparkle, TrendUp, TrendDown, Minus, ChartBar, BookOpen, Gauge, UsersFour,
  ChatCircleText, CurrencyInr, Warning as WarningIcon,
  // Epic 2 Sprint 6.5 (E2-51): Delayed-tasks row on Trends card
  Clock,
} from "@phosphor-icons/react";
import { useAuth } from "../context/AuthContext";

// Epic 2 Sprint 5 (E2-33/E2-34): Desk CaptureBar retired. Voice + text +
// file capture now lives on /brain (Dex) at the top of every sub-tab.
// Founder ask 2026-08-14: 'remove the ai from the desk button and
// integrate with brain, make it single AI name.'
//
// Epic 2 Sprint 6 (E2-43..E2-47): CEO Brief merged INTO Desk. New top
// section shows Greeting + Dex narrative bubble + Trends card +
// Shortcuts card. Old /brief page redirects to /inbox. Bottom-nav
// 'Brief' slot retired (5 -> 4 slots). Founder ask 2026-08-14 after
// audit: 'in the decision desk itself at top we will have a section
// CEO brief'. Backend feeds via GET /api/desk/summary.


// -----------------------------------------------------------------------------
// Epic 2 Sprint 6 (E2-43): Greeting + Dex narrative bubble.
// Renders as the first thing on Desk. Template-generated narrative
// today; upgrade to LLM-generated in E2-48 (Backlog).
// -----------------------------------------------------------------------------
function DeskBriefHeader() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";

  const { data, isLoading } = useQuery({
    queryKey: ["desk-summary"],
    queryFn: () => api.get("/desk/summary").then((r) => r.data),
    refetchInterval: 60000,
  });

  if (isLoading || !data) {
    return (
      <div className="mb-6">
        <div className="h-8 w-64 bg-black/5 mb-2 animate-pulse" />
        <div className="h-16 bg-black/5 animate-pulse" />
      </div>
    );
  }

  const trends = data.trends || {};
  const wc = trends.weekly_completion_rate || {};
  const comp = trends.complaints_trend || {};
  const cash = trends.cash_flow || {};

  const dirIcon = (d) => d === "up" ? TrendUp : d === "down" ? TrendDown : Minus;
  const dirColor = (d, positiveIsUp = true) => {
    if (d === "up") return positiveIsUp ? "text-green-600" : "text-brand-600";
    if (d === "down") return positiveIsUp ? "text-brand-600" : "text-green-600";
    return "text-muted-foreground";
  };

  const WC_ICON = dirIcon(wc.direction);
  const CO_ICON = dirIcon(comp.direction);
  const CF_ICON = dirIcon(cash.direction);

  return (
    <div className="mb-8" data-testid="desk-brief-header">
      {/* Greeting */}
      <h2 className="font-heading text-2xl font-black tracking-tighter mb-3" data-testid="desk-brief-greeting">
        {data.greeting}.
      </h2>

      {/* Dex narrative bubble */}
      <div
        data-testid="desk-brief-narrative"
        className="border border-black bg-white p-4 mb-4 shadow-brutal-sm flex gap-3"
      >
        <div className="w-9 h-9 shrink-0 flex items-center justify-center bg-brand-ink text-white">
          <Sparkle size={18} weight="bold" />
        </div>
        <div className="flex-1">
          <p className="label-mono text-muted-foreground text-[10px] mb-1">DEX →</p>
          <p className="text-sm leading-relaxed">{data.narrative}</p>
        </div>
      </div>

      {/* Trends + Shortcuts side-by-side (stack on mobile) */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Trends card — Epic 2 Sprint 6.5 (E2-51/52): rows are click-through.
            Weekly completion  -> /my-work?filter=completed
            Complaints         -> /crm?complaint=open  (CRM 'With Complaints' chip)
            Cash-flow          -> /finance?tab=revenue if overdue receivables,
                                  else /finance?tab=inbox if unmatched,
                                  else /finance?tab=overview. */}
        <div className="border border-black bg-white p-4" data-testid="desk-brief-trends">
          <p className="label-mono text-muted-foreground text-[10px] mb-3 flex items-center gap-1">
            <ChartBar size={12} weight="bold" /> TRENDS
          </p>
          <div className="space-y-1">
            {/* Delayed tasks — Epic 2 Sprint 6.5 (E2-51): most urgent, at top.
                Founder ask 2026-08-15: 'compalanits, delayed task how we plan
                to show them, redirecting to task section and crm section right'. */}
            <button
              type="button"
              data-testid="desk-trend-delayed"
              onClick={() => navigate("/my-work?filter=overdue")}
              className="w-full flex items-center justify-between text-sm p-2 -mx-2 rounded hover:bg-black/5 transition-colors text-left"
              title="See overdue tasks"
            >
              <span className="flex items-center gap-2">
                <Clock size={14} weight="bold" className="text-muted-foreground" />
                Delayed tasks
              </span>
              <span className={`flex items-center gap-1 font-mono font-bold ${(data.counters?.delayed || 0) > 0 ? "text-brand-600" : "text-green-600"}`}>
                {(data.counters?.delayed || 0) > 0
                  ? <TrendUp size={12} weight="bold" />
                  : <Minus size={12} weight="bold" />}
                {data.counters?.delayed ?? 0}
              </span>
            </button>
            {/* Weekly completion */}
            <button
              type="button"
              data-testid="desk-trend-completion"
              onClick={() => navigate("/my-work?filter=completed")}
              className="w-full flex items-center justify-between text-sm p-2 -mx-2 rounded hover:bg-black/5 transition-colors text-left"
              title="See completed tasks"
            >
              <span className="flex items-center gap-2">
                <CheckCircle size={14} weight="bold" className="text-muted-foreground" />
                Weekly completion
              </span>
              <span className={`flex items-center gap-1 font-mono font-bold ${dirColor(wc.direction)}`}>
                <WC_ICON size={12} weight="bold" />
                {wc.value ?? 0}
                {typeof wc.delta_pct === "number" && wc.delta_pct !== 0 && (
                  <span className="text-[10px] opacity-70">
                    ({wc.delta_pct > 0 ? "+" : ""}{wc.delta_pct}%)
                  </span>
                )}
              </span>
            </button>
            {/* Complaints */}
            <button
              type="button"
              data-testid="desk-trend-complaints"
              onClick={() => navigate("/crm?complaint=open")}
              className="w-full flex items-center justify-between text-sm p-2 -mx-2 rounded hover:bg-black/5 transition-colors text-left"
              title="See customers with open complaints"
            >
              <span className="flex items-center gap-2">
                <ChatCircleText size={14} weight="bold" className="text-muted-foreground" />
                Complaints
              </span>
              <span className={`flex items-center gap-1 font-mono font-bold ${dirColor(comp.direction, false)}`}>
                <CO_ICON size={12} weight="bold" />
                {comp.value ?? 0}
                {typeof comp.new_7d === "number" && comp.new_7d > 0 && (
                  <span className="text-[10px] opacity-70">(+{comp.new_7d} 7d)</span>
                )}
              </span>
            </button>
            {/* Cash-flow */}
            <button
              type="button"
              data-testid="desk-trend-cashflow"
              onClick={() => {
                const dest = (cash.overdue_receivables_amount || 0) > 0
                  ? "/finance?tab=revenue"
                  : (cash.unmatched_payments || 0) > 0
                    ? "/finance?tab=inbox"
                    : "/finance?tab=overview";
                navigate(dest);
              }}
              className="w-full flex items-center justify-between text-sm p-2 -mx-2 rounded hover:bg-black/5 transition-colors text-left"
              title="Open Finance"
            >
              <span className="flex items-center gap-2">
                <CurrencyInr size={14} weight="bold" className="text-muted-foreground" />
                Cash-flow
              </span>
              <span className={`flex items-center gap-1 font-mono font-bold ${cash.clear ? "text-green-600" : "text-brand-600"}`}>
                <CF_ICON size={12} weight="bold" />
                {cash.clear ? "All clear" : "Attention"}
              </span>
            </button>
          </div>
        </div>

        {/* Shortcuts card */}
        <div className="border border-black bg-white p-4" data-testid="desk-brief-shortcuts">
          <p className="label-mono text-muted-foreground text-[10px] mb-3">SHORTCUTS</p>
          <div className="space-y-2">
            {isOwner && (
              <button
                data-testid="desk-shortcut-journal"
                onClick={() => navigate("/journal")}
                className="w-full flex items-center gap-2 border border-black bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors"
              >
                <BookOpen size={14} weight="bold" /> CEO Journal
              </button>
            )}
            {isOwner && (
              <button
                data-testid="desk-shortcut-ops"
                onClick={() => navigate("/operating-score")}
                className="w-full flex items-center gap-2 border border-black bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors"
              >
                <Gauge size={14} weight="bold" /> Ops health
              </button>
            )}
            {isOwner && (
              <button
                data-testid="desk-shortcut-team"
                onClick={() => navigate("/operating-score")}
                className="w-full flex items-center gap-2 border border-black bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors"
              >
                <UsersFour size={14} weight="bold" /> Team leaderboard
              </button>
            )}
            {!isOwner && (
              <button
                data-testid="desk-shortcut-coach"
                onClick={() => navigate("/coach")}
                className="w-full flex items-center gap-2 border border-black bg-white px-3 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors"
              >
                <Sparkle size={14} weight="bold" /> AI Coach
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// -----------------------------------------------------------------------------
// One card in the chip's list
// -----------------------------------------------------------------------------
function DeskCard({ card, onAction }) {
  const [busy, setBusy] = useState(false);

  const ctaLabel = {
    review: "Review →",
    respond: "Respond",
    chase: "Chase",
    nudge: "Nudge",
  }[card.cta] || "Open";

  const ctaStyle = {
    review: "bg-brand-ink text-white hover:shadow-brutal-sm",
    respond: "border border-black bg-white hover:bg-brand-600 hover:text-white",
    chase: "border border-black bg-white hover:bg-brand-600 hover:text-white",
    nudge: "border border-black bg-white hover:bg-brand-yellow",
  }[card.cta] || "border border-black bg-white";

  const doAction = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await onAction(card);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid={`desk-card-${card.id}`}
      className="flex items-center justify-between gap-4 p-4 border border-black bg-white hover:shadow-brutal-sm transition-all"
    >
      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base leading-tight truncate">{card.title}</p>
        <p className="text-xs text-muted-foreground font-mono mt-1">{card.context_line}</p>
      </div>
      {card.amount_formatted && (
        <p className="font-mono font-bold text-sm shrink-0">{card.amount_formatted}</p>
      )}
      <button
        data-testid={`desk-cta-${card.cta}-${card.id}`}
        onClick={doAction}
        disabled={busy}
        className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider shrink-0 disabled:opacity-50 transition-all ${ctaStyle}`}
      >
        {busy ? <Spinner size={12} className="animate-spin" /> : ctaLabel}
      </button>
    </div>
  );
}


// -----------------------------------------------------------------------------
// Main Desk page
// -----------------------------------------------------------------------------
const CHIPS = [
  { key: "needs_decision", label: "Needs Your Decision", icon: null },
  { key: "on_fire", label: "On Fire", icon: Fire },
  { key: "due_today", label: "Due Today", icon: Sun },
  { key: "important", label: "Important", icon: Star },
];

export default function Desk() {
  // MPWA-06: below lg this screen is rebuilt (§8). Above lg the original tree
  // renders byte-for-byte unchanged, which is how §9.2's empty desktop diff is
  // guaranteed structurally rather than re-verified on every edit.
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [chip, setChip] = useState("needs_decision");
  const [openDecision, setOpenDecision] = useState(null); // decision id for the DecisionDialog

  // E2-66 (2026-08-15): support deep-link from a decision-focused nudge
  // notification. `/inbox?decision=<id>` -> flip to needs_decision chip,
  // then when its cards land -> auto-open the DecisionDialog for that id.
  const [searchParams] = useSearchParams();
  const focusDecisionId = searchParams.get("decision");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["desk", chip],
    queryFn: () => api.get(`/desk?chip=${chip}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  // E2-66: when a ?decision=<id> deep-link lands, force the chip to
  // needs_decision AND auto-open the DecisionDialog for that id once
  // the cards load. Only fires the first time the id is seen so a
  // subsequent chip click doesn't yank the user back.
  useEffect(() => {
    if (focusDecisionId) {
      setChip("needs_decision");
    }
  }, [focusDecisionId]);
  useEffect(() => {
    if (!focusDecisionId || !data?.cards) return;
    const match = data.cards.find(
      (c) => c.target_id === focusDecisionId && c.target_kind === "decision");
    if (match) setOpenDecision(focusDecisionId);
  }, [focusDecisionId, data?.cards]);

  const counters = data?.counters || { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 };
  const cards = data?.cards || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  const onCardAction = async (card) => {
    if (card.cta === "review" && card.target_kind === "decision") {
      setOpenDecision(card.target_id);
      return;
    }
    if (card.cta === "respond") {
      // Task-level respond: jump to MyWork with the task focused so the
      // founder can reply from the full task detail (which has the trail
      // + attachments + full context).
      navigate(`/my-work?task=${card.target_id}`);
      return;
    }
    if (card.cta === "chase" || card.cta === "nudge") {
      try {
        const res = await api.post(`/desk/nudge/${card.target_id}`, {});
        const to = res.data?.target_name || "them";
        toast.success(
          card.cta === "chase"
            ? `Chased ${to} — sent via ${res.data?.channel}`
            : `Nudged ${to} — sent via ${res.data?.channel}`
        );
        refresh();
      } catch (e) {
        toast.error(e.response?.data?.detail || "Nudge failed");
      }
    }
  };

  // Header subline copy — matches the founder mock exactly.
  const subline = [
    `${counters.needs_decision} decision${counters.needs_decision !== 1 ? "s" : ""} waiting on you`,
    `${counters.on_fire} on fire`,
    `${counters.due_today} due today`,
  ].join(" · ");

  if (isMobile) return <DeskMobile />;

  return (
    <div className="max-w-5xl mx-auto">
      {/* Epic 2 Sprint 5 (E2-34): capture bar moved to /brain (Dex).
          Desk is now pure decision viewer.
          Epic 2 Sprint 6 (E2-43..45): CEO Brief absorbed into Desk. */}
      <DeskBriefHeader />

      {/* Header */}
      <div className="mb-4">
        <h1 className="font-heading text-4xl font-black tracking-tighter" data-testid="desk-title">
          Decision Desk
        </h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="desk-subline">
          {subline}
        </p>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-2 mb-6" data-testid="desk-chips">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(c.key)}
            data-testid={`desk-chip-${c.key}`}
            className={`flex items-center gap-2 px-4 py-2 border border-black text-sm font-semibold uppercase tracking-wider transition-colors ${
              chip === c.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"
            }`}
          >
            {c.icon && <c.icon size={14} weight="bold" />}
            {c.label}
            <span
              className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold ${
                chip === c.key ? "bg-white/20 text-white" : "bg-black/10 text-black"
              }`}
            >
              {counters[c.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Card list */}
      {/* E2-14: skeleton cards on first load so the chip strip doesn't
          collapse into a "Loading…" text jump when data lands. */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      )}
      {!isLoading && cards.length === 0 && (
        <div className="border border-black border-dashed bg-white p-10 text-center" data-testid="desk-empty">
          <CheckCircle size={32} weight="bold" className="text-brand-ink mx-auto mb-3" />
          <p className="font-heading font-bold text-lg">Nothing here — you're caught up</p>
          <p className="text-sm text-muted-foreground mt-1">
            {chip === "needs_decision" && "No decisions are waiting on you right now."}
            {chip === "on_fire" && "No escalations, handoffs, or overdue items."}
            {chip === "due_today" && "Nothing you own is due today."}
            {chip === "important" && "Nothing AI-flagged as important right now."}
          </p>
        </div>
      )}
      <div className="space-y-3" data-testid="desk-card-list">
        {cards.map((c) => (
          <DeskCard key={c.id} card={c} onAction={onCardAction} />
        ))}
      </div>

      {/* Refresh spinner */}
      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground font-mono mt-4 flex items-center gap-2">
          <ArrowClockwise size={12} className="animate-spin" /> refreshing…
        </p>
      )}

      {/* Decision review modal */}
      {openDecision && (
        <DecisionDialog
          decisionId={openDecision}
          open={!!openDecision}
          onClose={() => { setOpenDecision(null); refresh(); }}
        />
      )}
    </div>
  );
}

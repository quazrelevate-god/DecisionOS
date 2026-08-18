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
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { FounderBento } from "./desk/FounderBento";
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
      <div className="mb-10">
        <div className="h-10 w-72 bg-muted rounded-lg mb-4 animate-pulse" />
        <div className="h-12 bg-muted rounded-lg animate-pulse" />
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
    <div className="mb-10" data-testid="desk-brief-header">
      {/* RD-2 (2026-08-17) — the greeting is now the page's editorial moment.
          Was 24px Inter at font-black / tracking-tighter, which read as a
          shouted label. The reference opens every screen with a large serif
          greeting split across two weights: the salutation in full ink, the
          name muted. Same trick here, at 36px. */}
      <h2 className="font-display text-4xl mb-6" data-testid="desk-brief-greeting">
        {(() => {
          // data.greeting arrives as "Good evening, Rajesh" — split on the
          // last comma so the name can carry its own colour. Falls back to
          // the whole string when the shape is different (other locales).
          const g = String(data.greeting || "");
          const i = g.lastIndexOf(",");
          if (i === -1) return <span>{g}.</span>;
          return (
            <>
              <span>{g.slice(0, i + 1)}</span>
              <span className="text-muted-foreground">{g.slice(i + 1)}.</span>
            </>
          );
        })()}
      </h2>

      {/* Dex narrative. RD-2: the hard border + brutal shadow + solid dark
          avatar tile are gone. It now reads as a quiet inset note — the
          content is the point, not the container. */}
      <div
        data-testid="desk-brief-narrative"
        className="flex gap-3 mb-6"
      >
        <div className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Sparkle size={15} weight="fill" />
        </div>
        <p className="flex-1 text-sm leading-relaxed text-foreground/80 pt-0.5">
          {data.narrative}
        </p>
      </div>

      <FounderBento />
    </div>
  );
}


// -----------------------------------------------------------------------------
// One card in the chip's list
// -----------------------------------------------------------------------------
function DeskCard({ card, onAction, currentUserId }) {
  const [busy, setBusy] = useState(false);

  // U7-02.1 (2026-08-17): CTA label reflects who owes the reply.
  // Founder wireframe: On-Fire items on the top of the list read
  // "Respond" (this is on ME to reply -- escalation, handoff, task
  // where I am the assignee) and the ones below read "Chase" (someone
  // else owes ME the reply -- I nudge them). Same backend CTA "chase"
  // in both cases; we split on whether the target owner is the viewer.
  const effectiveCta =
    card.cta === "chase" && card.target_owner_id === currentUserId
      ? "respond"
      : card.cta;

  // RD-2 (2026-08-17): the arrow leaves the label — the reference never
  // decorates a button with glyphs, and "Review →" plus a hover shadow was
  // two affordances doing one job.
  const ctaLabel = {
    review: "Review",
    respond: "Respond",
    chase: "Chase",
    nudge: "Nudge",
  }[effectiveCta] || "Open";

  // Only the action that is genuinely ON the viewer gets the indigo fill.
  // Chase and Nudge are things the viewer does TO someone else and sit one
  // level quieter, as hairline buttons.
  const ctaStyle = {
    review: "bg-primary text-primary-foreground hover:bg-brand-700",
    respond: "bg-primary text-primary-foreground hover:bg-brand-700",
    chase: "nm-tile hover:bg-accent",
    nudge: "nm-tile hover:bg-accent",
  }[effectiveCta] || "nm-tile hover:bg-accent";

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
    /* RD-2: hairline row, no shadow, hover darkens the border only. The
       context line drops the mono face — it is prose ("Waiting 2 days ·
       From Ravi Kumar"), not data, and mono made it read as a log entry.
       The amount keeps mono + tabular numerals, because it IS data and it
       has to align down the column. */
    /* NM-9: the WHOLE ROW is the action. It used to be a row with a 90px
       button at its right end — one small target, and the other ~500px of a
       row the founder had already read did nothing. The verb moves to a
       label under the title so the row still says what tapping does, and the
       row itself is the button. Kept as <button> rather than a div+onClick so
       it is keyboard-reachable and gets the focus ring for free. */
    <button
      type="button"
      data-testid={`desk-card-${card.id}`}
      onClick={doAction}
      disabled={busy}
      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left nm-tile transition-shadow duration-150 hover:shadow-nm active:shadow-nm-press disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm leading-snug line-clamp-2">{card.title}</p>
        <p className="text-xs text-muted-foreground mt-1 truncate">{card.context_line}</p>
        <p className="text-[11px] font-medium text-primary mt-1.5 flex items-center gap-1">
          {busy ? <Spinner size={11} className="animate-spin" /> : null}
          {busy ? "Working…" : ctaLabel}
        </p>
      </div>
      {card.amount_formatted && (
        <p className="font-mono text-sm font-medium tabular-nums shrink-0 self-start">{card.amount_formatted}</p>
      )}
    </button>
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

  // NM-9: the board shows all four lists at once, so it fetches all four.
  // useQueries rather than four useQuery calls so the count stays data-driven
  // if CHIPS ever changes. Each column keeps its own cache entry, which means
  // the single-chip query above and the board share whatever is already loaded.
  const boardQs = useQueries({
    queries: CHIPS.map((c) => ({
      queryKey: ["desk", c.key],
      queryFn: () => api.get(`/desk?chip=${c.key}`).then((r) => r.data),
      refetchInterval: 30000,
    })),
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
    // U7-02.2 (2026-08-17): open the dialog on deep-link even when the
    // decision has already been resolved and no longer appears in the
    // Desk cards list. Bookmark to /inbox?decision=<id> should always
    // render the dialog (which itself handles access-restricted).
    if (focusDecisionId) setOpenDecision(focusDecisionId);
  }, [focusDecisionId]);

  const counters = data?.counters || { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 };
  const cards = data?.cards || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  const { user } = useAuth();

  const onCardAction = async (card) => {
    // U7-02.1: match the effective-CTA logic in DeskCard -- if this card
    // is really "on me" (I own the target), treat "chase" as "respond".
    const effectiveCta =
      card.cta === "chase" && card.target_owner_id === user?.id
        ? "respond"
        : card.cta;
    if (effectiveCta === "review" && card.target_kind === "decision") {
      setOpenDecision(card.target_id);
      return;
    }
    if (effectiveCta === "respond") {
      // Task-level respond: jump to MyWork with the task focused so the
      // founder can reply from the full task detail (which has the trail
      // + attachments + full context).
      navigate(`/my-work?task=${card.target_id}`);
      return;
    }
    if (effectiveCta === "chase" || effectiveCta === "nudge") {
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

      {/* RD-2 (2026-08-17): section heading drops font-black/tracking-tighter
          for the serif display face, sized below the greeting so the page has
          one clear lead and this reads as the section beneath it. */}
      <div className="mb-5">
        <h1 className="font-display text-2xl" data-testid="desk-title">
          Decision Desk
        </h1>
        <p className="text-sm text-muted-foreground mt-1" data-testid="desk-subline">
          {subline}
        </p>
      </div>

      {/* NM-9 — the board.
          Was four filter chips over one list: three of the four counts were
          visible but their contents were one click away each, so "what needs
          me" took four clicks to read. All four are columns now, so the whole
          decision surface is one glance. Columns keep their own scroll so a
          long On Fire cannot push Due Today off the screen.

          Not drag-and-drop: these are not stages a founder moves items
          between — they are four questions the backend answers. A Kanban
          affordance that cannot be dragged would be a lie. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="desk-board">
        {CHIPS.map((c, i) => {
          const q = boardQs[i];
          const list = q?.data?.cards || [];
          const n = counters[c.key] ?? list.length;
          const Icon = c.icon;
          return (
            <section key={c.key} className="flex flex-col min-w-0" data-testid={`desk-col-${c.key}`}>
              {/* Column head sits on the page ground, not in the card — the
                  cards are the objects, the heading is a label for them. */}
              <div className="flex items-center gap-2 px-1 pb-2.5">
                {Icon && <Icon size={14} weight="bold" className="text-muted-foreground" />}
                <h2 className="text-sm font-medium">{c.label}</h2>
                <span className="ml-auto min-w-[20px] rounded-full bg-nm-sunken px-1.5 py-0.5 text-center text-[11px] tabular-nums text-muted-foreground">
                  {n}
                </span>
              </div>

              <div className="flex-1 space-y-2 xl:max-h-[26rem] xl:overflow-y-auto xl:pr-0.5">
                {q?.isLoading && Array.from({ length: 2 }).map((_, k) => <SkeletonCard key={k} lines={2} />)}

                {!q?.isLoading && list.length === 0 && (
                  <div className="nm-inset px-3 py-6 text-center" data-testid={`desk-col-empty-${c.key}`}>
                    <CheckCircle size={18} weight="regular" className="text-success-600 mx-auto mb-1.5" />
                    <p className="text-xs text-muted-foreground">
                      {c.key === "needs_decision" && "No decisions waiting"}
                      {c.key === "on_fire" && "Nothing on fire"}
                      {c.key === "due_today" && "Nothing due today"}
                      {c.key === "important" && "Nothing flagged"}
                    </p>
                  </div>
                )}

                {list.map((card) => (
                  <DeskCard key={card.id} card={card} onAction={onCardAction} currentUserId={user?.id} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Refresh spinner */}
      {isFetching && !isLoading && (
        <p className="text-xs text-muted-foreground mt-4 flex items-center gap-2">
          <ArrowClockwise size={12} className="animate-spin" /> Refreshing…
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

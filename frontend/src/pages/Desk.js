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
import { SkeletonCard } from "../components/common";
import { DecisionDialog } from "../components/DecisionDialog";
import { useIsMobile } from "../hooks/useIsMobile";
import DeskMobile from "./mobile/DeskMobile";
import {
  Fire, Sun, Star, CheckCircle, ArrowClockwise, Spinner,
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
  const { data, isLoading } = useQuery({
    queryKey: ["desk-summary"],
    queryFn: () => api.get("/desk/summary").then((r) => r.data),
    refetchInterval: 60000,
  });

  if (isLoading || !data) {
    return <div className="mb-7 h-10 w-72 rounded-control bg-nm-sunken animate-pulse" />;
  }

  return (
    <div className="mb-7" data-testid="desk-brief-header">
      {/* RD-2 (2026-08-17) — the greeting is now the page's editorial moment.
          Was 24px Inter at font-black / tracking-tighter, which read as a
          shouted label. The reference opens every screen with a large serif
          greeting split across two weights: the salutation in full ink, the
          name muted. Same trick here, at 36px. */}
      <h2 className="font-display text-4xl" data-testid="desk-brief-greeting">
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

      {/* NM-14 — the Dex narrative paragraph is gone.
          It restated in prose what the bento states as numbers directly
          beneath it: "14 tasks are delayed" over a Work tile reading 14 late,
          "₹685,000 in overdue receivables" over a Money tile reading ₹6.8L,
          "3 decisions are waiting on you — see below" over a Needs Your
          Decision column showing exactly those three. Three sentences, no
          third fact, and it pushed the first actionable tile down the page.
          The greeting stays: it is the page's editorial opening, not a
          duplicate readout.

          NM-21 — the bento left this component. It is now a pane of the
          two-column layout below, not something stacked under the greeting. */}
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
    /* NM-21: the 1024px cap was right for a single stacked column and is the
       thing that made a split impossible — two panes inside it would have left
       the desk about 650px wide. Raised to 1560 so the right pane can carry
       four kanban columns of real width on a wide display, and still centred
       so the page does not sprawl on a 27" monitor. */
    <div className="max-w-[1560px] mx-auto">
      {/* Epic 2 Sprint 5 (E2-34): capture bar moved to /brain (Dex).
          Desk is now pure decision viewer.
          Epic 2 Sprint 6 (E2-43..45): CEO Brief absorbed into Desk. */}
      <DeskBriefHeader />

      {/* NM-21 — THE PAGE SPLITS.
          The KPIs sat on top of the desk as a full-width band, which cost the
          page twice. The bento's own tiles went four-across and short, so a
          two-line "so what" line floated in a lot of empty tile; and the desk
          underneath started ~420px down the screen, which left its four
          columns squeezed into whatever height was left and put most of a
          founder's actual queue below the fold.

          Side by side, each half gets the dimension it needs. The KPIs are
          five numbers — they want narrow and tall, which is a column. The desk
          is a list that only ever grows, so it wants the height, and it now
          starts at the top of the viewport instead of halfway down it.

          THE BREAKPOINT IS 1400, NOT TAILWIND'S xl (1280), AND THAT IS
          MEASURED. The split only pays for itself while the right pane can
          still hold four kanban columns. At 1280 it cannot: 1280 - 84 rail -
          64 padding - 300 pane - 24 gap leaves 808px, the board falls to a 2x2,
          and the second row pushed the page 138px past the fold — a fresh
          scroll traded for the whitespace this change removes. Verified at
          1320 before moving it. Below 1400 the page keeps the stack it already
          had: bento band, then desk. Same components, one grid declaration
          apart. */}
      {/* NM-22 — the row carries ONE explicit height and both panes stretch to
          fill it, which is what makes the two tops and the two bottoms line up
          by construction rather than by arithmetic. The previous pass gave
          each pane its own max-height and I had to hand-tune two different
          rem offsets to get the bottoms within a pixel of each other, because
          the board sits 56px lower than the KPI column. With a stretched row
          there is nothing left to tune: the grid decides once. */}
      <div
        className="grid gap-6 min-[1400px]:grid-cols-[300px_minmax(0,1fr)] min-[1400px]:h-[calc(100vh-12.75rem)]"
        data-testid="desk-split"
      >

        {/* Left pane — the read. Its own scroll: five stacked tiles run ~760px
            against a ~700px row, and a KPI column that pushed the page taller
            than the screen would trade the whitespace this change removes for
            a new patch of it lower down. */}
        <aside
          className="min-w-0 min-[1400px]:h-full min-[1400px]:overflow-y-auto min-[1400px]:pr-1"
          data-testid="desk-kpi-pane"
        >
          <FounderBento />
        </aside>

        {/* Right pane — the work, now a single card.
            NM-22: the heading moved INSIDE it. That is the whole trick behind
            the alignment the founder drew: while "Decision Desk" sat on the
            page ground above the board, the card could only ever start below
            its own title, ~56px lower than the KPI column beside it. As the
            card's header it costs no vertical offset and the two panes open on
            the same line. */}
        <section
          className="min-w-0 nm-raised flex flex-col p-5 min-[1400px]:h-full min-[1400px]:min-h-0"
          data-testid="desk-work-pane"
        >
          {/* RD-2 (2026-08-17): section heading drops font-black/tracking-tighter
              for the serif display face, sized below the greeting so the page has
              one clear lead and this reads as the section beneath it. */}
          <div className="mb-5 shrink-0">
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
          affordance that cannot be dragged would be a lie.

          NM-21: the column count is UNCHANGED. Setting the split's breakpoint
          at the width where four columns still fit means the board never needs
          a variant for the split — 4-up stacked below 1400, 4-up beside the
          KPIs above it. At 1440 that is 228px a column; at the 1560 cap, 306.

          NM-22: `flex-1 min-h-0` is what hands the board the card's leftover
          height. Without min-h-0 a flex child refuses to shrink below its
          content, the board would size to the longest column, and the card
          would grow past the fold instead of scrolling inside itself. */}
      <div className="flex-1 min-h-0 grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="desk-board">
        {CHIPS.map((c, i) => {
          const q = boardQs[i];
          const list = q?.data?.cards || [];
          const n = counters[c.key] ?? list.length;
          const Icon = c.icon;
          return (
            <section key={c.key} className="flex flex-col min-w-0 min-h-0" data-testid={`desk-col-${c.key}`}>
              {/* Column head. NM-22: `shrink-0` so it holds its 30px while
                  the list below it absorbs every pixel of the card's height. */}
              <div className="flex shrink-0 items-center gap-2 px-1 pb-2.5">
                {Icon && <Icon size={14} weight="bold" className="text-muted-foreground" />}
                <h2 className="text-sm font-medium">{c.label}</h2>
                <span className="ml-auto min-w-[20px] rounded-full bg-nm-sunken px-1.5 py-0.5 text-center text-[11px] tabular-nums text-muted-foreground">
                  {n}
                </span>
              </div>

              {/* NM-22: inside the split the viewport arithmetic is GONE.
                  NM-21 capped this at calc(100vh-20rem), a number I had to
                  measure and would have to re-measure the moment anything
                  above it changed height. The card is now a fixed-height flex
                  column, so `flex-1 min-h-0` gives the list exactly what is
                  left and the scroll falls out of the layout instead of out of
                  a constant. The 26rem cap still governs the stacked layout
                  below 1400, where there is no card to measure against. */}
              <div className="flex-1 min-h-0 space-y-2 overflow-y-auto lg:max-h-[26rem] lg:pr-0.5 min-[1400px]:max-h-none">
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
        </section>
      </div>

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

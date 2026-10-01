/* ASK-52 · THE WORKFLOWS TILE — a member of the Desk's KPI grid, two cells wide.
 *
 * It is the same tile as the five beside it, not a new thing: nm-tile's white
 * rounded face, IconChip top-left wearing the alert dot on the same rule as
 * Delayed and To collect, the black circular arrow top-right, the same label
 * and the same BigNumeral. What it adds is the width: the left half counts
 * what needs attention across every board, the right half names the one card
 * to pick up and offers the board's own move on it.
 *
 * ONE DIFFERENCE, deliberate: the other tiles ARE links — the whole tile
 * navigates. This one cannot be, because it carries a button inside it, so the
 * arrow is the link and the tile itself is a plain surface. Nothing else about
 * it differs.
 *
 * The numbers are workflowAttention's (pages/desk/workflowAttention.js); this
 * file only draws them.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Check, FlowArrow, SpinnerGap } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "../../lib/api";
import { BigNumeral } from "../../components/karma";
import { IconChip } from "../../components/karma/IconChip";
import { CHIP } from "../../components/karma/glass";
import { cn } from "../../lib/utils";

/* The bar's three parts, in the order the founder wrote them: you, stuck,
   late — the app's ink, its amber and its accent. A card is in exactly one, so
   the three widths are a split of the number above them. */
const PARTS = [
  { key: "you", label: "you", bar: "bg-neutral-900", dot: "bg-neutral-900" },
  { key: "stuck", label: "stuck", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "late", label: "late", bar: "bg-kr-accent", dot: "bg-kr-accent" },
];

/* THE TWO MOVES ARE ONE PAIR, so they are one recipe. They were written
   separately and drifted: Approve measured 45 real px against Open Workflows'
   39, which reads as a mistake rather than as a hierarchy. One fixed height for
   both — equal, and no taller than the platform's 44pt target once --ui-scale's
   0.8 lands — with the padding tightened so the pill hugs its label instead of
   sprawling, and the label itself kept on one line with room either side. */
const ACTION_PILL =
  "flex h-10 max-lg:h-[3.5rem] w-full shrink-0 items-center justify-center gap-1.5 rounded-pill px-2.5 lg:px-4 "
  + "text-center text-[13px] font-medium leading-tight "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline";

/* THE WIDE ARRANGEMENT'S TWO MOVES ARE CIRCLES, not pills — the founder's
   call, and the arithmetic is on their side. Two pills were taking 220 CSS px
   of a 255px column, which is why "PO #221 — Cotton yarn (2 tonnes)" was
   arriving as "PO #221 — C…": the card's name, the one thing you actually read,
   was losing its room to two labels you can infer from a tick and an arrow.
   Two 3.5rem circles take 120px and give the title back a hundred.

   THE VISIBLE LABEL GOES, THE ACCESSIBLE ONE DOES NOT. accessibility.md is
   explicit that an icon-only control still needs a name for a screen reader, so
   each carries the exact words the pill carried — "Approve", "Open Workflows" —
   as aria-label and as the hover title. A tick for the move and an arrow out
   for the boards are the two most conventional glyphs there are; this is not
   the place to be inventive. 3.5rem is 44.8 real pixels once --ui-scale's 0.8
   lands, which is the platform's target. */
const ICON_MOVE =
  "grid h-14 w-14 shrink-0 place-items-center rounded-full "
  + "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline";

const REASON_CHIP = {
  stuck: "bg-amber-50 text-amber-800 ring-amber-100",
  late: "bg-rose-50 text-rose-700 ring-rose-100",
  you: "bg-slate-500/[0.07] text-slate-700 ring-slate-500/10",
};

/* `wide` — the card owns a whole row instead of two of three columns.
   Proposed by the founder after seeing the Desk on a real iPhone 13 mini, where
   "Spend, this month" was a tall near-empty tile with its own label truncated to
   "Spend, this…". Dropping it frees a column; this card takes it and comes down
   to the top row's height. More width, less height — so the two moves go side by
   side instead of stacking, which is where the height comes from. */
export function WorkflowsTile({ attention, loading = false, onMoved, className, wide = false, testid = "kpi-workflows" }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { needAttention = 0, total = 0, nextUp = null, advancedToday = 0, atRisk = 0 } = attention || {};
  const quiet = !loading && needAttention === 0;

  /* The board's move, from the board's own endpoint — same call the Workflows
     page makes, so the two cannot diverge. The card refreshes in place: the
     tile reads the refetched list, nothing navigates. The engine can refuse a
     move that is not ready (409); the board answers that with an override
     dialog, which is a conversation this tile has no room for, so it says what
     the engine said and points at the board. */
  const move = useMutation({
    mutationFn: () => api.patch(`/workflows/${nextUp.id}/advance`, {
      stage: nextUp.nextStage, note: `Moved to ${nextUp.nextStage}`,
    }),
    onSuccess: () => {
      toast.success(`→ ${nextUp.actionLabel?.replace(/^(Advance to|Approve)\s+/, "") || "Moved"}`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      onMoved?.();
    },
    onError: (e) => {
      const detail = e.response?.data?.detail || "Could not move it";
      toast.error(e.response?.status === 409
        ? `${String(detail).replace(/^Stage not ready:\s*/, "")} — open Workflows to move it anyway`
        : detail);
    },
    onSettled: () => setBusy(false),
  });

  const parts = PARTS.map((p) => ({ ...p, n: attention?.[p.key] || 0 })).filter((p) => p.n > 0);

  /* The one link on the tile, to the boards. 2026-09-21, founder — a named
     pill, not a bare circle: "Open Workflows", the same shape, width and
     height as the move above it, in the ink the circle wore, so the two read
     as a pair — the move you can make here, and the way to the boards. */
  const openBoards = (
    <Link
      to="/workflows"
      data-testid={`${testid}-open`}
      className={cn(ACTION_PILL,
        "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]")}
    >
      {/* The arrow is desktop's. In a 130px column it was the 14px that pushed
          "Open Workflows" onto a second line while Approve sat on one — the
          label is the affordance here, and a pill that wraps reads as cramped
          however equal its height is. */}
      <span className="whitespace-nowrap">Open Workflows</span>
      <ArrowRight size={14} weight="bold" aria-hidden="true" className="kr-arrow hidden shrink-0 transition-transform duration-200 lg:block" />
    </Link>
  );

  /* THE WIDE ARRANGEMENT — a proposal, rendered only in /design-lab behind
     ?kpi=wide (Desk.js). It is a SEPARATE BODY rather than the tall card with
     tighter classes, and that is the point: squeezing the tall one into the top
     row's height just made it overflow and disappear behind the black card.
     A card that is twice as wide and half as tall is a different arrangement —
     the count sits beside its label instead of under it, and the two moves go
     side by side instead of stacking. Everything it shows, it shows from the
     same values; nothing new is computed and nothing is dropped except the
     "forecast to miss" line, which has no row to live on at this height and is
     the one piece here that is not about right now.
     If the founder says no, deleting this block restores the card exactly. */
  if (wide) {
    return (
      <div
        data-testid={testid}
        className={cn("kr-stat nm-tile grid grid-cols-[minmax(0,0.85fr)_1px_minmax(0,1.6fr)] items-center gap-3 p-3", className)}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <IconChip icon={FlowArrow} alert={needAttention > 0} />
          <div className="min-w-0">
            <span className="flex items-baseline whitespace-nowrap leading-none">
              <BigNumeral text={loading ? "…" : String(needAttention)} size="md"
                className={quiet ? "text-foreground/45" : undefined}
                accent={!quiet && !loading} testid={`${testid}-count`} />
              {!loading && <span className="ml-1 text-base font-medium text-muted-foreground">/ {total}</span>}
            </span>
            <p className="kr-stat__label mt-0.5 line-clamp-2 text-sm leading-tight text-foreground/80">
              Workflows — need attention
            </p>
            {!loading && !quiet && parts.length > 0 && (
              <span className="mt-1 block" data-testid={`${testid}-split`}>
                <span className="flex h-1.5 w-full max-w-[9rem] overflow-hidden rounded-full bg-slate-900/[0.06]">
                  {parts.map((pt) => (
                    <span key={pt.key} className={pt.bar} style={{ width: `${(pt.n / needAttention) * 100}%` }} />
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>

        <span aria-hidden="true" className="h-full w-px self-stretch bg-slate-900/10" />

        <div className="flex min-w-0 flex-col justify-center gap-1.5">
          {loading ? (
            <div className="space-y-2" aria-hidden="true">
              <div className="ds-skeleton h-3.5 w-24 rounded-control" />
              <div className="ds-skeleton h-8 w-4/5 rounded-control" />
            </div>
          ) : quiet ? (
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700" data-testid={`${testid}-quiet`}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="min-w-0 truncate">All moving{advancedToday > 0 ? ` · ${advancedToday} advanced today` : ""}</span>
              </p>
              <Link
                to="/workflows"
                data-testid={`${testid}-open`}
                title="Open Workflows"
                aria-label="Open Workflows"
                className={cn(ICON_MOVE, "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]")}
              >
                <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          ) : nextUp ? (
            /* The title gets the room the two pills were holding, and gets to
               use two lines of it — this is the name of the thing waiting on
               the founder, and an ellipsis in the middle of it is the whole
               reason this arrangement is being tried. */
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
                   title={nextUp.title} data-testid={`${testid}-next-title`}>
                  {nextUp.title}
                </p>
                <span className={cn(CHIP, "mt-1 inline-flex max-w-full truncate", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)}
                      title={nextUp.reasonLabel} data-testid={`${testid}-next-reason`}>
                  {nextUp.reasonLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {nextUp.actionLabel && (
                  <button
                    type="button"
                    data-testid={`${testid}-next-action`}
                    disabled={busy || move.isPending}
                    onClick={() => { setBusy(true); move.mutate(); }}
                    title={nextUp.actionLabel}
                    aria-label={nextUp.actionLabel}
                    className={cn(ICON_MOVE, "kr-pop text-foreground disabled:opacity-50")}
                  >
                    {move.isPending
                      ? <SpinnerGap size={20} weight="bold" aria-hidden="true" className="animate-spin" />
                      : <Check size={22} weight="bold" aria-hidden="true" />}
                  </button>
                )}
                <Link
                  to="/workflows"
                  data-testid={`${testid}-open`}
                  title="Open Workflows"
                  aria-label="Open Workflows"
                  className={cn(ICON_MOVE, "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]")}
                >
                  <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : (
            /* Nothing waiting: the boards are still one tap away, on their own. */
            <div className="flex min-w-0 items-center justify-between gap-2.5">
              <p className="min-w-0 text-sm text-muted-foreground">Nothing waiting on a move.</p>
              <Link
                to="/workflows"
                data-testid={`${testid}-open`}
                title="Open Workflows"
                aria-label="Open Workflows"
                className={cn(ICON_MOVE, "bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))]")}
              >
                <ArrowUpRight size={22} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    /* 2026-09-21, founder — THE NEXT UP HALF RUNS THE CARD'S FULL HEIGHT.
       It used to start under a header row it shared with the left half, whose
       only job on this side was the black arrow — so Next up got what was left
       below it, and a move like "Approve Order Confirmed" wrapped onto two
       lines inside a 40px pill with no room above or below it. The arrow now
       sits at the foot of this half, under the move, as a named pill; the
       half starts at the card's top edge, and the move gets its whole width on
       one line at 13px — 25-odd characters — growing to a second line with
       its own padding only where the card is at its narrowest. */
    <div
      data-testid={testid}
      className={cn(
        /* max-lg: — the phone runs this same tile, scaled (Desk's PHONE_TILE).
           The 20px gutter and the 170px floor are desktop's; on a 487px CSS
           viewport two columns plus a 20px trough leaves too little for the
           "next up" title, so the trough halves and the floor comes off. */
        "kr-stat nm-tile grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-5 p-5",
        "max-lg:gap-2.5 lg:min-h-[170px]",
        wide && "max-lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1.45fr)]", className)}
    >
      {/* LEFT — the count, and what it is made of. The chip wears the dot
          whenever something needs attention (Delayed and To collect's rule). */}
      <div className="flex min-w-0 flex-col">
        <IconChip icon={FlowArrow} alert={needAttention > 0} />
        <p className="kr-stat__label mt-4 text-base text-foreground/80">Workflows — need attention</p>
        {/* 2026-09-22 — on time today, but forecast to miss the date the card
            has to be done by (services/workflow_timing). Not late yet, so not
            one of the three reasons; said here so it is seen before it is. */}
        {!loading && atRisk > 0 && (
          <p className="mt-1 text-[12px] font-medium text-amber-700" data-testid={`${testid}-at-risk`}>
            {atRisk === 1 ? "1 card" : `${atRisk} cards`} forecast to miss {atRisk === 1 ? "its" : "their"} target date
          </p>
        )}
        <div className="kr-stat__foot mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-3">
          <span className="inline-flex shrink-0 items-baseline whitespace-nowrap leading-none">
            {/* The score's own shape: the number, then the total it is out of. */}
            <BigNumeral text={loading ? "…" : String(needAttention)} size="md"
              className={quiet ? "text-foreground/45" : undefined}
              accent={!quiet && !loading} testid={`${testid}-count`} />
            {!loading && (
              <span className="ml-1 text-lg font-medium text-muted-foreground">/ {total}</span>
            )}
          </span>
          {!loading && !quiet && parts.length > 0 && (
            <span className="min-w-0 pb-0.5 text-right" data-testid={`${testid}-split`}>
              <span className="ml-auto flex h-1.5 w-[140px] max-w-full overflow-hidden rounded-full bg-slate-900/[0.06]">
                {parts.map((p) => (
                  <span key={p.key} className={p.bar} style={{ width: `${(p.n / needAttention) * 100}%` }} />
                ))}
              </span>
              <span className="mt-1.5 block whitespace-nowrap text-[11px] leading-none text-muted-foreground">
                {parts.map((p, i) => (
                  <span key={p.key}>{i > 0 ? " · " : ""}{p.n} {p.label}</span>
                ))}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* A hairline between the two halves, as the drawer's sections use. */}
      <span aria-hidden="true" className="w-px self-stretch bg-slate-900/10" />

      {/* RIGHT — the one to pick up (or the quiet line), and at its foot the
          move and the way to the boards. */}
      <div className="flex min-w-0 flex-col">
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="ds-skeleton h-3.5 w-24 rounded-control" />
            <div className="ds-skeleton h-4 w-4/5 rounded-control" />
          </div>
        ) : quiet ? (
          /* Nothing is asking for anything. It should read as a good state,
             not as an empty one. */
          <p className="mt-auto flex items-center gap-2 text-sm font-medium text-emerald-700" data-testid={`${testid}-quiet`}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            All moving{advancedToday > 0 ? ` · ${advancedToday} advanced today` : ""}
          </p>
        ) : nextUp ? (
          <>
            {/* The eyebrow and the reason share a line, so the card's name,
                its stage and the move each keep a line of their own. */}
            {/* THE CHIP WRAPS UNDER THE EYEBROW WHEN THE COLUMN IS NARROW.
                `shrink-0` beside a `justify-between` eyebrow is fine at the
                desktop width this was written for; on the phone the column is
                103px and "Needs your sign-off" ran 28px PAST the tile's own
                edge (measured, sparse fixture). flex-wrap lets it drop to its
                own line, and min-w-0 + truncate means even a longer reason can
                only ever use the width it has. */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Next up</p>
              <span className={cn(CHIP, "min-w-0 max-w-full truncate", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)}
                    title={nextUp.reasonLabel} data-testid={`${testid}-next-reason`}>
                {nextUp.reasonLabel}
              </span>
            </div>
            {/* J14-09 (JOURNEY-1) — THE ONE THING HE HAS TO SIGN OFF, CUT IN HALF.
                One line and an ellipsis: "Second press brake — Coimbat…", on the
                card that asks for his approval. There is room underneath — the
                Requested line and two buttons sit below it — so this was a clamp,
                not a space problem. Two lines, then clamp: a long title reads,
                and the tile still cannot grow without limit. */}
            <p className="mt-1.5 line-clamp-2 text-sm font-medium text-foreground" title={nextUp.title} data-testid={`${testid}-next-title`}>
              {nextUp.title}
            </p>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={`${nextUp.stage}${nextUp.note ? ` · ${nextUp.note}` : ""}`}>
              {nextUp.stage}{nextUp.note ? ` · ${nextUp.note}` : ""}
            </p>
          </>
        ) : (
          <p className="mt-auto text-sm text-muted-foreground">Nothing waiting on a move.</p>
        )}

        {/* Sized to the row the grid already had: the tiles follow the Dex
            well's height (Desk.js, KR-8.6), so this half fits inside it rather
            than making every tile taller. */}
        <div className={cn("flex gap-2", wide ? "max-lg:flex-row lg:flex-col" : "flex-col",
          (quiet || !nextUp) && !loading ? "pt-2.5" : "mt-auto pt-2.5")}>
          {!loading && !quiet && nextUp?.actionLabel && (
            <button
              type="button"
              data-testid={`${testid}-next-action`}
              disabled={busy || move.isPending}
              onClick={() => { setBusy(true); move.mutate(); }}
              title={nextUp.actionLabel}
              className={cn(ACTION_PILL, "kr-pop text-foreground disabled:opacity-50")}
            >
              {move.isPending ? "Moving…" : nextUp.actionLabel}
            </button>
          )}
          {openBoards}
        </div>
      </div>
    </div>
  );
}

export default WorkflowsTile;

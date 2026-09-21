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
import { ArrowRight, FlowArrow } from "@phosphor-icons/react";
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

const REASON_CHIP = {
  stuck: "bg-amber-50 text-amber-800 ring-amber-100",
  late: "bg-rose-50 text-rose-700 ring-rose-100",
  you: "bg-slate-500/[0.07] text-slate-700 ring-slate-500/10",
};

export function WorkflowsTile({ attention, loading = false, onMoved, className, testid = "kpi-workflows" }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { needAttention = 0, total = 0, nextUp = null, advancedToday = 0 } = attention || {};
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
      className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-pill bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] px-4 py-2 text-[13px] font-medium leading-tight text-[hsl(var(--kr-action-fg,0_0%_100%))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
    >
      Open Workflows
      <ArrowRight size={14} weight="bold" aria-hidden="true" className="kr-arrow shrink-0 transition-transform duration-200" />
    </Link>
  );

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
      className={cn("kr-stat nm-tile grid min-h-[170px] grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-5 p-5", className)}
    >
      {/* LEFT — the count, and what it is made of. The chip wears the dot
          whenever something needs attention (Delayed and To collect's rule). */}
      <div className="flex min-w-0 flex-col">
        <IconChip icon={FlowArrow} alert={needAttention > 0} />
        <p className="kr-stat__label mt-4 text-base text-foreground/80">Workflows — need attention</p>
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
            <div className="flex min-w-0 items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Next up</p>
              <span className={cn(CHIP, "shrink-0", REASON_CHIP[nextUp.reason] || REASON_CHIP.you)} data-testid={`${testid}-next-reason`}>
                {nextUp.reasonLabel}
              </span>
            </div>
            <p className="mt-1.5 truncate text-sm font-medium text-foreground" title={nextUp.title} data-testid={`${testid}-next-title`}>
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
        <div className={cn("flex flex-col gap-2", (quiet || !nextUp) && !loading ? "pt-2.5" : "mt-auto pt-2.5")}>
          {!loading && !quiet && nextUp?.actionLabel && (
            <button
              type="button"
              data-testid={`${testid}-next-action`}
              disabled={busy || move.isPending}
              onClick={() => { setBusy(true); move.mutate(); }}
              title={nextUp.actionLabel}
              className="kr-pop flex min-h-10 w-full items-center justify-center gap-1.5 rounded-pill px-4 py-2 text-center text-[13px] font-medium leading-tight text-foreground [text-wrap:balance] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline disabled:opacity-50"
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

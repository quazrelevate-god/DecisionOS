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

  return (
    <div
      data-testid={testid}
      className={cn("kr-stat nm-tile flex min-h-[120px] flex-col p-4 sm:p-5 lg:min-h-[170px]", className)}
    >
      {/* The grid's own header: the chip on the left wearing the dot whenever
          something needs attention (Delayed and To collect's rule), the arrow
          on the right — the one thing here that navigates. */}
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={FlowArrow} alert={needAttention > 0} />
        <Link
          to="/workflows"
          data-testid={`${testid}-open`}
          aria-label="Open Workflows"
          className="hidden h-10 w-10 shrink-0 place-items-center rounded-full bg-[hsl(var(--kr-action-bg,var(--kr-ink)))] text-[hsl(var(--kr-action-fg,0_0%_100%))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline lg:grid"
        >
          <ArrowRight size={18} weight="bold" className="kr-arrow transition-transform duration-200" />
        </Link>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-5">
        {/* LEFT — the count, and what it is made of */}
        <div className="flex min-w-0 flex-col lg:flex-1">
          <p className="kr-stat__label text-base text-foreground/80">Workflows — need attention</p>
          <div className="kr-stat__foot mt-auto flex items-end justify-between gap-3 pt-3 lg:pt-4">
            <span className="inline-flex items-baseline leading-none">
              {/* The score's own shape: the number, then the total it is out of. */}
              <BigNumeral text={loading ? "…" : String(needAttention)} size="md"
                className={quiet ? "text-foreground/45" : undefined}
                accent={!quiet && !loading} testid={`${testid}-count`} />
              {!loading && (
                <span className="ml-1 text-lg font-medium text-muted-foreground">/ {total}</span>
              )}
            </span>
            {!loading && !quiet && parts.length > 0 && (
              <span className="hidden shrink-0 pb-0.5 text-right lg:block" data-testid={`${testid}-split`}>
                <span className="flex h-1.5 w-[140px] overflow-hidden rounded-full bg-slate-900/[0.06]">
                  {parts.map((p) => (
                    <span key={p.key} className={p.bar} style={{ width: `${(p.n / needAttention) * 100}%` }} />
                  ))}
                </span>
                <span className="mt-1.5 block text-[11px] leading-none text-muted-foreground">
                  {parts.map((p, i) => (
                    <span key={p.key}>{i > 0 ? " · " : ""}{p.n} {p.label}</span>
                  ))}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* A hairline between the two halves, as the drawer's sections use. */}
        <span aria-hidden="true" className="hidden w-px shrink-0 self-stretch bg-slate-900/10 lg:block" />

        {/* RIGHT — the one to pick up, or the quiet line when there is none */}
        <div className="flex min-w-0 flex-col lg:flex-1">
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Next up</p>
              <p className="mt-1.5 truncate text-sm font-medium text-foreground" data-testid={`${testid}-next-title`}>
                {nextUp.title}
              </p>
              <div className="mt-1.5 flex min-w-0 items-center gap-2">
                <span className={cn(CHIP, REASON_CHIP[nextUp.reason] || REASON_CHIP.you)} data-testid={`${testid}-next-reason`}>
                  {nextUp.reasonLabel}
                </span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {nextUp.stage}{nextUp.note ? ` · ${nextUp.note}` : ""}
                </span>
              </div>
              {nextUp.actionLabel && (
                <button
                  type="button"
                  data-testid={`${testid}-next-action`}
                  disabled={busy || move.isPending}
                  onClick={() => { setBusy(true); move.mutate(); }}
                  className="kr-pop mt-auto flex h-10 w-fit items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-foreground disabled:opacity-50"
                >
                  {move.isPending ? "Moving…" : nextUp.actionLabel}
                  {!move.isPending && <ArrowRight size={14} weight="bold" aria-hidden="true" />}
                </button>
              )}
            </>
          ) : (
            <p className="mt-auto text-sm text-muted-foreground">Nothing waiting on a move.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkflowsTile;

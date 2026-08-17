/**
 * The expanded member card — what opens when a box in the Ops grid is tapped.
 *
 * A READ, and only a read. It carried three management pills — Access, Invite,
 * Mark absent — for as long as the roster was folded into Ops and there was
 * nowhere else for them to live. U7-09 gave /team its own page back (card grid,
 * click-through profile), team management went with it, and this card lost the
 * writes: one door to changing a person, and it is the Team page.
 *
 * CONTENT. The /work-coach payload — the same data the desktop coach page
 * renders — minus four tiles by request: proof uploads, plans used, photos,
 * voice updates. What remains is the four counters that describe throughput and
 * the AI review, which is the part worth reading on a phone.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Sparkle, TrendUp, Lightbulb, CheckCircle, Trophy } from "@phosphor-icons/react";
import api from "../../lib/api";
import { cn } from "@/lib/utils";

const roleLabel = (r) => (r ? String(r).replace(/^./, (c) => c.toUpperCase()) : "");

function Counter({ label, value, suffix = "", accent = "" }) {
  return (
    <div
      className="rounded-xl border border-hairline bg-card px-1 py-2.5 text-center"
      data-testid={`member-stat-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <p className={cn("font-heading text-xl font-black leading-none tabular-nums", accent)}>
        {value}{suffix}
      </p>
      {/* 9px and tracking-normal: the card is narrower than the Ops sheet, and
          at label-mono's default tracking "OVERDUE" ran to both borders of a
          74px box. */}
      <p className="label-mono mt-1 text-[9px] tracking-normal text-muted-foreground">{label}</p>
    </div>
  );
}

// The Access / Invite / Mark-absent pills lived here. They moved back to the
// Team page with the rest of team management (U7-09 gave /team its own card
// grid and click-through profile), so this card is a READ again: how this
// person is doing, opened from the Ops grid, with no writes attached.
export function MemberCard({ member, open, onClose, isAbsent = false }) {
  const qc = useQueryClient();
  const userId = member?.id;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["work-coach", userId],
    queryFn: () => api.get(`/work-coach?user_id=${userId}`).then((r) => r.data),
    enabled: !!open && !!userId,
    retry: false,
  });

  const refresh = useMutation({
    mutationFn: () => api.post(`/work-coach/refresh?user_id=${userId}`).then((r) => r.data),
    onSuccess: (d) => { qc.setQueryData(["work-coach", userId], d); toast.success("AI coach updated"); },
    onError: () => toast.error("Could not refresh coaching"),
  });

  if (!open || !member) return null;

  const stats = data?.stats;
  const summary = refresh.data?.summary || data?.summary;

  return (
    <div className="fixed inset-0 z-[9000] lg:hidden" data-testid="member-card-layer" role="dialog" aria-modal="true">
      {/* Scrim. z-[9000] keeps this under the dock and Dex FAB at z-[10000],
          which are never covered by design. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        data-testid="member-card-scrim"
      />

      <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
        {/* ── the card ── */}
        <div
          className="rounded-2xl border border-hairline bg-background shadow-2xl overflow-hidden"
          data-testid="member-card"
        >
          <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div className="min-w-0">
              <p className="font-heading text-xl font-extrabold tracking-tight truncate">{member.name}</p>
              <p className="label-mono text-muted-foreground truncate">
                {roleLabel(member.role)}{isAbsent ? " · Absent today" : ""}
              </p>
            </div>
            <button
              type="button" onClick={onClose} aria-label="Close"
              data-testid="member-card-close"
              className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-foreground/10"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          {/* max-h + internal scroll: an AI review runs to several paragraphs
              and the card must not grow past the viewport. */}
          <div className="max-h-[52svh] overflow-y-auto overscroll-contain scrollbar-none px-5 pb-5">
            {isError ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground" data-testid="member-card-error">
                Only the owner can view another member's coaching.
              </p>
            ) : isLoading || !stats ? (
              <div className="space-y-3 py-2" data-skeleton="member-card">
                <div className="grid grid-cols-4 gap-2">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />)}
                </div>
                <div className="h-20 animate-pulse rounded-xl bg-muted" />
              </div>
            ) : (
              <>
                {/* Proof uploads, plans used, photos and voice updates are
                    deliberately not here — four tiles removed by request. */}
                {/* Monochrome, like the Ops hero these were opened from — a
                    green Done beside a red Overdue made four counters argue
                    when only their values differ. */}
                <div className="grid grid-cols-4 gap-2" data-testid="member-card-stats">
                  <Counter label="Done" value={stats.completed} />
                  <Counter label="Open" value={stats.open} />
                  <Counter label="Overdue" value={stats.overdue} />
                  <Counter label="Rate" value={stats.completion_rate} suffix="%" />
                </div>

                {!summary ? (
                  <div className="mt-4 rounded-xl border border-dashed border-hairline px-4 py-6 text-center" data-testid="member-card-coach-empty">
                    <Trophy size={26} weight="bold" className="mx-auto mb-2 text-brand-600" />
                    <p className="text-sm font-semibold">No coaching yet</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                      Generate an AI review from the numbers above.
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3" data-testid="member-card-coach">
                    <div className="rounded-xl bg-brand-ink px-4 py-3.5 text-white">
                      <p className="flex items-start gap-2 font-heading text-[15px] font-bold leading-snug">
                        <Sparkle size={18} weight="fill" className="mt-0.5 shrink-0 text-caution-400" />
                        {summary.headline}
                      </p>
                    </div>

                    <div className="rounded-xl border border-hairline bg-card px-4 py-3.5">
                      <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold text-muted-foreground">
                        <TrendUp size={15} weight="bold" className="text-success-600" /> Strengths
                      </p>
                      <ul className="space-y-1.5">
                        {(summary.strengths || []).map((it, i) => (
                          <li key={`s-${i}`} className="flex items-start gap-2 text-[13px] leading-relaxed">
                            <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-success-600" /> {it}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-hairline bg-card px-4 py-3.5">
                      <p className="mb-2 flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold text-muted-foreground">
                        <Lightbulb size={15} weight="bold" className="text-caution-600" /> Areas to improve
                      </p>
                      <ul className="space-y-1.5">
                        {(summary.improvements || []).map((it, i) => (
                          <li key={`i-${i}`} className="flex items-start gap-2 text-[13px] leading-relaxed">
                            <span className="shrink-0 font-bold text-caution-600">→</span> {it}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-hairline border-l-4 border-l-brand-600 bg-card px-4 py-3.5">
                      <p className="label-mono mb-1 text-brand-600">AI recommendation</p>
                      <p className="text-[13px] font-medium leading-relaxed">{summary.recommendation}</p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending}
                  data-testid="member-card-refresh"
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-hairline bg-card text-sm font-semibold disabled:opacity-50"
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  <Sparkle size={15} weight="bold" className="text-brand-600" />
                  {refresh.isPending ? "Analyzing…" : summary ? "Refresh coaching" : "Generate coaching"}
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

export default MemberCard;

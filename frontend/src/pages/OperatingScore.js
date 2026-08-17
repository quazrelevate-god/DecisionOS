import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import {
  Gauge, Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots, Trophy,
  Sparkle, CaretRight, Camera, ClipboardText, Check, Warning, ArrowRight,
  Info, CaretDown, CaretUp, Microphone, Receipt,
} from "@phosphor-icons/react";

// Epic 7 Sprint 1 Phase A -- role-aware dispatcher.
// Owner keeps the company dashboard (with a new personal snapshot mini-widget).
// Every other role gets a self-focused view: their stats, their open work,
// their active workflows, and their peer context (opt-in later).
// Founder ask 2026-08-17: 'if the team person login and go the ops it have to
// show the individuals person metrics'.

// U7-01.16: each category carries its formula + weight so a (i) tooltip
// can explain WHAT the number measures without the founder digging into
// backend code. Weights match _score_execution / _score_sales / inline
// finance + responsiveness in server.py (35/25/20/20).
const CATS = [
  { key: "execution", label: "Execution", icon: Lightning, color: "bg-brand-blue",
    weight: 35,
    formula: "(tasks done ÷ total actionable) × 100  −  (overdue ÷ open) × 40",
    plain: "How much of what you started is finished on time." },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar, color: "bg-green-600",
    weight: 25,
    formula: "(paid ÷ billed) × 100  −  overdue invoices × 5",
    plain: "How well cash is coming in vs. how much is stuck." },
  { key: "sales", label: "Sales", icon: TrendUp, color: "bg-brand-yellow",
    weight: 20,
    formula: "approved decisions ÷ total decisions × 100",
    plain: "Rate at which raised decisions get a green light." },
  { key: "responsiveness", label: "Responsiveness", icon: ChatCenteredDots, color: "bg-purple-600",
    weight: 20,
    formula: "100  −  (open complaints × 12)  −  (overdue tasks × 3)",
    plain: "How fast the team is closing loops -- complaints + missed dates." },
];

const scoreColor = (v) =>
  v == null ? "text-black/30"
  : v >= 70 ? "text-green-600"
  : v >= 40 ? "text-amber-600"
  : "text-brand-600";

export default function OperatingScore() {
  const { data, isLoading } = useQuery({
    queryKey: ["operating-score"],
    queryFn: () => api.get("/operating-score").then((r) => r.data),
  });

  // U7-01.20: skeleton matches the actual page shape (score circle +
  // stat tiles + a wide content strip) so the layout doesn't jump when
  // data arrives. Same skeleton for both views -- we don't know the
  // role yet at loading time.
  if (isLoading || !data) return <OperatingScoreSkeleton />;

  // `view` is the role-dispatch discriminator returned by the backend.
  // We defensively fall back on the presence of `company` for older payloads.
  const isOwnerView = data.view === "owner" || Boolean(data.company);
  return isOwnerView ? <OwnerView data={data} /> : <SelfView data={data} />;
}

// -----------------------------------------------------------------------------
// OwnerView -- company dashboard (existing behaviour, plus new PersonalSnapshot)
// -----------------------------------------------------------------------------
function OwnerView({ data }) {
  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data]
  );

  const { company, stats, my_snapshot: mySnapshot } = data;
  const overall = company.overall;
  const enough = company.enough_data !== false;

  return (
    <div>
      <PageHeader eyebrow="How well the business is running" title="Operating Score" />

      {!enough ? (
        <NotEnoughDataEmptyState stats={stats} />
      ) : (
      /* Company overall */
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-overall">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-black bg-white">
            <span className={`font-heading text-6xl font-black leading-none ${scoreColor(overall)}`} data-testid="operating-overall-score">{overall}</span>
            <span className="label-mono text-muted-foreground mt-1">/ 100</span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-brand-600" />
            <span className="font-heading font-extrabold uppercase tracking-tight text-sm">Company Health</span>
          </div>
        </div>
        <div className="flex-1 w-full space-y-4">
          {CATS.map((c) => {
            const v = company.categories[c.key];
            const has = v != null;
            return (
              <div key={c.key} data-testid={`operating-cat-${c.key}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
                    <c.icon size={15} weight="bold" className="text-muted-foreground" /> {c.label}
                    {/* U7-01.16: per-category (i) tooltip explains what the
                        number measures in plain English before diving into
                        the formula. Native title attribute keeps zero JS. */}
                    <span
                      title={`${c.plain}\n\nFormula: ${c.formula}\nWeight: ${c.weight}% of overall`}
                      className="text-black/30 hover:text-brand-600 cursor-help"
                      aria-label={`How ${c.label} is calculated`}
                    >
                      <Info size={13} weight="bold" />
                    </span>
                  </span>
                  <span
                    className={`font-heading font-black ${scoreColor(v)}`}
                    role="progressbar"
                    aria-label={`${c.label}: ${has ? v : "no data"} out of 100`}
                    aria-valuenow={has ? v : undefined}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {has ? v : "—"}
                  </span>
                </div>
                <div className="h-3 bg-black/10 border border-black" aria-hidden="true">
                  <div className={`h-full ${c.color}`} style={{ width: `${has ? v : 0}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* U7-01.16: full formula panel, collapsed by default. Opens the
          weights + formulas for all four categories so a founder can
          reason about their score instead of trusting a black box. */}
      {enough && <FormulaExplainer />}

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[
          { label: "Tasks Done", value: stats.done },
          { label: "Open Tasks", value: stats.open },
          { label: "Overdue", value: stats.overdue, accent: stats.overdue > 0 ? "text-danger-600" : "" },
          { label: "Open Complaints", value: stats.open_complaints, accent: stats.open_complaints > 0 ? "text-purple-600" : "" },
        ].map((s) => (
          <div key={s.label} className="card-brutal p-4">
            <p className="label-mono text-muted-foreground">{s.label}</p>
            <p className={`font-heading text-2xl font-black tracking-tight mt-1 ${s.accent || ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Owner-as-IC personal snapshot -- the owner is also a contributor.
          Sits between company stats and team leaderboard so it reads as
          "here's how you're doing personally" without hijacking the page. */}
      {mySnapshot && <PersonalSnapshot stats={mySnapshot} viewerName={data.self?.name} />}

      {/* Employee leaderboard */}
      <div className="flex items-center gap-2 mb-4">
        <Trophy size={18} weight="bold" className="text-brand-600" />
        <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight">Team Execution</h2>
      </div>
      <p className="label-mono text-muted-foreground mb-3">Tap any member to see their full activity &amp; AI coaching.</p>
      <div className="card-brutal divide-y divide-black/10" data-testid="operating-employees">
        {rankedEmployees.map((e, i) => (
          <Link key={e.id} to={`/coach?user=${e.id}`} data-testid={`operating-emp-${e.id}`}
            className="p-4 flex items-center gap-4 hover:bg-black/[0.03] transition-colors group cursor-pointer">
            <span className="font-heading text-lg font-black text-black/30 w-6">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate group-hover:text-brand-600 transition-colors">{e.name}</p>
              <p className="label-mono text-muted-foreground">{e.role} · {e.done} done · {e.open} open{e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}</p>
            </div>
            <span className="hidden sm:flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-hover:text-brand-600 transition-colors shrink-0">
              <Sparkle size={13} weight="bold" /> Details
            </span>
            <div className="w-14 h-14 flex flex-col items-center justify-center border-2 border-black bg-white shrink-0">
              <span className={`font-heading text-2xl font-black leading-none ${scoreColor(e.score)}`}>{e.score != null ? e.score : "—"}</span>
            </div>
            <CaretRight size={16} weight="bold" className="text-black/30 group-hover:text-brand-600 transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// PersonalSnapshot -- a compact owner-as-IC widget reused inside OwnerView.
// -----------------------------------------------------------------------------
function PersonalSnapshot({ stats, viewerName }) {
  return (
    <div className="card-brutal p-6 mb-8" data-testid="operating-personal-snapshot">
      <div className="flex items-center gap-2 mb-1">
        <Sparkle size={16} weight="bold" className="text-brand-600" />
        <h2 className="font-heading text-lg font-extrabold uppercase tracking-tight">Your personal snapshot</h2>
      </div>
      <p className="label-mono text-muted-foreground mb-4">
        You're an operator too — this is your own execution, not the company's.
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Completion" value={`${stats.completion_rate}%`} accent={scoreColor(stats.completion_rate)} />
        <StatTile label="Open" value={stats.open} accent={stats.overdue > 0 ? "text-danger-600" : ""} />
        <StatTile label="Overdue" value={stats.overdue} accent={stats.overdue > 0 ? "text-danger-600" : ""} />
        <StatTile label="Proof rate" value={`${stats.proof_upload_rate}%`}
          hint={stats.proof_upload_rate < 40 && stats.completed > 0 ? "Attach a photo or voice on done tasks" : null} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SelfView -- the new per-contributor dashboard for any non-owner role.
// -----------------------------------------------------------------------------
function SelfView({ data }) {
  const { self, stats, my_open_work: openWork = [], my_active_workflows: activeWfs = [], peer_context: peer } = data;
  const scoreOfMe = _selfScore(stats);
  const hasActivity = stats.actionable > 0;

  return (
    <div>
      <PageHeader eyebrow="Your operating view" title={`Hi ${self.name?.split(" ")[0] || "there"} — here's how you're doing`} />

      {/* Hero -- personal score */}
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-self-hero">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-black bg-white">
            {hasActivity ? (
              <>
                <span className={`font-heading text-6xl font-black leading-none ${scoreColor(scoreOfMe)}`} data-testid="operating-self-score">
                  {scoreOfMe}
                </span>
                <span className="label-mono text-muted-foreground mt-1">/ 100</span>
              </>
            ) : (
              <span className="label-mono text-muted-foreground text-center px-2 leading-tight">
                Complete a task to see your score
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-brand-600" />
            <span className="font-heading font-extrabold uppercase tracking-tight text-sm">Your Health</span>
          </div>
        </div>

        <div className="flex-1 w-full">
          <p className="font-heading font-extrabold uppercase tracking-tight text-lg mb-3">
            {hasActivity
              ? _selfHeadline(stats, peer)
              : "Once you close a task or two, your score kicks in."}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Completed" value={stats.completed} />
            <StatTile label="Open" value={stats.open} />
            <StatTile label="Overdue" value={stats.overdue} accent={stats.overdue > 0 ? "text-danger-600" : ""} />
            <StatTile label="Completion" value={`${stats.completion_rate}%`} accent={scoreColor(stats.completion_rate)} />
          </div>
        </div>
      </div>

      {/* Rich breakdown -- signals only the individual view surfaces */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-8">
        <BreakdownCard
          icon={Camera}
          label="Proof rate"
          value={`${stats.proof_upload_rate}%`}
          detail={`${_pctToCount(stats.proof_upload_rate, stats.completed)} of ${stats.completed} done with photo/voice`}
          hint={stats.proof_upload_rate < 40 && stats.completed >= 3
            ? "Attach a photo or voice update on your next done task"
            : null}
        />
        <BreakdownCard
          icon={ClipboardText}
          label="Plans in use"
          value={`${stats.plans_completed}/${stats.plans_used}`}
          detail={`${stats.plans_used} accepted plan${stats.plans_used === 1 ? "" : "s"}, ${stats.plans_completed} finished`}
          hint={stats.plans_used === 0 && stats.actionable >= 3
            ? "Ask Dex to plan your next big task"
            : null}
        />
        <BreakdownCard
          icon={Check}
          label="Actionable"
          value={stats.actionable}
          detail={`${stats.completed} done + ${stats.open} open`}
        />
      </div>

      {/* My open work -- the surface a contributor actually acts on */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lightning size={18} weight="bold" className="text-brand-600" />
          <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight">Your open work</h2>
        </div>
        <Link to="/my-work" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-brand-600 flex items-center gap-1">
          See all <ArrowRight size={12} weight="bold" />
        </Link>
      </div>
      {openWork.length === 0 ? (
        <div className="card-brutal p-6 mb-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing open right now — good place to be.</p>
        </div>
      ) : (
        <div className="card-brutal divide-y divide-black/10 mb-8" data-testid="operating-self-open">
          {openWork.map((t) => (
            <Link key={t.id} to="/my-work" className="p-4 flex items-center gap-4 hover:bg-black/[0.03] transition-colors group">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate group-hover:text-brand-600">{t.title}</p>
                <p className="label-mono text-muted-foreground">
                  {t.status} · {t.priority || "med"}
                  {t.due_date ? ` · due ${_formatDate(t.due_date)}` : ""}
                  {t.stage_key ? ` · stage ${t.stage_key}` : ""}
                </p>
              </div>
              {t.is_overdue && (
                <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-danger-600 shrink-0">
                  <Warning size={12} weight="bold" /> Overdue
                </span>
              )}
              <CaretRight size={16} weight="bold" className="text-black/30 group-hover:text-brand-600 shrink-0" />
            </Link>
          ))}
        </div>
      )}

      {/* My active workflows -- where I own the current stage */}
      {activeWfs.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendUp size={18} weight="bold" className="text-brand-600" />
              <h2 className="font-heading text-xl font-extrabold uppercase tracking-tight">Workflows waiting on you</h2>
            </div>
            <Link to="/workflows" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-brand-600 flex items-center gap-1">
              See board <ArrowRight size={12} weight="bold" />
            </Link>
          </div>
          <div className="card-brutal divide-y divide-black/10 mb-8" data-testid="operating-self-workflows">
            {activeWfs.map((w) => (
              <Link key={w.id} to="/workflows" className="p-4 flex items-center gap-4 hover:bg-black/[0.03] transition-colors group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate group-hover:text-brand-600">{w.title}</p>
                  <p className="label-mono text-muted-foreground">
                    {w.type} · stage {w.stage}
                    {w.counterparty ? ` · ${w.counterparty}` : ""}
                    {w.amount ? ` · ₹${w.amount}` : ""}
                  </p>
                </div>
                <CaretRight size={16} weight="bold" className="text-black/30 group-hover:text-brand-600 shrink-0" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Peer context -- surfaced only when the comparison is meaningful
          (2+ ranked peers). A single-person role makes "1 of 1" noise, not
          a signal. A future Settings item (Phase B follow-up) will let users
          hide this even when peers exist. */}
      {peer && peer.my_rank_in_role && peer.role_ranked_size >= 2 && (
        <div className="card-brutal p-4 mb-8 flex items-center gap-3" data-testid="operating-self-peer">
          <Trophy size={16} weight="bold" className="text-brand-600 shrink-0" />
          <p className="text-sm">
            Among your <strong>{peer.role}</strong> peers you're ranked{" "}
            <strong>{peer.my_rank_in_role}</strong> of {peer.role_ranked_size}.
          </p>
        </div>
      )}

      <p className="label-mono text-muted-foreground mt-6">
        Want AI coaching on this?{" "}
        <Link to="/coach" className="text-brand-600 font-semibold hover:underline">Open your Work Coach →</Link>
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small components + helpers
// -----------------------------------------------------------------------------
function StatTile({ label, value, accent, hint }) {
  return (
    <div className="border border-black/30 p-3">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className={`font-heading text-2xl font-black tracking-tight mt-1 ${accent || ""}`}>{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1 leading-tight">{hint}</p>}
    </div>
  );
}

function BreakdownCard({ icon: Icon, label, value, detail, hint }) {
  return (
    <div className="card-brutal p-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} weight="bold" className="text-muted-foreground" />
        <p className="label-mono text-muted-foreground">{label}</p>
      </div>
      <p className="font-heading text-2xl font-black tracking-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{detail}</p>
      {hint && <p className="text-xs text-brand-600 mt-2 font-semibold">{hint}</p>}
    </div>
  );
}

// Self "score" -- same shape as _score_employees in the backend, computed
// client-side from the individual stats. Kept simple by design; when Phase B
// ships better formulas the backend can start returning this directly.
function _selfScore(stats) {
  if (!stats || stats.actionable === 0) return null;
  const completion = stats.completion_rate / 100;
  const overdueRatio = stats.open > 0 ? stats.overdue / stats.open : 0;
  const raw = completion * 100 - overdueRatio * 40;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function _selfHeadline(stats, peer) {
  const parts = [];
  if (stats.overdue > 0) {
    parts.push(`You have ${stats.overdue} overdue ${stats.overdue === 1 ? "task" : "tasks"} — clearing them lifts your score fastest.`);
  } else if (stats.completion_rate >= 80) {
    parts.push(`You're finishing what you start — ${stats.completed} tasks done at ${stats.completion_rate}%.`);
  } else if (stats.open > stats.completed) {
    parts.push(`${stats.open} tasks open vs ${stats.completed} done — a couple of closes and your score jumps.`);
  } else {
    parts.push(`${stats.completed} done, ${stats.open} open, ${stats.completion_rate}% completion.`);
  }
  if (peer && peer.my_rank_in_role === 1 && peer.role_ranked_size > 1) {
    parts.push("Leading your role right now.");
  }
  return parts.join(" ");
}

function _pctToCount(pct, total) {
  if (!total) return 0;
  return Math.round((pct / 100) * total);
}

function _formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

// -----------------------------------------------------------------------------
// U7-01.20 -- skeleton matches final page shape so layout doesn't jump.
// Same skeleton for owner + self because the role isn't known until data
// arrives. Uses tokenized muted-foreground colors so both themes read.
// -----------------------------------------------------------------------------
function OperatingScoreSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="operating-skeleton">
      <div className="mb-6">
        <div className="h-3 w-40 bg-black/10 mb-2 animate-pulse" />
        <div className="h-8 w-64 bg-black/10 animate-pulse" />
      </div>
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8">
        <div className="w-36 h-36 border-4 border-black/20 bg-black/5 shrink-0 animate-pulse" />
        <div className="flex-1 w-full space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <div className="h-3 w-32 bg-black/10 animate-pulse" />
                <div className="h-4 w-8 bg-black/10 animate-pulse" />
              </div>
              <div className="h-3 bg-black/10 border border-black/20" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-brutal p-4">
            <div className="h-3 w-16 bg-black/10 mb-3 animate-pulse" />
            <div className="h-6 w-10 bg-black/10 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card-brutal divide-y divide-black/10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-4 flex items-center gap-4">
            <div className="h-4 w-4 bg-black/10 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-40 bg-black/10 animate-pulse" />
              <div className="h-3 w-56 bg-black/10 animate-pulse" />
            </div>
            <div className="w-14 h-14 border-2 border-black/20 bg-black/5 shrink-0 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// U7-01.14 -- empty state as coaching checklist, not stat dump.
// The old panel showed 3 tiles of zeros and the word "still learning" -- true
// but useless. This one names the two gates that unlock the score
// (3+ actionable tasks OR 1+ invoice) as tickable items with direct actions.
// -----------------------------------------------------------------------------
function NotEnoughDataEmptyState({ stats }) {
  const doneCount = (stats?.done || 0) + (stats?.open || 0);
  const hasTasks = doneCount >= 3;
  const hasInvoices = (stats?.total_decisions || 0) > 0; // decisions is the closest proxy on the owner payload; invoice presence is inferred backend-side
  const taskProgress = Math.min(doneCount, 3);

  return (
    <div className="card-brutal p-8 mb-8" data-testid="operating-not-ready">
      <div className="flex flex-col lg:flex-row items-start gap-8">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center border-4 border-black bg-black/5 text-center px-3">
            <Gauge size={30} weight="bold" className="text-muted-foreground mb-1" />
            <span className="label-mono text-muted-foreground leading-tight" data-testid="operating-overall-score">
              Score kicks in soon
            </span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-brand-600" />
            <span className="font-heading font-extrabold uppercase tracking-tight text-sm">Company Health</span>
          </div>
        </div>
        <div className="flex-1 w-full">
          <p className="font-heading font-extrabold uppercase tracking-tight text-lg mb-2">
            Two quick things and your score turns on
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mb-5">
            The Operating Score needs a little real activity before it can say anything useful.
            Do either of these and it starts tracking automatically.
          </p>
          <div className="space-y-3">
            <ChecklistItem
              done={hasTasks}
              label={hasTasks
                ? "Capture 3 actionable tasks"
                : `Capture 3 actionable tasks  (${taskProgress} of 3)`}
              hint="Speak or type a decision on the Decision Desk -- it becomes tasks automatically."
              actionLabel="Open Desk"
              actionTo="/inbox"
              icon={Microphone}
            />
            <ChecklistItem
              done={hasInvoices}
              label="Add your first invoice"
              hint="Import from Tally / Zoho, upload a PDF, or log manually in Finance."
              actionLabel="Open Finance"
              actionTo="/finance"
              icon={Receipt}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label, hint, actionLabel, actionTo, icon: Icon }) {
  return (
    <div className={`border-2 ${done ? "border-green-600/40 bg-green-50" : "border-black/30"} p-4 flex items-start gap-3`}>
      <div className={`w-6 h-6 flex items-center justify-center border-2 ${done ? "border-green-600 bg-green-600 text-white" : "border-black/40"} shrink-0 mt-0.5`}>
        {done && <Check size={14} weight="bold" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${done ? "line-through text-muted-foreground" : ""}`}>{label}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{hint}</p>
      </div>
      {!done && (
        <Link
          to={actionTo}
          className="shrink-0 text-xs font-semibold uppercase tracking-wider text-brand-600 hover:underline flex items-center gap-1 mt-0.5"
        >
          <Icon size={12} weight="bold" /> {actionLabel}
        </Link>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// U7-01.16 -- collapsible formula panel. Every category's formula + weight in
// one place; opens on click, closed by default so it doesn't clutter the hero.
// -----------------------------------------------------------------------------
function FormulaExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-8 -mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-brand-600 transition-colors"
        aria-expanded={open}
        aria-controls="operating-formula-panel"
        data-testid="operating-formula-toggle"
      >
        <Info size={12} weight="bold" />
        How is this calculated?
        {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
      </button>
      {open && (
        <div id="operating-formula-panel" className="mt-3 card-brutal p-5 space-y-4 text-sm" data-testid="operating-formula-panel">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Overall = weighted average across the four categories below. Categories with no data yet are skipped and remaining weights renormalize.
          </p>
          {CATS.map((c) => (
            <div key={c.key} className="border-l-4 pl-4 border-black/20">
              <div className="flex items-center gap-2 mb-1">
                <c.icon size={14} weight="bold" className="text-muted-foreground" />
                <span className="font-semibold uppercase tracking-wide">{c.label}</span>
                <span className="label-mono text-muted-foreground">weight {c.weight}%</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{c.plain}</p>
              <p className="font-mono text-xs">{c.formula}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

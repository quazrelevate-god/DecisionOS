import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import {
  Gauge, Lightning, CurrencyCircleDollar, TrendUp, ChatCenteredDots, Trophy,
  Sparkle, CaretRight, Camera, ClipboardText, Check, Warning, ArrowRight,
  Info, CaretDown, CaretUp, Microphone, Receipt, X, ArrowUp, ArrowDown,
  ArrowsClockwise, Flame, Coins, CheckCircle,
} from "@phosphor-icons/react";
import {
  demoDelta, demoDrivers, demoDrilldowns, demoDex,
  demoActions, demoEmpDeltas, DEFAULT_WEIGHTS, WEIGHT_PRESETS,
} from "./_operatingScoreDemo";

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
  { key: "execution", label: "Execution", icon: Lightning,
    weight: 35,
    formula: "(tasks done ÷ total actionable) × 100  −  (overdue ÷ open) × 40",
    plain: "How much of what you started is finished on time." },
  { key: "finance", label: "Finance", icon: CurrencyCircleDollar,
    weight: 25,
    formula: "(paid ÷ billed) × 100  −  overdue invoices × 5",
    plain: "How well cash is coming in vs. how much is stuck." },
  { key: "sales", label: "Sales", icon: TrendUp, color: "bg-caution-50",
    weight: 20,
    formula: "approved decisions ÷ total decisions × 100",
    plain: "Rate at which raised decisions get a green light." },
  { key: "responsiveness", label: "Responsiveness", icon: ChatCenteredDots,
    weight: 20,
    formula: "100  −  (open complaints × 12)  −  (overdue tasks × 3)",
    plain: "How fast the team is closing loops -- complaints + missed dates." },
];

// NM-10: was green / amber / brand-600. Two problems — the first two were
// raw palette rather than the semantic ramps, and a LOW score being brand
// indigo said "this is the action to take" when it means "this is at risk".
// Now the ramps carry their own meaning: settled, waiting, at risk.
const scoreColor = (v) =>
  v == null ? "text-muted-foreground"
  : v >= 70 ? "text-success-600"
  : v >= 40 ? "text-caution-600"
  : "text-danger-600";

export default function OperatingScore() {
  // Sprint 1 batch 4 (2026-08-17): owner can view any team member's ops via
  // ?user=X. Backend returns that user's self-view payload plus view_as
  // metadata; frontend renders SelfView with a "viewing as X" breadcrumb.
  const [searchParams] = useSearchParams();
  const userIdParam = searchParams.get("user") || null;

  const { data, isLoading } = useQuery({
    queryKey: ["operating-score", userIdParam],
    queryFn: () => api
      .get("/operating-score", { params: userIdParam ? { user_id: userIdParam } : {} })
      .then((r) => r.data),
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
// ViewAsBanner -- shown when the owner is drilled into a teammate's ops.
// -----------------------------------------------------------------------------
function ViewAsBanner({ target }) {
  if (!target) return null;
  return (
    <div
      className="mb-4 border-2 border-brand-600 bg-brand-600/10 px-4 py-3 flex items-center justify-between gap-3"
      data-testid="operating-view-as-banner"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Sparkle size={16} weight="bold" className="text-brand-600 shrink-0" />
        <p className="text-sm truncate">
          Viewing <strong>{target.name}</strong>
          <span className="label-mono text-muted-foreground ml-2">{target.role}</span>
        </p>
      </div>
      <Link
        to="/operating-score"
        className="text-xs font-medium text-brand-600 hover:underline flex items-center gap-1 shrink-0"
      >
        <ArrowRight size={12} weight="bold" className="rotate-180" />
        Back to company view
      </Link>
    </div>
  );
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

  // U7-01.4: which category is drilled open. null = no drill.
  const [drillCat, setDrillCat] = useState(null);
  // U7-01.17: local weights override (backend persistence lands in Phase B).
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);

  return (
    <div>
      <PageHeader eyebrow="How well the business is running" title="Operating Score" />

      {!enough ? (
        <NotEnoughDataEmptyState stats={stats} />
      ) : (
        <>
          {/* U7-01.1 + U7-01.3 + U7-01.9 -- upgraded hero: score circle,
              delta chip vs last week, 30-day sparkline, one-sentence Dex
              narrative. This is the panel a founder reads first. */}
          <HeroCard overall={overall} />

          {/* U7-01.9 -- Dex explainer card. Longer diagnosis with a refresh
              button (mock refresh for now; wires to /api/ai/... later). */}
          <DexExplainerCard />

          {/* U7-01.10 -- suggested action chips derived from stats (demo).
              One tap from score to fix. */}
          <SuggestedActions />

          {/* U7-01.4 -- category CARDS with drivers + drill-in, replacing
              the old thin category bars. Grid of 4, click to open drill. */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
            {CATS.map((c) => (
              <CategoryCard
                key={c.key}
                cat={c}
                value={company.categories[c.key]}
                drivers={demoDrivers[c.key] || []}
                onDrillIn={() => setDrillCat(c.key)}
              />
            ))}
          </div>
        </>
      )}

      {/* U7-01.16 + U7-01.17: formula panel + weights editor, collapsed by default. */}
      {enough && <FormulaExplainer weights={weights} setWeights={setWeights} />}

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

      {/* U7-01.11 + U7-01.13 -- leaderboard with period label + sort. */}
      <Leaderboard employees={rankedEmployees} />

      {/* U7-01.5..8 -- category drill-down modal. One component with
          per-category demo payloads keeps the surface small. */}
      {drillCat && (
        <CategoryDrillModal
          cat={CATS.find((c) => c.key === drillCat)}
          value={company.categories[drillCat]}
          drivers={demoDrivers[drillCat] || []}
          drill={demoDrilldowns[drillCat]}
          onClose={() => setDrillCat(null)}
        />
      )}
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
        <h2 className="text-base font-medium">Your personal snapshot</h2>
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
  const {
    self, stats, my_open_work: openWork = [], my_active_workflows: activeWfs = [],
    peer_context: peer, view_as: viewAs,
  } = data;
  const scoreOfMe = _selfScore(stats);
  const hasActivity = stats.actionable > 0;

  // When the owner is drilled in as this user, the framing shifts from
  // "your view" to "their view" -- no need to say "Hi Sunita" back to Meera.
  const isViewAs = Boolean(viewAs);
  const firstName = self.name?.split(" ")[0] || "there";
  const title = isViewAs
    ? `${self.name}'s operating view`
    : `Hi ${firstName} — here's how you're doing`;
  const eyebrow = isViewAs ? "Team member ops (owner view)" : "Your operating view";

  return (
    <div>
      <ViewAsBanner target={viewAs} />
      <PageHeader eyebrow={eyebrow} title={title} />

      {/* Hero -- personal score */}
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8" data-testid="operating-self-hero">
        <div className="flex flex-col items-center shrink-0">
          <div className="w-36 h-36 flex flex-col items-center justify-center nm-tile bg-nm">
            {hasActivity ? (
              <>
                <span className={`text-5xl font-medium leading-none tabular-nums ${scoreColor(scoreOfMe)}`} data-testid="operating-self-score">
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
            <span className="font-medium text-sm">Your Health</span>
          </div>
        </div>

        <div className="flex-1 w-full">
          <p className="font-medium text-lg mb-3">
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
          <h2 className="font-heading text-xl font-medium tracking-tight">Your open work</h2>
        </div>
        <Link to="/my-work" className="text-xs font-medium text-muted-foreground hover:text-brand-600 flex items-center gap-1">
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
                <span className="flex items-center gap-1 text-xs font-medium text-danger-600 shrink-0">
                  <Warning size={12} weight="bold" /> Overdue
                </span>
              )}
              <CaretRight size={16} weight="bold" className="text-muted-foreground group-hover:text-brand-600 shrink-0" />
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
              <h2 className="text-base font-medium">Workflows waiting on you</h2>
            </div>
            <Link to="/workflows" className="text-xs font-medium text-muted-foreground hover:text-brand-600 flex items-center gap-1">
              See board <ArrowRight size={12} weight="bold" />
            </Link>
          </div>
          <div className="card-brutal divide-y divide-black/10 mb-8" data-testid="operating-self-workflows">
            {activeWfs.map((w) => (
              <Link key={w.id} to="/workflows" className="p-4 flex items-center gap-4 hover:bg-nm-sunken/40 transition-colors group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate group-hover:text-brand-600">{w.title}</p>
                  <p className="label-mono text-muted-foreground">
                    {w.type} · stage {w.stage}
                    {w.counterparty ? ` · ${w.counterparty}` : ""}
                    {w.amount ? ` · ₹${w.amount}` : ""}
                  </p>
                </div>
                <CaretRight size={16} weight="bold" className="text-muted-foreground group-hover:text-brand-600 shrink-0" />
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
        {isViewAs ? (
          <>
            Want to see the AI coaching for {self.name?.split(" ")[0]}?{" "}
            <Link to={`/coach?user=${self.id}`} className="text-brand-600 font-semibold hover:underline">Open their Work Coach →</Link>
          </>
        ) : (
          <>
            Want AI coaching on this?{" "}
            <Link to="/coach" className="text-brand-600 font-semibold hover:underline">Open your Work Coach →</Link>
          </>
        )}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small components + helpers
// -----------------------------------------------------------------------------
function StatTile({ label, value, accent, hint }) {
  return (
    <div className="nm-tile p-3">
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
// U7-01.1 -- Hero card: score circle + delta chip + one-sentence Dex
// narrative + 30-day sparkline behind. This is the panel a founder reads
// first, so it carries the whole "what's my number and what changed" story.
// -----------------------------------------------------------------------------
function HeroCard({ overall }) {
  // NM-10 — the score as a soft-depth dial.
  //
  // Was a 144px hard-bordered white square holding a 60px colour-banded
  // number, with a 30-day sparkline bleeding across the card behind it. Three
  // problems: the border was the retired brutalist language, the number
  // changed hue with the value so the card's whole mood swung on the data,
  // and the sparkline was decoration — the copy under it even admitted it
  // ("hover the score for the exact day") for a graph nothing could hover.
  //
  // Now: an inset well with the arc riding in it, monochrome, and the score
  // flat and high-contrast on top (§0 — depth is furniture, never the
  // message). The sparkline is gone entirely.
  const pct = Math.max(0, Math.min(100, Number(overall) || 0));
  const R = 62, C = 2 * Math.PI * R;
  return (
    <div className="card-brutal p-8 mb-4" data-testid="operating-overall">
      <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8">
        <div className="flex flex-col items-center shrink-0">
          <div className="relative grid place-items-center w-[152px] h-[152px] rounded-full nm-inset">
            <svg width="152" height="152" viewBox="0 0 152 152" className="-rotate-90 absolute inset-0">
              <circle cx="76" cy="76" r={R} fill="none" strokeWidth="8"
                className="stroke-nm-edge/30" />
              <circle
                cx="76" cy="76" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
                className="stroke-foreground/70 transition-[stroke-dashoffset] duration-700 ease-out"
                strokeDasharray={C}
                strokeDashoffset={C - (pct / 100) * C}
              />
            </svg>
            <div className="relative flex flex-col items-center">
              <span
                className="text-5xl font-medium leading-none tabular-nums"
                data-testid="operating-overall-score"
              >{overall}</span>
              <span className="text-xs text-muted-foreground mt-1">/ 100</span>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Gauge size={15} className="text-muted-foreground" />
            <span className="text-sm font-medium">Company health</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <DeltaChip value={demoDelta.value} sign={demoDelta.sign} />
            <span className="text-xs text-muted-foreground">{demoDelta.period}</span>
          </div>
          <p className="text-lg font-medium leading-snug">
            {demoDex.headline}
          </p>
        </div>
      </div>
    </div>
  );
}

// (U7-01.3's inline SVG Sparkline lived here. NM-10 removed the 30-day
// trend graph from the hero, and nothing else referenced it.)

function DeltaChip({ value, sign }) {
  if (value == null) return null;
  const isUp = sign === "up" || value > 0;
  const isDown = sign === "down" || value < 0;
  const abs = Math.abs(value);
  const tone = isUp ? "bg-green-100 text-green-800 border-green-600"
             : isDown ? "bg-red-100 text-red-800 border-red-600"
             : "bg-nm-sunken text-muted-foreground border-nm-edge/40";
  const Icon = isUp ? ArrowUp : isDown ? ArrowDown : null;
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 px-2 py-0.5 text-sm font-heading font-black ${tone}`}
      data-testid="operating-delta-chip"
    >
      {Icon && <Icon size={12} weight="bold" />}
      {isUp ? "+" : isDown ? "−" : ""}{abs}
    </span>
  );
}

// -----------------------------------------------------------------------------
// U7-01.9 -- Dex explainer card. Longer diagnosis + refresh button.
// Refresh is mocked; wires to /api/ai/operating-score-explain later.
// -----------------------------------------------------------------------------
function DexExplainerCard() {
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState(demoDex.explainer);
  const refresh = () => {
    setRefreshing(true);
    // fake latency; in production this is an AI call under DPDP consent gate.
    setTimeout(() => {
      setText(demoDex.explainer);
      setRefreshing(false);
    }, 900);
  };
  return (
    <div className="card-brutal p-5 mb-4 flex items-start gap-4 bg-brand-600/5" data-testid="operating-dex-explainer">
      <div className="w-10 h-10 border-2 border-brand-600 bg-nm flex items-center justify-center shrink-0" aria-hidden="true">
        <Sparkle size={18} weight="bold" className="text-brand-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-brand-600">Dex says</span>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="text-xs text-muted-foreground hover:text-brand-600 inline-flex items-center gap-1"
            aria-label="Ask Dex to re-explain"
          >
            <ArrowsClockwise size={11} weight="bold" className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "thinking..." : "refresh"}
          </button>
        </div>
        <p className="text-sm leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// U7-01.10 -- Suggested-action chip row. Turns "here are the numbers" into
// "here's what to do first". Each chip carries an estimated point-lift.
// -----------------------------------------------------------------------------
function SuggestedActions() {
  const iconMap = { flame: Flame, money: Coins, check: CheckCircle };
  return (
    <div className="mb-6" data-testid="operating-suggested-actions">
      <p className="label-mono text-muted-foreground mb-2">Do these first — expected lift shown</p>
      <div className="flex flex-wrap gap-2">
        {demoActions.map((a) => {
          const Icon = iconMap[a.icon] || Sparkle;
          return (
            <Link
              key={a.label}
              to={a.to}
              className="inline-flex items-center gap-2 nm-tile px-3 py-2 text-sm font-semibold hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-colors group"
            >
              <Icon size={14} weight="bold" />
              <span>{a.label}</span>
              <span className="label-mono opacity-70 group-hover:opacity-100">{a.lift}</span>
              <ArrowRight size={12} weight="bold" className="opacity-40 group-hover:opacity-100" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// U7-01.4 -- Category card. Replaces the old thin bars. Shows value + bar +
// top 3 drivers + "drill in" affordance. Clickable to open the modal.
// -----------------------------------------------------------------------------
function CategoryCard({ cat, value, drivers, onDrillIn }) {
  const has = value != null;
  const toneColor = {
    good: "text-green-600",
    warn: "text-amber-600",
    bad: "text-danger-600",
    neutral: "text-muted-foreground",
  };
  return (
    <button
      type="button"
      onClick={onDrillIn}
      disabled={!has}
      className="card-brutal p-4 text-left hover:border-brand-600 hover:shadow-md transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      data-testid={`operating-cat-${cat.key}`}
      aria-label={`${cat.label} — drill in`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold ">
          <cat.icon size={14} weight="bold" className="text-muted-foreground" /> {cat.label}
        </span>
        <span
          title={`${cat.plain}\n\nFormula: ${cat.formula}\nWeight: ${cat.weight}%`}
          className="text-muted-foreground hover:text-brand-600 cursor-help"
          aria-label={`How ${cat.label} is calculated`}
        >
          <Info size={12} weight="bold" />
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span
          className={`text-4xl font-medium leading-none tabular-nums ${scoreColor(value)}`}
          role="progressbar"
          aria-valuenow={has ? value : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${cat.label}: ${has ? value : "no data"} out of 100`}
        >{has ? value : "—"}</span>
        <span className="label-mono text-muted-foreground">/ 100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill nm-inset mb-3" aria-hidden="true">
        {/* NM-10: monochrome. Four categories in four different hues made the
                page read as a chart legend; the VALUE beside it already says
                good or bad. */}
        <div className="h-full rounded-full bg-foreground/25 transition-[width] duration-700"
             style={{ width: `${has ? value : 0}%` }} />
      </div>
      <ul className="space-y-1">
        {drivers.slice(0, 3).map((d, i) => (
          <li key={i} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground truncate pr-2">{d.label}</span>
            <span className={`label-mono tabular-nums ${toneColor[d.tone] || "text-muted-foreground"}`}>{d.value}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t border-nm-edge/40 flex items-center justify-between text-xs font-semibold text-muted-foreground">
        <span>See breakdown</span>
        <CaretRight size={12} weight="bold" />
      </div>
    </button>
  );
}

// -----------------------------------------------------------------------------
// U7-01.5..8 -- Category drill-down modal. One component; per-category
// payload keeps the surface small. Closes on backdrop click, Esc, or X.
// -----------------------------------------------------------------------------
function CategoryDrillModal({ cat, value, drivers, drill, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toneColor = {
    good: "text-green-600", warn: "text-amber-600",
    bad: "text-danger-600", neutral: "text-muted-foreground",
  };
  const has = value != null;
  return (
    <div
      className="fixed inset-0 z-50 bg-muted0 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drill-title"
      data-testid={`operating-drill-${cat.key}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="nm-raised max-w-2xl w-full max-h-[85vh] flex flex-col shadow-nm-lg"
      >
        <div className="p-5 border-b border-nm-edge/30 bg-nm-sunken flex items-start gap-4">
          <div className="w-12 h-12 flex items-center justify-center nm-tile shrink-0">
            <cat.icon size={22} weight="bold" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="label-mono text-muted-foreground">Weight {cat.weight}% of overall</p>
            <h2 id="drill-title" className="font-display text-2xl leading-tight">
              {drill?.title || cat.label}
            </h2>
          </div>
          <span className={`text-5xl font-medium tabular-nums ${scoreColor(value)} shrink-0`}>
            {has ? value : "—"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 nm-tile flex items-center justify-center hover:bg-black hover:text-white shrink-0"
            aria-label="Close drill-down"
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-5 border-b border-nm-edge/40">
            <p className="text-sm font-semibold mb-1">{drill?.hero}</p>
            <p className="font-mono text-xs text-muted-foreground mt-2">{cat.formula}</p>
          </div>

          <div className="p-5 border-b border-nm-edge/40">
            <p className="text-xs font-medium mb-3">Top drivers this period</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {drivers.map((d, i) => (
                <div key={i} className="nm-tile p-3">
                  <p className="label-mono text-muted-foreground">{d.label}</p>
                  <p className={`font-heading text-xl font-black tabular-nums ${toneColor[d.tone] || ""}`}>{d.value}</p>
                </div>
              ))}
            </div>
          </div>

          {drill?.items && (
            <div className="p-5">
              <p className="text-xs font-medium mb-3">Specifics</p>
              <ul className="divide-y divide-black/10 nm-tile">
                {drill.items.map((item, i) => (
                  <li key={i} className="p-3 flex items-center gap-3">
                    <span className={`w-1.5 h-8 shrink-0 ${
                      item.tone === "bad" ? "bg-danger-600" :
                      item.tone === "warn" ? "bg-amber-500" :
                      item.tone === "good" ? "bg-success-600" : "bg-foreground/20"
                    }`} aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{item.title}</p>
                      <p className="label-mono text-muted-foreground">{item.meta}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {drill?.action && (
          <div className="p-4 border-t border-nm-edge/40 flex items-center justify-between gap-3 bg-nm-sunken/40">
            <span className="text-xs text-muted-foreground">Ready to act?</span>
            <Link
              to={drill.action.to}
              onClick={onClose}
              className="inline-flex items-center gap-2 nm-tile bg-black text-white px-4 py-2 text-sm font-semibold hover:bg-brand-600 hover:border-brand-600 transition-colors"
            >
              {drill.action.label}
              <ArrowRight size={14} weight="bold" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// U7-01.11 + U7-01.13 -- Leaderboard: period label, per-person delta chips,
// sort dropdown (score / name / activity).
// -----------------------------------------------------------------------------
function Leaderboard({ employees }) {
  const [sortBy, setSortBy] = useState("score");
  const sorted = useMemo(() => {
    const copy = [...(employees || [])];
    copy.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "activity") return (b.done + b.open) - (a.done + a.open);
      // default: score desc, null last
      return (b.score ?? -1) - (a.score ?? -1);
    });
    return copy;
  }, [employees, sortBy]);

  return (
    <>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Trophy size={18} weight="bold" className="text-brand-600" />
          <h2 className="text-base font-medium">Team Execution</h2>
          <span className="label-mono text-muted-foreground">— last 30 days</span>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Sort by
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="nm-tile px-2 py-1 text-xs font-semibold"
            aria-label="Sort team by"
            data-testid="operating-leaderboard-sort"
          >
            <option value="score">Score</option>
            <option value="activity">Activity</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <p className="label-mono text-muted-foreground mb-3">
        Tap any member to see their full ops — open tasks, active workflows, and AI coaching.
      </p>
      <div className="card-brutal divide-y divide-black/10" data-testid="operating-employees">
        {sorted.map((e, i) => {
          const delta = demoEmpDeltas[e.role];
          return (
            <div key={e.id} data-testid={`operating-emp-${e.id}`}
              className="p-4 flex items-center gap-4 hover:bg-nm-sunken/40 transition-colors group">
              <span className="font-heading text-lg font-black text-muted-foreground w-6">{i + 1}</span>
              {/* Primary action: full ops view (open tasks + active workflows +
                  peer context). Sprint 1 batch 4 -- was /coach which only had
                  stats + AI review. Founder ask: 'from the owner side if i
                  click the team member is it working better or not will show
                  their tasks all the things the individual ops has right'. */}
              <Link to={`/operating-score?user=${e.id}`} className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate group-hover:text-brand-600 transition-colors">{e.name}</p>
                <p className="label-mono text-muted-foreground">
                  {e.role} · {e.done} done · {e.open} open{e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}
                </p>
              </Link>
              {delta !== undefined && delta !== 0 && (
                <DeltaChip value={delta} sign={delta > 0 ? "up" : "down"} />
              )}
              {/* Secondary: AI coach (WorkCoach). Kept as its own affordance so
                  owner can jump straight to coaching without going through ops. */}
              <Link
                to={`/coach?user=${e.id}`}
                className="hidden sm:flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand-600 transition-colors shrink-0"
                title="Open AI coach for this person"
              >
                <Sparkle size={13} weight="bold" /> Coach
              </Link>
              <Link to={`/operating-score?user=${e.id}`}
                className="w-14 h-14 flex flex-col items-center justify-center nm-tile shrink-0 hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-colors">
                <span className={`font-heading text-2xl font-black leading-none ${scoreColor(e.score)}`}>
                  {e.score != null ? e.score : "—"}
                </span>
              </Link>
              <Link to={`/operating-score?user=${e.id}`}>
                <CaretRight size={16} weight="bold" className="text-black/30 hover:text-brand-600 transition-colors shrink-0" />
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// U7-01.15 -- Inline capture on the empty state. Small mic + text input so
// a first-time tenant doesn't need to bounce to Desk to make progress.
// -----------------------------------------------------------------------------
function InlineCapture() {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    // Real wiring: POST /api/voice-notes with kind='text', source='ops-empty'.
    setSent(true);
    setText("");
    setTimeout(() => setSent(false), 2400);
  };
  return (
    <form
      onSubmit={submit}
      className="mt-5 nm-tile bg-nm-sunken/40 p-3 flex items-center gap-2"
      data-testid="operating-inline-capture"
    >
      <Microphone size={16} weight="bold" className="text-brand-600 shrink-0" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or capture a decision right here — 'Ship 200 units to Delhi Retail by Friday'"
        className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
        aria-label="Capture a decision"
      />
      <button
        type="submit"
        disabled={!text.trim()}
        className="nm-tile bg-black text-white px-3 py-1 text-xs font-semibold hover:bg-brand-600 hover:border-brand-600 transition-colors disabled:opacity-40"
      >
        Capture
      </button>
      {sent && (
        <span className="label-mono text-green-600 flex items-center gap-1" role="status">
          <Check size={12} weight="bold" /> sent
        </span>
      )}
    </form>
  );
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
        <div className="h-3 w-40 bg-nm-sunken mb-2 animate-pulse" />
        <div className="h-8 w-64 bg-nm-sunken animate-pulse" />
      </div>
      <div className="card-brutal p-8 mb-8 flex flex-col lg:flex-row items-center gap-8">
        <div className="w-36 h-36 nm-tile bg-nm-sunken shrink-0 animate-pulse" />
        <div className="flex-1 w-full space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1">
                <div className="h-3 w-32 bg-nm-sunken animate-pulse" />
                <div className="h-4 w-8 bg-nm-sunken animate-pulse" />
              </div>
              <div className="h-3 bg-nm-sunken nm-tile" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-brutal p-4">
            <div className="h-3 w-16 bg-nm-sunken mb-3 animate-pulse" />
            <div className="h-6 w-10 bg-nm-sunken animate-pulse" />
          </div>
        ))}
      </div>
      <div className="card-brutal divide-y divide-black/10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-4 flex items-center gap-4">
            <div className="h-4 w-4 bg-nm-sunken animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-40 bg-nm-sunken animate-pulse" />
              <div className="h-3 w-56 bg-nm-sunken animate-pulse" />
            </div>
            <div className="w-14 h-14 nm-tile/20 bg-nm-sunken shrink-0 animate-pulse" />
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
          <div className="w-36 h-36 flex flex-col items-center justify-center rounded-full nm-inset text-center px-4">
            <Gauge size={30} weight="bold" className="text-muted-foreground mb-1" />
            <span className="label-mono text-muted-foreground leading-tight" data-testid="operating-overall-score">
              Score kicks in soon
            </span>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Gauge size={16} weight="bold" className="text-brand-600" />
            <span className="font-medium text-sm">Company Health</span>
          </div>
        </div>
        <div className="flex-1 w-full">
          <p className="font-medium text-lg mb-2">
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

          {/* U7-01.15 -- inline capture: skip the round trip to Desk for
              first-time users. Prefills a quick text-decision box right here
              so they can act without bouncing pages. */}
          <InlineCapture />
        </div>
      </div>
    </div>
  );
}

function ChecklistItem({ done, label, hint, actionLabel, actionTo, icon: Icon }) {
  return (
    <div className={`border-2 ${done ? "border-green-600/40 bg-green-50" : "border-nm-edge/40"} p-4 flex items-start gap-3`}>
      <div className={`w-6 h-6 flex items-center justify-center border-2 ${done ? "border-success-600 bg-success-600 text-white" : "border-nm-edge/40"} shrink-0 mt-0.5`}>
        {done && <Check size={14} weight="bold" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${done ? "line-through text-muted-foreground" : ""}`}>{label}</p>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{hint}</p>
      </div>
      {!done && (
        <Link
          to={actionTo}
          className="shrink-0 text-xs font-medium text-brand-600 hover:underline flex items-center gap-1 mt-0.5"
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
function FormulaExplainer({ weights = DEFAULT_WEIGHTS, setWeights }) {
  const [open, setOpen] = useState(false);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const applyPreset = (key) => setWeights && setWeights(WEIGHT_PRESETS[key].weights);
  const setOne = (key, val) => setWeights && setWeights({ ...weights, [key]: Math.max(0, Math.min(100, val)) });

  return (
    <div className="mb-8 -mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-brand-600 transition-colors"
        aria-expanded={open}
        aria-controls="operating-formula-panel"
        data-testid="operating-formula-toggle"
      >
        <Info size={12} weight="bold" />
        How is this calculated?
        {open ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />}
      </button>
      {open && (
        <div id="operating-formula-panel" className="mt-3 card-brutal p-5 space-y-5 text-sm" data-testid="operating-formula-panel">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Overall = weighted average across the four categories below. Categories with no data yet are skipped and remaining weights renormalize.
          </p>

          {/* U7-01.17 -- weights editor. Presets first, sliders below. */}
          {setWeights && (
            <div className="nm-tile p-4 bg-nm-sunken/40">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium">Customize weights for your business</p>
                <span className={`label-mono ${total === 100 ? "text-muted-foreground" : "text-danger-600"}`}>
                  total: {total}%
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(WEIGHT_PRESETS).map(([k, p]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => applyPreset(k)}
                    className="nm-tile px-3 py-1.5 text-xs font-semibold hover:bg-brand-600 hover:text-white hover:border-brand-600 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {CATS.map((c) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <span className="w-32 flex items-center gap-2 text-xs font-semibold  shrink-0">
                      <c.icon size={12} weight="bold" className="text-muted-foreground" /> {c.label}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      step="5"
                      value={weights[c.key]}
                      onChange={(e) => setOne(c.key, Number(e.target.value))}
                      className="flex-1"
                      aria-label={`${c.label} weight`}
                    />
                    <span className="w-14 text-right label-mono tabular-nums">{weights[c.key]}%</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {total !== 100
                  ? "Weights should add up to 100%. Pick a preset or adjust the sliders."
                  : "Local preview only -- backend persistence lands next."}
              </p>
            </div>
          )}

          {CATS.map((c) => (
            <div key={c.key} className="border-l-4 pl-4 border-nm-edge/40">
              <div className="flex items-center gap-2 mb-1">
                <c.icon size={14} weight="bold" className="text-muted-foreground" />
                <span className="font-semibold ">{c.label}</span>
                <span className="label-mono text-muted-foreground">weight {weights[c.key]}%</span>
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

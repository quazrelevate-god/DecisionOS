// /operating-score — KR-9. The DIAGNOSTIC surface: /inbox says "72", this page
// says "because" — the four categories, what is dragging each one, and the
// team behind them.
//
// 2026-09-14, founder — rebuilt end to end on the founder's reference:
//   * a title with one line under it, and the scope the numbers cover;
//   * row one: the overall score (numeral, band word, ring), the four
//     categories as cards that open their breakdown, and "Do these first";
//   * row two: "Team & work health" and "Your own execution", four tiles each;
//   * "How is this calculated?" on the notch of a dark "Team execution" card,
//     which is a table now — rank, member, department, score, activity — split
//     into two halves on wide screens.
//
// HONESTY, carried from KR-9. The reference draws sparklines and a "Last 30
// days" picker. Nothing in the system keeps score history, and
// /operating-score counts every task, decision and complaint on record, so a
// trend line would be invented and a period picker would change nothing. The
// tiles carry small instruments fed by real ratios instead (done of all work,
// overdue of open, open complaints as dots), and the header states the scope
// as it is: all time. demoDex, demoDelta, demoDrivers and demoDrilldowns still
// render only for the demo tenant (isDemoTenant).
//
// Deep link preserved: /operating-score?user=<id> renders that person's
// self-view with the view-as strip (U7-01.40).
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { selfScore, scoreBand, scoreActions } from "../lib/karmaScore";
import { StickyHeader } from "../components/common";
import { CircleDots } from "../components/karma/MiniViz";
import {
  ArrowLeft, ArrowRight, CalendarBlank, CaretDown, CaretRight, ChartBar, ChartLineUp, ChatCircleText,
  Check, CheckCircle, ClipboardText, Coins, Eye, Flag, Gauge, Info, ListBullets, ListChecks,
  MagnifyingGlass, Microphone, Receipt, ShieldCheck, Timer, Trophy, User, UsersThree, Warning,
  WarningCircle, X,
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import {
  DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL, DRAWER_TRACK, GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL,
} from "../components/karma/glass";
import { GlassSelect } from "../components/karma/GlassSelect";
import { cn } from "@/lib/utils";
import {
  isDemoTenant, demoDelta, demoDrivers, demoDrilldowns, demoDex,
  DEFAULT_WEIGHTS, WEIGHT_PRESETS,
} from "./_operatingScoreDemo";

// U7-01.16: each category carries its formula and weight so the page can say
// WHAT the number measures. Weights match services/operating_score.py
// (35 / 25 / 20 / 20).
const CATS = [
  { key: "execution", label: "Execution", icon: ListChecks, weight: 35,
    formula: "(tasks done ÷ total actionable) × 100  −  (overdue ÷ open) × 40",
    plain: "How much of what you started is finished on time." },
  { key: "finance", label: "Finance", icon: Coins, weight: 25,
    formula: "(paid ÷ billed) × 100  −  overdue invoices × 5",
    plain: "How well cash is coming in vs. how much is stuck." },
  { key: "sales", label: "Sales", icon: ChartBar, weight: 20,
    formula: "approved decisions ÷ total decisions × 100",
    plain: "Rate at which raised decisions get a green light." },
  { key: "responsiveness", label: "Responsiveness", icon: Timer, weight: 20,
    formula: "100  −  (open complaints × 12)  −  (overdue tasks × 3)",
    plain: "How fast the team is closing loops — complaints and missed dates." },
];

// KR-9 — below 40 is the one place a score raises its voice (orange); above
// it the bar is the calm green the reference uses.
const isFailing = (v) => v != null && v < 40;
const pctOf = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const CARD = "rounded-[1.6rem] bg-white/75 ring-1 ring-inset ring-white shadow-[0_14px_36px_-18px_hsl(150_15%_20%/0.28),0_1px_2px_hsl(150_15%_20%/0.06)] backdrop-blur-xl";
const TILE = "rounded-[1.25rem] bg-white/85 ring-1 ring-inset ring-white shadow-[0_8px_22px_-14px_hsl(150_15%_20%/0.3)]";
const BAR_GOOD = "bg-[linear-gradient(90deg,hsl(140_18%_30%),hsl(140_22%_42%))]";
const BAR_LOW = "bg-[linear-gradient(90deg,hsl(18_92%_52%),hsl(30_95%_58%))]";
const DARK_BAND = "bg-[linear-gradient(180deg,hsl(220_9%_13%),hsl(220_11%_7%))]";

const BAND_COPY = {
  Excellent: "Every key area is in good shape. Keep the rhythm going.",
  Good: "Most areas are healthy — a couple could use attention.",
  Fair: "Some key areas need attention. Start with “Do these first”.",
  "Needs work": "Key operational areas have challenges. Start with “Do these first”.",
};

const roleLabelFor = (roles, key) => {
  if (key === "owner") return "Owner";
  if (!key) return "—";
  return roles.find((r) => r.key === key)?.label || key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
function initialsOf(name) {
  const parts = String(name || "").replace(/[_.-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function OperatingScore() {
  const [searchParams] = useSearchParams();
  const userIdParam = searchParams.get("user") || null;

  const { data, isLoading } = useQuery({
    queryKey: ["operating-score", userIdParam],
    queryFn: () => api
      .get("/operating-score", { params: userIdParam ? { user_id: userIdParam } : {} })
      .then((r) => r.data),
  });

  if (isLoading || !data) return <OperatingScoreSkeleton />;

  const isOwnerView = data.view === "owner" || Boolean(data.company);
  return isOwnerView ? <OwnerView data={data} /> : <SelfView data={data} />;
}

// ─── page furniture ──────────────────────────────────────────────────────────

function PageHeader({ title, subtitle }) {
  return (
    <StickyHeader className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground sm:text-base" data-testid="operating-subtitle">{subtitle}</p>}
        </div>
        {/* The scope, stated rather than offered: the scores count everything
            on record, so a period picker would have nothing to change. */}
        <span data-testid="operating-scope" title="Scores count every task, decision and complaint on record."
          className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-700 ${GLASS_PILL}`}>
          <CalendarBlank size={17} aria-hidden="true" /> All time
        </span>
      </div>
    </StickyHeader>
  );
}

/** The owner is looking at someone else's page — a mode, so it is said. */
function ViewAsBanner({ target }) {
  if (!target) return null;
  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${DRAWER_CARD}`} data-testid="operating-view-as-banner">
      <p className="flex min-w-0 items-center gap-2.5 text-sm text-slate-700">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-700 ${GLASS_PILL}`}>
          <Eye size={16} weight="bold" aria-hidden="true" />
        </span>
        <span className="truncate">Viewing <strong className="font-semibold text-slate-900">{target.name}</strong></span>
        {target.role && <span className="text-slate-500">· {target.role}</span>}
      </p>
      <Link to="/operating-score" className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
        <ArrowLeft size={14} weight="bold" aria-hidden="true" /> Back to company
      </Link>
    </div>
  );
}

function Bar({ value, label, dark = false, className, testid }) {
  const has = value != null && Number.isFinite(Number(value));
  const pct = has ? Math.max(0, Math.min(100, Number(value))) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={has ? pct : undefined}
      data-testid={testid}
      className={cn("h-2 w-full overflow-hidden rounded-full", dark ? "bg-white/[0.12]" : "bg-slate-900/[0.07]", className)}>
      {pct > 0 && (
        <div className={cn("h-full rounded-full", isFailing(pct) ? BAR_LOW : dark ? "bg-emerald-400" : BAR_GOOD)} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

/** The reference's ring: a soft track, the score as a dark green arc from the
 *  top, and the number again in a white disc at its centre. */
function ScoreRing({ value, size = 148, stroke = 14, testid }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} data-testid={testid}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-slate-900/[0.06]" />
        {pct > 0 && (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${(c * pct) / 100} ${c}`} className="stroke-[hsl(140_18%_32%)]" />
        )}
      </svg>
      <div className="absolute inset-[20px] grid place-items-center rounded-full bg-white/90 text-center shadow-[inset_0_1px_0_hsl(0_0%_100%),0_8px_20px_-12px_hsl(150_15%_20%/0.4)]">
        <div>
          <p className="font-display text-3xl leading-none text-slate-900 tabular-nums">{value ?? "—"}</p>
          <p className="mt-1 text-[11px] text-slate-500">out of 100</p>
        </div>
      </div>
    </div>
  );
}

function OverallCard({ title, score, caption, delta, onExplain, testid }) {
  const band = scoreBand(score);
  return (
    <section data-testid={testid} className={`relative overflow-hidden p-5 sm:p-6 ${CARD}`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_85%_at_85%_25%,hsl(120_32%_90%/0.9),transparent_65%)]" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[17px] font-semibold text-slate-900">
          {title}
          {onExplain && (
            <button type="button" onClick={onExplain} aria-label="How is this calculated?" title="How is this calculated?"
              data-testid="operating-explain"
              className="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition-colors hover:bg-white/80 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
              <Info size={17} aria-hidden="true" />
            </button>
          )}
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="font-display text-7xl leading-none text-slate-900 tabular-nums sm:text-8xl" data-testid="operating-overall-score">{score ?? "—"}</span>
              {score != null && <span className="text-2xl text-slate-500">/ 100</span>}
            </p>
            {band && <p className="mt-3 text-xl font-semibold text-slate-900" data-testid="operating-band-word">{band}</p>}
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-600">{caption}</p>
            {delta}
          </div>
          <div className="hidden lg:block"><ScoreRing value={score} testid="operating-gauge" /></div>
        </div>
      </div>
    </section>
  );
}

/* PILOT-1 D — a category with no number says WHY. It used to be only "No
   access to this area" (Finance, for someone who cannot see money). A category
   with nothing to measure yet — no invoices, no decisions — used to be scored
   70 instead; it is left out of the overall now, and says so. */
const UNSCORED_WORDS = {
  no_access: "No access to this area",
  no_data: "Nothing to score yet — left out of the total",
};

function CategoryCard({ cat, value, reason, onOpen }) {
  const has = value != null;
  const why = UNSCORED_WORDS[reason] || UNSCORED_WORDS.no_access;
  return (
    <button type="button" onClick={onOpen} disabled={!has} data-testid={`operating-cat-${cat.key}`}
      data-unscored={has ? undefined : (reason || "no_access")}
      aria-label={has ? `${cat.label}: ${value} out of 100 — see breakdown` : `${cat.label}: ${why}`}
      className={`group flex min-w-0 flex-col p-4 text-left transition-[transform,box-shadow] duration-200 enabled:hover:-translate-y-0.5 enabled:hover:shadow-[0_18px_40px_-18px_hsl(150_15%_20%/0.35)] disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 motion-reduce:transition-none ${CARD}`}>
      <span className="flex w-full items-center gap-2 text-[15px] font-medium text-slate-800">
        <cat.icon size={18} aria-hidden="true" className="shrink-0 text-slate-600" />
        <span className="min-w-0 flex-1 truncate">{cat.label}</span>
        {has && <CaretRight size={13} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-4xl leading-none text-slate-900 tabular-nums">{has ? value : "—"}</span>
        <span className="text-sm text-slate-500">/ 100</span>
      </span>
      <Bar value={value} label={`${cat.label} score`} className="mt-4" testid={`operating-meter-${cat.key}`} />
      <span className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-500">
        {has ? <>See breakdown <CaretRight size={11} weight="bold" aria-hidden="true" /></> : why}
      </span>
    </button>
  );
}

const ACTION_ICON = { overdue: CheckCircle, complaints: ChatCircleText, weakest: ChartLineUp, "first-close": Flag };

/** What to do first — derived from real stats (lib/karmaScore), claiming no lift. */
function DoTheseFirst({ actions, onDrill, note, className = "" }) {
  return (
    <section data-testid="operating-next-moves" className={`flex min-w-0 flex-col p-5 sm:p-6 ${CARD} ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-700 ${TILE}`}>
          <ListBullets size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Do these first</h2>
          <p className="text-sm text-slate-500">Key actions to improve your operating score.</p>
        </div>
      </div>
      {note && <p className="mt-4 text-sm leading-relaxed text-slate-600" data-testid="operating-dex-note">{note}</p>}
      {actions.length > 0 ? (
        <ul className="mt-4 divide-y divide-slate-900/[0.06] border-t border-slate-900/[0.06]">
          {actions.map((a) => {
            const Icon = ACTION_ICON[a.key] || ArrowRight;
            const inner = (
              <>
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-700 ${TILE}`}>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-slate-900">{a.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{a.why}</span>
                </span>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[hsl(120_28%_91%)] text-slate-800 ring-1 ring-inset ring-white transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none">
                  <ArrowRight size={15} weight="bold" aria-hidden="true" />
                </span>
              </>
            );
            const cls = "group flex w-full items-center gap-3 rounded-xl py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
            return (
              <li key={a.key}>
                {a.to ? (
                  <Link to={a.to} className={cls} data-testid={`ops-action-${a.key}`}>{inner}</Link>
                ) : (
                  <button type="button" onClick={() => onDrill(a.drill)} className={cls} data-testid={`ops-action-${a.key}`}>{inner}</button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-slate-500" data-testid="operating-next-moves-empty">Nothing urgent right now — keep the rhythm going.</p>
      )}
    </section>
  );
}

function SectionHead({ icon: Icon, title, sub }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-700">
        <Icon size={22} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {sub && <p className="text-sm text-slate-500">{sub}</p>}
      </div>
    </div>
  );
}

const TONE_ICON = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  quiet: "bg-slate-500/[0.07] text-slate-600 ring-slate-500/10",
  bad: "bg-rose-50 text-rose-600 ring-rose-100",
  warn: "bg-orange-50 text-orange-600 ring-orange-100",
};
const METER_TONE = { good: "bg-emerald-600", quiet: "bg-slate-400", bad: "bg-rose-500", warn: "bg-orange-500" };

/** A tile's corner instrument: the share it stands for, as a small bar. */
function TileMeter({ value, tone, label, showValue = true }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <span className="flex w-14 flex-col items-end gap-1" title={label}>
      {/* Hidden where the tile's own number is already the percentage. */}
      {showValue && <span className="text-[11px] tabular-nums text-slate-500" aria-hidden="true">{pct}%</span>}
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-900/[0.07]" aria-hidden="true">
        <span className={`block h-full rounded-full ${METER_TONE[tone]}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function HealthTile({ icon: Icon, tone = "quiet", label, value, suffix, to, testid, instrument }) {
  const body = (
    <>
      {/* Icon and arrow share the top line; the label gets a line of its own,
          so "Open complaints" reads whole in a quarter-width tile. */}
      <div className="flex items-center justify-between gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1 ring-inset ${TONE_ICON[tone]}`}>
          <Icon size={16} aria-hidden="true" />
        </span>
        {to && <CaretRight size={12} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />}
      </div>
      <p className="mt-2.5 truncate text-[13px] text-slate-700">{label}</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
        <p className="font-display text-[1.75rem] leading-none text-slate-900 tabular-nums">
          {value}{suffix && <span className="ml-0.5 text-base text-slate-500">{suffix}</span>}
        </p>
        {instrument}
      </div>
    </>
  );
  const cls = `group flex min-w-0 flex-col p-3.5 ${TILE}`;
  return to ? (
    <Link to={to} data-testid={testid}
      className={`${cls} transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_-16px_hsl(150_15%_20%/0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 motion-reduce:transition-none`}>
      {body}
    </Link>
  ) : (
    <div data-testid={testid} className={cls}>{body}</div>
  );
}

function TeamHealthCard({ stats }) {
  const total = (stats.done || 0) + (stats.open || 0);
  return (
    <section className={`p-5 sm:p-6 ${CARD}`} data-testid="operating-quick-stats">
      <SectionHead icon={UsersThree} title="Team & work health" sub="Key indicators across your team's work." />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HealthTile icon={Check} tone="good" label="Tasks done" value={stats.done} to="/my-work" testid="ops-stat-done"
          instrument={<TileMeter value={pctOf(stats.done, total)} tone="good" label={`${stats.done} of ${total} tasks done`} />} />
        <HealthTile icon={ClipboardText} tone="quiet" label="Open tasks" value={stats.open} to="/my-work" testid="ops-stat-open"
          instrument={<TileMeter value={pctOf(stats.open, total)} tone="quiet" label={`${stats.open} of ${total} tasks still open`} />} />
        <HealthTile icon={Warning} tone="bad" label="Overdue" value={stats.overdue} to="/my-work?filter=overdue" testid="ops-stat-overdue"
          instrument={<TileMeter value={pctOf(stats.overdue, stats.open)} tone="bad" label={`${stats.overdue} of ${stats.open} open tasks overdue`} />} />
        <HealthTile icon={WarningCircle} tone="warn" label="Open complaints" value={stats.open_complaints} to="/crm" testid="ops-stat-complaints"
          instrument={(
            <span className="mb-0.5 text-orange-500" title={`${stats.open_complaints} open complaint${stats.open_complaints === 1 ? "" : "s"}`}>
              <CircleDots count={stats.open_complaints} max={5} />
            </span>
          )} />
      </div>
    </section>
  );
}

function OwnExecutionCard({ stats, title = "Your own execution", sub = "Your personal operational metrics — this is your work, not the company's." }) {
  return (
    <section className={`p-5 sm:p-6 ${CARD}`} data-testid="operating-personal-snapshot">
      <SectionHead icon={User} title={title} sub={sub} />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <HealthTile icon={ChartLineUp} tone="good" label="Completion" value={stats.completion_rate} suffix="%" to="/my-work" testid="ops-me-completion"
          instrument={<TileMeter value={stats.completion_rate} tone="good" label={`${stats.completed} of ${stats.actionable} of your tasks done`} showValue={false} />} />
        <HealthTile icon={ClipboardText} tone="quiet" label="Open" value={stats.open} to="/my-work" testid="ops-me-open"
          instrument={<TileMeter value={pctOf(stats.open, stats.actionable)} tone="quiet" label={`${stats.open} of ${stats.actionable} of your tasks open`} />} />
        <HealthTile icon={Warning} tone="bad" label="Overdue" value={stats.overdue} to="/my-work?filter=overdue" testid="ops-me-overdue"
          instrument={<TileMeter value={pctOf(stats.overdue, stats.open)} tone="bad" label={`${stats.overdue} of ${stats.open} of your open tasks overdue`} />} />
        <HealthTile icon={ShieldCheck} tone="quiet" label="Proof rate" value={stats.proof_upload_rate} suffix="%" to="/my-work" testid="ops-me-proof"
          instrument={<TileMeter value={stats.proof_upload_rate} tone="quiet" label={`${stats.proof_upload_rate}% of your done tasks carry a photo or voice note`} showValue={false} />} />
      </div>
    </section>
  );
}

// ─── owner view ──────────────────────────────────────────────────────────────

function OwnerView({ data }) {
  const { tenant } = useAuth();
  const demo = isDemoTenant(tenant);
  const { company, stats, my_snapshot: mySnapshot } = data;
  const overall = company.overall;
  const enough = company.enough_data !== false;
  const [drillCat, setDrillCat] = useState(null);
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const formulaRef = useRef(null);

  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data],
  );
  const actions = useMemo(() => scoreActions(stats, company.categories), [stats, company.categories]);
  const explain = () => {
    setFormulaOpen(true);
    requestAnimationFrame(() => formulaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div data-testid="operating-page">
      <PageHeader
        title="Operating Score"
        subtitle="A snapshot of your team's operational health. Identify gaps, take action, and keep things moving."
      />

      {!enough ? (
        <NotEnoughDataEmptyState stats={stats} />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.2fr)]">
            <OverallCard
              title="Overall Operating Score"
              score={overall}
              caption={BAND_COPY[scoreBand(overall)] || "Weighted across the four categories. Updates as work lands."}
              onExplain={explain}
              testid="operating-overall"
              delta={demo ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="operating-delta-chip">
                  {demoDelta.sign === "up" ? "+" : "−"}{Math.abs(demoDelta.value)} pts {demoDelta.period}
                </p>
              ) : null}
            />
            <div className="grid grid-cols-2 gap-3 sm:gap-4" data-testid="operating-categories">
              {CATS.map((c) => (
                <CategoryCard key={c.key} cat={c} value={company.categories[c.key]} reason={company.unscored?.[c.key]}
                  onOpen={() => setDrillCat(c.key)} />
              ))}
            </div>
            <DoTheseFirst actions={actions} onDrill={setDrillCat} note={demo ? demoDex.explainer : null} className="lg:col-span-2 xl:col-span-1" />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <TeamHealthCard stats={stats} />
            {mySnapshot && <OwnExecutionCard stats={mySnapshot} />}
          </div>
        </>
      )}

      <TeamExecution
        employees={rankedEmployees}
        panel={enough ? <FormulaPanel open={formulaOpen} weights={weights} setWeights={setWeights} panelRef={formulaRef} /> : null}
        toggle={enough ? <FormulaToggle open={formulaOpen} onToggle={() => setFormulaOpen((v) => !v)} /> : null}
      />

      {drillCat && (
        <CategoryDrill
          cat={CATS.find((c) => c.key === drillCat)}
          value={company.categories[drillCat]}
          drivers={demo ? (demoDrivers[drillCat] || []) : []}
          drill={demo ? demoDrilldowns[drillCat] : null}
          onClose={() => setDrillCat(null)}
        />
      )}
    </div>
  );
}

/* The team, on a dark card. The "How is this calculated?" pill sits in a cut
   carved out of the card's top edge (.kr-notch, lg and up — on a phone the
   pill sits above the card); its panel, when open, unfolds above both. */
function TeamExecution({ employees, panel, toggle }) {
  const { tenant } = useAuth();
  const roles = useMemo(() => tenant?.roles || [], [tenant]);
  const [sortBy, setSortBy] = useState("score");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...(employees || [])];
    if (q) {
      list = list.filter((e) => [e.name, e.role, roleLabelFor(roles, e.role)].some((v) => String(v || "").toLowerCase().includes(q)));
    }
    list.sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "activity") return (b.done + b.open) - (a.done + a.open);
      return (b.score ?? -1) - (a.score ?? -1);
    });
    return list;
  }, [employees, sortBy, query, roles]);

  const half = Math.ceil(rows.length / 2);
  const columns = rows.length > 6 ? [rows.slice(0, half), rows.slice(half)] : [rows];

  return (
    <div className="mt-8">
      {panel}
      {/* The pill's centre lands on the card's top edge (-mb = half its 44px). */}
      {toggle && <div className="relative z-10 mb-3 flex justify-center lg:-mb-[22px]">{toggle}</div>}
      {/* A mask clips box-shadow too, so the notched card carries no outer shadow. */}
      <section data-testid="operating-band"
        className={`relative rounded-[2rem] px-4 pb-5 pt-7 text-white ring-1 ring-inset ring-white/[0.06] sm:px-6 lg:px-7 ${toggle ? "kr-notch lg:pt-12" : ""} ${DARK_BAND}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.08] ring-1 ring-inset ring-white/15">
              <UsersThree size={20} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Team execution</h2>
              <p className="text-sm text-white/60">Every task on record · open anyone to see their full ops</p>
            </div>
          </div>
          {/* Phone: search takes the whole line so its placeholder reads whole,
              Sort drops to the line below. */}
          <div className="flex flex-wrap items-center gap-2.5 sm:flex-nowrap">
            <label className="relative flex h-11 w-full min-w-0 items-center rounded-pill bg-white/[0.06] ring-1 ring-inset ring-white/15 sm:w-auto sm:flex-1 lg:w-80 lg:flex-none"
              data-testid="operating-leaderboard-search-wrap">
              <MagnifyingGlass size={16} aria-hidden="true" className="pointer-events-none absolute left-4 text-white/60" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, member, department…" aria-label="Search team" data-testid="operating-leaderboard-search"
                className="h-full w-full min-w-0 rounded-pill bg-transparent pl-10 pr-4 text-sm text-white placeholder:text-white/45 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 [&::-webkit-search-cancel-button]:hidden" />
            </label>
            <span className="ml-auto text-sm text-white/70 sm:ml-0">Sort</span>
            <GlassSelect testid="operating-leaderboard-sort" ariaLabel="Sort team by" value={sortBy} onChange={setSortBy} align="end"
              options={[{ value: "score", label: "Score" }, { value: "activity", label: "Activity" }, { value: "name", label: "Name" }]}
              triggerClassName="h-11 w-32 shrink-0 bg-white/[0.06] text-sm text-white shadow-none ring-white/15 hover:bg-white/10" />
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-white/65" data-testid="operating-employees-empty">
            {query ? "No matches — try a different name or department." : "No team activity to rank yet."}
          </p>
        ) : (
          <div className={`mt-5 grid gap-0 ${columns.length > 1 ? "xl:grid-cols-2 xl:gap-4" : ""}`} data-testid="operating-employees">
            {columns.map((col, ci) => (
              <TeamTable key={ci} rows={col} offset={ci === 0 ? 0 : half} roles={roles}
                continuation={ci > 0} continued={ci === 0 && columns.length > 1} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const TEAM_COLS = "grid-cols-[1.75rem_minmax(0,1fr)_auto] lg:grid-cols-[1.75rem_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,1.6fr)]";

function TeamTable({ rows, offset, roles, continuation, continued }) {
  return (
    <div className={cn(
      "overflow-hidden bg-white/[0.03] ring-1 ring-inset ring-white/[0.06]",
      continuation ? "rounded-b-2xl xl:rounded-2xl" : continued ? "rounded-t-2xl xl:rounded-2xl" : "rounded-2xl",
    )}>
      <div aria-hidden="true"
        className={cn(`gap-3 border-b border-white/[0.06] px-4 py-2.5 text-xs text-white/55 ${TEAM_COLS}`, continuation ? "hidden xl:grid" : "grid")}>
        <span>#</span><span>Member</span><span className="hidden lg:block">Department</span>
        <span className="text-right lg:text-left">Score</span><span className="hidden lg:block">Activity (tasks | open | overdue)</span>
      </div>
      <ul>
        {rows.map((e, i) => (
          <li key={e.id} className={i > 0 || continuation ? "border-t border-white/[0.05]" : ""}>
            <Link to={`/operating-score?user=${e.id}`} data-testid={`operating-emp-${e.id}`}
              className={`grid items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.08] focus-visible:outline-none ${TEAM_COLS}`}>
              <span className="tabular-nums text-white/60">{offset + i + 1}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/90 text-[10px] font-semibold text-slate-800">
                  {initialsOf(e.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.name}</span>
                  <span className="block text-[11px] leading-snug text-white/50 lg:hidden">
                    {roleLabelFor(roles, e.role)} · {e.done} done · {e.open} open{e.overdue > 0 ? ` · ${e.overdue} overdue` : ""}
                  </span>
                </span>
              </span>
              <span className="hidden truncate text-white/70 lg:block">{roleLabelFor(roles, e.role)}</span>
              <span className="flex items-center justify-end gap-3 lg:justify-start">
                <span className="w-6 text-right font-semibold tabular-nums">{e.score != null ? e.score : "—"}</span>
                <Bar value={e.score} dark label={`${e.name} score`} className="hidden h-1.5 w-16 lg:block lg:w-20" />
              </span>
              <span className="hidden truncate text-xs text-white/65 lg:block">
                {e.done} done <span className="mx-1 text-white/25">|</span> {e.open} open <span className="mx-1 text-white/25">|</span>{" "}
                <span className={e.overdue > 0 ? "text-rose-300" : ""}>{e.overdue} overdue</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── self view ───────────────────────────────────────────────────────────────

function SelfView({ data }) {
  const {
    self, stats, my_open_work: openWork = [], my_active_workflows: activeWfs = [],
    peer_context: peer, view_as: viewAs,
  } = data;
  const score = selfScore(stats);
  const hasActivity = stats.actionable > 0;
  const actions = useMemo(() => scoreActions(stats), [stats]);
  const isViewAs = Boolean(viewAs);
  const firstName = self.name?.split(" ")[0] || "there";

  return (
    <div data-testid="operating-page">
      <ViewAsBanner target={viewAs} />
      <PageHeader
        title={isViewAs ? `${self.name}'s operating view` : `Hi ${firstName} — here's how you're doing`}
        subtitle={isViewAs ? "Their work, what is open and what to do first." : "Your work, what is open and what to do first."}
      />

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.2fr)]">
        <OverallCard
          title={isViewAs ? "Operating score" : "Your operating score"}
          score={hasActivity ? score : null}
          caption={hasActivity ? "Completion, less the drag from anything overdue." : "Close a task or two and the score kicks in."}
          testid="operating-self-hero"
        />
        <section className={`p-5 sm:p-6 ${CARD}`} data-testid="operating-self-stats">
          <SectionHead icon={User} title={isViewAs ? "Their execution" : "Your execution"} sub="Everything assigned, on record." />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <HealthTile icon={Check} tone="good" label="Completed" value={stats.completed} to="/my-work" testid="ops-self-completed"
              instrument={<TileMeter value={stats.completion_rate} tone="good" label={`${stats.completed} of ${stats.actionable} done`} showValue={false} />} />
            <HealthTile icon={ClipboardText} tone="quiet" label="Open" value={stats.open} to="/my-work" testid="ops-self-open"
              instrument={<TileMeter value={pctOf(stats.open, stats.actionable)} tone="quiet" label={`${stats.open} of ${stats.actionable} open`} />} />
            <HealthTile icon={Warning} tone="bad" label="Overdue" value={stats.overdue} to="/my-work?filter=overdue" testid="ops-self-overdue"
              instrument={<TileMeter value={pctOf(stats.overdue, stats.open)} tone="bad" label={`${stats.overdue} of ${stats.open} open overdue`} />} />
            <HealthTile icon={ShieldCheck} tone="quiet" label="Proof rate" value={stats.proof_upload_rate} suffix="%" to="/my-work" testid="ops-self-proof"
              instrument={<TileMeter value={stats.proof_upload_rate} tone="quiet" label={`${stats.proof_upload_rate}% of done tasks carry proof`} showValue={false} />} />
          </div>
        </section>
        <DoTheseFirst actions={actions} onDrill={() => {}} className="lg:col-span-2 xl:col-span-1" />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <BreakdownCard icon={ShieldCheck} label="Proof rate" value={`${stats.proof_upload_rate}%`} meter={stats.proof_upload_rate}
          detail={`${_pctToCount(stats.proof_upload_rate, stats.completed)} of ${stats.completed} done with photo or voice`}
          hint={stats.proof_upload_rate < 40 && stats.completed >= 3 ? "Attach a photo or voice update on your next done task" : null} />
        <BreakdownCard icon={ClipboardText} label="Plans in use" value={`${stats.plans_completed}/${stats.plans_used}`}
          meter={stats.plans_used > 0 ? (stats.plans_completed / stats.plans_used) * 100 : null}
          detail={`${stats.plans_used} accepted plan${stats.plans_used === 1 ? "" : "s"}, ${stats.plans_completed} finished`}
          hint={stats.plans_used === 0 && stats.actionable >= 3 ? "Ask Dex to plan your next big task" : null} />
        <BreakdownCard icon={Check} label="Actionable" value={String(stats.actionable)}
          meter={stats.actionable > 0 ? (stats.completed / stats.actionable) * 100 : null}
          detail={`${stats.completed} done + ${stats.open} open`} />
      </div>

      <section className={`mt-5 p-5 sm:p-6 ${CARD}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionHead icon={ClipboardText} title={isViewAs ? "Their open work" : "Your open work"} />
          <Link to="/my-work" className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
            See all <ArrowRight size={13} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        {openWork.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nothing open right now — good place to be.</p>
        ) : (
          <ul className="divide-y divide-slate-900/[0.06]" data-testid="operating-self-open">
            {openWork.map((t) => (
              <li key={t.id}>
                <Link to="/my-work" className="group flex items-center gap-4 rounded-xl px-1 py-3 transition-colors hover:bg-white/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {t.status} · {t.priority || "medium"}
                      {t.due_date ? ` · due ${_formatDate(t.due_date)}` : ""}
                      {t.stage_key ? ` · stage ${t.stage_key}` : ""}
                    </p>
                  </div>
                  {t.is_overdue && (
                    <span className="shrink-0 rounded-pill bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-100">Overdue</span>
                  )}
                  <CaretRight size={14} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(activeWfs.length > 0 || (peer && peer.my_rank_in_role && peer.role_ranked_size >= 2)) && (
        <section data-testid="operating-self-band"
          className={`mt-8 rounded-[2rem] px-4 pb-6 pt-7 text-white ring-1 ring-inset ring-white/[0.06] sm:px-6 lg:px-7 ${DARK_BAND}`}>
          {activeWfs.length > 0 && (
            <>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Workflows waiting on {isViewAs ? "them" : "you"}</h2>
                <Link to="/workflows" className="flex items-center gap-1 text-sm font-medium text-white/70 hover:text-white">
                  See board <ArrowRight size={13} weight="bold" aria-hidden="true" />
                </Link>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="operating-self-workflows">
                {activeWfs.map((w) => (
                  <li key={w.id}>
                    <Link to="/workflows" className="flex h-full flex-col rounded-2xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.08]">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{w.title}</p>
                      <p className="mt-auto pt-3 text-xs text-white/60">
                        {w.type} · stage {w.stage}{w.counterparty ? ` · ${w.counterparty}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {peer && peer.my_rank_in_role && peer.role_ranked_size >= 2 && (
            <p className={`flex items-center gap-2.5 text-sm text-white/80 ${activeWfs.length ? "mt-6" : ""}`} data-testid="operating-self-peer">
              <Trophy size={16} weight="bold" aria-hidden="true" className="shrink-0 text-white/60" />
              <span>Among the <strong className="font-semibold text-white">{peer.role}</strong> peers, ranked{" "}
                <strong className="font-semibold text-white">{peer.my_rank_in_role}</strong> of {peer.role_ranked_size}.</span>
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function BreakdownCard({ icon: Icon, label, value, detail, hint, meter }) {
  return (
    <div className={`p-5 ${CARD}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-full text-slate-700 ${TILE}`}><Icon size={18} aria-hidden="true" /></span>
        <span className="font-display text-3xl leading-none text-slate-900 tabular-nums">{value}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-900">{label}</p>
      {meter != null && <Bar value={meter} label={label} className="mt-2.5 h-1.5" />}
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{detail}</p>
      {hint && <p className="mt-2 text-xs font-medium leading-relaxed text-slate-800">{hint}</p>}
    </div>
  );
}

/** A category's breakdown. Drivers and specifics exist for the demo tenant
 *  only; everyone else sees what the number measures and how. */
function CategoryDrill({ cat, value, drivers, drill, onClose }) {
  const has = value != null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent data-testid={`operating-drill-${cat.key}`}
        className={`max-h-[calc(88dvh/var(--ui-scale,1))] max-w-2xl gap-0 overflow-y-auto rounded-[1.75rem] p-0 sm:rounded-[1.75rem] [&>button.absolute]:hidden ${GLASS_SHEET}`}>
        <div className="flex items-start gap-4 p-6 pb-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-slate-700 ${TILE}`}><cat.icon size={22} aria-hidden="true" /></span>
          <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
            <p className="text-xs text-slate-500">Weight {cat.weight}% of overall</p>
            <DialogTitle className="text-xl font-semibold text-neutral-900">{drill?.title || cat.label}</DialogTitle>
            <DialogDescription className="text-sm text-neutral-600">{cat.plain}</DialogDescription>
          </DialogHeader>
          <span className="flex shrink-0 items-baseline gap-1 pt-1">
            <span className="font-display text-4xl leading-none text-slate-900 tabular-nums">{has ? value : "—"}</span>
            <span className="text-sm text-slate-500">/ 100</span>
          </span>
          <button type="button" onClick={onClose} aria-label="Close breakdown" data-testid="operating-drill-close" className={GLASS_ICON_BTN}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-6 pb-6">
          <div className={`p-4 ${DRAWER_CARD}`}>
            {drill?.hero && <p className="mb-3 text-sm font-semibold text-slate-900">{drill.hero}</p>}
            <Bar value={value} label={`${cat.label} score`} />
            <p className="mt-3 font-mono text-xs text-slate-500">{cat.formula}</p>
          </div>

          {drivers.length > 0 && (
            <div>
              <p className={DRAWER_LABEL}>Top drivers this period</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {drivers.map((d, i) => (
                  <div key={i} className={`p-3.5 ${DRAWER_CARD}`}>
                    <p className="text-xs text-slate-500">{d.label}</p>
                    <p className="mt-1 font-display text-2xl tabular-nums text-slate-900">{d.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drill?.items && (
            <div>
              <p className={DRAWER_LABEL}>Specifics</p>
              <ul className="space-y-2">
                {drill.items.map((item, i) => (
                  <li key={i} className={`flex items-center gap-3 p-3 ${DRAWER_CARD}`}>
                    <span aria-hidden="true"
                      className={`h-8 w-1 shrink-0 rounded-pill ${item.tone === "bad" ? "bg-orange-500" : item.tone === "good" ? "bg-emerald-600" : "bg-slate-300"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{item.meta}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!drivers.length && !drill?.items && (
            <p className="text-sm text-slate-500">
              A per-driver breakdown is not wired for this category yet — the score above is live, the detail is not.
            </p>
          )}

          {drill?.action && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-900/[0.06] pt-4">
              <span className="text-xs text-slate-500">Ready to act?</span>
              <Link to={drill.action.to} onClick={onClose}
                className={`inline-flex h-11 items-center gap-2 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
                {drill.action.label} <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── formula panel ───────────────────────────────────────────────────────────

/* KM-28 — the formula and the weights, unfolded above the Team execution card.
   The control that opens it is FormulaToggle, in the card's notch. */
function FormulaPanel({ open, weights = DEFAULT_WEIGHTS, setWeights, panelRef }) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return (
    <div ref={panelRef}>
      {open && (
        <div id="operating-formula-panel" className={`mb-6 space-y-4 p-5 sm:p-6 ${CARD}`} data-testid="operating-formula-panel">
          <p className="text-sm leading-relaxed text-slate-600">
            Overall is a weighted average across the four categories. Categories with no data yet are skipped and the remaining weights renormalize.
          </p>
          {setWeights && (
            <div className={`rounded-[1.25rem] p-4 ${DRAWER_TRACK}`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-900">Customize weights for your business</p>
                <span className={`text-xs tabular-nums ${total === 100 ? "text-slate-500" : "text-orange-600"}`}>total: {total}%</span>
              </div>
              <div className="mb-4 flex flex-wrap gap-2">
                {Object.entries(WEIGHT_PRESETS).map(([k, p]) => (
                  <button key={k} type="button" onClick={() => setWeights(p.weights)}
                    className={`flex h-9 items-center rounded-pill px-4 text-xs font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {CATS.map((c) => (
                  <div key={c.key} className="flex items-center gap-3">
                    <span className="flex w-36 shrink-0 items-center gap-2 text-xs font-medium text-slate-700">
                      <c.icon size={14} aria-hidden="true" className="text-slate-500" /> {c.label}
                    </span>
                    <input type="range" min="0" max="60" step="5" value={weights[c.key]}
                      onChange={(e) => setWeights({ ...weights, [c.key]: Math.max(0, Math.min(100, Number(e.target.value))) })}
                      className="flex-1 accent-neutral-900" aria-label={`${c.label} weight`} />
                    <span className="w-12 text-right text-xs font-medium tabular-nums text-slate-700">{weights[c.key]}%</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {total !== 100 ? "Weights should add up to 100%. Pick a preset or adjust the sliders." : "Local preview only — saving weights lands with the backend."}
              </p>
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {CATS.map((c) => (
              <div key={c.key} className={`p-4 ${DRAWER_CARD}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <c.icon size={15} aria-hidden="true" className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{c.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">weight {weights[c.key]}%</span>
                </div>
                <p className="mb-2 text-xs leading-relaxed text-slate-500">{c.plain}</p>
                <p className="inline-block rounded-pill bg-white/80 px-3 py-1 text-[11px] tabular-nums text-slate-700 ring-1 ring-inset ring-slate-900/[0.06]">{c.formula}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 44px tall — .kr-notch's cut is sized to this pill (its lower half + 10px). */
function FormulaToggle({ open, onToggle }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls="operating-formula-panel" data-testid="operating-formula-toggle"
      className={`flex h-11 items-center gap-2 rounded-pill px-5 text-sm font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
      <Info size={16} aria-hidden="true" />
      How is this calculated?
      <CaretDown size={13} weight="bold" aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

// ─── empty + loading ─────────────────────────────────────────────────────────

function InlineCapture() {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!sent) return undefined;
    const t = setTimeout(() => setSent(false), 2400);
    return () => clearTimeout(t);
  }, [sent]);
  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSent(true);
    setText("");
  };
  return (
    <form onSubmit={submit} className="mt-5 flex items-center gap-2" data-testid="operating-inline-capture">
      <div className="relative min-w-0 flex-1">
        <Microphone size={16} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Or capture a decision right here"
          aria-label="Capture a decision" className={cn(DRAWER_FIELD, "h-11 py-0 pl-10 text-sm")} />
      </div>
      <button type="submit" disabled={!text.trim()} className={`h-11 shrink-0 rounded-pill px-5 text-sm font-medium disabled:opacity-40 ${INK_PILL}`}>
        Capture
      </button>
      {sent && <span className="text-xs font-medium text-slate-600" role="status">sent</span>}
    </form>
  );
}

function NotEnoughDataEmptyState({ stats }) {
  const doneCount = (stats?.done || 0) + (stats?.open || 0);
  const hasTasks = doneCount >= 3;
  const hasInvoices = (stats?.total_decisions || 0) > 0;
  const taskProgress = Math.min(doneCount, 3);
  return (
    <section className={`p-6 sm:p-8 ${CARD}`} data-testid="operating-not-ready">
      <div className="flex flex-col items-start gap-8 lg:flex-row">
        <div className="shrink-0">
          <div className={`grid h-32 w-32 place-items-center rounded-full ${TILE}`}>
            <Gauge size={30} aria-hidden="true" className="text-slate-500" />
          </div>
          <p className="mt-3 text-center text-sm font-medium text-slate-700" data-testid="operating-overall-score">Score kicks in soon</p>
        </div>
        <div className="w-full flex-1">
          <h2 className="text-xl font-semibold text-slate-900">Two quick things and your score turns on</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The operating score needs a little real activity before it can say anything useful. Do either of these and it starts tracking.
          </p>
          <div className="mt-5 space-y-3">
            <ChecklistItem done={hasTasks}
              label={hasTasks ? "Capture 3 actionable tasks" : `Capture 3 actionable tasks (${taskProgress} of 3)`}
              hint="Speak or type a decision on the Decision Desk — it becomes tasks automatically." actionLabel="Open Desk" actionTo="/inbox" />
            <ChecklistItem done={hasInvoices} label="Add your first invoice"
              hint="Import from Tally / Zoho, upload a PDF, or log it manually in Finance." actionLabel="Open Finance" actionTo="/finance" icon={Receipt} />
          </div>
          <InlineCapture />
        </div>
      </div>
    </section>
  );
}

function ChecklistItem({ done, label, hint, actionLabel, actionTo, icon: Icon = Microphone }) {
  return (
    <div className={`flex items-start gap-3 p-4 ${DRAWER_CARD}`}>
      <span aria-hidden="true"
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${done ? "bg-neutral-900 text-white" : "ring-1 ring-inset ring-slate-900/20"}`}>
        {done && <Check size={13} weight="bold" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${done ? "text-slate-500 line-through" : "text-slate-900"}`}>{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>
      </div>
      {!done && (
        <Link to={actionTo} className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
          <Icon size={13} weight="bold" aria-hidden="true" /> {actionLabel}
        </Link>
      )}
    </div>
  );
}

function OperatingScoreSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="operating-skeleton">
      <div className="mb-6">
        <div className="ds-skeleton h-9 w-64 rounded-control" />
        <div className="ds-skeleton mt-3 h-4 w-96 max-w-full rounded-control" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <div className="ds-skeleton h-[268px] rounded-[1.6rem]" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="ds-skeleton h-[126px] rounded-[1.6rem]" />)}
        </div>
        <div className="ds-skeleton h-[268px] rounded-[1.6rem] lg:col-span-2 xl:col-span-1" />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="ds-skeleton h-[176px] rounded-[1.6rem]" />)}
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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

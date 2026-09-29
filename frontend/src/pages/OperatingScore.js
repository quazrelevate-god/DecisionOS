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
import { opModel } from "../lib/operatingModel";
import { humanStage, taskStatusLabel, priorityLabel } from "../lib/format";
import {
  isDemoTenant, demoDelta, demoDrivers, demoDrilldowns, demoDex,
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
  const [searchParams, setSearchParams] = useSearchParams();
  const userIdParam = searchParams.get("user") || null;
  /* ?window=30|90 lives in the address so a refresh keeps it and the owner can
     send somebody the same view. Anything else reads as all time — a stale or
     hand-typed link should show the page, not an error. `replace`, because
     flicking between periods is reading, not navigating, and nobody wants
     twenty history entries for it. */
  const rawWindow = searchParams.get("window") || "all";
  const windowKey = ["30", "90"].includes(rawWindow) ? rawWindow : "all";
  const setWindow = (next) => setSearchParams((prev) => {
    const p = new URLSearchParams(prev);
    if (next && next !== "all") p.set("window", next); else p.delete("window");
    return p;
  }, { replace: true });

  const { data, isLoading } = useQuery({
    queryKey: ["operating-score", userIdParam, windowKey],
    queryFn: () => api
      .get("/operating-score", {
        params: {
          ...(userIdParam ? { user_id: userIdParam } : {}),
          ...(windowKey !== "all" ? { window: Number(windowKey) } : {}),
        },
      })
      .then((r) => r.data),
    // The previous period stays on screen while the next one loads, so the
    // page does not blink back to skeletons on every flick of the picker.
    placeholderData: (prev) => prev,
  });

  // The URL already says which page is coming, so the waiting shape is the
  // right one and nothing rearranges under the eye when it lands (2026-09-29).
  if (isLoading || !data) return <OperatingScoreSkeleton person={Boolean(userIdParam)} />;

  const isOwnerView = data.view === "owner" || Boolean(data.company);
  const win = { windowKey, onWindow: setWindow };
  return isOwnerView ? <OwnerView data={data} {...win} /> : <SelfView data={data} {...win} />;
}

// ─── page furniture ──────────────────────────────────────────────────────────

/* 2026-09-29 — THE SCOPE IS A CHOICE NOW. It used to be a statement: the
   scores counted everything on record, so a period picker would have had
   nothing to change. That was honest and it answered the wrong question. A
   workshop that had a bad September carried it for the rest of its life, and
   an owner asking "are we better than last month?" got the same figure either
   way — worse, Execution mixed the two clocks, counting completion over all
   time and the overdue penalty as of right now.

   The rule is one sentence, and the header says it rather than making anyone
   infer it: a window narrows the FINISHED work to what finished inside it,
   and everything still open counts however old it is. Open work is never
   filtered — a task raised in March and still not done is a live problem
   today, and hiding it behind a 30-day window would flatter exactly the team
   that needs telling. */
const WINDOW_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
const WINDOW_NOTE = {
  all: "Every task, decision and complaint on record.",
  30: "Work finished in the last 30 days. Everything still open counts, however old.",
  90: "Work finished in the last 90 days. Everything still open counts, however old.",
};

function PageHeader({ title, subtitle, windowKey, onWindow }) {
  return (
    <StickyHeader className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground sm:text-base" data-testid="operating-subtitle">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5" data-testid="operating-scope">
          <GlassSelect value={windowKey} onChange={onWindow} options={WINDOW_OPTIONS}
            icon={CalendarBlank} ariaLabel="What these numbers cover" testid="operating-window" />
          <span className="max-w-[16rem] text-right text-[11px] leading-snug text-slate-500"
            data-testid="operating-window-note">
            {WINDOW_NOTE[windowKey]}
          </span>
        </div>
      </div>
    </StickyHeader>
  );
}

/** The owner is looking at someone else's page — a mode, so it is said. */
function ViewAsBanner({ target, roles = [] }) {
  if (!target) return null;
  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${DRAWER_CARD}`} data-testid="operating-view-as-banner">
      <p className="flex min-w-0 items-center gap-2.5 text-sm text-slate-700">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-700 ${GLASS_PILL}`}>
          <Eye size={16} weight="bold" aria-hidden="true" />
        </span>
        <span className="truncate">Viewing <strong className="font-semibold text-slate-900">{target.name}</strong></span>
        {/* 2026-09-29: was the stored key — "sales_&_order_management". The
            table two sections down had it right all along. */}
        {target.role && <span className="text-slate-500">· {roleLabelFor(roles, target.role)}</span>}
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

/* 2026-09-29 — "See breakdown" is offered only when there IS one. The items
   behind it (demoDrivers / demoDrilldowns) exist for the demo tenant alone, so
   on every real company the card invited a click and the dialog answered "a
   breakdown of what makes it up isn't shown for this part yet". A control that
   cannot keep its promise is worse than no control: the card says what the
   category MEASURES instead, which is true and useful, and the formula behind
   it is one tap away under "How is this calculated?". */
const CAT_CARD_CLS = `group flex min-w-0 flex-col p-4 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-18px_hsl(150_15%_20%/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 motion-reduce:transition-none ${CARD}`;

/* 2026-09-29 — FINANCE OPENS THE FINANCE PAGE (`to`).
   Yokesh, pushing back on a broader suggestion of mine and rightly: money
   belongs on the Finance page, not duplicated here. What was left of the
   point is narrower. Finance carries 25% of the overall score and was the one
   category you could not click into at all: the other three at least say what
   they measure, and Finance showed a number, or a dash, and stopped. Every
   other figure on this page now leads somewhere; this one led nowhere.
   So it is a link, not a new section — and only for somebody who may see the
   money, since the Finance page would bounce anyone else. When it is
   unscored the card keeps saying so ("Nothing to score yet — left out of the
   total"), because that sentence is the honest part and it is also exactly
   when an owner should go and raise an invoice. */
function CategoryCard({ cat, value, reason, onOpen, canDrill = false, to = null }) {
  const has = value != null;
  const opens = has && canDrill;
  const linkTo = !opens && to ? to : null;
  const why = UNSCORED_WORDS[reason] || UNSCORED_WORDS.no_access;
  const label = opens ? `${cat.label}: ${value} out of 100 — see breakdown`
    : has ? `${cat.label}: ${value} out of 100 — ${cat.plain}${linkTo ? ". Open Finance" : ""}`
      : `${cat.label}: ${why}${linkTo ? ". Open Finance" : ""}`;
  const body = (
    <>
      <span className="flex w-full items-center gap-2 text-[15px] font-medium text-slate-800">
        <cat.icon size={18} aria-hidden="true" className="shrink-0 text-slate-600" />
        <span className="min-w-0 flex-1 truncate">{cat.label}</span>
        {(opens || linkTo) && <CaretRight size={13} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span className="font-display text-4xl leading-none text-slate-900 tabular-nums">{has ? value : "—"}</span>
        <span className="text-sm text-slate-500">/ 100</span>
      </span>
      <Bar value={value} label={`${cat.label} score`} className="mt-4" testid={`operating-meter-${cat.key}`} />
      <span className="mt-3 flex items-center gap-1 text-xs font-medium leading-relaxed text-slate-500">
        {opens ? <>See breakdown <CaretRight size={11} weight="bold" aria-hidden="true" /></>
          : has ? <span className="line-clamp-2">{cat.plain}</span> : why}
      </span>
    </>
  );
  if (linkTo) {
    return (
      <Link to={linkTo} data-testid={`operating-cat-${cat.key}`}
        data-unscored={has ? undefined : (reason || "no_access")}
        aria-label={label} className={CAT_CARD_CLS}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={opens ? onOpen : undefined} disabled={!opens} data-testid={`operating-cat-${cat.key}`}
      data-unscored={has ? undefined : (reason || "no_access")}
      aria-label={label}
      className={`${CAT_CARD_CLS} disabled:translate-y-0 disabled:cursor-default disabled:shadow-none disabled:hover:translate-y-0`}>
      {body}
    </button>
  );
}

const ACTION_ICON = { overdue: CheckCircle, complaints: ChatCircleText, weakest: ChartLineUp, "first-close": Flag };

/** What to do first — derived from real stats (lib/karmaScore), claiming no lift. */
function DoTheseFirst({ actions, onDrill, note, sub = "Key actions to improve your operating score.", className = "" }) {
  return (
    <section data-testid="operating-next-moves" className={`flex min-w-0 flex-col p-5 sm:p-6 ${CARD} ${className}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-slate-700 ${TILE}`}>
          <ListBullets size={22} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-slate-900">Do these first</h2>
          <p className="text-sm text-slate-500">{sub}</p>
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

/* WHERE THE WORK IS PILING UP (2026-09-29).

   Yokesh, walking the page: "it ranks people but never names the bottleneck".
   The table underneath says Anand is 0 and Priya is 18, which is a verdict on
   two people, not an answer to the question an owner-led workshop actually
   asks — which card is jammed, and who is holding it. The clock that knows
   already existed (services/workflow_timing.card_timing, the same one the
   Desk and the stuck alert read); nothing had asked it for a ranking.

   Two different complaints are kept apart rather than blurred into one
   "stuck": OVER means the stage is taking longer than the board allows,
   IDLE means nobody has touched the card at all. A card can be idle without
   being over, on a generous stage, and over without being idle, when someone
   is working on it and it is simply slow — and the fix is different. */
function Bottlenecks({ cards }) {
  const jams = cards || [];
  return (
    <section className={`mt-5 p-5 sm:p-6 ${CARD}`} data-testid="operating-bottlenecks">
      <SectionHead icon={Warning} title="Where the work is stuck"
        sub="Cards sitting longer than their stage allows, worst first." />
      {jams.length === 0 ? (
        <p className="py-4 text-sm text-slate-500" data-testid="operating-bottlenecks-empty">
          Nothing is sitting — every card has moved inside the days its stage allows.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-900/[0.06] border-t border-slate-900/[0.06]">
          {jams.map((c) => {
            /* The two clocks. Whichever ran longer is the headline, because
               that is the number beside it — the first browser pass showed
               "4 working days over" next to a 7, which reads as a mistake.
               The other clock follows in a clause when it has something to
               add: over and idle are different complaints with different
               fixes, and an owner wants both. "Nobody is on it" is not a
               missing name — it is the finding. */
            const days = (n) => `${n} working day${n === 1 ? "" : "s"}`;
            const over = `${days(c.over_days)} over the ${c.stage_days} this stage allows`;
            const why = c.idle_days > c.over_days
              ? `not moved for ${days(c.idle_days)}` + (c.over_days ? `, and ${over}` : "")
              : over;
            const who = c.holders?.length
              ? c.holders.map((h) => h.name).join(", ")
              : c.open_tasks > 0 ? "nobody named on it" : "no open work on this stage";
            return (
              <li key={c.id}>
                <Link to={`/workflows?wf=${encodeURIComponent(c.id)}${c.type ? `&wf_type=${encodeURIComponent(c.type)}` : ""}`}
                  data-testid={`operating-jam-${c.id}`}
                  className="group flex items-center gap-4 rounded-xl px-1 py-3.5 transition-colors hover:bg-white/60">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-700 ${TILE}`}>
                    <Timer size={18} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-slate-900">{c.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {c.stage_label} · {why} · with {who}
                      {c.counterparty ? ` · ${c.counterparty}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1 text-rose-700">
                    <span className="font-display text-2xl leading-none tabular-nums">{c.waiting_days}</span>
                    <span className="text-xs">d</span>
                  </span>
                  <CaretRight size={14} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            );
          })}
        </ul>
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

function OwnerView({ data, windowKey, onWindow }) {
  const { tenant } = useAuth();
  const demo = isDemoTenant(tenant);
  const { company, stats, my_snapshot: mySnapshot } = data;
  const overall = company.overall;
  const enough = company.enough_data !== false;
  const [drillCat, setDrillCat] = useState(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const formulaRef = useRef(null);

  const rankedEmployees = useMemo(
    () => (data?.employees || []).filter((e) => e.score != null || e.open > 0 || e.done > 0),
    [data],
  );
  /* Only offer what can be acted on. The "weakest category" item opens a
     drill-down that has content for the demo tenant alone, so on a real
     company the page's own first instruction — "open it to see what is
     pulling it down" — led to a dialog that said there was nothing to see
     (2026-09-29). Everything else here links somewhere real. */
  const actions = useMemo(
    () => scoreActions(stats, company.categories).filter((a) => a.to || (demo && a.drill)),
    [stats, company.categories, demo],
  );
  const explain = () => {
    setFormulaOpen(true);
    requestAnimationFrame(() => formulaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div data-testid="operating-page">
      <PageHeader
        title="Operating Score"
        subtitle="A snapshot of your team's operational health. Identify gaps, take action, and keep things moving."
        windowKey={windowKey} onWindow={onWindow}
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
                  canDrill={demo} onOpen={() => setDrillCat(c.key)}
                  to={c.key === "finance" && data.can_finance ? "/finance" : null} />
              ))}
            </div>
            <DoTheseFirst actions={actions} onDrill={setDrillCat} note={demo ? demoDex.explainer : null} className="lg:col-span-2 xl:col-span-1" />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <TeamHealthCard stats={stats} />
            {mySnapshot && <OwnExecutionCard stats={mySnapshot} />}
          </div>

          {/* 2026-09-29 — the counts above say how MUCH is moving; these say
              how fast, and whether it lands when it was promised. The same
              three numbers each person's page carries, over the company. */}
          <WorkMovesRow timing={stats.timing} company />

          <Bottlenecks cards={data.bottlenecks} />
        </>
      )}

      <TeamExecution
        employees={rankedEmployees}
        panel={enough ? <FormulaPanel open={formulaOpen} panelRef={formulaRef} /> : null}
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
        <span className="text-right lg:text-left">Score</span><span className="hidden lg:block">Activity (done | open | overdue | typical)</span>
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
                    {e.timing?.typical_days != null
                      ? (e.timing.typical_days === 0 ? " · closes same day" : ` · ~${e.timing.typical_days}d to close`)
                      : ""}
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
                {/* How long, beside how much — the reason two people with the
                    same counts are not the same (2026-09-29). */}
                {e.timing?.typical_days != null && (
                  <>
                    <span className="mx-1 text-white/25">|</span>
                    <span className="text-white/50">
                      {e.timing.typical_days === 0 ? "same day" : `~${e.timing.typical_days}d`}
                    </span>
                  </>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── self view ───────────────────────────────────────────────────────────────

function SelfView({ data, windowKey, onWindow }) {
  const { tenant } = useAuth();
  const roles = tenant?.roles || [];
  /* The tenant's own words for a pipeline and its stages — the same ones the
     board shows. Ops printed the stored keys ("order_management · stage
     ready_for_dispatch") on a page a team member reads about their own work. */
  const pipelines = useMemo(() => opModel(tenant).pipelines || [], [tenant]);
  const wfWords = useMemo(() => {
    const out = {};
    pipelines.forEach((pl) => {
      out[pl.key] = { label: pl.label || humanStage(pl.key), stages: {} };
      (pl.stages || []).forEach((st) => { out[pl.key].stages[st.key] = st.label || humanStage(st.key); });
    });
    return out;
  }, [pipelines]);
  const wfLabel = (type) => wfWords[type]?.label || humanStage(type);
  const stageLabel = (type, stage) => wfWords[type]?.stages?.[stage] || humanStage(stage);
  const {
    self, stats, my_open_work: openWork = [], my_active_workflows: activeWfs = [],
    peer_context: peer, view_as: viewAs, approvals,
  } = data;
  const score = selfScore(stats);
  const hasActivity = stats.actionable > 0;
  const actions = useMemo(() => scoreActions(stats), [stats]);
  const isViewAs = Boolean(viewAs);
  const firstName = self.name?.split(" ")[0] || "there";
  /* Every link off this page has to land on the work it is ABOUT. Looking at
     somebody else, "See all" and each tile used to open the viewer's own My
     Work — the owner clicked Priya's 8 open tasks and got his own three.
     ?view=all&person= is the list that holds theirs. */
  const workLink = (extra = {}) => {
    const q = new URLSearchParams(extra);
    if (isViewAs && viewAs?.id) { q.set("view", "all"); q.set("person", viewAs.id); }
    const qs = q.toString();
    return qs ? `/my-work?${qs}` : "/my-work";
  };

  return (
    <div data-testid="operating-page">
      <ViewAsBanner target={viewAs} roles={roles} />
      <PageHeader
        title={isViewAs ? `${self.name}'s operating view` : `Hi ${firstName} — here's how you're doing`}
        subtitle={isViewAs ? "Their work, what is open and what to do first." : "Your work, what is open and what to do first."}
        windowKey={windowKey} onWindow={onWindow}
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
            <HealthTile icon={Check} tone="good" label="Completed" value={stats.completed} to={workLink({ status: "done" })} testid="ops-self-completed"
              instrument={<TileMeter value={stats.completion_rate} tone="good" label={`${stats.completed} of ${stats.actionable} done`} showValue={false} />} />
            <HealthTile icon={ClipboardText} tone="quiet" label="Open" value={stats.open} to={workLink()} testid="ops-self-open"
              instrument={<TileMeter value={pctOf(stats.open, stats.actionable)} tone="quiet" label={`${stats.open} of ${stats.actionable} open`} />} />
            <HealthTile icon={Warning} tone="bad" label="Overdue" value={stats.overdue} to={workLink({ status: "overdue" })} testid="ops-self-overdue"
              instrument={<TileMeter value={pctOf(stats.overdue, stats.open)} tone="bad" label={`${stats.overdue} of ${stats.open} open overdue`} />} />
            <HealthTile icon={ShieldCheck} tone="quiet" label="Proof rate" value={stats.proof_upload_rate} suffix="%" to={workLink({ status: "done" })} testid="ops-self-proof"
              instrument={<TileMeter value={stats.proof_upload_rate} tone="quiet" label={`${stats.proof_upload_rate}% of done tasks carry proof`} showValue={false} />} />
          </div>
        </section>
        <DoTheseFirst actions={actions} onDrill={() => {}} className="lg:col-span-2 xl:col-span-1"
          sub={isViewAs ? `Key actions to improve ${firstName}'s operating score.` : "Key actions to improve your operating score."} />
      </div>

      {/* 2026-09-29 — HOW LONG, beside how much. "5 done" reads the same
          whether it took two working days or nine, and somebody who finishes
          everything a week late looked perfect, because Overdue only ever
          counted work still OPEN. Both numbers are None rather than a
          flattering zero when there is nothing to measure (services/
          task_timing), and the cards say why instead of showing a dash. */}
      <WorkMovesRow timing={stats.timing} who={isViewAs ? firstName : null}
        approvals={approvals} />

      {/* 2026-09-29 — ONLY THE CARDS WITH SOMETHING IN THEM. On the page of
          somebody who has finished nothing, "Proof rate — 0 of 0 done with
          photo or voice" and "Plans in use 0/0" took two thirds of the row to
          say nothing: a proof rate over no finished work is not a low score,
          it is an undefined one, and a reader cannot tell those apart from a
          dash. Proof rate appears once there is finished work to carry proof;
          Plans in use stays while there is enough work for the nudge to mean
          something, because "hasn't used a Dex plan yet" IS the message. */}
      <BreakdownRow cards={[
        stats.completed > 0 && {
          key: "proof", icon: ShieldCheck, label: "Proof rate",
          value: `${stats.proof_upload_rate}%`, meter: stats.proof_upload_rate,
          detail: `${_pctToCount(stats.proof_upload_rate, stats.completed)} of ${stats.completed} done with photo or voice`,
          hint: stats.proof_upload_rate < 40 && stats.completed >= 3
            ? (isViewAs ? `${firstName} could attach a photo or voice update on the next done task` : "Attach a photo or voice update on your next done task")
            : null,
        },
        (stats.plans_used > 0 || stats.actionable >= 3) && {
          key: "plans", icon: ClipboardText, label: "Plans in use",
          value: `${stats.plans_completed}/${stats.plans_used}`,
          meter: stats.plans_used > 0 ? (stats.plans_completed / stats.plans_used) * 100 : null,
          detail: `${stats.plans_used} accepted plan${stats.plans_used === 1 ? "" : "s"}, ${stats.plans_completed} finished`,
          hint: stats.plans_used === 0 && stats.actionable >= 3
            ? (isViewAs ? `${firstName} hasn't used a Dex plan yet` : "Ask Dex to plan your next big task")
            : null,
        },
        {
          key: "actionable", icon: Check, label: "Actionable", value: String(stats.actionable),
          meter: stats.actionable > 0 ? (stats.completed / stats.actionable) * 100 : null,
          detail: `${stats.completed} done + ${stats.open} open`,
        },
      ]} />

      <section className={`mt-5 p-5 sm:p-6 ${CARD}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionHead icon={ClipboardText} title={isViewAs ? "Their open work" : "Your open work"} />
          <Link to={workLink()} className="flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
            See all <ArrowRight size={13} weight="bold" aria-hidden="true" />
          </Link>
        </div>
        {openWork.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nothing open right now — good place to be.</p>
        ) : (
          <ul className="divide-y divide-slate-900/[0.06]" data-testid="operating-self-open">
            {openWork.map((t) => (
              <li key={t.id}>
                {/* 2026-09-29 — was "/my-work" for every row: five tasks, one
                    destination, and from somebody else's page it landed the
                    owner on his OWN list. ?task= is the deep link the board
                    already uses (Workflows.js); it carries no person filter
                    because My Work drops every filter that could hide a
                    deep-linked task, by design, and widens the scope until the
                    task is visible. */}
                <Link to={`/my-work?task=${encodeURIComponent(t.id)}`} className="group flex items-center gap-4 rounded-xl px-1 py-3 transition-colors hover:bg-white/60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {taskStatusLabel(t.status)} · {priorityLabel(t.priority)}
                      {t.due_date ? ` · due ${_formatDate(t.due_date)}` : ""}
                      {t.stage_key ? ` · ${humanStage(t.stage_key)}` : ""}
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
                    <Link to={`/workflows?wf=${encodeURIComponent(w.id)}${w.type ? `&wf_type=${encodeURIComponent(w.type)}` : ""}`}
                      className="flex h-full flex-col rounded-2xl bg-white/[0.05] p-4 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.08]">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug">{w.title}</p>
                      <p className="mt-auto pt-3 text-xs text-white/60">
                        {wfLabel(w.type)} · {stageLabel(w.type, w.stage)}{w.counterparty ? ` · ${w.counterparty}` : ""}
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

/* Time to close, landing on the date, and the age of the queue. Counted in
   WORKING days (Sunday off) — the same calendar the stage deadlines and the
   stuck alerts count in, so "three days" means one thing across the product. */
function WorkMovesRow({ timing, who, company = false, approvals = null }) {
  const t = timing || {};
  /* An approver's queue is invisible in every other number on this page: work
     waiting on a signature is not the approver's own task, so it sits in
     nobody's Open and nobody's Overdue. Only shown to somebody who actually
     signs things off — for everyone else it is a card of dashes. */
  const a = approvals && (approvals.waiting > 0 || approvals.answered > 0) ? approvals : null;
  const theirs = company ? "the company's" : who ? `${who}'s` : "your";
  const them = company ? "the team" : who || "you";
  const onTimeCount = t.on_time_rate != null && t.dated ? Math.round((t.on_time_rate * t.dated) / 100) : null;
  return (
    <section className="mt-5" data-testid="operating-work-moves">
      <SectionHead icon={Timer}
        title={company ? "How the work moves" : who ? "How their work moves" : "How your work moves"}
        sub="Counted in working days — Sunday off, the same calendar the deadlines use." />
      <div className={`mt-4 grid gap-4 md:grid-cols-3 ${a ? "xl:grid-cols-4" : ""}`}>
        {/* Zero working days is a real and common answer in a workshop — raised
            in the morning, done by evening — and a bare "0" reads like a
            failure to measure rather than the best possible result. */}
        <BreakdownCard icon={Timer} label="Typical days to close"
          value={t.typical_days === 0 ? "Same day" : t.typical_days != null ? String(t.typical_days) : "—"}
          testid="ops-timing-typical"
          detail={t.typical_days != null
            ? `The middle of ${t.closed} finished task${t.closed === 1 ? "" : "s"} — half went quicker, half took longer.`
            : `Nothing finished yet, so there is nothing to time.`} />
        {/* 2026-09-29 — this counted only FINISHED work, and the browser showed
            why that was wrong: "Overdue 14" sat four inches above "Landed on
            time 100%", and a man with four dated tasks all past their date and
            nothing finished was told there was nothing to judge. Work still
            open past its date has already missed it. */}
        <BreakdownCard icon={CalendarBlank} label="Hit their date"
          value={t.on_time_rate != null ? `${t.on_time_rate}%` : "—"}
          meter={t.on_time_rate != null ? t.on_time_rate : null}
          testid="ops-timing-on-time"
          detail={t.on_time_rate != null
            ? `${onTimeCount} of ${t.dated} dated task${t.dated === 1 ? "" : "s"} were done by their date`
              + (t.late_open ? ` — ${t.late_open} ${t.late_open === 1 ? "is" : "are"} open and already past it.` : ".")
            : `Nothing dated has come due yet — work nobody dated cannot be early or late.`}
          hint={t.on_time_rate != null && t.on_time_rate < 60
            ? `More than a third of ${theirs} dated work misses its date.` : null} />
        <BreakdownCard icon={ClipboardText} label="Oldest thing waiting"
          value={t.waiting_days != null ? String(t.waiting_days) : "—"}
          testid="ops-timing-waiting"
          detail={t.waiting_days != null
            ? `Working days the longest-open task has been with ${them}.`
            : `Nothing open — a good place to be.`} />
        {a && (
          <BreakdownCard icon={ShieldCheck} label="Sign-offs waiting"
            value={String(a.waiting)}
            testid="ops-timing-approvals"
            detail={a.typical_days != null
              ? `${who || "You"} answer${who ? "s" : ""} a request in about ${a.typical_days === 0
                  ? "the same day" : `${a.typical_days} working day${a.typical_days === 1 ? "" : "s"}`}, over ${a.answered} so far.`
              : `Nothing answered yet to measure a turnaround from.`}
            hint={a.oldest_days > 2
              ? `The oldest has been waiting ${a.oldest_days} working days.` : null} />
        )}
      </div>
    </section>
  );
}

/* A row of however many cards there are. Tailwind needs the column class
   spelled out, so it is picked from a map rather than built from a number —
   a class assembled at runtime is one the build has never seen and will not
   ship. Two cards in a three-column grid leave a hole that reads as a card
   that failed to load, which is the bug this row exists to avoid. */
const ROW_COLS = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" };

function BreakdownRow({ cards }) {
  const shown = (cards || []).filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className={`mt-5 grid gap-4 ${ROW_COLS[shown.length] || "md:grid-cols-3"}`} data-testid="operating-breakdowns">
      {shown.map((c) => (
        <BreakdownCard key={c.key} icon={c.icon} label={c.label} value={c.value}
          meter={c.meter} detail={c.detail} hint={c.hint} testid={`ops-breakdown-${c.key}`} />
      ))}
    </div>
  );
}

function BreakdownCard({ icon: Icon, label, value, detail, hint, meter, testid }) {
  return (
    <div className={`p-5 ${CARD}`} data-testid={testid}>
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
              {/* JOURNEY-1 J2 — this line read "not wired for this category yet": a
                  note to a programmer, on a founder's screen. */}
              The score above is up to date. A breakdown of what makes it up isn't shown for this part yet.
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

/* KM-28 — the formula, unfolded above the Team execution card. The control
   that opens it is FormulaToggle, in the card's notch.

   2026-09-29 — THE WEIGHT SLIDERS ARE GONE. "Customize weights for your
   business" offered four presets and four sliders, and its own small print
   admitted they were not saved. They did not even preview: moving Execution
   from 35% to 45% left the score on screen exactly where it was, because
   nothing downstream read them. A control on a page whose whole job is to be
   trusted about numbers must either change a number or not be there. If
   per-industry weights are wanted, they belong in the operating model beside
   the pipelines, computed in services/operating_score.py — then the slider
   would mean something. */
function FormulaPanel({ open, panelRef }) {
  return (
    <div ref={panelRef}>
      {open && (
        <div id="operating-formula-panel" className={`mb-6 space-y-4 p-5 sm:p-6 ${CARD}`} data-testid="operating-formula-panel">
          <p className="text-sm leading-relaxed text-slate-600">
            Overall is a weighted average across the four categories. Categories with no data yet are skipped and the remaining weights renormalize.
          </p>
          {/* Said here rather than left for somebody to discover: a payment
              settles an invoice that may have been raised months earlier, so
              "collected in the last 30 days" would divide two figures that do
              not belong to each other. Finance reads all time whatever the
              window says, and the reader is told. */}
          <p className="text-sm leading-relaxed text-slate-600">
            A window narrows the <strong className="font-semibold text-slate-900">finished</strong> work to what finished inside it;
            everything still open counts however old it is. Finance is the exception — it always reads all time,
            because a payment often settles an invoice raised long before it.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {CATS.map((c) => (
              <div key={c.key} className={`p-4 ${DRAWER_CARD}`}>
                <div className="mb-1.5 flex items-center gap-2">
                  <c.icon size={15} aria-hidden="true" className="shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">{c.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-500">weight {c.weight}%</span>
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

function OperatingScoreSkeleton({ person = false }) {
  return (
    <div aria-busy="true" aria-live="polite" data-testid="operating-skeleton" data-shape={person ? "person" : "company"}>
      {person && <div className="ds-skeleton mb-5 h-[62px] rounded-[1.25rem]" />}
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
      {person ? (
        <>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-[136px] rounded-[1.6rem]" />)}
          </div>
          <div className="ds-skeleton mt-5 h-[300px] rounded-[1.6rem]" />
        </>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="ds-skeleton h-[176px] rounded-[1.6rem]" />)}
        </div>
      )}
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

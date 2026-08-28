// /inbox — the founder's dashboard, KR-8: the Health Karma reference,
// replicated on real data.
//
// LAYOUT (the reference's, exactly):
//   light zone · LEFT   greeting title, Company/You scope pills, the giant
//                       score with delta eyebrow + band caption, the thin
//                       ArcGauge, two wide money cards
//   light zone · RIGHT  the 3×2 StatTile grid, one glass tile among five
//   dark band          THE DESK, full width (KR-8.5) — all four sections at
//                       once as one bento, boxes sized by priority, each
//                       section carrying its own gradient. No filter pills:
//                       colour is the grouping. All DeskCard behaviour ported
//                       verbatim; acted cards dim in place.
//                       (The spend chart moved out — a money chart belongs on
//                       /finance, and the founder wanted this sheet to be the
//                       desk and nothing else.)
//
// WHAT DIED HERE: FounderBento.jsx (its data wiring lives on in
// useDeskMetrics), the two-pane NM-22 split, the kanban board markup — and,
// on the founder's mid-build directive ("don't use any old mobile view port
// uiux design layout"), DeskMobile.jsx and the isMobile early-return. This
// tree is the ONE tree, reflowing to the phone reference below lg: title →
// score+gauge → wide cards → 2-up tiles → band.
//
// Deep-link contract preserved: /inbox?decision=<id> forces the
// needs_decision pill and auto-opens the DecisionDialog (E2-66/U7-02.2).
import { useState, useEffect, useRef, useCallback } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import api from "../lib/api";
import { toast } from "sonner";
import { DecisionDialog } from "../components/DecisionDialog";
import { useAuth } from "../context/AuthContext";
import { inrCompact } from "../lib/format";
import { selfScore, scoreBand } from "../lib/karmaScore";
import { isDemoTenant, demoDelta } from "./_operatingScoreDemo";
import {
  ArcGauge, StatTile, DecisionBento, InsightWell,
  BigNumeral, KDeltaChip, DarkBand, MiniBars, CircleDots, TinySpark,
} from "../components/karma";
import { useDeskMetrics } from "./desk/useDeskMetrics";
import { deskInsight } from "../lib/deskInsight";
import {
  Fire, Sun, Star, Scales, Timer,
  ChatCircleText, Gauge as GaugeIcon, Receipt, HandCoins, TrendUp,
} from "@phosphor-icons/react";

// KR-8.5 — the four sections, in urgency order. `tint` is the gradient each
// section's boxes wear; `dot` is its solid swatch in the section header.
// Order matters twice: it is the reading order, and DecisionBento uses the
// index as the first term of its size ranking.
const SECTIONS = [
  { key: "needs_decision", label: "Needs your decision", icon: Scales, tint: "kr-desk--needs", dot: "bg-[hsl(30_88%_52%)]", empty: "No decisions waiting on you" },
  { key: "on_fire",        label: "On fire",             icon: Fire,   tint: "kr-desk--fire",  dot: "bg-[hsl(6_78%_50%)]",  empty: "Nothing on fire" },
  { key: "due_today",      label: "Due today",           icon: Sun,    tint: "kr-desk--today", dot: "bg-[hsl(210_55%_52%)]", empty: "Nothing due today" },
  { key: "important",      label: "Important",           icon: Star,   tint: "kr-desk--flag",  dot: "bg-[hsl(92_34%_44%)]", empty: "Nothing flagged" },
];

const CTA_LABEL = { review: "Review", respond: "Respond", chase: "Chase", nudge: "Nudge" };
const CTA_ICON = { review: Scales, respond: ChatCircleText, chase: Fire, nudge: Sun };

/**
 * The scope pair — the reference's Equifax/TransUnion pills, honestly: the
 * company's grade vs the founder's own operator score. Only an owner has both.
 *
 * KR-8.11 — extracted because the pills now render in two places (stacked to
 * the numeral's left from lg, above the score below it) and two copies of a
 * toggle is two chances for the pressed state to drift apart. The pill's own
 * size is untouched, per the founder: h-9, px-4, natural width.
 */
/* KM-1 — the JOINED variant.
   WHY NOT .kr-pop / .kr-pressed, which is what MyWork's segmented pair uses:
   measured on this page, it inverts. .kr-pressed draws a big white inset from
   the bottom-right (inset -4px -4px 9px hsl(0 0% 100% / .72)); that reads as
   recessed over MyWork's cool blue-grey zone, but Desk's sky is a HOT ORANGE
   bloom, and against a warm ground the same white inset reads as a lighter
   FILL — so the selected half looked raised and the unselected half looked
   pushed in, exactly backwards. Same failure mode this project already hit
   once ("the white highlight needs a darker ground"). Depth was never
   available here, so the arm's-length argument for it does not apply.
   What is left is the founder's own KR-8.13 treatment, whose alphas were
   MEASURED against this bloom (faded label 4.75:1, faded border 3.63:1) and
   whose rule was explicit: no fill on either pill. That stays untouched.
   The real defect was never the material — it was that two pills floating in
   an equidistant gap belonged to neither neighbour. So the fix is pure
   GEOMETRY: -ml-px welds the two hairlines into one continuous outline, so the
   pair reads as ONE control with two halves, and `relative z-10` lets the
   selected pill's full-strength border draw over its faded neighbour's rather
   than averaging with it. No new material, no fill, nothing to re-measure. */
const SEG = "flex h-11 items-center justify-center border-[0.5px] px-5 text-sm";
const SEG_ON = "relative z-10 border-kr-ink font-medium text-foreground";
const SEG_OFF = "border-kr-ink/55 text-foreground/65";

function ScopePills({ scope, setScope, variant = "pill" }) {
  if (variant === "joined") {
    return (
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setScope("you")}
          aria-pressed={scope === "you"}
          data-testid="desk-scope-joined-you"
          className={`${SEG} rounded-l-pill ${scope === "you" ? SEG_ON : SEG_OFF}`}
        >
          You
        </button>
        <button
          type="button"
          onClick={() => setScope("company")}
          aria-pressed={scope === "company"}
          data-testid="desk-scope-joined-company"
          className={`${SEG} -ml-px rounded-r-pill ${scope === "company" ? SEG_ON : SEG_OFF}`}
        >
          Company
        </button>
      </div>
    );
  }

  // KR-8.12 — "You" leads, "Company" follows. Stacked that puts You on top
  // and Company below, which is the founder's order; the horizontal phone
  // row inherits it rather than keeping a second, contradictory order.
  return [["you", "You"], ["company", "Company"]].map(([k, label]) => (
    <button
      key={k}
      type="button"
      onClick={() => setScope(k)}
      aria-pressed={scope === k}
      data-testid={`desk-scope-${k}`}
      /* KR-8.13 — NO FILL ON EITHER PILL. Both grounds are the page itself;
         the selected one is drawn purely by a darker border and a medium
         label, the unselected by the same outline faded back. Opacity is
         not the only difference, deliberately: weight and border strength
         both move, so the pair is still readable to anyone who cannot
         separate two tints (and aria-pressed carries it for anyone who
         cannot see either).
         KR-8.13 also thins both to a 0.5px BLACK hairline, matching
         PillNav — the selected at full strength, the faded at 55%: still
         black, just quieter, so each keeps its own boundary.
         The alphas are measured, not chosen — against the bloom's hottest
         point the faded label sits at 4.75:1 and its border at 3.63:1.
         foreground/45 would have looked right and measured 2.92:1. */
      className={
        scope === k
          ? "h-9 rounded-pill border-[0.5px] border-kr-ink px-4 text-sm font-medium text-foreground"
          : "h-9 rounded-pill border-[0.5px] border-kr-ink/55 px-4 text-sm text-foreground/65 transition-colors hover:text-foreground/85"
      }
    >
      {label}
    </button>
  ));
}

export default function Desk() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, tenant } = useAuth();
  const m = useDeskMetrics();

  const [openDecision, setOpenDecision] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // KR-8.5: cards the founder has already acted on this session. They dim in
  // place rather than vanishing — losing your place in a grid is worse than
  // seeing a finished item.
  const [doneIds, setDoneIds] = useState(() => new Set());
  const markDone = useCallback((id) => setDoneIds((prev) => new Set(prev).add(id)), []);

  /* KM-9 — THE PROGRESSIVE BLUR IS GONE, on the founder's call.
     A passive scroll listener used to write --kr-hero-blur / --kr-hero-fade /
     --kr-hero-scale so the hero fogged as the dark sheet climbed over it. It
     was built for the DESKTOP composition, where the hero is pinned and the
     sheet genuinely travels across it; on a phone the page just scrolls, so
     the effect only ever blurred content still being read. heroRef stays —
     .kr-hero is still the grid — it simply has nothing writing to it now. */
  const heroRef = useRef(null);

  // Owner sees Company/You; everyone else only ever has their own view.
  const [scope, setScope] = useState("company");

  // E2-66: deep-link from a decision-focused nudge notification.
  const [searchParams] = useSearchParams();
  const focusDecisionId = searchParams.get("decision");
  useEffect(() => { if (focusDecisionId) setOpenDecision(focusDecisionId); }, [focusDecisionId]);

  // The board fetch — all four chips in parallel, cache-shared, 30s fresh.
  const boardQs = useQueries({
    queries: SECTIONS.map((c) => ({
      queryKey: ["desk", c.key],
      queryFn: () => api.get(`/desk?chip=${c.key}`).then((r) => r.data),
      refetchInterval: 30000,
    })),
  });
  const counters = boardQs.find((q) => q.data?.counters)?.data?.counters
    || { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 };
  
  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  // U7-02.1: "chase" on a card the viewer owns is really "respond".
  const effectiveCta = (card) =>
    card.cta === "chase" && card.target_owner_id === user?.id ? "respond" : card.cta;

  const onCardAction = async (card) => {
    const cta = effectiveCta(card);
    if (cta === "review" && card.target_kind === "decision") { setOpenDecision(card.target_id); markDone(card.id); return; }
    if (cta === "respond") { navigate(`/my-work?task=${card.target_id}`); return; }
    if (cta === "chase" || cta === "nudge") {
      setBusyId(card.id);
      try {
        const res = await api.post(`/desk/nudge/${card.target_id}`, {});
        const to = res.data?.target_name || "them";
        toast.success(card.cta === "chase"
          ? `Chased ${to} — sent via ${res.data?.channel}`
          : `Nudged ${to} — sent via ${res.data?.channel}`);
        markDone(card.id);
        refresh();
      } catch (e) {
        toast.error(e.response?.data?.detail || "Nudge failed");
      } finally {
        setBusyId(null);
      }
    }
  };

  // ── the score block ──────────────────────────────────────────────────────
  const ops = m.ops;
  const isOwnerView = ops?.view === "owner";
  const youScore = isOwnerView ? selfScore(ops.mySnapshot) : selfScore(ops?.stats);
  const shownScore =
    !ops ? null
    : isOwnerView
      ? (scope === "you" ? youScore : (ops.enough ? ops.score : null))
      : youScore;
  const band = scoreBand(shownScore);
  const scoreReady = shownScore != null;

  const total = SECTIONS.reduce((n, sec) => n + (counters[sec.key] ?? 0), 0);

  // KR-8.7 — Dex's lead for the well. A ranker over metrics the page has
  // already fetched, so it adds a request count of zero and cannot contradict
  // a tile. Owners get the decision backlog as a candidate; everyone else
  // only ever sees their own work and money.
  const insight = deskInsight(m, isOwnerView ? (counters.needs_decision ?? 0) : 0);

  const greeting = m.greeting;
  const gi = greeting.lastIndexOf(",");

  return (
    /* KR-8.4 — THE SHEET RISES OVER A PINNED HERO.
       Founder, correcting KR-8.3: "the black card should scroll along with
       the content — I don't want the content inside it scrollable." So the
       band has NO inner scroller. Instead the light zone is STICKY: it holds
       at the top of the viewport while the page scrolls, and the band — one
       opaque sheet, content and all — travels up and over it. That is the
       motion the centre tab has been promising since KR-8.2.

       z-order is what makes it read: the hero sits at z-0 and the band at
       z-10, so the ink covers rather than blends as it passes. Sticky (not
       fixed) so the hero still participates in layout and the page height is
       simply hero + band.

       Below lg the hero is NOT pinned — it is several screens tall on a
       phone, and pinning it would leave the dashboard permanently hidden
       behind the sheet. The phone scrolls the whole document. */
    <div data-testid="desk-page">
      {/* ── LIGHT ZONE — pinned; the sheet passes over it ─────────────── */}
      {/* KR-8.6 — the split and the gaps are MEASURED off the reference, not
          eyeballed. In the reference the light zone divides 36 / 56 with a
          wide 8% trough between; we were at 42 / 58 with a 40px gap, which is
          what made our tiles read as squeezed and over-spaced at once. */}
      <div ref={heroRef} className="kr-hero sticky top-0 z-0 flex flex-col gap-6 lg:grid lg:gap-8 lg:top-5 lg:grid-cols-[minmax(0,29fr)_minmax(0,45fr)] lg:gap-20">
        {/* LEFT column (KR-8.7) — greeting, scope, THE INSIGHT WELL, and the
            score pushed to the floor.
            The founder wanted the editorial space directly under the greeting
            for Dex, and the score block moved down to sit level with the KPI
            grid's bottom edge. A flex column does both in one move: the well
            takes flex-1 (it absorbs whatever height the grid dictates) and
            the score block, being last with nothing after it, lands on the
            column's floor — which the hero grid has already made equal to
            the right column's floor.
            KR-14.2 · MOBILE ONLY — the column becomes display:contents so its
            children flow into the outer flex-col, letting the KPI grid slot
            between the pills and the Dex well via `order-*`. Desktop is
            unchanged: from lg the column reverts to flex flex-col and its
            children forget their orders. */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col">
          {/* KR-14.2 · MOBILE row — greeting on the LEFT, a compact
              score+gauge on the RIGHT, matching the reference. On lg the
              wrapper reverts to a block and its children stack: the h1
              re-centres, the mobile score cluster hides, and the full-size
              score row (below) takes over. */}
          <div className="order-1 flex items-start justify-between gap-4 lg:order-none lg:block">
            <h1 className="font-display text-2xl leading-tight lg:text-center lg:text-3xl sm:lg:text-4xl" data-testid="desk-brief-greeting">
              {gi === -1
                ? <span>{greeting || " "}</span>
                : <>
                    <span>{greeting.slice(0, gi + 1)}</span>
                    <span className="text-muted-foreground">{greeting.slice(gi + 1)}.</span>
                  </>}
            </h1>

            {/* Compact score cluster — mobile only. Hides from lg where the
                dedicated score row below owns this content. */}
            <div className="flex shrink-0 items-center gap-3 lg:hidden" aria-hidden={!scoreReady}>
              <div className="flex items-baseline">
                <span className="font-display text-6xl leading-none">{scoreReady ? shownScore : "—"}</span>
                {scoreReady && <span className="ml-1 text-sm text-muted-foreground">/100</span>}
              </div>
              <ArcGauge
                value={scoreReady ? shownScore : null}
                size={110}
                className="w-24 shrink-0 text-foreground"
              />
            </div>
          </div>

          {/* KR-11 — the pills only appear ABOVE the score below lg. From
              lg they move into the score row, stacked to the numeral's left.
              KR-14.2 · MOBILE — justify-start, per the reference; from lg the
              row re-centres between the greeting and the desktop score. */}
          {/* KR-14.20 · MOBILE — the You / Company scope pills are hidden
              on the phone per the founder's ask. They still render at lg
              (below xl) and, at xl and above, in the side stack. */}
          {isOwnerView && (
            <div className="order-2 hidden items-center justify-start gap-2 lg:order-none lg:mt-4 lg:flex lg:justify-center xl:hidden" data-testid="desk-scope-pills">
              <ScopePills scope={scope} setScope={setScope} />
            </div>
          )}

          {/* Score + gauge, side by side like the reference — back in their
              original slot under the pills (KR-8.8).
              items-END, not items-center: with the caption gone the block is
              just a numeral, and the gauge is a HALF circle whose diameter
              is its floor. Bottom-aligning the two lands the needle hub on
              the numeral's baseline, which is the relationship the reference
              draws. Centring them left the instrument floating high. */}
          {/* KR-8.10 — CENTRED over the well, and lifted off it.
              mt-2 pulls the block up toward the pills (the founder's "move
              the score number and the odometer a little bit upper");
              mb-10 is the air below it. That margin has to be REAL, not
              slack: the left column's content already exceeds the KPI grid's
              natural height, so mt-auto on the well resolves to zero and
              would have given nothing. justify-center puts the numeral+gauge
              pair on the well's centre line. */}
          {/* KR-8.12 — EVEN AIR, COMPUTED NOT TYPED. The gaps were 8 above
              and 58 below: mt-2/mb-10 set a floor, then the well's mt-auto
              swept the column's leftover slack into the lower gap alone.
              my-auto here replaces both. Two auto margins on the same flex
              item split the free space equally by definition, so the score
              sits dead centre between the greeting and the well at ANY
              column height — no magic number to re-tune per breakpoint.
              The well drops its own mt-auto, or it would compete for the
              same slack and tip the balance back. my-8 is the phone floor,
              where a stacked column has no free space to distribute.
              lg:py-5 is the OTHER floor, and it has to be padding rather
              than margin: at 1024 the column has no slack either, auto
              collapses to 0, and the score ends up touching both neighbours.
              Padding cannot collapse, so the gap is never smaller than 20px
              — and because it is inside the row, both sides still grow by
              the same amount and stay even. */}
          <div className="hidden lg:my-auto lg:flex lg:items-end lg:justify-center lg:gap-5 lg:py-5">
            {/* KR-8.11 — the pills, stacked to the numeral's LEFT from xl.
                items-end is the founder's "right aligned to the left side of
                the number": the two pills keep their own natural widths (93
                and 56) and line up on their RIGHT edges, so the stack ends
                flush against the numeral rather than starting flush with it.
                self-center puts the 80px stack on the 96px numeral's middle. */}
            {isOwnerView && (
              <div className="hidden flex-col items-end gap-2 self-center xl:flex" data-testid="desk-scope-pills-side">
                <ScopePills scope={scope} setScope={setScope} />
              </div>
            )}

            {/* shrink-0: this block was shrinking under pressure and wrapping
                "/ 100" onto its own line — a silent reflow that made the row
                25px taller. The score is not the thing that gives way. */}
            <div className="shrink-0">
              {/* Delta eyebrow — demo-tenant only; no endpoint carries a real
                  score delta yet (see _operatingScoreDemo's wire-order note). */}
              {isDemoTenant(tenant) && scoreReady && (
                <p className="mb-1" data-testid="desk-score-delta">
                  <KDeltaChip
                    pct={demoDelta.sign === "down" ? -demoDelta.value : demoDelta.value}
                    direction={demoDelta.sign}
                    downIsBad
                    suffix=" pts"
                  />
                </p>
              )}
              <div className="flex items-baseline gap-3">
                <BigNumeral
                  text={scoreReady ? String(shownScore) : "—"}
                  size="xl"
                  countUp={scoreReady}
                  testid="desk-score"
                />
                {scoreReady && <span className="text-2xl text-muted-foreground">/ 100</span>}
              </div>
              {/* KR-8.8 — the "Needs work / Updated live" caption is gone on
                  the founder's call: the band word is already the tile grid's
                  job and "Updated live" is decoration.
                  It survives ONLY in the not-enough-data case, where a bare
                  "—" would be a shrug. That is the honesty line, not the
                  caption the founder asked to remove. */}
              {!scoreReady && (
                <p className="mt-2 text-sm leading-snug text-muted-foreground" data-testid="desk-score-caption">
                  Score kicks in soon —<br />a little real activity first
                </p>
              )}
            </div>
            <ArcGauge
              value={scoreReady ? shownScore : null}
              size={190}
              /* The viewBox is fixed; the rendered width steps to whatever
                 the row can actually afford. It gives up 12px at xl, which
                 is where the 93px pill stack joins the row:
                 93 + 20 + 112 + 20 + 178 = 423 in a 441px column. */
              className="w-[128px] shrink-0 text-foreground sm:w-[160px] lg:w-[190px] xl:w-[178px]"
              testid="desk-gauge"
            />
          </div>

          {/* KR-8.8 — the well moves to the floor. mt-auto, not flex-1: the
              founder wants it ALIGNED to the grid's bottom line, not
              stretched to swallow the slack above it. So it keeps its own
              height and the air collects between the score and the well.
              (The two money cards left this column in KR-8.7 for the KPI
              grid opposite, taking the slots Due today and Completion rate
              gave up.) */}
          {/* KM-1 — order-4 puts the well AFTER the KPI grid on a phone.
              Evidence, then interpretation: today Dex tells you what to do
              before you have seen a single number to judge it against, and the
              well's 172-242px sits between the score and the first tile. This
              is also the honest linearisation of the desktop composition, where
              the comment above already places the well at the column's FLOOR,
              level with the grid's bottom edge — stacking it naively teleported
              that bottom-left element into the vertical middle.
              This class and the grid's order-3 below are the entire decision;
              swapping the two numbers reverts it. */}
          <InsightWell
            insight={insight}
            loading={!insight}
            className="order-4 min-h-[172px] lg:order-none"
            testid="desk-insight"
          />
        </div>

        {/* RIGHT — the 3×2 grid. Six honest tiles; Score mix is the glass one.
            KR-8.6 · three fixes to the founder's "slightly spaced" note:
            · 3 columns from lg, not xl — below 1280 we were rendering a 2×3
              portrait grid, which is a different composition from the
              reference's 3×2, not a tighter version of it;
            · 12px gutters (the reference's gutter is ~4% of a tile, ours was
              6.6%);
            · auto-rows-fr so the two rows are EQUAL and the grid's floor lands
              on the money cards' floor. Ragged row heights (173/200/173) were
              the actual misalignment. */}
        {/* KR-14.20 · MOBILE — the KPIs are four rounded rectangles in a
            2×2 grid. Each card: label on the LEFT, icon + numeral aligned
            to the RIGHT. Score-mix and Spend are dropped per the founder;
            the four kept are Delayed, Complaints, Overdue, Net profit. */}
        <div className="order-3 grid grid-cols-2 gap-2 lg:hidden" data-testid="desk-kpi-strip">
          {[
            { icon: Timer, label: "Delayed",
              value: String(m.counters ? m.counters.delayed : m.work?.overdue ?? "…"),
              urgent: (m.counters?.delayed ?? m.work?.overdue ?? 0) > 0,
              to: "/my-work?filter=overdue", testid: "kpi-delayed-m" },
            { icon: ChatCircleText, label: "Complaints",
              value: String(m.complaints ? m.complaints.value : "…"),
              urgent: (m.complaints?.new_7d || 0) > 0,
              to: "/crm", testid: "kpi-complaints-m" },
            { icon: HandCoins, label: "Overdue",
              value: m.cash ? inrCompact(m.cash.overdue) : "…",
              urgent: (m.cash?.overdue || 0) > 0,
              to: "/finance?tab=revenue&filter=overdue", testid: "kpi-collect-m" },
            { icon: TrendUp, label: "Net profit",
              value: m.ledger && Number.isFinite(m.ledger.netProfit) ? inrCompact(m.ledger.netProfit) : "…",
              urgent: m.ledger ? m.ledger.netProfit < 0 : false,
              to: "/finance", testid: "kpi-profit-m" },
          ].map((k) => (
            <Link key={k.testid} to={k.to} data-testid={k.testid}
              className="nm-tile flex min-w-0 items-center justify-between gap-2 p-3">
              <p className="min-w-0 truncate text-xs font-medium text-foreground/80">{k.label}</p>
              <span className="flex shrink-0 items-center gap-1.5">
                <k.icon size={13} weight="regular" aria-hidden="true" className="text-muted-foreground" />
                <span className={`font-display text-base leading-none tabular-nums ${k.urgent ? "text-kr-accent" : ""}`}>
                  {k.value}
                </span>
              </span>
            </Link>
          ))}
        </div>

        <div className="order-3 hidden min-w-0 grid-cols-2 gap-3 lg:order-none lg:grid lg:auto-rows-fr lg:grid-cols-3" data-testid="desk-kpi-grid">
          <StatTile
            icon={Timer}
            label="Delayed"
            value={String(m.counters ? m.counters.delayed : m.work?.overdue ?? "…")}
            urgent={(m.counters?.delayed ?? m.work?.overdue ?? 0) > 0}
            alert={(m.counters?.delayed ?? 0) > 0}
            viz={m.work?.deptCounts?.length ? <MiniBars values={m.work.deptCounts} accentIndex={0} width={64} /> : null}
            to="/my-work?filter=overdue"
            countUp
            testid="kpi-delayed"
          />
          <StatTile
            icon={ChatCircleText}
            label="Complaints"
            value={String(m.complaints ? m.complaints.value : "…")}
            urgent={(m.complaints?.new_7d || 0) > 0}
            alert={m.complaints?.new_7d > 0 ? m.complaints.new_7d : false}
            viz={m.complaints ? <CircleDots count={m.complaints.new_7d} /> : null}
            meaning={m.complaints?.new_7d > 0 ? `${m.complaints.new_7d} new this week` : undefined}
            to="/crm"
            countUp
            testid="kpi-complaints"
          />
          <StatTile
            glass
            icon={GaugeIcon}
            label={isOwnerView && ops.weakest ? `Weakest — ${ops.weakest[0]}` : "Score mix"}
            value={isOwnerView && ops.weakest ? String(ops.weakest[1]) : "—"}
            viz={isOwnerView ? <MiniBars values={ops.catValues} width={64} /> : null}
            to="/operating-score"
            testid="kpi-score-mix"
          />
          {/* KR-8.7 — the money pair, moved in from the left column and
              re-cut as tiles. They were WideStatCards; in a 3×2 grid whose
              whole point is six identical cells, a second card anatomy read
              as a mistake. Same data, same destinations, same orange alert
              on overdue.
              TESTID RENAME: desk-card-collect/profit → kpi-collect/profit.
              The old names shared the `desk-card-` prefix with the bento's
              decision boxes, which already cost one bad measurement. */}
          <StatTile
            icon={HandCoins}
            alert={(m.cash?.overdue || 0) > 0}
            label="To collect (overdue)"
            value={m.cash ? inrCompact(m.cash.overdue) : "…"}
            urgent={(m.cash?.overdue || 0) > 0}
            to="/finance?tab=revenue&filter=overdue"
            testid="kpi-collect"
          />
          <StatTile
            icon={TrendUp}
            label="Net profit"
            value={m.ledger && Number.isFinite(m.ledger.netProfit) ? inrCompact(m.ledger.netProfit) : "…"}
            urgent={m.ledger ? m.ledger.netProfit < 0 : false}
            to="/finance"
            testid="kpi-profit"
          />
          <StatTile
            icon={Receipt}
            label="Spend, this month"
            value={m.ledger?.lastMonthSpend != null ? inrCompact(m.ledger.lastMonthSpend) : "…"}
            viz={m.ledger?.byMonth?.length > 1
              ? <TinySpark points={m.ledger.byMonth.map((x) => x.amount)} tone="neutral" />
              : null}
            to="/finance"
            testid="kpi-spend"
          />
        </div>
      </div>

      {/* ── THE DARK BAND ──────────────────────────────────────────────── */}
      <DarkBand
        testid="desk-band"
        /* KM-1 — mobile carried DOUBLE desktop's bottom padding (pb-28 = 112px
           against lg:pb-14 = 56px) on top of main's own pb-dock (96px): ~200px
           of nothing at the foot of the page. pb-20 still leaves 80 - 16 + 96 =
           160px of clearance under the last card against a ~96px dock. */
        /* KM-9 — the collapsed sheet must CLEAR the dock, not sit under it.
           Measured before: at rest the band ran 516->865 while the dock's top
           edge is 732, so the single card it is collapsed to was cut in half
           by the bar. Pulling the band up (mt-4/pt-4) and dropping the mobile
           card floor to 150px puts the whole card above 732. Desktop keeps its
           own margins and the 178/196px floors. */
        className="relative z-10 mt-4 pt-4 pb-20 lg:mt-10 lg:pt-10 lg:pb-14 -mb-4 lg:-mb-8"
      >
        {/* KR-8.5 — the desk takes the WHOLE sheet. The spend line chart is
            gone from here (it lives on /finance, where a money chart belongs);
            the four sections now use the full width as one bento, all visible
            at once, sized by priority. No filter pills: colour does the
            grouping, so nothing is a click away. */}
        {/* KR-14.20 — the "Decision desk" heading and its count are hidden
            on mobile per the founder's ask; both return from lg up. */}
        <div className="mb-4 hidden flex-wrap items-baseline gap-x-3 gap-y-1 lg:mb-5 lg:flex lg:justify-start">
          <h2 className="text-h2 lg:text-left">Decision desk</h2>
          <p className="text-sm opacity-70">
            {total === 0 ? "Nothing waiting on you" : `${total} waiting on you`}
          </p>
        </div>

        <DecisionBento
          testid="desk-bento"
          sections={SECTIONS.map((sec, i) => ({
            ...sec,
            count: counters[sec.key] ?? 0,
            cards: boardQs[i]?.data?.cards || [],
            loading: boardQs[i]?.isLoading,
          }))}
          verbFor={(card) => CTA_LABEL[effectiveCta(card)] || "Open"}
          iconFor={(card) => CTA_ICON[effectiveCta(card)] || Scales}
          onCard={onCardAction}
          busyId={busyId}
          doneIds={doneIds}
        />
      </DarkBand>

      {/* Decision review modal — mechanics untouched. */}
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

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
import { useNavigate, useSearchParams } from "react-router-dom";
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

  // KR-8.5 — the hero blurs progressively as the sheet climbs over it.
  // A passive scroll listener writing three custom properties, rAF-coalesced:
  // the alternative (blur as React state) would re-render the whole dashboard
  // on every scroll frame. Desktop only — the hero is not pinned below lg, so
  // blurring it there would just fog content the founder is still reading.
  const heroRef = useRef(null);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const wide = window.matchMedia("(min-width: 1024px)");
    let raf = 0;
    const paint = () => {
      raf = 0;
      if (reduced.matches || !wide.matches) {
        el.style.removeProperty("--kr-hero-blur");
        el.style.removeProperty("--kr-hero-fade");
        el.style.removeProperty("--kr-hero-scale");
        return;
      }
      // Full effect by the time the sheet has climbed ~320px.
      const p = Math.max(0, Math.min(1, window.scrollY / 320));
      el.style.setProperty("--kr-hero-blur", `${(p * 9).toFixed(2)}px`);
      el.style.setProperty("--kr-hero-fade", (1 - p * 0.5).toFixed(3));
      el.style.setProperty("--kr-hero-scale", (1 - p * 0.028).toFixed(4));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    paint();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
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
      <div ref={heroRef} className="kr-hero grid gap-8 lg:sticky lg:top-5 lg:z-0 lg:grid-cols-[minmax(0,29fr)_minmax(0,45fr)] lg:gap-20">
        {/* LEFT column (KR-8.7) — greeting, scope, THE INSIGHT WELL, and the
            score pushed to the floor.
            The founder wanted the editorial space directly under the greeting
            for Dex, and the score block moved down to sit level with the KPI
            grid's bottom edge. A flex column does both in one move: the well
            takes flex-1 (it absorbs whatever height the grid dictates) and
            the score block, being last with nothing after it, lands on the
            column's floor — which the hero grid has already made equal to
            the right column's floor. */}
        <div className="flex min-w-0 flex-col">
          <h1 className="font-display text-3xl sm:text-4xl" data-testid="desk-brief-greeting">
            {gi === -1
              ? <span>{greeting || " "}</span>
              : <>
                  <span>{greeting.slice(0, gi + 1)}</span>
                  <span className="text-muted-foreground">{greeting.slice(gi + 1)}.</span>
                </>}
          </h1>

          {/* Scope pills — the reference's Equifax/TransUnion pair, honestly:
              the company's grade vs the founder's own operator score. Only an
              owner has both. */}
          {isOwnerView && (
            <div className="mt-4 flex items-center gap-2" data-testid="desk-scope-pills">
              {[["company", "Company"], ["you", "You"]].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setScope(k)}
                  aria-pressed={scope === k}
                  data-testid={`desk-scope-${k}`}
                  className={
                    scope === k
                      ? "h-9 rounded-pill bg-kr-ink px-4 text-sm font-medium text-white"
                      : "h-9 rounded-pill border border-kr-outline px-4 text-sm text-foreground/80 transition-colors hover:text-foreground"
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Dex's read of today — the page's one piece of prose, and the
              reason the score moved down. flex-1 so it eats the slack
              between the greeting and the score's floor. */}
          <InsightWell
            insight={insight}
            loading={!insight}
            className="mt-6 min-h-[168px] flex-1"
            testid="desk-insight"
          />

          {/* Score + gauge, side by side like the reference. Last child, so
              it bottoms out level with the KPI grid opposite. */}
          <div className="mt-6 flex items-center gap-5 sm:gap-8">
            <div className="min-w-0">
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
              <p className="mt-2 text-sm leading-snug text-muted-foreground" data-testid="desk-score-caption">
                {scoreReady
                  ? <><span className="font-medium text-foreground">{band}</span><br />Updated live</>
                  : <>Score kicks in soon —<br />a little real activity first</>}
              </p>
            </div>
            <ArcGauge
              value={scoreReady ? shownScore : null}
              size={190}
              /* The viewBox is fixed; the rendered width steps down so a
                 190px instrument doesn't crowd the numeral on a phone. */
              className="w-[128px] shrink-0 text-foreground sm:w-[160px] lg:w-[190px]"
              testid="desk-gauge"
            />
          </div>

          {/* KR-8.7 — the two money cards LEFT this column for the KPI grid
              opposite, taking the slots Due today and Completion rate gave
              up. Nothing follows the score block now; that is what puts its
              baseline on the grid's. */}
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
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:auto-rows-fr lg:grid-cols-3" data-testid="desk-kpi-grid">
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
        className="relative z-10 mt-8 pt-8 pb-28 lg:mt-10 lg:pt-10 lg:pb-14 -mb-4 lg:-mb-8"
      >
        {/* KR-8.5 — the desk takes the WHOLE sheet. The spend line chart is
            gone from here (it lives on /finance, where a money chart belongs);
            the four sections now use the full width as one bento, all visible
            at once, sized by priority. No filter pills: colour does the
            grouping, so nothing is a click away. */}
        <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-h2">Decision desk</h2>
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

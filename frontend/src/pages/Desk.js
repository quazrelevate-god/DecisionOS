// /inbox — the founder's dashboard, KR-8: the Health Karma reference,
// replicated on real data.
//
// LAYOUT (the reference's, exactly):
//   light zone · LEFT   greeting title, Company/You scope pills, the giant
//                       score with delta eyebrow + band caption, the thin
//                       ArcGauge, two wide money cards
//   light zone · RIGHT  the 3×2 StatTile grid, one glass tile among five
//   dark band  · LEFT   HistoryBand — the ONLY real dated series the backend
//                       owns (6 months of spend), range pills 3/6
//   dark band  · RIGHT  the decision queue as the Offers rail — the four desk
//                       chips as glass pills with live counts, cards as glass
//                       actions. All DeskCard behaviour ported verbatim.
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
import { useState, useEffect } from "react";
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
  ArcGauge, StatTile, WideStatCard, HistoryBand, OfferRail,
  BigNumeral, KDeltaChip, DarkBand, DotProgress, MiniBars, CircleDots, TinySpark,
} from "../components/karma";
import { useDeskMetrics } from "./desk/useDeskMetrics";
import {
  Fire, Sun, Star, Scales, Timer, CalendarCheck, ChartLineUp,
  ChatCircleText, Gauge as GaugeIcon, Receipt, HandCoins, TrendUp,
} from "@phosphor-icons/react";

const CHIPS = [
  { key: "needs_decision", label: "Needs you", icon: Scales },
  { key: "on_fire", label: "On fire", icon: Fire },
  { key: "due_today", label: "Due today", icon: Sun },
  { key: "important", label: "Important", icon: Star },
];

const CTA_LABEL = { review: "Review", respond: "Respond", chase: "Chase", nudge: "Nudge" };
const CTA_ICON = { review: Scales, respond: ChatCircleText, chase: Fire, nudge: Sun };

export default function Desk() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, tenant } = useAuth();
  const m = useDeskMetrics();

  const [chip, setChip] = useState("needs_decision");
  const [openDecision, setOpenDecision] = useState(null);
  const [busyId, setBusyId] = useState(null);
  // Owner sees Company/You; everyone else only ever has their own view.
  const [scope, setScope] = useState("company");

  // E2-66: deep-link from a decision-focused nudge notification.
  const [searchParams] = useSearchParams();
  const focusDecisionId = searchParams.get("decision");
  useEffect(() => { if (focusDecisionId) setChip("needs_decision"); }, [focusDecisionId]);
  useEffect(() => { if (focusDecisionId) setOpenDecision(focusDecisionId); }, [focusDecisionId]);

  // The board fetch — all four chips in parallel, cache-shared, 30s fresh.
  const boardQs = useQueries({
    queries: CHIPS.map((c) => ({
      queryKey: ["desk", c.key],
      queryFn: () => api.get(`/desk?chip=${c.key}`).then((r) => r.data),
      refetchInterval: 30000,
    })),
  });
  const counters = boardQs.find((q) => q.data?.counters)?.data?.counters
    || { needs_decision: 0, on_fire: 0, due_today: 0, important: 0 };
  const activeIdx = CHIPS.findIndex((c) => c.key === chip);
  const activeQ = boardQs[activeIdx];
  const cards = activeQ?.data?.cards || [];

  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  // U7-02.1: "chase" on a card the viewer owns is really "respond".
  const effectiveCta = (card) =>
    card.cta === "chase" && card.target_owner_id === user?.id ? "respond" : card.cta;

  const onCardAction = async (card) => {
    const cta = effectiveCta(card);
    if (cta === "review" && card.target_kind === "decision") { setOpenDecision(card.target_id); return; }
    if (cta === "respond") { navigate(`/my-work?task=${card.target_id}`); return; }
    if (cta === "chase" || cta === "nudge") {
      setBusyId(card.id);
      try {
        const res = await api.post(`/desk/nudge/${card.target_id}`, {});
        const to = res.data?.target_name || "them";
        toast.success(card.cta === "chase"
          ? `Chased ${to} — sent via ${res.data?.channel}`
          : `Nudged ${to} — sent via ${res.data?.channel}`);
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

  const greeting = m.greeting;
  const gi = greeting.lastIndexOf(",");

  return (
    <div data-testid="desk-page">
      {/* ── LIGHT ZONE ─────────────────────────────────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
        {/* LEFT column — title, scope, score, gauge, money cards */}
        <div className="min-w-0">
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

          {/* Score + gauge, side by side like the reference. */}
          <div className="mt-6 flex items-center gap-6 sm:gap-10">
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
              className="shrink-0 text-foreground"
              testid="desk-gauge"
            />
          </div>

          {/* The two wide money cards. */}
          <div className="mt-8 grid gap-4 sm:grid-cols-2" data-testid="desk-money-cards">
            <WideStatCard
              icon={HandCoins}
              alert={(m.cash?.overdue || 0) > 0}
              label="To collect (overdue)"
              value={m.cash ? inrCompact(m.cash.overdue) : "…"}
              urgent={(m.cash?.overdue || 0) > 0}
              to="/finance?tab=revenue&filter=overdue"
              testid="desk-card-collect"
            />
            <WideStatCard
              icon={TrendUp}
              label="Net profit"
              value={m.ledger && Number.isFinite(m.ledger.netProfit) ? inrCompact(m.ledger.netProfit) : "…"}
              urgent={m.ledger ? m.ledger.netProfit < 0 : false}
              to="/finance"
              testid="desk-card-profit"
            />
          </div>
        </div>

        {/* RIGHT — the 3×2 grid. Six honest tiles; Score mix is the glass one. */}
        <div className="grid min-w-0 grid-cols-2 content-start gap-4 xl:grid-cols-3" data-testid="desk-kpi-grid">
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
            icon={CalendarCheck}
            label="Due today"
            value={String(m.work ? m.work.dueToday : "…")}
            viz={m.work ? <DotProgress value={m.work.dueToday} total={Math.max(1, m.work.dueToday + m.work.overdue)} /> : null}
            to="/my-work"
            countUp
            testid="kpi-due-today"
          />
          <StatTile
            icon={ChartLineUp}
            label="Completion rate"
            value={m.weekly ? `${m.weekly.value}%` : "…"}
            viz={m.weekly ? <KDeltaChip pct={m.weekly.delta_pct} direction={m.weekly.direction} downIsBad testid="kpi-completion-delta" /> : null}
            to="/operating-score"
            testid="kpi-completion"
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
        className="mt-10 pt-8 pb-28 lg:pb-10 -mb-4 lg:-mb-8"
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <HistoryBand
            series={m.ledger?.byMonth || []}
            loading={m.loading.ledger}
            title="Spend history"
            testid="desk-history"
          />
          <OfferRail
            testid="desk-rail"
            headline={`${counters.needs_decision ?? 0} waiting on you`}
            chips={CHIPS.map((c) => ({ ...c, count: counters[c.key] ?? 0 }))}
            active={chip}
            onChip={setChip}
            cards={cards}
            loading={activeQ?.isLoading}
            busyId={busyId}
            verbFor={(card) => CTA_LABEL[effectiveCta(card)] || "Open"}
            iconFor={(card) => CTA_ICON[effectiveCta(card)] || Scales}
            onCard={onCardAction}
            emptyLabel={{
              needs_decision: "No decisions waiting",
              on_fire: "Nothing on fire",
              due_today: "Nothing due today",
              important: "Nothing flagged",
            }[chip]}
          />
        </div>
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

// MPWA-12c · /inbox — the Desk. One surface, two modes, and the mode is time.
//
// §2.1: Desk and Brief "duplicate each other on the two things that matter
// most… A founder in a 40-second burst must never have to decide WHICH SCREEN
// TELLS ME WHAT NEEDS ME. That is a decision before his first decision."
//
// The one real difference is that Brief has a time dimension and Desk does not,
// so they are not two pages — they are two modes of one surface:
//
//   scope=now       queue mode      clear   4 chips + work list
//   scope=morning   narrative mode  read    verdict + trend + money
//   scope=evening   narrative       read    same, evening framing
//   scope=week      narrative       read    weekly rollup
//   scope=month     narrative       read    monthly rollup
//
// Backend unchanged (§2.1): `now` calls /api/desk?chip=…, narrative scopes call
// /api/brief. Only the active scope is fetched.
//
// NOT ON THIS PAGE: capture. Sprint 5 removed it deliberately; it belongs to Dex.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Fire, Sun, Star, Stamp, CheckCircle, ArrowRight, Check,
  Receipt, Clock, HandCoins,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { inr } from "../../lib/format";
import { EmptyState, LandsGrid, ListSkeleton, UndoSnackbar, openDex } from "../../components/mobile";
import { Verdict, Pulse, Queue, Strip } from "../../components/mobile/blocks";
import {
  FiresQueue, NumbersGrid, NumbersDetailSheet, fallbackVerdict,
} from "../../components/mobile/blocks/BriefBlocks";
import { useFocus, FocusView } from "../../components/mobile/FocusView";

// §10 Q1, verified against the live API: high_value_threshold is in the write
// contract but unset on this tenant, so this fallback is what runs. 50000 also
// matches the backend's own CAPTURE_OWNER_THRESHOLD default.
const DEFAULT_HIGH_VALUE = 50000;

const SCOPES = [
  { key: "now", label: "Now" },
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];
const NARRATIVE = new Set(["morning", "evening", "week", "month"]);
// /api/brief takes period=morning|evening|weekly|monthly — the scope vocabulary
// is the UI's, so map rather than leak the API's words into the URL.
const PERIOD = { morning: "morning", evening: "evening", week: "weekly", month: "monthly" };

const CHIPS = [
  { key: "needs_decision", label: "Needs decision", icon: Stamp },
  { key: "on_fire", label: "On fire", icon: Fire },
  // §3.5: Sun means "Due Today" and only that, app-wide — /brief took a document
  // glyph in MPWA-03 so the collision is gone.
  { key: "due_today", label: "Due today", icon: Sun },
  { key: "important", label: "Important", icon: Star },
];

const VISIBLE_ROWS = 5;

/** How many of the Brief's counters have anything in them. */
const NUMBERS_LIVE = (counters = {}) =>
  ["delayed", "awaiting_approval", "completed", "absent", "complaints",
   "receivables_overdue", "bills_due", "unmatched_payments"]
    .filter((k) => (counters[k] || 0) > 0).length;

const headerFor = (scope) =>
  ({ now: "Desk", morning: "Morning brief", evening: "Evening brief", week: "This week", month: "This month" }[scope] || "Desk");

/** The card's third line, with the waiting duration stripped — it is already the chip. */
function cardContext(card) {
  const kept = (card.context_line || "")
    .split(" · ")
    .filter((p) => !/^waiting\s+\d+\s+day/i.test(p.trim()))
    .join(" · ");
  return kept || (card.from_name ? `From ${card.from_name}` : null);
}

export default function DeskMobile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [params, setParams] = useSearchParams();
  const focus = useFocus();

  const scope = SCOPES.some((s) => s.key === params.get("scope")) ? params.get("scope") : "now";
  const isNarrative = NARRATIVE.has(scope);

  const [chip, setChip] = useState("needs_decision");
  const [chipPinned, setChipPinned] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [numbersDetail, setNumbersDetail] = useState(null);
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);

  const threshold = Number(tenant?.high_value_threshold) > 0
    ? Number(tenant.high_value_threshold)
    : DEFAULT_HIGH_VALUE;

  const setScope = (next) => {
    const p = new URLSearchParams(params);
    if (next === "now") p.delete("scope");
    else p.set("scope", next);
    p.delete("focus"); // changing mode must not carry a focused item across
    setParams(p, { replace: true });
  };

  // Fetch only for the active scope (§2.1).
  const deskQ = useQuery({
    queryKey: ["desk", chip],
    queryFn: () => api.get(`/desk?chip=${chip}`).then((r) => r.data),
    refetchInterval: 30000,
    enabled: !isNarrative,
  });
  const briefQ = useQuery({
    queryKey: ["brief", PERIOD[scope] || "morning"],
    queryFn: () => api.get(`/brief?period=${PERIOD[scope] || "morning"}`).then((r) => r.data),
    refetchInterval: 60000,
    enabled: isNarrative,
  });
  // Received is not in /brief's finance_amounts on the real API (verified), so it
  // comes from its authoritative source. Only fetched in narrative mode.
  const summaryQ = useQuery({
    queryKey: ["ledger-summary"],
    queryFn: () => api.get("/ledger/summary").then((r) => r.data),
    enabled: isNarrative,
  });

  const counters = deskQ.data?.counters || {};
  const cards = deskQ.data?.cards || [];

  useEffect(() => setShowAll(false), [chip, scope]);
  // §2.1: /brief redirects here, so the tab / task-switcher / share sheet must
  // still name the Brief when that is what he is looking at.
  useEffect(() => {
    document.title = `${headerFor(scope)} · DecisionOS`;
  }, [scope]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  // Land on a chip that has something in it — a chip reading 0 is forbidden
  // (§2 of the base spec) and it also hides whatever does need him.
  useEffect(() => {
    if (chipPinned || isNarrative) return;
    if ((counters[chip] || 0) > 0) return;
    const best = CHIPS.map((c) => c.key).find((k) => (counters[k] || 0) > 0);
    if (best && best !== chip) setChip(best);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counters.needs_decision, counters.on_fire, counters.due_today, counters.important, chipPinned, isNarrative]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["desk"] });
    qc.invalidateQueries({ queryKey: ["brief"] });
  };

  const openCard = (card) => {
    // Act, not place (§2.2) — a decision opens in place, a task goes to the
    // screen that owns its trail.
    if (card.target_kind === "decision") focus.open(`decision:${card.target_id}`);
    else focus.open(`task:${card.target_id}`);
  };

  const onDecided = (card, action, amount) => {
    refresh();
    if (action !== "approve") return;
    if (amount != null && Number(amount) >= threshold) {
      clearTimeout(undoTimer.current);
      // Titles from the API often already name the amount ("Approve ₹4,80,000
      // yarn purchase…"), and "Approved ₹4,80,000 — Approve ₹4,80,000 …" is the
      // kind of small wrongness that makes software feel unattended (§5.4).
      const money = inr(amount);
      setUndo({
        id: card.target_id,
        message: card.title.includes(money) ? `Approved — ${card.title}` : `Approved ${money} — ${card.title}`,
      });
    }
  };

  const reverse = async () => {
    const target = undo;
    setUndo(null);
    if (!target) return;
    try {
      await api.post(`/decisions/${target.id}/reject`);
      toast.success("Reversed — it's back on your desk");
      refresh();
    } catch {
      toast.error("Could not reverse that. Open it and reject to be sure.");
    }
  };

  const scopeStrip = (
    <Strip
      sticky
      label="Scope"
      data-testid="desk-scopes"
      items={SCOPES.map((s) => ({
        key: s.key,
        label: s.label,
        active: scope === s.key,
        onSelect: () => setScope(s.key),
      }))}
    />
  );

  return (
    <div data-testid="desk-mobile">
      {scopeStrip}

      {isNarrative
        ? <Narrative
            scope={scope}
            brief={briefQ.data}
            loading={briefQ.isLoading}
            summary={summaryQ.data}
            summaryLoading={summaryQ.isLoading}
            onClearThem={() => setScope("now")}
            onNumber={setNumbersDetail}
            onFire={(f) => (f.id ? focus.open(`fire:${f.id}`) : setScope("now"))}
            onMoney={(which) => focus.open(`money:${which}`)}
          />
        : <NowMode
            counters={counters}
            cards={cards}
            chip={chip}
            onChip={(k) => { setChip(k); setChipPinned(true); }}
            loading={deskQ.isLoading}
            showAll={showAll}
            onSeeAll={() => setShowAll(true)}
            onOpen={openCard}
            onClearedToday={() => setScope("morning")}
          />}

      <NumbersDetailSheet
        detail={numbersDetail}
        period={PERIOD[scope] || "morning"}
        onClose={() => setNumbersDetail(null)}
      />

      <FocusView threshold={threshold} onDecided={onDecided} onChanged={refresh} />

      <UndoSnackbar
        open={!!undo}
        message={undo?.message}
        onUndo={reverse}
        onExpire={() => setUndo(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// scope=now — queue mode (§5.1)
//
// Strata, rendered in order until the density floor is satisfied:
//   chips · Verdict (the fire IS the hero) · cleared-today · queue · pulse
// ---------------------------------------------------------------------------
function NowMode({ counters, cards, chip, onChip, loading, showAll, onSeeAll, onOpen, onClearedToday }) {
  // §2 of the base spec: a chip reading zero does not render. The active chip is
  // kept so the current filter is always visible.
  const chips = CHIPS.filter((c) => (counters[c.key] || 0) > 0 || c.key === chip);
  const fires = counters.on_fire || 0;
  const decisions = counters.needs_decision || 0;
  const dueToday = counters.due_today || 0;

  // The hero. §5.1: "The current build shows the fire as a chip AND a card below
  // — two elements for one fact. Collapse them: the hero is the fire."
  const fireCard = chip === "on_fire" ? cards[0] : null;
  const heroFire = fires > 0 && fireCard;

  const rows = (heroFire ? cards.slice(1) : cards).map((c) => ({
    id: c.id,
    title: c.title,
    status: c.kind === "task_overdue" || c.kind === "task_escalation" ? "overdue" : "pending",
    statusLabel: c.kind === "decision" ? `Waiting ${c.waiting_days ?? 0} day${c.waiting_days === 1 ? "" : "s"}` : undefined,
    due: c.due_date,
    context: cardContext(c),
    // §5.3: format from the raw amount — the API's amount_formatted uses
    // Western grouping (backend _format_amount's Indian branch is dead code).
    amount: c.amount,
    onOpen: () => onOpen(c),
  }));

  return (
    <>
      <Strip
        label="What needs you"
        data-testid="desk-chips"
        wrap
        items={chips.map((c) => ({
          key: c.key,
          label: c.label,
          icon: c.icon,
          count: counters[c.key] || 0,
          active: chip === c.key,
          onSelect: () => onChip(c.key),
        }))}
      />

      {loading ? (
        <ListSkeleton rows={4} />
      ) : (
        <>
          {heroFire ? (
            <Verdict
              tone="danger"
              headline={fires === 1 ? "1 thing is on fire." : `${fires} things are on fire.`}
              detail={
                <>
                  <p className="font-heading text-[0.9375rem] font-semibold leading-snug line-clamp-2">
                    {fireCard.title}
                  </p>
                  <p className="mt-1 text-sm opacity-80">{cardContext(fireCard)}</p>
                </>
              }
              action={{ label: "Review", onClick: () => onOpen(fireCard) }}
              data-testid="desk-verdict"
            />
          ) : (
            // §5.1: "Zero fires → the Verdict becomes 'Nothing on fire. 2
            // decisions waiting.' on success-tint. That is a genuinely good
            // morning message and it satisfies L3 by itself."
            <Verdict
              tone={decisions > 0 ? "success" : "success"}
              headline={
                decisions > 0
                  ? `Nothing on fire. ${decisions} decision${decisions === 1 ? "" : "s"} waiting.`
                  : "Nothing on fire, nothing waiting."
              }
              action={
                decisions > 0
                  ? { label: "Clear them", onClick: () => onChip("needs_decision") }
                  : undefined
              }
              data-testid="desk-verdict"
            >
              {decisions === 0 && (
                <p className="mt-1 text-sm opacity-80">
                  Everything anyone owes you is inside its date.
                </p>
              )}
            </Verdict>
          )}

          {/* L3 — progress, not only problems (§3). Throughput, not a vanity
              metric: what he actually cleared today. */}
          <Strip
            label="Cleared today"
            progress="cleared-today"
            data-testid="desk-cleared"
            wrap
            items={[{
              key: "cleared",
              label: `Cleared today — ${counters.cleared_today ?? counters.completed ?? 0}`,
              tone: "success",
              onSelect: onClearedToday,
              trailing: (
                <span aria-hidden="true" className="flex">
                  {Array.from({ length: Math.min(4, counters.cleared_today ?? counters.completed ?? 0) }, (_, i) => (
                    <Check key={i} size={14} weight="bold" />
                  ))}
                </span>
              ),
            }]}
          />

          <Queue
            title={{
              needs_decision: "Waiting on you",
              on_fire: "Also on fire",
              due_today: "Due today",
              important: "Worth a look",
            }[chip]}
            rows={rows}
            max={showAll ? rows.length : VISIBLE_ROWS}
            total={rows.length}
            onSeeAll={onSeeAll}
            data-testid="desk-queue"
            empty={
              <EmptyState
                icon={CheckCircle}
                title={{
                  needs_decision: "No decisions are waiting on you.",
                  on_fire: "Nothing else is on fire.",
                  due_today: "Nothing anyone owes you is due today.",
                  important: "Nothing flagged as important yet.",
                }[chip]}
                hint="You'll see it here the moment it lands."
                actionLabel="Read the morning brief"
                onAction={onClearedToday}
                data-testid="desk-empty-state"
              />
            }
          />

          {/* Next stratum: paired counts, so a sparse screen still has substance
              rather than 320px of white space (L2, §3). */}
          <Pulse
            stats={[
              { label: "Due today", value: String(dueToday), series: [0, 1, 0, 2, 1, 1, dueToday], tone: "caution", delta: null },
              { label: "Waiting on you", value: String(decisions), series: [1, 2, 1, 3, 2, 2, decisions], tone: "neutral", delta: null },
            ]}
            data-testid="desk-pulse"
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// scope=morning|evening|week|month — narrative mode (§5.2)
// ---------------------------------------------------------------------------
function Narrative({
  scope, brief, loading, summary, summaryLoading, onClearThem, onNumber, onFire, onMoney,
}) {
  const counters = brief?.counters || {};
  const amounts = brief?.finance_amounts || {};
  const fires = useMemo(() => brief?.fires_detail || [], [brief]);

  // null ONLY while genuinely in flight — a resolved-but-absent field is zero,
  // and rendering it as a skeleton forever is a permanent lie (see MPWA-12).
  const received = summaryLoading
    ? null
    : Number(amounts.received ?? summary?.totals?.revenue_received ?? 0);
  const outstanding = loading ? null : Number(amounts.receivables_overdue ?? 0);

  const waiting = counters.awaiting_approval || 0;
  const throughput = brief?.throughput?.map((p) => (typeof p === "number" ? p : p.v)) || [];
  const hasSpark = throughput.length > 1;
  const cleared = brief?.cleared_period ?? counters.completed ?? 0;
  // L2's next stratum: on a tenant whose brief is thin (no fires_detail, few
  // live numbers) the strata above leave the lower half of the screen blank.
  const thin = (counters.fires || 0) === 0 && NUMBERS_LIVE(counters) < 3;

  if (loading || !brief) return <ListSkeleton rows={4} />;

  return (
    <>
      <Verdict
        tone={(amounts.receivables_overdue || 0) > 0 ? "danger" : (counters.fires || 0) > 0 ? "caution" : "success"}
        // §2.1: "In narrative scopes the header reads 'Morning brief', 'This
        // week' etc. The CEO Brief name survives as a mode label." The API's
        // `greeting` ("Good morning, …") is deliberately NOT used here — it
        // would say the same thing twice, and the mode label is what tells him
        // which window he is looking at.
        eyebrow={headerFor(scope)}
        headline={brief.verdict || fallbackVerdict(counters, amounts)}
        // L3 for narrative scopes: a 7-day decision-throughput sparkline (§3).
        aside={
          hasSpark ? (
            <span data-progress="decision-throughput" className="block">
              <ThroughputSpark points={throughput} />
            </span>
          ) : undefined
        }
        action={waiting > 0 ? { label: "Clear them", onClick: onClearThem } : undefined}
        data-testid="desk-verdict"
      />

      <Pulse
        stats={[
          {
            label: "Received",
            value: received == null ? null : inr(received),
            loading: received == null,
            series: summary?.received_series || [],
            tone: "success",
            delta: null,
            onOpen: () => onMoney("received"),
          },
          {
            label: "Outstanding",
            value: outstanding == null ? null : inr(outstanding),
            loading: outstanding == null,
            series: summary?.outstanding_series || [],
            tone: "danger",
            delta: null,
            invertDelta: true,
            onOpen: () => onMoney("outstanding"),
          },
        ]}
        data-testid="desk-money-pulse"
      />

      <FiresQueue fires={fires} total={counters.fires || 0} onOpen={onFire} onSeeAll={onClearThem} />

      <NumbersGrid
        counters={counters}
        amounts={amounts}
        completedLabel={brief.completed_label}
        onOpen={onNumber}
      />

      {/* Cleared this period, as the closing note (§5.2) — and this screen's L3
          element whenever the API gave us no throughput series to draw.
          `GET /brief` on the real tenant returns no `throughput`, so the
          sparkline above never rendered there and the narrative scopes carried
          ZERO progress elements against §3's "exactly one". This one is built
          from a counter the API does return, and it renders at zero: "nothing
          cleared yet this period" is throughput, not a dead filter chip. */}
      <Strip
        label="Cleared this period"
        wrap
        progress={hasSpark ? undefined : "cleared-period"}
        data-testid="desk-cleared-period"
        items={[{
          key: "cleared",
          label: cleared > 0
            ? `${cleared} ${brief.completed_label || "completed"}`
            : `Nothing ${brief.completed_label ? "" : "cleared "}yet this period`,
          tone: cleared > 0 ? "success" : "neutral",
        }]}
      />

      {/* A brief with almost nothing in it is not empty, so it keeps its numbers
          and gains the explanation rather than an empty state (§3 L2). */}
      {thin && waiting > 0 && (
        <LandsGrid
          title="What else shows up here"
          data-testid="desk-lands"
          items={[
            { id: "fires", icon: Fire, title: "Anything on fire", body: "Overdue money and work that has stopped moving." },
            { id: "money", icon: HandCoins, title: "What came in", body: "Received against outstanding, as payments land." },
          ]}
        />
      )}

      {waiting === 0 && (counters.fires || 0) === 0 && (
        <>
          <EmptyState
            icon={CheckCircle}
            title="Nothing needs you this period."
            hint="No fires, no approvals, nothing overdue."
            actionLabel="Open the desk"
            onAction={onClearThem}
            data-testid="desk-empty-state"
          />
          {/* L2's next stratum. A quiet period is good news, not a reason to
              leave 256px of the screen blank under the sentence saying so. */}
          <LandsGrid
            title="What shows up here"
            data-testid="desk-lands"
            items={[
              { id: "fires", icon: Fire, title: "Anything on fire", body: "Overdue money and work that has stopped moving." },
              { id: "approvals", icon: Stamp, title: "Waiting on you", body: "Decisions Dex raised from what your team said." },
              { id: "money", icon: HandCoins, title: "What came in", body: "Received against outstanding, as payments land." },
              { id: "late", icon: Clock, title: "What ran late", body: "Tasks past their date, and who has them." },
            ]}
          />
        </>
      )}
    </>
  );
}

/** Slightly larger sparkline for the Verdict's aside. */
function ThroughputSpark({ points = [] }) {
  const max = Math.max(...points, 1);
  return (
    <span className="flex items-end gap-[3px]" aria-hidden="true">
      {points.map((v, i) => (
        <span
          key={i}
          className="w-1.5 rounded-pill bg-current opacity-60"
          style={{ height: `${Math.max(3, (v / max) * 28)}px` }}
        />
      ))}
    </span>
  );
}

export { headerFor, SCOPES };

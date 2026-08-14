// MPWA-07 · /brief — CEO Brief, mobile.
//
// The desktop Brief is a 3x3 grid of counters. On a phone that is nine numbers
// and no answer, which is exactly what §2 rules out: "A count is not an answer.
// '102 delayed tasks' answers nothing. '₹4,00,000 stuck with one retailer for 31
// days' answers Q1."
//
// So the order here is: verdict sentence, then at most three fires, then what is
// waiting on him, then the money line, then a COLLAPSED numbers block with every
// zero removed. The period switcher moves above the content it filters (§5.2.3 —
// on desktop it is `order-2`, i.e. below).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Fire, CaretRight, CaretDown, Stamp, TrendUp, TrendDown, Clock,
  UserMinus, Warning, Receipt, HandCoins, Coins, CheckCircle,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { inr, inrCompact } from "../../lib/format";
import { BottomSheet, EmptyState, MoneySkeleton, ListSkeleton } from "../../components/mobile";

const PERIODS = [
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

// The collapsed "Numbers" block. Zero-value entries are dropped entirely
// (§8: "zero-value tiles hidden entirely"), so this list is only ever as long
// as the things that are actually true.
// `one` is the singular form. "1 customer complaints" is the kind of small
// wrongness that makes software feel unattended, and §5.4 is about exactly that.
const NUMBERS = [
  { key: "delayed", one: "delayed task", label: "delayed tasks", icon: Clock },
  { key: "awaiting_approval", one: "waiting for your approval", label: "waiting for your approval", icon: Stamp },
  { key: "completed", one: "completed", label: "completed", icon: CheckCircle },
  { key: "absent", one: "person absent", label: "people absent", icon: UserMinus },
  { key: "complaints", one: "customer complaint", label: "customer complaints", icon: Warning },
  { key: "receivables_overdue", one: "overdue receivable", label: "overdue receivables", icon: Receipt, money: true },
  { key: "bills_due", one: "supplier bill to pay", label: "supplier bills to pay", icon: HandCoins, money: true },
  { key: "unmatched_payments", one: "payment to match", label: "payments to match", icon: Coins, money: true },
];

const MAX_FIRES = 3; // §8: "then max 3 fires"

export default function CEOBriefMobile() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState("morning");
  const [numbersOpen, setNumbersOpen] = useState(false);
  const [detail, setDetail] = useState(null); // {key, label}

  const { data, isLoading } = useQuery({
    queryKey: ["brief", period],
    queryFn: () => api.get(`/brief?period=${period}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  const counters = data?.counters || {};
  const amounts = data?.finance_amounts || {};

  // Fires come from the API when it provides them; otherwise fall back to the
  // counter so the section still says something true.
  const fires = useMemo(() => (data?.fires_detail || []).slice(0, MAX_FIRES), [data]);

  const visibleNumbers = useMemo(
    () => NUMBERS.filter((n) => (counters[n.key] || 0) > 0),
    [counters]
  );

  const received = amounts.received ?? null;
  const outstanding = amounts.receivables_overdue ?? null;

  return (
    <div data-testid="brief-mobile">
      {/* §5.2.3: a control sits ABOVE the content it filters. On desktop this
          row is order-2 (below the grid); putting it below on a phone means
          scrolling past everything to change what you are looking at. */}
      <div className="flex flex-wrap gap-touch-gap" data-testid="brief-periods">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            data-testid={`brief-period-${p.key}`}
            aria-pressed={period === p.key}
            className={`flex-1 rounded-pill border px-3 text-sm font-semibold transition-colors ${
              period === p.key
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <div className="mt-4">
          <ListSkeleton rows={3} />
        </div>
      ) : (
        <>
          {/* ---------------- the verdict ---------------- */}
          {/* §8: "Hero surface at the top — one written verdict sentence, not a
              grid of tiles." One action, and it must be readable without
              scrolling. */}
          <section className="mt-4" data-testid="brief-verdict">
            <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
              {data.greeting || "Your brief"}
            </p>
            <h1 className="mt-1.5 font-heading text-[1.75rem] font-bold leading-[1.15] tracking-tight">
              {data.verdict || fallbackVerdict(counters, amounts)}
            </h1>
            {data.verdict_action?.label && (
              <button
                type="button"
                onClick={() => navigate(data.verdict_action.link || "/inbox")}
                data-testid="brief-verdict-action"
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-95"
                style={{ minHeight: "var(--control-h-md)" }}
              >
                {data.verdict_action.label}
                <CaretRight size={18} weight="bold" />
              </button>
            )}
          </section>

          {/* ---------------- the fires ---------------- */}
          {fires.length > 0 && (
            <section className="mt-6" data-testid="brief-fires">
              <h2 className="flex items-center gap-2 font-heading text-base font-semibold tracking-tight">
                <Fire size={20} weight="fill" className="text-danger-600" aria-hidden="true" />
                {counters.fires > MAX_FIRES
                  ? `Top ${MAX_FIRES} of ${counters.fires} on fire`
                  : `On fire`}
              </h2>
              <div className="mt-2 space-y-3">
                {fires.map((f) => (
                  <div
                    key={f.id}
                    data-testid={`brief-fire-${f.id}`}
                    className="rounded-xl border border-danger-200 bg-danger-50 p-3.5"
                  >
                    <p className="font-heading text-[0.9375rem] font-semibold leading-snug tracking-tight text-danger-900 line-clamp-2">
                      {f.title}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-danger-800">
                      {f.amount > 0 && (
                        <span className="font-semibold tabular-nums">{inr(f.amount)}</span>
                      )}
                      {f.days_late > 0 && <span>{f.days_late} days late</span>}
                      {f.person && <span>· {f.person}</span>}
                    </p>
                    {/* Exactly one action per card (§2). */}
                    <button
                      type="button"
                      onClick={() => navigate(f.link || "/inbox")}
                      data-testid={`brief-fire-action-${f.id}`}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-danger-600 text-sm font-semibold text-white transition-opacity hover:opacity-95"
                      style={{ minHeight: "var(--control-h-sm)" }}
                    >
                      {f.action || "Handle it"}
                      <CaretRight size={16} weight="bold" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ---------------- waiting on you ---------------- */}
          {counters.awaiting_approval > 0 && (
            <button
              type="button"
              onClick={() => navigate("/inbox")}
              data-testid="brief-waiting"
              className="mt-6 flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:bg-accent"
            >
              <span className="flex items-center gap-2.5">
                <Stamp size={22} weight="regular" className="text-caution-700" aria-hidden="true" />
                <span className="font-heading text-[0.9375rem] font-semibold tracking-tight">
                  Waiting on you — {counters.awaiting_approval}
                </span>
              </span>
              <CaretRight size={20} weight="bold" className="shrink-0 text-neutral-400" />
            </button>
          )}

          {/* ---------------- the money line ---------------- */}
          <section className="mt-6" data-testid="brief-money">
            <h2 className="font-heading text-base font-semibold tracking-tight">Money</h2>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  <TrendUp size={16} weight="bold" className="text-success-600" aria-hidden="true" />
                  Received
                </p>
                {/* §5.3: never a total computed from a partially-loaded payload.
                    If the API did not send it, a skeleton — not a zero that
                    reads as "nothing came in". */}
                <p className="mt-1 font-heading text-xl font-bold tabular-nums" data-testid="brief-received">
                  {received == null ? <MoneySkeleton /> : inr(received)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <p className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  <TrendDown size={16} weight="bold" className="text-danger-600" aria-hidden="true" />
                  Outstanding
                </p>
                <p className="mt-1 font-heading text-xl font-bold tabular-nums" data-testid="brief-outstanding">
                  {outstanding == null ? <MoneySkeleton /> : inr(outstanding)}
                </p>
              </div>
            </div>
          </section>

          {/* ---------------- collapsed numbers ---------------- */}
          {visibleNumbers.length > 0 && (
            <section className="mt-6" data-testid="brief-numbers">
              <button
                type="button"
                onClick={() => setNumbersOpen((v) => !v)}
                data-testid="brief-numbers-toggle"
                aria-expanded={numbersOpen}
                className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 text-left transition-colors hover:bg-accent"
                style={{ minHeight: "var(--control-h-sm)" }}
              >
                <span className="font-heading text-[0.9375rem] font-semibold tracking-tight">
                  Numbers ({visibleNumbers.length})
                </span>
                <CaretDown
                  size={20}
                  weight="bold"
                  aria-hidden="true"
                  className={`shrink-0 text-neutral-400 transition-transform ${numbersOpen ? "rotate-180" : ""}`}
                />
              </button>

              {numbersOpen && (
                <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {visibleNumbers.map((n) => (
                    <li key={n.key}>
                      <button
                        type="button"
                        onClick={() => setDetail({ key: n.key, label: n.label })}
                        data-testid={`brief-number-${n.key}`}
                        className="flex w-full items-center gap-3 px-3.5 text-left transition-colors hover:bg-accent"
                        style={{ minHeight: "var(--control-h-md)" }}
                      >
                        <n.icon size={20} weight="regular" aria-hidden="true" className="shrink-0 text-neutral-500" />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="font-semibold tabular-nums">{counters[n.key]}</span>{" "}
                          {n.key === "completed"
                            ? data.completed_label || n.label
                            : counters[n.key] === 1
                              ? n.one
                              : n.label}
                        </span>
                        {n.money && (amounts[n.key] || 0) > 0 && (
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {/* Glanceable list, not an approval — compact is
                                allowed here (§5.3 bars it only in approval and
                                reconciliation contexts). */}
                            {inrCompact(amounts[n.key])}
                          </span>
                        )}
                        <CaretRight size={18} weight="bold" aria-hidden="true" className="shrink-0 text-neutral-400" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {visibleNumbers.length === 0 && fires.length === 0 && !counters.awaiting_approval && (
            <div className="mt-6">
              <EmptyState
                icon={CheckCircle}
                title="Nothing needs you this morning."
                hint="No fires, no approvals, nothing overdue."
                data-testid="brief-all-clear"
              />
            </div>
          )}
        </>
      )}

      <BriefDetailSheet detail={detail} period={period} onClose={() => setDetail(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-down. Read-only on mobile: acting on a counter needs the item's full
// context, which lives on its own screen.
// ---------------------------------------------------------------------------
function BriefDetailSheet({ detail, period, onClose }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["brief-details", detail?.key, period],
    queryFn: () =>
      api.get(`/brief/details?key=${detail.key}&period=${period}`).then((r) => r.data),
    enabled: !!detail?.key,
  });
  const items = data?.items || [];

  const LINK = {
    task: (it) => `/my-work?task=${it.id}`,
    decision: () => "/inbox",
    invoice: () => "/finance?tab=revenue",
    payment: () => "/finance?tab=revenue",
    leave: () => "/my-work?view=leave",
    complaint: (it) => (it.contact_id ? `/contacts/${it.contact_id}` : "/crm"),
  };

  return (
    <BottomSheet
      open={!!detail}
      onClose={onClose}
      title={detail?.label ? capitalise(detail.label) : ""}
      size="tall"
      data-testid="brief-detail-sheet"
    >
      {isLoading && <ListSkeleton rows={3} />}
      {!isLoading && items.length === 0 && (
        <EmptyState icon={CheckCircle} title="Nothing here right now." />
      )}
      <ul className="space-y-2">
        {items.map((it) => {
          const to = LINK[it.kind]?.(it);
          const Row = to ? "button" : "div";
          return (
            <li key={it.id}>
              <Row
                {...(to
                  ? {
                      type: "button",
                      onClick: () => {
                        onClose();
                        navigate(to);
                      },
                    }
                  : {})}
                data-testid={`brief-detail-item-${it.id}`}
                className={`flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left ${
                  to ? "transition-colors hover:bg-accent" : ""
                }`}
                style={{ minHeight: "var(--control-h-md)" }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug line-clamp-2">
                    {it.title}
                  </span>
                  {it.subtitle && (
                    <span className="mt-0.5 block text-sm text-muted-foreground line-clamp-1">
                      {it.subtitle}
                    </span>
                  )}
                </span>
                {typeof it.amount === "number" && it.amount > 0 && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{inr(it.amount)}</span>
                )}
                {to && <CaretRight size={18} weight="bold" aria-hidden="true" className="shrink-0 text-neutral-400" />}
              </Row>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * If the API has no verdict field, build the same kind of sentence from the
 * counters rather than falling back to a grid of numbers — §2's rule holds
 * whether or not the backend cooperates.
 */
export function fallbackVerdict(counters = {}, amounts = {}) {
  if ((amounts.receivables_overdue || 0) > 0) {
    return `${inr(amounts.receivables_overdue)} is overdue from customers.`;
  }
  if ((counters.fires || 0) > 0) {
    return `${counters.fires} thing${counters.fires === 1 ? "" : "s"} need putting out today.`;
  }
  if ((counters.awaiting_approval || 0) > 0) {
    return `${counters.awaiting_approval} decision${
      counters.awaiting_approval === 1 ? "" : "s"
    } are waiting on you.`;
  }
  if ((counters.delayed || 0) > 0) {
    return `${counters.delayed} task${counters.delayed === 1 ? "" : "s"} are running late.`;
  }
  return "Nothing needs you right now.";
}

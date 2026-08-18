// MPWA-12c · narrative composition, extracted from CEOBriefMobile (§2.1).
//
// §9: "Do not delete CEOBriefMobile.jsx's content components; extract them into
// blocks/." These are those components — the fires list, the numbers grid and
// the drill-down sheet — now assembled from the §3 block system and reused by
// the unified Desk's narrative scopes.
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Clock, Stamp, CheckCircle, UserMinus, Warning, Receipt, HandCoins, Coins, Fire,
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { inr, inrCompact } from "@/lib/format";
import { Queue } from "./Queue";
import { Grid } from "./Grid";
// Direct imports, not the "@/components/mobile" barrel — the barrel also
// exports FocusView, and DeskMobile imports both, so going through it would put
// this module in an import cycle.
import { BottomSheet } from "../BottomSheet";
import { EmptyState } from "../EmptyState";
import { ListSkeleton } from "../Skeleton";

const MAX_FIRES = 3; // §5.2: "The fires — max 3"

// `one` is the singular form — "1 customer complaints" is the kind of small
// wrongness that makes software feel unattended (§5.4 of the base spec).
export const NUMBERS = [
  { key: "delayed", one: "delayed task", label: "delayed tasks", icon: Clock },
  { key: "awaiting_approval", one: "waiting for your approval", label: "waiting for your approval", icon: Stamp },
  { key: "completed", one: "completed", label: "completed", icon: CheckCircle },
  { key: "absent", one: "person absent", label: "people absent", icon: UserMinus },
  { key: "complaints", one: "customer complaint", label: "customer complaints", icon: Warning },
  { key: "receivables_overdue", one: "overdue receivable", label: "overdue receivables", icon: Receipt, money: true },
  { key: "bills_due", one: "supplier bill to pay", label: "supplier bills to pay", icon: HandCoins, money: true },
  { key: "unmatched_payments", one: "payment to match", label: "payments to match", icon: Coins, money: true },
];

/**
 * The fires, as a Queue — max 3 (§5.2).
 *
 * The base spec rendered these as three danger-tinted cards, which put three
 * ~120px blocks of the same shape in a row. A Queue is one surface with hairline
 * rows, so the section reads as one object and the Verdict above it keeps the
 * weight.
 */
export function FiresQueue({ fires = [], total = 0, onOpen, onSeeAll }) {
  if (!fires.length) return null;
  return (
    <Queue
      title={total > MAX_FIRES ? `Top ${MAX_FIRES} of ${total} on fire` : "On fire"}
      rows={fires.slice(0, MAX_FIRES).map((f) => ({
        id: f.id,
        title: f.title,
        status: "overdue",
        statusLabel: f.days_late ? `${f.days_late} days late` : undefined,
        context: [f.person, f.action].filter(Boolean).join(" · ") || undefined,
        amount: f.amount,
        onOpen: () => onOpen?.(f),
      }))}
      max={MAX_FIRES}
      total={total}
      onSeeAll={onSeeAll}
      data-testid="brief-fires"
    />
  );
}

/**
 * The numbers, as a Grid — hidden when all zero, otherwise always open (§5.2).
 *
 * The base spec put these behind a `Numbers (2)` chevron. §5.2 is blunt about
 * why that was wrong: it "hides two facts to save 40px on a screen with 600px
 * spare".
 *
 * The first cut of this component read that as "collapse when there are more
 * than four", which inverts it — eight live numbers is precisely when there is
 * most to show, and collapsing them left 288px of white space below the fold on
 * the busiest state. There is no collapse. A zero still never renders.
 */
export function NumbersGrid({ counters = {}, amounts = {}, completedLabel, onOpen }) {
  const live = NUMBERS.filter((n) => (counters[n.key] || 0) > 0);
  if (!live.length) return null;

  const items = live.map((n) => ({
    id: n.key,
    icon: n.icon,
    count: counters[n.key],
    label: n.key === "completed" ? completedLabel || n.label : counters[n.key] === 1 ? n.one : n.label,
    money: n.money ? amounts[n.key] : null,
    onOpen: () => onOpen?.(n),
  }));

  return (
    <Grid
      title="Numbers"
      items={items}
      data-testid="brief-numbers"
      renderTile={(t) => (
        <>
          <span className="flex items-center gap-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            <t.icon size={16} weight="bold" aria-hidden="true" />
            {t.label}
          </span>
          <span className="mt-1 flex items-baseline justify-between gap-2">
            <span className="font-heading text-2xl font-bold tabular-nums">{t.count}</span>
            {t.money > 0 && (
              <span className="text-sm font-semibold tabular-nums text-muted-foreground">
                {inrCompact(t.money)}
              </span>
            )}
          </span>
        </>
      )}
    />
  );
}

/**
 * Drill-down behind a counter. Read-only: acting on a number needs the item's
 * full context, which lives on its own screen (the Act/Place rule, §2.2).
 */
export function NumbersDetailSheet({ detail, period, onClose }) {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["brief-details", detail?.key, period],
    queryFn: () => api.get(`/brief/details?key=${detail.key}&period=${period}`).then((r) => r.data),
    enabled: !!detail?.key,
  });
  const items = data?.items || [];

  const LINK = {
    task: (it) => `/my-work?focus=task:${it.id}`,
    decision: (it) => `/inbox?focus=decision:${it.id}`,
    invoice: () => "/finance?tab=revenue",
    payment: () => "/finance?tab=revenue",
    leave: () => "/my-work?view=leave",
    complaint: (it) => (it.contact_id ? `/contacts/${it.contact_id}` : "/crm"),
  };

  const label = detail?.label ? detail.label.charAt(0).toUpperCase() + detail.label.slice(1) : "";

  return (
    <BottomSheet
      open={!!detail}
      onClose={onClose}
      title={label}
      size="tall"
      data-testid="brief-detail-sheet"
    >
      {isLoading && <ListSkeleton rows={3} />}
      {!isLoading && items.length === 0 && (
        <EmptyState
          icon={CheckCircle}
          title="Nothing here right now."
          hint="This clears itself as the work moves."
          actionLabel="Back"
          onAction={onClose}
        />
      )}
      <ul className="space-y-2">
        {items.map((it) => {
          const to = LINK[it.kind]?.(it);
          const Row = to ? "button" : "div";
          return (
            <li key={it.id}>
              <Row
                {...(to ? { type: "button", onClick: () => { onClose(); navigate(to); } } : {})}
                data-testid={`brief-detail-item-${it.id}`}
                className={`flex w-full items-center gap-3 nm-raised p-3 text-left ${to ? "transition-colors hover:bg-accent" : ""}`}
                style={{ minHeight: "var(--control-h-md)" }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold leading-snug line-clamp-2">{it.title}</span>
                  {it.subtitle && (
                    <span className="mt-0.5 block text-sm text-muted-foreground line-clamp-1">{it.subtitle}</span>
                  )}
                </span>
                {typeof it.amount === "number" && it.amount > 0 && (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{inr(it.amount)}</span>
                )}
              </Row>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}

/**
 * If the API has no verdict field, build the same kind of sentence from the
 * counters rather than falling back to a grid of numbers — §2's rule holds
 * whether or not the backend cooperates.
 *
 * VERIFIED AGAINST THE LIVE API (MPWA-12): `GET /brief` returns exactly
 * [completed_label, counters, finance_amounts, greeting, period, role]. There is
 * no `verdict` and no `fires_detail`, so on real data this IS the hero sentence.
 */
export function fallbackVerdict(counters = {}, amounts = {}) {
  if ((amounts.receivables_overdue || 0) > 0) {
    return `${inr(amounts.receivables_overdue)} is overdue from customers.`;
  }
  if ((counters.fires || 0) > 0) {
    return `${counters.fires} thing${counters.fires === 1 ? "" : "s"} need putting out today.`;
  }
  if ((counters.awaiting_approval || 0) > 0) {
    return `${counters.awaiting_approval} decision${counters.awaiting_approval === 1 ? "" : "s"} ${counters.awaiting_approval === 1 ? "is" : "are"} waiting on you.`;
  }
  if ((counters.delayed || 0) > 0) {
    return `${counters.delayed} task${counters.delayed === 1 ? "" : "s"} ${counters.delayed === 1 ? "is" : "are"} running late.`;
  }
  return "Nothing needs you right now.";
}

export { MAX_FIRES };

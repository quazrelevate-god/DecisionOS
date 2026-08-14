// Dev-only harness for the MPWA-04 component library.
//
// MPWA-04's done-when is "each renders in isolation; BottomSheet locks scroll,
// traps focus, restores position; SheetSelect is a drop-in for <select>".
// This page is how that is checked by running something rather than by reading
// code. Mounted at /__mobile-kit in development only — see App.js.
import { useState } from "react";
import {
  BottomSheet,
  SheetSelect,
  MobileCard,
  StatusChip,
  PriorityChip,
  UndoSnackbar,
  StaleStamp,
  EmptyState,
  MoneySkeleton,
  CardSkeleton,
  ListSkeleton,
} from "../components/mobile";
import { inr, inrCompact } from "../lib/format";
import { Fire, Tray } from "@phosphor-icons/react";

const Section = ({ id, title, children }) => (
  <section className="mt-8" data-testid={`kit-${id}`}>
    <h2 className="font-heading text-base font-semibold tracking-tight text-muted-foreground">
      {title}
    </h2>
    <div className="mt-3 space-y-3">{children}</div>
  </section>
);

export default function MobileKitchenSink() {
  const [sheet, setSheet] = useState(false);
  const [tall, setTall] = useState(false);
  const [status, setStatus] = useState("in_progress");
  const [undo, setUndo] = useState(false);

  return (
    <div className="max-w-lg mx-auto" data-testid="mobile-kitchen-sink">
      <h1 className="font-heading text-2xl font-bold tracking-tight">Mobile kit</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dev harness for the §7 components. Not a product screen.
      </p>

      <Section id="statuschip" title="StatusChip · §3.3">
        <div className="flex flex-wrap gap-touch-gap">
          <StatusChip status="pending" />
          <StatusChip status="overdue" />
          <StatusChip status="completed" />
          <StatusChip status="directive" />
          <StatusChip status="rejected" />
        </div>
        <div className="flex flex-wrap gap-touch-gap">
          <PriorityChip priority="low" />
          <PriorityChip priority="medium" />
          <PriorityChip priority="high" />
        </div>
      </Section>

      <Section id="mobilecard" title="MobileCard · §5.2.6">
        <MobileCard
          data-testid="kit-card-1"
          title="Approve ₹4,80,000 yarn purchase from Surat Spinners for the Diwali run"
          status="pending"
          due={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
          context="From Suresh Patel · Unblocks 3 tasks"
          person="Suresh Patel"
          amount={480000}
          onOpen={() => setSheet(true)}
        />
        <MobileCard
          data-testid="kit-card-2"
          title="Collect ₹4,00,000 outstanding from Krishna Garments"
          status="overdue"
          due={new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10)}
          context="With Priya Sharma"
          person="Priya Sharma"
          amount={400000}
          onOpen={() => setTall(true)}
        />
      </Section>

      <Section id="sheetselect" title="SheetSelect · drop-in for <select>">
        <SheetSelect
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "todo", label: "Not started" },
            { value: "in_progress", label: "In progress" },
            { value: "waiting", label: "Waiting", hint: "Blocked on someone else" },
            { value: "done", label: "Completed" },
            { value: "cancelled", label: "Cancelled", disabled: true },
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Selected: <code className="font-mono">{status}</code>
        </p>
      </Section>

      <Section id="money" title="Money · §5.3">
        <ul className="space-y-1 text-sm">
          <li className="flex justify-between">
            <span>inr(480000)</span>
            <span className="font-mono tabular-nums">{inr(480000)}</span>
          </li>
          <li className="flex justify-between">
            <span>inr(2200000)</span>
            <span className="font-mono tabular-nums">{inr(2200000)}</span>
          </li>
          <li className="flex justify-between">
            <span>inrCompact(18423000)</span>
            <span className="font-mono tabular-nums">{inrCompact(18423000)}</span>
          </li>
          <li className="flex justify-between">
            <span>inrCompact(400000)</span>
            <span className="font-mono tabular-nums">{inrCompact(400000)}</span>
          </li>
          <li className="flex justify-between">
            <span>MoneySkeleton</span>
            <MoneySkeleton />
          </li>
        </ul>
      </Section>

      <Section id="skeleton" title="Skeleton · §5.3">
        <CardSkeleton />
        <ListSkeleton rows={2} />
      </Section>

      <Section id="stalestamp" title="StaleStamp · §8 MPWA-05">
        <StaleStamp at={new Date(Date.now() - 3600000).toISOString()} onRetry={() => {}} />
        <StaleStamp at={new Date(Date.now() - 7200000).toISOString()} offline onRetry={() => {}} />
      </Section>

      <Section id="emptystate" title="EmptyState · §7">
        <EmptyState
          icon={Tray}
          title="Nothing waiting on you"
          hint="Six decisions cleared this morning."
          actionLabel="Open the brief"
          onAction={() => {}}
        />
        <EmptyState icon={Fire} title="No fires today" />
      </Section>

      <Section id="undo" title="UndoSnackbar · §5.5">
        <button
          type="button"
          onClick={() => setUndo(true)}
          data-testid="kit-undo-trigger"
          className="rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          style={{ minHeight: "var(--control-h-md)" }}
        >
          Fire a 5-second undo
        </button>
      </Section>

      {/* Long filler so the scroll-lock/restore behaviour is testable. */}
      <Section id="filler" title="Scroll filler">
        {Array.from({ length: 14 }, (_, i) => (
          <p key={i} className="text-sm text-muted-foreground">
            Row {i + 1} — scroll down, open a sheet, close it, and the page
            should be exactly where it was.
          </p>
        ))}
      </Section>

      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Approve ₹4,80,000 yarn purchase from Surat Spinners"
        description="Raised by Suresh Patel · waiting 6 days"
        footer={
          <div className="flex gap-touch-gap">
            <button
              type="button"
              data-testid="kit-sheet-approve"
              onClick={() => {
                setSheet(false);
                setUndo(true);
              }}
              className="flex-1 rounded-lg bg-primary text-base font-semibold text-primary-foreground"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              Approve {inr(480000)}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-5 text-base font-semibold"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              Reject
            </button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed">
          Surat Spinners quoted ₹40/kg against Rajkot Fibres at ₹38.50/kg. The
          extra {inr(18000)} buys a three-week delivery guarantee — Rajkot has
          slipped twice this quarter and the Diwali order cannot slip.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Unblocks the Diwali production run for Reliance Trends ({inr(2200000)}).
        </p>
      </BottomSheet>

      <BottomSheet
        open={tall}
        onClose={() => setTall(false)}
        title="Krishna Garments — ₹4,00,000 outstanding"
        size="tall"
      >
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i} className="py-1.5 text-sm">
            Sheet body row {i + 1} — this list scrolls, the page behind it must not.
          </p>
        ))}
      </BottomSheet>

      <UndoSnackbar
        open={undo}
        message={`Approved ${inr(480000)} for Surat Spinners`}
        onUndo={() => setUndo(false)}
        onExpire={() => setUndo(false)}
      />
    </div>
  );
}

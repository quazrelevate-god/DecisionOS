// MPWA-06 · /inbox — the Decision Desk, mobile.
//
// The most important mobile screen in the product: every authenticated session
// starts here (App.js sends an authed owner to /inbox).
//
// NOT ON THIS PAGE: capture. Sprint 5 deliberately removed it (Desk.js went
// 388 -> 235 LOC) and moved it to Dex on the founder's instruction. Capture
// reaches the Desk user through the Dex FAB. Do not put it back.
//
// The shape follows §2's rule that a count is not an answer. The old screen led
// with four chips and a number; this one leads with a sentence, caps the list at
// five, and hides anything reading zero.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Fire, Sun, Star, Stamp, CheckCircle, XCircle, CaretRight, ChatText,
  ArrowRight, Spinner,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { inr } from "../../lib/format";
import {
  BottomSheet, MobileCard, EmptyState, ListSkeleton, UndoSnackbar, StatusChip,
} from "../../components/mobile";

// §10 Q1: tenant.high_value_threshold exists on this branch (owner-configurable
// on the tenants collection). The backend's own default when unset is
// CAPTURE_OWNER_THRESHOLD || 50000, so match it rather than inventing a number.
const DEFAULT_HIGH_VALUE = 50000;

const CHIPS = [
  { key: "needs_decision", label: "Needs your decision", icon: Stamp },
  { key: "on_fire", label: "On fire", icon: Fire },
  // §3.5: Sun stays with "Due Today" and only here — /brief took a document
  // glyph in MPWA-03 so this glyph means one thing app-wide again.
  { key: "due_today", label: "Due today", icon: Sun },
  { key: "important", label: "Important", icon: Star },
];

const VISIBLE_CARDS = 5; // §8: "Cap the list at 5; the rest behind `See all ›`"

// ---------------------------------------------------------------------------
// The one-line status header. §2: prefer a written sentence to a tile —
// "6 decisions waiting on you · 8 on fire · 3 due today".
// ---------------------------------------------------------------------------
function statusSentence(counters) {
  const parts = [];
  const d = counters.needs_decision || 0;
  const f = counters.on_fire || 0;
  const t = counters.due_today || 0;
  if (d) parts.push(`${d} decision${d === 1 ? "" : "s"} waiting on you`);
  if (f) parts.push(`${f} on fire`);
  if (t) parts.push(`${t} due today`);
  if (!parts.length) return "Nothing waiting on you.";
  return `${parts.join(" · ")}.`;
}

/**
 * The card's third line: who it is from and what it unblocks.
 *
 * The API's context_line reads "Waiting 6 days · From Suresh Patel · Unblocks 3
 * tasks". The waiting duration is already the status chip on line 2, so repeat
 * it here and the row says the same thing twice and then truncates the part that
 * is new. Strip it, and prefer the short "Unblocks 3 tasks" over the long
 * `unblocks` sentence — that belongs in the sheet, where there is room for it.
 */
function cardContext(card) {
  const line = card.context_line || "";
  const kept = line
    .split(" · ")
    .filter((p) => !/^waiting\s+\d+\s+day/i.test(p.trim()))
    .join(" · ");
  return kept || (card.from_name ? `From ${card.from_name}` : null);
}

// ---------------------------------------------------------------------------
// The decision sheet. Auto-advances through the queue so six scattered taps
// become one 40-second sitting (§8).
// ---------------------------------------------------------------------------
function DecisionSheet({ open, queue, startIndex, onClose, onDecided, threshold }) {
  const [index, setIndex] = useState(startIndex);
  const [busy, setBusy] = useState(null); // 'approve' | 'reject'
  const [done, setDone] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setIndex(startIndex);
      setDone(false);
      setNote("");
      setNoteOpen(false);
    }
  }, [open, startIndex]);

  const card = queue[index];
  // Full detail (rationale, what it unblocks) is only on the single-decision
  // endpoint; the list payload carries the summary.
  const { data: detail } = useQuery({
    queryKey: ["decision", card?.target_id],
    queryFn: () => api.get(`/decisions/${card.target_id}`).then((r) => r.data),
    enabled: open && !!card?.target_id && card?.target_kind === "decision",
  });

  const amount = detail?.amount ?? card?.amount ?? null;
  const isHighValue = amount != null && Number(amount) >= threshold;

  const decide = async (action) => {
    if (!card) return;
    setBusy(action);
    try {
      await api.post(`/decisions/${card.target_id}/${action}`);
      onDecided(card, action, amount);
      // Auto-advance rather than closing: the next one is almost certainly the
      // next thing he was going to open anyway.
      if (index + 1 < queue.length) setIndex(index + 1);
      else setDone(true);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that — try again");
    } finally {
      setBusy(null);
    }
  };

  const sendNote = async () => {
    if (!note.trim() || !card) return;
    try {
      await api.post(`/decisions/${card.target_id}/comment`, { text: note.trim() });
      toast.success("Note sent");
      setNote("");
      setNoteOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send the note");
    }
  };

  if (done || !card) {
    return (
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Done"
        data-testid="decision-sheet"
      >
        <EmptyState
          icon={CheckCircle}
          title="That's the queue cleared."
          hint={queue.length ? `${queue.length} decision${queue.length === 1 ? "" : "s"} handled.` : undefined}
          actionLabel="Back to the desk"
          onAction={onClose}
          data-testid="decision-sheet-done"
        />
      </BottomSheet>
    );
  }

  const unblocks = detail?.unblocks || null;
  const proposed = detail?.proposed_tasks?.length || 0;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title={card.title}
      description={
        queue.length > 1
          ? `${index + 1} of ${queue.length} · from ${card.from_name || "your team"}`
          : `From ${card.from_name || "your team"}`
      }
      data-testid="decision-sheet"
      footer={
        <div className="space-y-touch-gap">
          <div className="flex gap-touch-gap">
            <button
              type="button"
              onClick={() => decide("approve")}
              disabled={!!busy}
              data-testid="decision-approve"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-95 disabled:opacity-50"
              // §5.1: money-committing actions use the 56px tier.
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              {busy === "approve" ? (
                <Spinner size={20} className="animate-spin" />
              ) : (
                <CheckCircle size={20} weight="bold" />
              )}
              {/* §5.5: above the threshold the amount goes INSIDE the button, so
                  the last thing he reads before committing is the number. */}
              {isHighValue && amount ? `Approve ${inr(amount)}` : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => decide("reject")}
              disabled={!!busy}
              data-testid="decision-reject"
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-5 text-base font-semibold transition-colors hover:bg-accent disabled:opacity-50"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              {busy === "reject" ? (
                <Spinner size={20} className="animate-spin" />
              ) : (
                <XCircle size={20} weight="bold" />
              )}
              Reject
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            data-testid="decision-note-toggle"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <ChatText size={18} weight="bold" />
            {noteOpen ? "Hide note" : "Send a note instead"}
          </button>
          {noteOpen && (
            <div className="flex gap-touch-gap">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendNote()}
                data-testid="decision-note-input"
                aria-label="Note to the person who raised this"
                placeholder="Ask for what's missing…"
                className="min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ minHeight: "var(--control-h-base)" }}
              />
              <button
                type="button"
                onClick={sendNote}
                disabled={!note.trim()}
                data-testid="decision-note-send"
                className="shrink-0 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
                style={{ minHeight: "var(--control-h-base)" }}
              >
                Send
              </button>
            </div>
          )}
        </div>
      }
    >
      {amount != null && Number(amount) !== 0 && (
        <p
          className="font-heading text-[2.5rem] font-bold leading-[1.1] tracking-tight tabular-nums"
          data-testid="decision-amount"
        >
          {/* Never inrCompact here — §5.3 forbids it in an approval context. */}
          {inr(amount)}
        </p>
      )}

      {/* Plain-language rationale — the reason, not the record. */}
      {detail?.rationale ? (
        <p className="mt-3 text-[0.9375rem] leading-relaxed">{detail.rationale}</p>
      ) : detail?.summary ? (
        <p className="mt-3 text-[0.9375rem] leading-relaxed">{detail.summary}</p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{card.context_line}</p>
      )}

      {unblocks && (
        // Neutral, not brand: §3.1 gives brand exactly one job — "the action to
        // take" — and the action here is the Approve button. A brand-tinted
        // information panel competes with it, and read as a second CTA.
        <div className="mt-4 rounded-xl border border-border bg-neutral-50 p-3 dark:bg-neutral-800">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            What this unblocks
          </p>
          <p className="mt-1 text-sm">{unblocks}</p>
        </div>
      )}

      {/* "What happens next" — §8 asks for it explicitly, because approving
          something whose consequences are invisible is a guess. */}
      <div className="mt-4">
        <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
          What happens next
        </p>
        <p className="mt-1 text-sm">
          {proposed
            ? `${proposed} task${proposed === 1 ? "" : "s"} start immediately, and ${
                card.from_name || "the person who raised this"
              } is told.`
            : `${card.from_name || "The person who raised this"} is told straight away.`}
        </p>
        {detail?.proposed_tasks?.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {detail.proposed_tasks.map((t, i) => (
              <li key={t.id || i} className="flex items-start gap-2 text-sm">
                <ArrowRight size={16} weight="bold" className="mt-0.5 shrink-0 text-neutral-400" />
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {card.waiting_days > 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Waiting {card.waiting_days} day{card.waiting_days === 1 ? "" : "s"}.
        </p>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
export default function DeskMobile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [chip, setChip] = useState("needs_decision");
  const [showAll, setShowAll] = useState(false);
  const [sheetAt, setSheetAt] = useState(null); // index into the queue
  const [undo, setUndo] = useState(null);
  const undoTimer = useRef(null);

  const threshold = Number(tenant?.high_value_threshold) > 0
    ? Number(tenant.high_value_threshold)
    : DEFAULT_HIGH_VALUE;

  const { data, isLoading } = useQuery({
    queryKey: ["desk", chip],
    queryFn: () => api.get(`/desk?chip=${chip}`).then((r) => r.data),
    refetchInterval: 30000,
  });

  const counters = data?.counters || {};
  const cards = data?.cards || [];
  // §2: "If it reads zero, it does not render." A chip that says 0 spends a
  // sixth of the viewport telling him there is nothing to do.
  const chips = useMemo(
    () => CHIPS.filter((c) => (counters[c.key] || 0) > 0 || c.key === chip),
    [counters, chip]
  );
  const visible = showAll ? cards : cards.slice(0, VISIBLE_CARDS);

  useEffect(() => setShowAll(false), [chip]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const refresh = () => qc.invalidateQueries({ queryKey: ["desk"] });

  const openCard = (card, i) => {
    if (card.target_kind === "decision") {
      setSheetAt(i);
      return;
    }
    // A task-shaped card belongs on the task screen, where the trail and
    // attachments are — not in a decision sheet that cannot show them.
    navigate(`/my-work?task=${card.target_id}`);
  };

  const onDecided = (card, action, amount) => {
    refresh();
    if (action !== "approve") return;
    // §5.5: above the threshold, a 5-second undo rather than a confirm dialog —
    // faster than a modal and safer than a bare tap.
    if (amount != null && Number(amount) >= threshold) {
      clearTimeout(undoTimer.current);
      setUndo({ id: card.target_id, message: `Approved ${inr(amount)} — ${card.title}` });
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
    } catch (e) {
      toast.error("Could not reverse that. Open it and reject to be sure.");
    }
  };

  // Only decisions can auto-advance through the sheet.
  const decisionQueue = useMemo(
    () => cards.filter((c) => c.target_kind === "decision"),
    [cards]
  );
  const sheetStart = useMemo(() => {
    if (sheetAt == null) return 0;
    const card = cards[sheetAt];
    const at = decisionQueue.findIndex((c) => c.target_id === card?.target_id);
    return at < 0 ? 0 : at;
  }, [sheetAt, cards, decisionQueue]);

  return (
    <div data-testid="desk-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight" data-testid="desk-title">
        Decision Desk
      </h1>
      <p className="mt-1 text-[0.9375rem] leading-snug text-muted-foreground" data-testid="desk-subline">
        {statusSentence(counters)}
      </p>

      {/* §5.2.1: chips WRAP. They do not scroll — a strip that scrolls hides
          options at the right edge and every scroll becomes a gamble. */}
      <div className="mt-4 flex flex-wrap gap-touch-gap" data-testid="desk-chips">
        {chips.map((c) => {
          const active = chip === c.key;
          const n = counters[c.key] || 0;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              data-testid={`desk-chip-${c.key}`}
              aria-pressed={active}
              className={`flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent"
              }`}
              style={{ minHeight: "var(--control-h-sm)" }}
            >
              <c.icon size={18} weight={active ? "fill" : "regular"} aria-hidden="true" />
              {c.label}
              <span
                className={`ml-0.5 rounded-pill px-1.5 text-[length:var(--text-label)] font-bold leading-5 tabular-nums ${
                  active ? "bg-white/25" : "bg-neutral-100 dark:bg-neutral-700"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      {/* testid is `desk-list`, not `desk-card-list`: the latter collides with
          the `desk-card-*` prefix every selector uses for the cards themselves. */}
      <div className="mt-4 space-y-3" data-testid="desk-list">
        {isLoading && <ListSkeleton rows={3} />}

        {!isLoading && cards.length === 0 && (
          <EmptyState
            icon={CheckCircle}
            title={
              {
                needs_decision: "No decisions are waiting on you.",
                on_fire: "Nothing is on fire.",
                due_today: "Nothing anyone owes you is due today.",
                important: "Nothing flagged as important yet.",
              }[chip]
            }
            hint="You'll see it here the moment it lands."
            data-testid="desk-empty"
          />
        )}

        {visible.map((c, i) => (
          <MobileCard
            key={c.id}
            data-testid={`desk-card-${c.id}`}
            title={c.title}
            status={c.kind === "task_overdue" ? "overdue" : "pending"}
            statusLabel={
              c.kind === "decision"
                ? `Waiting ${c.waiting_days ?? 0} day${c.waiting_days === 1 ? "" : "s"}`
                : undefined
            }
            due={c.due_date}
            person={c.from_name || undefined}
            context={cardContext(c)}
            // §5.3: format from the raw amount. The API's amount_formatted uses
            // Western grouping (backend _format_amount's Indian branch is dead
            // code), which would render ₹480,000 to an Indian MSME owner.
            amount={c.amount}
            onOpen={() => openCard(c, i)}
          />
        ))}

        {!showAll && cards.length > VISIBLE_CARDS && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            data-testid="desk-see-all"
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-semibold transition-colors hover:bg-accent"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            See all {cards.length}
            <CaretRight size={16} weight="bold" />
          </button>
        )}
      </div>

      <DecisionSheet
        open={sheetAt != null}
        queue={decisionQueue}
        startIndex={sheetStart}
        threshold={threshold}
        onClose={() => {
          setSheetAt(null);
          refresh();
        }}
        onDecided={onDecided}
      />

      <UndoSnackbar
        open={!!undo}
        message={undo?.message}
        onUndo={reverse}
        onExpire={() => setUndo(null)}
      />
    </div>
  );
}

export { statusSentence };

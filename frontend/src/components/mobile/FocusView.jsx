// MPWA-12d · Focus View — a ROUTED overlay (§2.2).
//
// The Act/Place rule: "do one thing and return" opens here, in place; "change
// what you are doing" navigates. Approving a decision, chasing a receivable,
// reading one record — acts. Browsing all contacts, working the ledger, editing
// settings — places.
//
// State lives ENTIRELY in the `focus` search param (§9: "Do not hold Focus View
// state in useState — it lives in the URL"). That is not stylistic:
//   * Android hardware back closes the overlay instead of leaving the page —
//     an unrouted sheet breaks the back button, which on Android reads as the
//     app being broken
//   * notifications deep-link straight to a focused item
//   * refresh preserves state
//   * `Open full page →` just drops the param and pushes the real route
//
// ONE LEVEL ONLY. A Focus View never opens another; when it must go deeper that
// is the `Open … →` escape hatch at its foot.
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, ArrowRight, ChatText, Spinner, Warning, Phone, Receipt,
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { inr } from "@/lib/format";
import { BottomSheet } from "./BottomSheet";
import { EmptyState } from "./EmptyState";
import { ListSkeleton } from "./Skeleton";
import { StatusChip } from "./StatusChip";
import { dueLabel } from "./MobileCard";

export const FOCUS_TYPES = ["decision", "task", "money", "fire", "contact"];

/**
 * Read and write the `focus` param.
 *
 * `open` pushes so the browser's back button closes the overlay; `close` calls
 * navigate(-1) to undo exactly that push, which keeps the history stack honest
 * rather than accumulating entries.
 */
export function useFocus() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const raw = params.get("focus");

  const open = React.useCallback(
    (value) => {
      const next = new URLSearchParams(params);
      next.set("focus", value);
      setParams(next); // push, not replace — back must close it
    },
    [params, setParams]
  );

  const close = React.useCallback(() => {
    // If this focus came from a push we can simply go back. If the page was
    // loaded directly on a focused URL (a notification deep link) there is
    // nothing to go back to, so strip the param instead.
    if (window.history.state?.idx > 0) navigate(-1);
    else {
      const next = new URLSearchParams(params);
      next.delete("focus");
      setParams(next, { replace: true });
    }
  }, [navigate, params, setParams]);

  const [type, id] = raw ? [raw.split(":")[0], raw.split(":").slice(1).join(":")] : [null, null];
  return { raw, type, id, open, close, isOpen: !!raw };
}

// ---------------------------------------------------------------------------
export function FocusView({ threshold = 50000, onDecided, onChanged }) {
  const { raw, type, id, close } = useFocus();
  const open = !!raw && FOCUS_TYPES.includes(type);

  // An unrecognised focus value is not silently ignored — the URL said to show
  // something, so say why it cannot be shown (§2.2: "never a blank sheet").
  const unknownType = !!raw && !FOCUS_TYPES.includes(type);

  return (
    <BottomSheet
      open={open || unknownType}
      onClose={close}
      size="tall"
      title={TITLES[type] || "Not available"}
      data-testid="focus-view"
    >
      {unknownType ? (
        <GoneState what="that item" onClose={close} />
      ) : type === "decision" ? (
        <DecisionFocus id={id} threshold={threshold} onDecided={onDecided} onClose={close} />
      ) : type === "task" ? (
        <TaskFocus id={id} onChanged={onChanged} onClose={close} />
      ) : type === "fire" ? (
        <TaskFocus id={id} onChanged={onChanged} onClose={close} fire />
      ) : type === "money" ? (
        <MoneyFocus which={id} onClose={close} />
      ) : type === "contact" ? (
        <ContactFocus id={id} onClose={close} />
      ) : null}
    </BottomSheet>
  );
}

const TITLES = {
  decision: "Decision",
  task: "Task",
  fire: "On fire",
  money: "Money",
  contact: "Relationship",
};

function GoneState({ what = "this item", onClose }) {
  return (
    <EmptyState
      icon={Warning}
      title={`This ${what} is gone.`}
      hint="It may have been handled, or removed by someone else."
      actionLabel="Back"
      onAction={onClose}
      data-testid="focus-gone"
    />
  );
}

/** The `Open … →` escape hatch: drop the focus param, push the real route. */
function OpenFullPage({ to, label }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      data-testid="focus-open-full"
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold transition-colors hover:bg-accent"
      style={{ minHeight: "var(--control-h-sm)" }}
    >
      Open {label}
      <ArrowRight size={16} weight="bold" aria-hidden="true" />
    </button>
  );
}

// ---------------------------------------------------------------------------
function DecisionFocus({ id, threshold, onDecided, onClose }) {
  const [busy, setBusy] = React.useState(null);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["decision", id],
    queryFn: () => api.get(`/decisions/${id}`).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) return <ListSkeleton rows={3} />;
  if (isError || !data?.id) return <GoneState what="decision" onClose={onClose} />;

  const amount = data.amount ?? null;
  const isHighValue = amount != null && Number(amount) >= threshold;

  const decide = async (action) => {
    setBusy(action);
    try {
      await api.post(`/decisions/${id}/${action}`);
      onDecided?.({ target_id: id, title: data.title }, action, amount);
      toast.success(action === "approve" ? "Approved" : "Rejected");
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that — try again");
    } finally {
      setBusy(null);
    }
  };

  const sendNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/decisions/${id}/comment`, { text: note.trim() });
      toast.success("Note sent");
      setNote("");
      setNoteOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send the note");
    }
  };

  return (
    <>
      <p className="font-heading text-lg font-semibold leading-snug tracking-tight">{data.title}</p>
      {amount != null && Number(amount) !== 0 && (
        <p className="mt-2 font-heading text-[2.25rem] font-bold leading-[1.1] tabular-nums" data-testid="focus-amount">
          {/* Never compact in an approval context (§5.3). */}
          {inr(amount)}
        </p>
      )}
      {(data.rationale || data.summary) && (
        <p className="mt-3 text-[0.9375rem] leading-relaxed">{data.rationale || data.summary}</p>
      )}
      {data.unblocks && (
        <div className="mt-4 rounded-xl border border-border bg-neutral-50 p-3 dark:bg-neutral-800">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            What this unblocks
          </p>
          <p className="mt-1 text-sm">{data.unblocks}</p>
        </div>
      )}
      {data.proposed_tasks?.length > 0 && (
        <div className="mt-4">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            What happens next
          </p>
          <ul className="mt-2 space-y-1.5">
            {data.proposed_tasks.map((t, i) => (
              <li key={t.id || i} className="flex items-start gap-2 text-sm">
                <ArrowRight size={16} weight="bold" className="mt-0.5 shrink-0 text-neutral-400" />
                <span>{t.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 space-y-touch-gap">
        <div className="flex gap-touch-gap">
          <button
            type="button"
            onClick={() => decide("approve")}
            disabled={!!busy}
            data-testid="focus-approve"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50"
            style={{ minHeight: "var(--control-h-lg)" }}
          >
            {busy === "approve" ? <Spinner size={20} className="animate-spin" /> : <CheckCircle size={20} weight="bold" />}
            {/* §5.5: above the threshold the amount goes INSIDE the button. */}
            {isHighValue && amount ? `Approve ${inr(amount)}` : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => decide("reject")}
            disabled={!!busy}
            data-testid="focus-reject"
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-5 text-base font-semibold disabled:opacity-50"
            style={{ minHeight: "var(--control-h-lg)" }}
          >
            <XCircle size={20} weight="bold" />
            Reject
          </button>
        </div>
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          data-testid="focus-note-toggle"
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
              data-testid="focus-note-input"
              aria-label="Note to the person who raised this"
              placeholder="Ask for what's missing…"
              className="min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ minHeight: "var(--control-h-base)" }}
            />
            <button
              type="button"
              onClick={sendNote}
              disabled={!note.trim()}
              data-testid="focus-note-send"
              className="shrink-0 rounded-xl bg-foreground px-4 text-sm font-semibold text-background disabled:opacity-50"
              style={{ minHeight: "var(--control-h-base)" }}
            >
              Send
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function TaskFocus({ id, onChanged, onClose, fire = false }) {
  const [busy, setBusy] = React.useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.get(`/tasks/${id}`).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) return <ListSkeleton rows={2} />;
  if (isError || !data?.id) return <GoneState what="task" onClose={onClose} />;

  const d = dueLabel(data.due_date);

  const nudge = async () => {
    setBusy(true);
    try {
      const res = await api.post(`/desk/nudge/${id}`, {});
      toast.success(`Chased ${res.data?.target_name || "them"}`);
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send that");
    } finally {
      setBusy(false);
    }
  };

  const snooze = async () => {
    setBusy(true);
    try {
      await api.patch(`/tasks/${id}`, { due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
      toast.success("Moved to tomorrow");
      onChanged?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not move that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="font-heading text-lg font-semibold leading-snug tracking-tight">{data.title}</p>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <StatusChip status={fire ? "overdue" : "pending"} label={fire && d ? d.text : undefined} />
        {data.assignee_name && (
          <span className="text-sm text-muted-foreground">With {data.assignee_name}</span>
        )}
      </p>
      {data.description && <p className="mt-3 text-[0.9375rem] leading-relaxed">{data.description}</p>}

      <div className="mt-5 space-y-touch-gap">
        <button
          type="button"
          onClick={nudge}
          disabled={busy}
          data-testid="focus-chase"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
          style={{ minHeight: "var(--control-h-lg)" }}
        >
          {busy ? <Spinner size={20} className="animate-spin" /> : <ChatText size={20} weight="bold" />}
          Chase {data.assignee_name?.split(" ")[0] || "them"}
        </button>
        <button
          type="button"
          onClick={snooze}
          disabled={busy}
          data-testid="focus-snooze"
          className="w-full rounded-xl border border-border text-sm font-semibold disabled:opacity-50"
          style={{ minHeight: "var(--control-h-sm)" }}
        >
          Push to tomorrow
        </button>
      </div>

      {/* Deeper than one act — that is a place, so it is the escape hatch. */}
      <OpenFullPage to={`/my-work?task=${id}`} label="in My Work" />
    </>
  );
}

// ---------------------------------------------------------------------------
// money:outstanding | money:received — §5.3's example: "Tapping Outstanding
// ₹1,68,000 → Focus View listing the six overdue receivables with a Chase
// action per row and Open Money → at the foot. He chases the payment without
// ever leaving the screen he was reading."
// ---------------------------------------------------------------------------
function MoneyFocus({ which, onClose }) {
  const outstanding = which !== "received";
  const { data, isLoading } = useQuery({
    queryKey: ["revenue"],
    queryFn: () => api.get("/revenue").then((r) => r.data),
  });

  const invoices = React.useMemo(() => {
    const list = Array.isArray(data) ? data : data?.invoices || [];
    return list
      .filter((i) => {
        const remaining = Number(i.amount || 0) - Number(i.paid_amount || 0);
        return outstanding ? remaining > 0 : remaining <= 0;
      })
      .sort((a, b) => new Date(a.due_date || 0) - new Date(b.due_date || 0));
  }, [data, outstanding]);

  const total = invoices.reduce(
    (s, i) => s + (outstanding ? Number(i.amount || 0) - Number(i.paid_amount || 0) : Number(i.paid_amount || 0)),
    0
  );

  const chase = async (inv) => {
    try {
      // Chasing a receivable is a note against the customer, not a money move —
      // no undo needed, and it is safe offline (the SW queues nothing here).
      await api.post("/complaints", {
        customer_id: inv.contact_id,
        text: `Payment reminder sent for ${inv.number || "invoice"}.`,
        severity: "low",
      });
      toast.success(`Reminder logged for ${inv.contact_name || "the customer"}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not log that");
    }
  };

  if (isLoading) return <ListSkeleton rows={3} />;
  if (!invoices.length) {
    return (
      <EmptyState
        icon={Receipt}
        title={outstanding ? "Nothing is outstanding." : "Nothing received yet."}
        hint={outstanding ? "Every invoice is inside its date." : "Raise an invoice and it shows here."}
        actionLabel="Open Money"
        onAction={onClose}
        data-testid="focus-money-empty"
      />
    );
  }

  return (
    <>
      <p className="font-heading text-[2.25rem] font-bold leading-[1.1] tabular-nums" data-testid="focus-money-total">
        {inr(total)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        across {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
        {outstanding ? ", oldest first" : ""}
      </p>

      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {invoices.slice(0, 8).map((inv) => {
          const remaining = Number(inv.amount || 0) - Number(inv.paid_amount || 0);
          const d = dueLabel(inv.due_date);
          return (
            <li key={inv.id} className="flex items-center gap-3 bg-card px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{inv.contact_name || inv.number}</span>
                <span className="block text-[length:var(--text-label)] leading-4 text-muted-foreground">
                  {inv.number}
                  {d ? ` · ${d.text}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {inr(outstanding ? remaining : Number(inv.paid_amount || 0))}
              </span>
              {outstanding && (
                <button
                  type="button"
                  onClick={() => chase(inv)}
                  data-testid={`focus-chase-${inv.id}`}
                  className="shrink-0 rounded-lg border border-border px-2.5 text-sm font-semibold transition-colors hover:bg-accent"
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  Chase
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <OpenFullPage to="/finance?tab=revenue" label="Money" />
    </>
  );
}

// ---------------------------------------------------------------------------
function ContactFocus({ id, onClose }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["contact-profile", id],
    queryFn: () => api.get(`/contacts/${id}/profile`).then((r) => r.data),
    enabled: !!id,
    retry: false,
  });

  if (isLoading) return <ListSkeleton rows={2} />;
  if (isError || !data?.contact) return <GoneState what="contact" onClose={onClose} />;

  const c = data.contact;
  const s = data.summary || {};

  return (
    <>
      <p className="font-heading text-lg font-semibold leading-snug tracking-tight">{c.name}</p>
      {c.company && c.company !== c.name && (
        <p className="mt-0.5 text-sm text-muted-foreground">{c.company}</p>
      )}
      <div className="mt-3 space-y-1">
        {[
          ["Outstanding", s.outstanding],
          ["Billed to date", s.total_billed],
          ["Paid to date", s.total_paid],
        ].map(([label, v]) => (
          <p key={label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums">{v == null ? "—" : inr(v)}</span>
          </p>
        ))}
      </div>
      {data.ai_relationship?.reason && (
        <p className="mt-3 text-sm leading-relaxed">{data.ai_relationship.reason}</p>
      )}

      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          data-testid="focus-call"
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          style={{ minHeight: "var(--control-h-lg)" }}
        >
          <Phone size={20} weight="bold" /> Call {c.name.split(" ")[0]}
        </a>
      )}

      <OpenFullPage to={`/contacts/${id}`} label="the full relationship" />
    </>
  );
}

export default FocusView;

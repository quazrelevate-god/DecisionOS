// U7-02.2 (2026-08-17): Decision Dialog redesigned per founder
// wireframe (Lovable prototype, screenshots 2026-08-17).
//
// The shape the founder mocked:
//   1. HEADER   -- title (bold), amount (big) if present,
//                  "Part of <workflow>" chip if this decision
//                  belongs to a live pipeline.
//   2. SUMMARY  -- one-liner about what the decision does.
//   3. UNBLOCKS -- "Unblocks N tasks in this workflow" callout
//                  when the decision spawned blocked tasks.
//   4. ACTIONS  -- big APPROVE + REJECT buttons (only when the
//                  decision is still pending_approval). Reject
//                  confirms because it cascades delete.
//   5. TIMELINE -- "What happens next":
//                    a) Raised by <who> <date>   (filled check)
//                    b) Waiting on your decision -- Everything below is blocked
//                    c) Each spawned task: title + "Goes to <assignee>"
//   6. NOTE     -- "Send a note" (reuses the existing
//                  /decisions/:id/comment endpoint). Mic icon is
//                  a placeholder for the voice input pattern we
//                  ship elsewhere; keyboard-only works today.
//
// 2026-09-14, founder — A POPUP AGAIN, ON THE APP'S GLASS, AT 70% OF THE
// SCREEN. KM-28 had made this a full-screen route because the old modal
// could not hold its content on a phone and a stray tap threw a review away.
// The founder's call now: "no full screen, instead a popup which covers 70%
// of the screen", and "the popup is not based on our current design theme,
// revamp it". So:
//   · the shell is the task drawer's gray glass sheet (components/karma/
//     glass), with a round glass close, the small-caps labels, the raised
//     glass cards, white glass pills for secondary actions, the black ink
//     pill for Approve and maroon for the destructive confirm;
//   · from lg it is a centred card 70vw × 70vh (divided by the UI scale —
//     CSS zoom leaves viewport units alone) whose BODY scrolls, laid out in
//     two columns so the width is used: the decision and its actions on the
//     left, what happens next and the note on the right;
//   · below lg it fills the screen, as New Task does, which is the phone
//     half of KM-28 kept;
//   · a stray tap outside closes it ONLY when nothing would be lost: while a
//     note is being typed or an action is in flight the outside tap is
//     ignored, which is the other half of KM-28 kept.
// The Desk opens it in place (pages/Desk.js); /decisions/:id still mounts it
// for notifications and pasted links.

import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import {
  ChatCircleText, User, WhatsappLogo, Microphone, PaperPlaneTilt,
  CheckCircle, ArrowRight, LinkSimple, Check, X, WarningCircle,
} from "@phosphor-icons/react";
import {
  CHIP, QUIET_CHIP, DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL,
  GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL, MAROON_PILL,
} from "./karma/glass";

/* ── helpers shared with the Desk's decision cards ───────────────────────── */
export function raisedByLabel(d) {
  if (d?.source === "whatsapp") return "From WhatsApp";
  if (d?.created_by_name) return `Raised by ${d.created_by_name}`;
  return "Raised";
}

export function RaisedByIcon({ d, ...rest }) {
  if (d?.source === "whatsapp") return <WhatsappLogo {...rest} />;
  return <User {...rest} />;
}

function extractAmount(d) {
  if (!d) return null;
  if (d.amount != null && Number(d.amount) > 0) {
    return `₹${Number(d.amount).toLocaleString("en-IN")}`;
  }
  const text = `${d.title || ""} ${d.summary || ""}`;
  const m = text.match(/₹\s?([\d,]+(?:\.\d+)?)/) || text.match(/Rs\.?\s?([\d,]+(?:\.\d+)?)/i);
  if (m) return `₹${m[1]}`;
  return null;
}

function workflowLabel(d) {
  const wf = d?.workflow_summary || d?.workflow;
  if (!wf) return null;
  return wf.title || wf.name || wf.type || null;
}

/* The timeline's marker: a filled check for what is done, a coloured dot
   for what is live, a quiet dot for what is waiting. */
function TimelineDot({ tone = "muted", check = false }) {
  const bg =
    tone === "green" ? "bg-emerald-600 text-white"
    : tone === "blue" ? "bg-sky-600 text-white"
    : "bg-slate-500/20 text-slate-500";
  return (
    <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${bg}`}>
      {check ? <Check size={10} weight="bold" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    </span>
  );
}

/* A raised glass card with a small-caps label — the task drawer's section. */
function Card({ label, right, children, testid, className = "" }) {
  return (
    <section className={`${DRAWER_CARD} p-4 lg:p-5 ${className}`} data-testid={testid}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className={`${DRAWER_LABEL} mb-0`}>{label}</p>
        {right && <span className="text-xs text-slate-500">{right}</span>}
      </div>
      {children}
    </section>
  );
}

export function DecisionDialog({ decisionId, open, onClose, variant = "modal" }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  // Focus lands on the close when the card opens, not on the card itself:
  // Radix focuses the content, and the content's focus ring is the app's
  // lavender outline drawn round the whole popup.
  const closeRef = useRef(null);

  const { data: d, isError } = useQuery({
    queryKey: ["decision", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}`).then((r) => r.data),
    enabled: !!decisionId && open,
    retry: false,
  });

  const canDecide = d?.status === "pending_approval";
  const amount = useMemo(() => extractAmount(d), [d]);
  const wfLabel = useMemo(() => workflowLabel(d), [d]);
  const tasks = d?.tasks || [];
  const blocked = tasks.filter((t) => t.status === "blocked");

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["decision", decisionId] });
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["desk"] });
    qc.invalidateQueries({ queryKey: ["desk-summary"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const approveM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/approve`),
    onSuccess: () => { toast.success("Approved — tasks unblocked"); invalidate(); onClose && onClose(); },
    onError: (e) => toast.error(e.response?.data?.detail || "Could not approve"),
  });
  const rejectM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/reject`),
    onSuccess: () => { toast.success("Rejected — spawned tasks removed"); invalidate(); onClose && onClose(); },
    onError: (e) => toast.error(e.response?.data?.detail || "Could not reject"),
  });
  const busy = approveM.isPending || rejectM.isPending;

  const sendNote = async () => {
    if (!note.trim()) return;
    setSending(true);
    try {
      await api.post(`/decisions/${decisionId}/comment`, { text: note.trim() });
      setNote("");
      invalidate();
      toast.success("Note sent");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not post note");
    } finally { setSending(false); }
  };

  /* A stray tap outside must not throw away work in progress. */
  const guardOutside = (e) => { if (note.trim() || busy || sending) e.preventDefault(); };

  const statusChip =
    d?.status === "approved" ? "bg-emerald-50 text-emerald-800 ring-emerald-100"
    : d?.status === "rejected" ? "bg-rose-50 text-rose-800 ring-rose-100"
    : QUIET_CHIP;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose && onClose()}>
      <DialogContent
        className={`${GLASS_SHEET} flex flex-col gap-0 p-0 outline-none [&>button.absolute]:hidden focus:outline-none focus-visible:outline-none focus-visible:ring-0
                   left-0 top-0 h-full w-full max-w-none translate-x-0 translate-y-0 rounded-none
                   [padding-top:env(safe-area-inset-top)] [padding-bottom:env(safe-area-inset-bottom)]
                   lg:left-[50%] lg:top-[50%] lg:h-[calc(70vh/var(--ui-scale,1))] lg:w-[calc(70vw/var(--ui-scale,1))]
                   lg:min-w-[52rem] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[1.75rem]
                   lg:[padding-top:0] lg:[padding-bottom:0]
                   data-[state=open]:[--tw-enter-translate-x:0] data-[state=open]:[--tw-enter-translate-y:0]
                   data-[state=closed]:[--tw-exit-translate-x:0] data-[state=closed]:[--tw-exit-translate-y:0]
                   lg:data-[state=open]:[--tw-enter-translate-x:-50%] lg:data-[state=open]:[--tw-enter-translate-y:-48%]
                   lg:data-[state=closed]:[--tw-exit-translate-x:-50%] lg:data-[state=closed]:[--tw-exit-translate-y:-48%]`}
        onPointerDownOutside={guardOutside}
        onInteractOutside={guardOutside}
        onOpenAutoFocus={(e) => { e.preventDefault(); closeRef.current?.focus(); }}
        data-variant={variant}
        data-testid="decision-dialog"
      >
        {isError ? (
          <div className="p-6" data-testid="decision-access-restricted">
            <DialogHeader className="text-left">
              <DialogTitle className="text-lg font-semibold text-slate-900">Access restricted</DialogTitle>
              <DialogDescription className="text-sm text-slate-600">You don't have access to this decision.</DialogDescription>
            </DialogHeader>
            <DialogPrimitiveClose data-testid="decision-close" aria-label="Close" className={`${GLASS_ICON_BTN} absolute right-5 top-5`}>
              <X size={16} weight="bold" aria-hidden="true" />
            </DialogPrimitiveClose>
          </div>
        ) : !d ? (
          <div className="p-6">
            <DialogHeader className="text-left">
              <DialogTitle className="sr-only">Decision</DialogTitle>
              <DialogDescription className="sr-only">Loading the decision</DialogDescription>
            </DialogHeader>
            <p className="py-4 text-sm text-slate-500">Loading…</p>
          </div>
        ) : (
          <>
            {/* HEADER — title, the amount, the chips; the close on the
                title's line. Sticky over the scrolling body. */}
            <DialogHeader className="shrink-0 space-y-0 border-b border-slate-900/[0.06] px-5 pb-4 pt-5 text-left lg:px-7 lg:pt-6">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-left text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
                    {d.title}
                  </DialogTitle>
                  <DialogDescription className="sr-only">Review this decision</DialogDescription>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                    {amount && (
                      <p className="text-2xl font-semibold tabular-nums text-slate-900" data-testid="decision-amount">
                        {amount}
                      </p>
                    )}
                    {wfLabel && (
                      <span className={`${CHIP} ${QUIET_CHIP}`} data-testid="decision-workflow-chip">
                        <LinkSimple size={12} weight="bold" aria-hidden="true" /> Part of: {wfLabel}
                      </span>
                    )}
                    {d.dtype && <span className={`${CHIP} ${QUIET_CHIP} capitalize`}>{String(d.dtype).replace(/_/g, " ")}</span>}
                    {d.status && d.status !== "pending_approval" && (
                      <span className={`${CHIP} ${statusChip} capitalize`} data-testid="decision-status-chip">
                        {d.status.replace(/_/g, " ")}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <RaisedByIcon d={d} size={13} weight="bold" aria-hidden="true" />
                      {raisedByLabel(d)} · {timeAgo(d.created_at)}
                    </span>
                  </div>
                </div>
                <DialogPrimitiveClose ref={closeRef} data-testid="decision-close" aria-label="Close" className={GLASS_ICON_BTN}>
                  <X size={16} weight="bold" aria-hidden="true" />
                </DialogPrimitiveClose>
              </div>
            </DialogHeader>

            {/* BODY — scrolls inside the card. Two columns from lg. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-7 lg:py-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5">
                {/* LEFT — the decision and what to do about it */}
                <div className="flex min-w-0 flex-col gap-4">
                  <Card label="The decision" testid="decision-summary-card">
                    {d.summary
                      ? <p className="text-[15px] leading-relaxed text-slate-800" data-testid="decision-summary">{d.summary}</p>
                      : <p className="text-sm text-slate-500">No summary was recorded.</p>}
                    {blocked.length > 0 && canDecide && (
                      <p className="mt-3 flex items-center gap-2 rounded-2xl bg-white/70 px-3.5 py-2.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-900/[0.05]"
                        data-testid="decision-unblocks">
                        <LinkSimple size={13} weight="bold" aria-hidden="true" />
                        Unblocks {blocked.length} task{blocked.length === 1 ? "" : "s"} in this workflow
                        <ArrowRight size={12} weight="bold" aria-hidden="true" className="ml-auto" />
                      </p>
                    )}
                  </Card>

                  {canDecide && (
                    <Card label="Your call" testid="decision-actions-card">
                      <div className="flex flex-wrap gap-2.5" data-testid="decision-actions">
                        <button
                          type="button"
                          onClick={() => approveM.mutate()}
                          disabled={busy}
                          data-testid="decision-approve"
                          className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-60 ${INK_PILL}`}
                        >
                          <CheckCircle size={16} weight="bold" aria-hidden="true" />
                          {approveM.isPending ? "Approving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => (confirmReject ? rejectM.mutate() : setConfirmReject(true))}
                          disabled={busy}
                          data-testid="decision-reject"
                          className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-60 ${
                            confirmReject ? MAROON_PILL : `text-slate-800 hover:bg-white ${GLASS_PILL}`}`}
                        >
                          {confirmReject
                            ? <><WarningCircle size={16} weight="bold" aria-hidden="true" />{rejectM.isPending ? "Rejecting…" : "Confirm reject"}</>
                            : <><X size={16} weight="bold" aria-hidden="true" /> Reject</>}
                        </button>
                      </div>
                      {confirmReject && (
                        <p className="mt-3 text-xs text-rose-700" data-testid="decision-reject-warning">
                          This removes {tasks.length} spawned task{tasks.length === 1 ? "" : "s"} and any linked workflows. Click Confirm reject again to proceed, or Approve to change your mind.
                        </p>
                      )}
                    </Card>
                  )}

                  {(d.timeline || []).length > 0 && (
                    <Card label="Prior activity" testid="decision-history-card">
                      <div className="space-y-2.5" data-testid="decision-history">
                        {(d.timeline || []).map((e, i) => (
                          <div key={`${e.ts}-${i}`}
                            className={`border-l-2 pl-3 text-sm ${e.kind === "comment" ? "border-slate-900/60 text-slate-800" : "border-slate-900/15 text-slate-600"}`}>
                            <p className="flex items-center gap-1.5">
                              {e.kind === "comment" && <ChatCircleText size={13} weight="bold" aria-hidden="true" className="shrink-0" />}
                              {e.label}
                            </p>
                            <p className="text-xs text-slate-500">{e.actor || "System"} · {timeAgo(e.ts)}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>

                {/* RIGHT — what happens next, and the note back */}
                <div className="flex min-w-0 flex-col gap-4">
                  <Card
                    label="What happens next"
                    right={`${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
                    testid="decision-timeline-section"
                  >
                    <ol className="space-y-3" data-testid="decision-timeline">
                      <li className="flex gap-3">
                        <TimelineDot tone="green" check />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">Raised by {d.created_by_name || "Unknown"}</p>
                          <p className="text-xs text-slate-500">{timeAgo(d.created_at)}</p>
                        </div>
                      </li>
                      <li className="flex gap-3">
                        <TimelineDot tone={canDecide ? "blue" : "green"} check={!canDecide} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            {canDecide ? "Waiting on your decision"
                              : d.status === "approved" ? "You approved"
                              : d.status === "rejected" ? "You rejected"
                              : "Decided"}
                          </p>
                          {canDecide && <p className="text-xs text-slate-500">Everything below is blocked</p>}
                        </div>
                      </li>
                      {tasks.length === 0 && (
                        <li className="flex gap-3">
                          <TimelineDot tone="muted" />
                          <p className="text-xs text-slate-500">No follow-up tasks spawned yet.</p>
                        </li>
                      )}
                      {tasks.map((t) => (
                        <li key={t.id} className="flex gap-3" data-testid={`decision-timeline-task-${t.id}`}>
                          <TimelineDot
                            tone={t.status === "done" ? "green" : t.status === "in_progress" ? "blue" : "muted"}
                            check={t.status === "done"}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-800">{t.title}</p>
                            <p className="text-xs text-slate-500">
                              {/* E3-13: auto-assigned to a person, else the role pool, else unassigned */}
                              {t.assignee_name ? `Goes to ${t.assignee_name}`
                                : t.assignee_role ? `Goes to the ${t.assignee_role} team`
                                : "Unassigned"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Card>

                  <Card label="Send a note" right={`To ${d.created_by_name || "creator"}`} testid="decision-note-section">
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendNote(); }}
                      data-testid="decision-note-input"
                      placeholder={`Speak or type — this goes back to ${d.created_by_name || "the raiser"}`}
                      rows={3}
                      className={`${DRAWER_FIELD} resize-none`}
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        title="Voice input"
                        aria-label="Voice input"
                        className={GLASS_ICON_BTN}
                        data-testid="decision-note-mic"
                        onClick={() => toast("Voice capture is available from the Dex panel", { icon: "🎙" })}
                      >
                        <Microphone size={16} weight="regular" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={sendNote}
                        disabled={sending || !note.trim()}
                        data-testid="decision-note-send"
                        className={`flex h-11 items-center gap-1.5 rounded-pill px-5 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}
                      >
                        <PaperPlaneTilt size={14} weight="bold" aria-hidden="true" />
                        {sending ? "Sending…" : "Send note"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Or tap the mic — speaking is faster than typing.</p>
                  </Card>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

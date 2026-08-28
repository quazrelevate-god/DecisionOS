// U7-02.2 (2026-08-17): Decision Dialog redesigned per founder
// wireframe (Lovable prototype, screenshots 2026-08-17).
//
// Was: single "Discussion & activity" pane with a comment input --
// the actual approve/reject buttons lived elsewhere and only appeared
// on approval-typed decisions in a compact toolbar.
//
// Now, the shape the founder mocked:
//   1. HEADER   -- title (bold), amount (big) if present,
//                  "Part of <workflow>" chip if this decision
//                  belongs to a live pipeline.
//   2. SUMMARY  -- one-liner about what the decision does.
//   3. UNBLOCKS -- "Unblocks N tasks in this workflow" callout
//                  when the decision spawned blocked tasks.
//   4. ACTIONS  -- big APPROVE + REJECT buttons (only when the
//                  decision is still pending_approval). Reject
//                  confirms because it cascades delete.
//   5. TIMELINE -- collapsible "What happens next" with:
//                    a) Raised by <who> <date>   (filled check)
//                    b) Waiting on your decision -- Everything below is blocked
//                    c) Each spawned task: title + "Goes to <assignee>"
//   6. NOTE     -- collapsible "Send a note" (reuses the existing
//                  /decisions/:id/comment endpoint). Mic icon is
//                  a placeholder for the voice input pattern we
//                  ship elsewhere; keyboard-only works today.
//
// Two example flows the founder asked for:
//   - "Create-decision" flow: a Desk decision (dtype=approval) that
//     asks the owner to accept a payment reschedule. Full stack lands
//     -- amount, workflow tag, approve/reject, timeline.
//   - "Approval section" flow: same dialog, once approved, buttons
//     disappear and the header shows the outcome. Timeline turns
//     historical.

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Chip } from "./common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import {
  ChatCircleText, User, WhatsappLogo, Microphone, PaperPlaneTilt,
  CheckCircle, CaretDown, CaretUp, ArrowRight, LinkSimple, Check, X,
  WarningCircle,
} from "@phosphor-icons/react";

export function raisedByLabel(d) {
  if (!d) return "";
  if (d.source === "whatsapp") return `Raised via WhatsApp${d.wa_from ? ` · ${d.wa_from}` : ""}`;
  const src = d.source === "voice" ? "Voice" : d.source === "text" ? "Text" : d.source ? d.source : "Manual";
  return `Raised by ${d.created_by_name || "Unknown"} · ${src}`;
}

export function RaisedByIcon({ d, ...rest }) {
  if (d?.source === "whatsapp") return <WhatsappLogo {...rest} />;
  if (d?.source === "voice") return <Microphone {...rest} />;
  return <User {...rest} />;
}

// U7-02.2: parse the "amount" out of a decision when the backend
// exposes it. Right now decisions carry no first-class amount field,
// so we peek at `items[].detail` for a rupee/currency string. Returns
// null when nothing looks like money -- that's fine, the header just
// omits the amount row.
function extractAmount(d) {
  if (!d) return null;
  const candidates = [
    d.amount_formatted,
    ...(d.items || []).map((i) => i?.detail),
    d.summary,
    d.title,
  ].filter(Boolean);
  for (const c of candidates) {
    const m = String(c).match(/(?:₹|Rs\.?|INR)\s?[\d,]+(?:\.\d+)?(?:\s?(?:cr|lakh|k|L))?/i);
    if (m) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

// U7-02.2: try to derive the "Part of: <workflow>" chip. If the
// decision has an entry in workflow_events, use the first one.
function workflowLabel(d) {
  const evs = d?.workflow_events || [];
  if (evs.length === 0) return null;
  const first = evs[0];
  return first?.workflow_label || first?.workflow_type || first?.type || null;
}

function TimelineDot({ tone = "muted", check = false }) {
  // Small circular indicator used down the timeline column. `tone`:
  // green (raised / done), blue (current), muted (pending).
  const bg = {
    green: "bg-green-600 text-white",
    blue: "bg-kr-ink text-white",
    muted: "kr-pop text-transparent",
  }[tone];
  return (
    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${bg}`}>
      {check ? <Check size={10} weight="bold" /> : <span className="w-1.5 h-1.5 bg-current rounded-full" />}
    </span>
  );
}

function Section({ label, right, open, onToggle, children, testid }) {
  return (
    <div className="mt-4 border-t border-nm-edge/40 pt-3" data-testid={testid}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="font-semibold text-sm">{label}</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {right}
          {open ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
        </span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function DecisionDialog({ decisionId, open, onClose }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showNote, setShowNote] = useState(true);
  const [confirmReject, setConfirmReject] = useState(false);

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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="kr-bento max-w-lg rounded-cardlg border-0 p-0 [&>button.absolute]:hidden" data-testid="decision-dialog">
        {isError ? (
          <div className="p-6" data-testid="decision-access-restricted">
            <DialogHeader>
              <DialogTitle className="text-left">Access restricted</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mt-1">You don't have access to this decision.</p>
          </div>
        ) : !d ? (
          <div className="p-6">
            <DialogHeader>
              <DialogTitle className="text-left sr-only">Decision</DialogTitle>
            </DialogHeader>
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : (
          <div className="p-6">
            {/* HEADER: title, amount, workflow chip. Status pill shows
                the current state (pending / approved / rejected). */}
            {/* KM-12 — the close sits ON the title's line, not floating in the
                sheet's corner, and is the same .kr-pop circle every other
                dismiss in the app uses. */}
            <DialogHeader className="pr-11">
              <DialogPrimitiveClose
                data-testid="decision-close"
                aria-label="Close"
                className="kr-pop absolute right-5 top-5 grid h-9 w-9 place-items-center rounded-full text-foreground/70">
                <X size={15} weight="bold" aria-hidden="true" />
              </DialogPrimitiveClose>
              <DialogTitle className="text-left text-xl font-semibold leading-snug">
                {d.title}
              </DialogTitle>
            </DialogHeader>
            {amount && (
              <p
                className="mt-1 text-2xl font-semibold tabular-nums text-foreground"
                data-testid="decision-amount"
              >
                {amount}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-2">
              {wfLabel && (
                <span
                  className="kr-pop inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-xs font-medium text-foreground/80"
                  data-testid="decision-workflow-chip"
                >
                  <LinkSimple size={12} weight="bold" /> Part of: {wfLabel}
                </span>
              )}
              {d.dtype && <Chip value={d.dtype} />}
              {d.status && d.status !== "pending_approval" && (
                <Chip
                  value={d.status.replace("_", " ")}
                  className={
                    d.status === "approved"
                      ? "bg-green-600 text-white"
                      : d.status === "rejected"
                      ? "bg-danger-600 text-white"
                      : "bg-muted text-black"
                  }
                />
              )}
            </div>

            {/* SUMMARY */}
            {d.summary && (
              <p className="text-sm mt-3 leading-relaxed" data-testid="decision-summary">
                {d.summary}
              </p>
            )}

            {/* UNBLOCKS callout */}
            {blocked.length > 0 && canDecide && (
              <button
                type="button"
                onClick={() => setShowTimeline(true)}
                className="kr-pop mt-3 flex w-full items-center gap-2 rounded-control px-3 py-2.5 text-xs text-foreground"
                data-testid="decision-unblocks"
              >
                <LinkSimple size={13} weight="bold" />
                Unblocks {blocked.length} task{blocked.length === 1 ? "" : "s"} in this workflow
                <ArrowRight size={12} weight="bold" className="ml-auto" />
              </button>
            )}

            {/* ACTIONS: big Approve / Reject only when pending. */}
            {canDecide && (
              <div className="grid grid-cols-2 gap-2 mt-4" data-testid="decision-actions">
                <button
                  type="button"
                  onClick={() => approveM.mutate()}
                  disabled={approveM.isPending || rejectM.isPending}
                  data-testid="decision-approve"
                  className="kr-lift flex h-12 items-center justify-center gap-2 rounded-pill bg-kr-ink px-4 text-sm font-medium text-white disabled:opacity-60"
                >
                  <CheckCircle size={16} weight="bold" />
                  {approveM.isPending ? "Approving…" : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => (confirmReject ? rejectM.mutate() : setConfirmReject(true))}
                  disabled={approveM.isPending || rejectM.isPending}
                  data-testid="decision-reject"
                  className={`flex h-12 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium disabled:opacity-60 ${
                    confirmReject
                      ? "bg-danger-600 text-white"
                      : "kr-pop text-foreground"
                  }`}
                >
                  {confirmReject ? (
                    <>
                      <WarningCircle size={16} weight="bold" />
                      {rejectM.isPending ? "Rejecting…" : "Confirm reject"}
                    </>
                  ) : (
                    <>
                      <X size={16} weight="bold" /> Reject
                    </>
                  )}
                </button>
              </div>
            )}
            {confirmReject && canDecide && (
              <p className="text-xs text-danger-600 mt-2" data-testid="decision-reject-warning">
                This removes {tasks.length} spawned task{tasks.length === 1 ? "" : "s"} and any linked workflows. Click Confirm reject again to proceed, or click Approve to change your mind.
              </p>
            )}

            {/* TIMELINE: What happens next */}
            <Section
              label="What happens next"
              right={<span>{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>}
              open={showTimeline}
              onToggle={() => setShowTimeline((o) => !o)}
              testid="decision-timeline-section"
            >
              <ol className="space-y-3" data-testid="decision-timeline">
                <li className="flex gap-3">
                  <TimelineDot tone="green" check />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Raised by {d.created_by_name || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{timeAgo(d.created_at)}</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <TimelineDot tone={canDecide ? "blue" : "green"} check={!canDecide} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {canDecide
                        ? "Waiting on your decision"
                        : d.status === "approved"
                        ? "You approved"
                        : d.status === "rejected"
                        ? "You rejected"
                        : "Decided"}
                    </p>
                    {canDecide && (
                      <p className="text-xs text-muted-foreground">Everything below is blocked</p>
                    )}
                  </div>
                </li>
                {tasks.length === 0 && (
                  <li className="flex gap-3">
                    <TimelineDot tone="muted" />
                    <p className="text-xs text-muted-foreground">No follow-up tasks spawned yet.</p>
                  </li>
                )}
                {tasks.map((t) => (
                  <li key={t.id} className="flex gap-3" data-testid={`decision-timeline-task-${t.id}`}>
                    <TimelineDot
                      tone={t.status === "done" ? "green" : t.status === "in_progress" ? "blue" : "muted"}
                      check={t.status === "done"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{t.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {/* E3-13: auto-assigned to a person, else the role pool, else unassigned */}
                        {t.assignee_name
                          ? `Goes to ${t.assignee_name}`
                          : t.assignee_role
                            ? `Goes to the ${t.assignee_role} team`
                            : "Unassigned"}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </Section>

            {/* NOTE */}
            <Section
              label="Send a note"
              right={<span>To {d.created_by_name || "creator"}</span>}
              open={showNote}
              onToggle={() => setShowNote((o) => !o)}
              testid="decision-note-section"
            >
              {/* KM-12 — THE MIC STOPS FLOATING BESIDE THE FIELD.
                  It sat as a solid indigo circle to the LEFT of the textarea,
                  which read as an unrelated button parked next to a box: its
                  job is to fill that field, not to sit outside it. Now the
                  field takes the full width and the row beneath it reads
                  left-to-right as the actual flow — speak (mic) … then send.
                  The helper line that explains the mic sits under it rather
                  than wedged between the two controls. */}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendNote();
                }}
                data-testid="decision-note-input"
                placeholder={`Speak or type — this goes back to ${d.created_by_name || "the raiser"}`}
                rows={3}
                className="kr-pressed w-full resize-none rounded-control border-0 px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  title="Voice input"
                  aria-label="Voice input"
                  className="kr-pop grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground"
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
                  className="kr-lift flex h-11 items-center gap-1.5 rounded-pill bg-kr-ink px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  <PaperPlaneTilt size={14} weight="bold" aria-hidden="true" />
                  {sending ? "Sending…" : "Send note"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Or tap the mic — speaking is faster than typing.
              </p>
            </Section>

            {/* Prior discussion, preserved but tucked below to keep the
                approval flow above the fold. */}
            {(d.timeline || []).length > 0 && (
              <div className="mt-4 border-t border-nm-edge/40 pt-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <ChatCircleText size={14} weight="bold" /> Prior activity
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto" data-testid="decision-history">
                  {(d.timeline || []).map((e, i) => (
                    <div
                      key={`${e.ts}-${i}`}
                      className={`border-l-2 pl-2.5 text-sm ${e.kind === "comment" ? "border-kr-ink/60" : "border-nm-edge/60"}`}
                    >
                      <p className={e.kind === "comment" ? "" : "text-muted-foreground"}>{e.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {e.actor || "System"} · {timeAgo(e.ts)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

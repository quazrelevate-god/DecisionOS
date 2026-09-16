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
  CheckCircle, ArrowRight, LinkSimple, Check, X, WarningCircle, Play,
} from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import {
  CHIP, QUIET_CHIP, DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL,
  GLASS_ICON_BTN, GLASS_PILL, GLASS_SHEET, INK_PILL, MAROON_PILL,
} from "./karma/glass";
import { GlassSelect } from "./karma/GlassSelect";
import { useAuth } from "../context/AuthContext";
import { userPerms } from "../lib/perms";
import { canAssignPerson } from "../lib/taskAccess";
import { proposalCreatesText } from "../lib/decisionProposal";

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
  // ASK-32 — the money in the workflows the decision proposes.
  const wfAmounts = (d.proposal?.workflows || []).map((w) => Number(w.amount)).filter((n) => n > 0);
  if (wfAmounts.length) return `₹${wfAmounts.reduce((a, b) => a + b, 0).toLocaleString("en-IN")}`;
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
  const { user } = useAuth();
  const [changing, setChanging] = useState(false);
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

  /* ASK-41 1 — BOTH SPELLINGS OF "nobody has decided this yet".
     The database carries two for one state and has since U7-02.3: a decision
     Dex captures lands as "pending_approval", one created any other way as
     "pending", and services/decision_flow.py calls them one thing (PENDING) —
     its _claim accepts either, so the server will approve both. This dialog
     asked for "pending_approval" only, so a "pending" decision opened with a
     grey Pending chip, no Approve and no Reject. Nobody noticed while every row
     carried a tick and a cross of its own; ASK-41 takes those away and makes
     this window the only way to decide, so the narrow test would have stranded
     every decision of that spelling. Renaming the status across the app is the
     bigger sweep desk.py says it is — this is the same widened filter desk.py
     itself uses to build the feed. */
  const canDecide = d?.status === "pending" || d?.status === "pending_approval";
  const amount = useMemo(() => extractAmount(d), [d]);
  const wfLabel = useMemo(() => workflowLabel(d), [d]);
  const tasks = d?.tasks || [];
  const blocked = tasks.filter((t) => t.status === "blocked");
  /* ASK-32 Phase 1 — a waiting decision PROPOSES its work; none of it exists
     until it is approved. Older decisions created their tasks blocked, so they
     keep reading the real tasks. */
  const proposal = d?.proposal || null;
  const proposing = canDecide && !!proposal;
  const rows = proposing ? (proposal.tasks || []) : tasks;
  const extras = proposing ? [
    /* ASK-32 Phase 4 — a workflow already on the board is named as such, with
       the stage it moves to; a new one says where it starts. */
    ...(proposal.workflows || []).map((w) => {
      const stage = (k) => String(k || "").replace(/_/g, " ");
      return {
        key: w.key, kind: "workflows",
        label: w.mode === "existing" ? `${w.pipeline_label || "Workflow"}: ${w.title} (already on the board)` : `New ${w.pipeline_label || "workflow"}: ${w.title}`,
        sub: [w.counterparty, Number(w.amount) > 0 ? `₹${Number(w.amount).toLocaleString("en-IN")}` : null,
          w.mode === "existing"
            ? (w.move_to ? `moves from ${stage(w.stage)} to ${stage(w.move_to)}` : `stays at ${stage(w.stage)}`)
            : (w.stage ? `starts at ${stage(w.stage)}` : null)].filter(Boolean).join(" · "),
      };
    }),
    ...(proposal.meetings || []).map((m) => ({ key: m.key, kind: "meetings", label: `Meeting: ${m.title}`, sub: [m.when, m.date].filter(Boolean).join(" · ") })),
    ...(proposal.reminders || []).map((r) => ({ key: r.key, kind: "reminders", label: `Reminder: ${r.title}`, sub: `For ${d?.created_by_name || "the person who raised it"}` })),
    ...(proposal.memory_notes || []).map((n) => ({ key: n.key, kind: "memory_notes", label: `Company note: ${n.text}`, sub: n.tag })),
  ] : [];
  const nWorkflows = (proposal?.workflows || []).length;
  // ASK-33 — the wording lives in lib/decisionProposal, so the Desk's Dex well
  // says exactly what this popup says about the same proposal.
  const createsText = proposalCreatesText({ tasks: rows.length, workflows: nWorkflows, extras: extras.length });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["decision", decisionId] });
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["desk"] });
    qc.invalidateQueries({ queryKey: ["desk-summary"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  /* ASK-32 Phase 2 — only the person it waits on (or an owner) decides it or
     hands it to someone else; anyone else who can open it sees who decides. */
  const mayDecide = canDecide && (user?.role === "owner" || d?.approver_id === user?.id
    || (!!d?.approver_id && (user?._acting_for || []).includes(d.approver_id)) // RBAC P2: handed to me while away
    || (!d?.approver_id && userPerms(user).includes("decisions_approve")));
  const waitingOn = d?.approver_id && d.approver_id === user?.id ? "Waiting on you"
    : d?.approver_name ? `Waiting on ${d.approver_name}` : "Waiting on an owner";
  const approversQ = useQuery({
    queryKey: ["decision-approvers", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}/approvers`).then((r) => r.data),
    enabled: !!decisionId && open && changing,
  });
  const changeM = useMutation({
    mutationFn: (approverId) => api.post(`/decisions/${decisionId}/approver`, { approver_id: approverId }),
    onSuccess: (res) => {
      toast.success(`Sent to ${res?.data?.approver_name || "them"} to decide`);
      setChanging(false);
      invalidate();
    },
    onError: (e) => toast.error(e.response?.data?.detail || "Could not change who decides"),
  });

  /* ASK-32 Phase 3 (DD5) — before approving, whoever decides can change who
     does a task, when it is due, or drop an item. The server holds the same
     rules (and who may be given a task). */
  const editable = proposing && mayDecide;
  const [editBusy, setEditBusy] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);
  const membersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: !!open && editable,
  });
  const people = (membersQ.data || []).filter((m) => canAssignPerson(user, m))
    .map((m) => ({ value: m.id, label: m.id === user?.id ? `${m.name} (you)` : m.name }));
  const editTask = async (key, body) => {
    setEditBusy(true);
    try {
      await api.patch(`/decisions/${decisionId}/proposal/tasks/${key}`, body);
      invalidate();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change it");
    } finally { setEditBusy(false); }
  };
  const removeItem = async (kind, key) => {
    setEditBusy(true);
    try {
      await api.delete(`/decisions/${decisionId}/proposal/${kind}/${key}`);
      toast.success("Removed — it won't be created");
      invalidate();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove it");
    } finally { setEditBusy(false); }
  };
  const playAudio = async () => {
    try {
      const { data } = await api.get(`/voice-notes/${d.said.voice_note_id}/audio`, { responseType: "blob" });
      setAudioUrl(URL.createObjectURL(data));
    } catch (e) {
      toast.error("Could not load the voice note");
    }
  };
  const saidHow = d?.said
    ? (d.said.how === "voice" ? `Voice note${d.said.language ? ` · ${d.said.language}` : ""}`
      : d.said.how === "whatsapp" ? "WhatsApp" : "Typed")
    : null;

  /* The decision's history, drawn once per layout (see the two mounts below). */
  const historyCard = (sfx) => ((d?.timeline || []).length > 0 ? (
    <Card label="Prior activity" testid={`decision-history-card${sfx}`}>
      <div className="space-y-2.5" data-testid={`decision-history${sfx}`}>
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
  ) : null);

  const approveM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/approve`),
    onSuccess: (res) => {
      const c = res?.data?.created_on_approval;
      const made = c ? [
        c.task_ids ? `${c.task_ids} task${c.task_ids === 1 ? "" : "s"}` : null,
        c.workflow_ids ? `${c.workflow_ids} workflow${c.workflow_ids === 1 ? "" : "s"}` : null,
      ].filter(Boolean) : [];
      toast.success(made.length ? `Approved — ${made.join(" and ")} created` : "Approved");
      // ASK-32 Phase 3 — stay open: the popup now shows what was created, with links.
      invalidate();
    },
    onError: (e) => { toast.error(e.response?.data?.detail || "Could not approve"); invalidate(); },
  });
  const rejectM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/reject`),
    onSuccess: () => { toast.success(proposing ? "Rejected — nothing was created" : "Rejected"); invalidate(); onClose && onClose(); },
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
                    {/* ASK-41 1 — and the chip stays out of the way of both:
                        "Pending" beside an Approve button says nothing the
                        button does not, and it used to appear on exactly the
                        decisions that could not be decided here. */}
                    {d.status && !canDecide && (
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
                    {canDecide && (proposing ? !!createsText : blocked.length > 0) && (
                      <p className="mt-3 flex items-center gap-2 rounded-2xl bg-white/70 px-3.5 py-2.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-900/[0.05]"
                        data-testid="decision-unblocks">
                        <LinkSimple size={13} weight="bold" aria-hidden="true" />
                        {proposing
                          ? `Approving creates ${createsText}`
                          : `Unblocks ${blocked.length} task${blocked.length === 1 ? "" : "s"} in this workflow`}
                        <ArrowRight size={12} weight="bold" aria-hidden="true" className="ml-auto" />
                      </p>
                    )}
                    {canDecide && d.repeat_of && (
                      <p className="mt-3 flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-100"
                        data-testid="decision-repeat">
                        <WarningCircle size={13} weight="bold" aria-hidden="true" />
                        Looks like a repeat of &ldquo;{d.repeat_of.title}&rdquo;, which is still waiting.
                      </p>
                    )}
                  </Card>

                  {/* ASK-32 Phase 3 — what was said, so the task list can be checked against it. */}
                  {d.said && (d.said.text || d.said.has_audio || (d.said.files || []).length > 0) && (
                    <Card label="What was said" right={saidHow} testid="decision-said-card">
                      {d.said.text
                        ? <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800" data-testid="decision-said">&ldquo;{d.said.text}&rdquo;</p>
                        : <p className="text-sm text-slate-500">No words — only a file was sent.</p>}
                      {d.said.has_audio && (audioUrl
                        ? <audio controls autoPlay src={audioUrl} className="mt-3 w-full" data-testid="decision-said-audio" />
                        : (
                          <button type="button" onClick={playAudio} data-testid="decision-play"
                            className={`mt-3 flex h-10 items-center gap-2 rounded-pill px-4 text-sm font-medium text-slate-800 hover:bg-white ${GLASS_PILL}`}>
                            <Play size={14} weight="fill" aria-hidden="true" /> Play the voice note
                          </button>
                        ))}
                      {(d.said.files || []).length > 0 && (
                        <p className="mt-3 text-xs text-slate-500" data-testid="decision-said-files">
                          Sent with it: {d.said.files.map((f) => f.name).join(", ")}
                        </p>
                      )}
                    </Card>
                  )}

                  {canDecide && !mayDecide && (
                    <Card label="Who decides" testid="decision-waiting-card">
                      <p className="text-sm text-slate-700">{waitingOn}. You'll be told when it's decided.</p>
                    </Card>
                  )}

                  {mayDecide && (
                    <Card label="Your call" testid="decision-actions-card">
                      <div className="flex flex-wrap gap-2.5" data-testid="decision-actions">
                        <button
                          type="button"
                          onClick={() => approveM.mutate()}
                          disabled={busy}
                          data-testid="decision-approve"
                          className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-60 lg:h-12 ${INK_PILL}`}
                        >
                          <CheckCircle size={16} weight="bold" aria-hidden="true" />
                          {approveM.isPending ? "Approving…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => (confirmReject ? rejectM.mutate() : setConfirmReject(true))}
                          disabled={busy}
                          data-testid="decision-reject"
                          className={`flex h-14 flex-1 items-center justify-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-60 lg:h-12 ${
                            confirmReject ? MAROON_PILL : `text-slate-800 hover:bg-white ${GLASS_PILL}`}`}
                        >
                          {confirmReject
                            ? <><WarningCircle size={16} weight="bold" aria-hidden="true" />{rejectM.isPending ? "Rejecting…" : "Confirm reject"}</>
                            : <><X size={16} weight="bold" aria-hidden="true" /> Reject</>}
                        </button>
                      </div>
                      {confirmReject && (
                        <p className="mt-3 text-xs text-rose-700" data-testid="decision-reject-warning">
                          {proposing
                            ? "Nothing it proposes will be created."
                            : "Tasks still waiting on it are cancelled; work already under way stays."}{" "}
                          Click Confirm reject again to proceed, or Approve to change your mind.
                        </p>
                      )}
                    </Card>
                  )}

                  {/* Desktop: history under the decision. Phone: after the work (below). */}
                  <div className="hidden lg:block">{historyCard("")}</div>
                </div>

                {/* RIGHT — what happens next, and the note back */}
                <div className="flex min-w-0 flex-col gap-4">
                  <Card
                    label="What happens next"
                    right={`${rows.length} task${rows.length === 1 ? "" : "s"}`}
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
                          <p className="text-sm font-medium text-slate-800" data-testid="decision-waiting-on">
                            {canDecide ? waitingOn
                              : d.status === "approved" ? `Approved${d.decided_by_name ? ` by ${d.decided_by_name}` : ""}`
                              : d.status === "rejected" ? `Rejected${d.decided_by_name ? ` by ${d.decided_by_name}` : ""}`
                              : "Decided"}
                          </p>
                          {canDecide && (
                            <p className="text-xs text-slate-500">
                              {proposing ? "Nothing below is created until it's approved" : "Everything below is blocked"}
                            </p>
                          )}
                          {mayDecide && !changing && (
                            <button type="button" onClick={() => setChanging(true)} data-testid="decision-change-approver"
                              className="mt-1 text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">
                              Change who decides
                            </button>
                          )}
                          {mayDecide && changing && (
                            <div className="mt-2 flex items-center gap-2" data-testid="decision-approver-picker">
                              <div className="min-w-0 flex-1">
                                <GlassSelect
                                  value=""
                                  onChange={(v) => v && changeM.mutate(v)}
                                  ariaLabel="Who decides"
                                  testid="decision-approver-select"
                                  placeholder={approversQ.isLoading ? "Loading…" : "Pick who decides"}
                                  disabled={changeM.isPending}
                                  options={(approversQ.data || [])
                                    .filter((p) => p.id !== d.approver_id)
                                    .map((p) => ({ value: p.id, label: `${p.name}${p.id === user?.id ? " (you)" : ""}` }))}
                                />
                              </div>
                              <button type="button" onClick={() => setChanging(false)}
                                className="text-xs text-slate-500 hover:text-slate-800">Cancel</button>
                            </div>
                          )}
                        </div>
                      </li>
                      {rows.length === 0 && extras.length === 0 && (
                        <li className="flex gap-3">
                          <TimelineDot tone="muted" />
                          <p className="text-xs text-slate-500">No follow-up tasks.</p>
                        </li>
                      )}
                      {rows.map((t) => (
                        <li key={t.id || t.key} className="flex gap-3" data-testid={`decision-timeline-task-${t.id || t.key}`}>
                          <TimelineDot
                            tone={t.status === "done" ? "green" : t.status === "in_progress" ? "blue" : "muted"}
                            check={t.status === "done"}
                          />
                          <div className="min-w-0 flex-1">
                            {proposing || !t.id
                              ? <p className="text-sm text-slate-800">{t.title}</p>
                              : (
                                <Link to={`/my-work?task=${t.id}`} onClick={() => onClose && onClose()}
                                  data-testid={`decision-task-link-${t.id}`}
                                  className="text-sm text-slate-800 underline-offset-2 hover:underline">{t.title}</Link>
                              )}
                            {editable ? (
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <div className="min-w-[10rem] flex-1">
                                  <GlassSelect
                                    value={t.assignee_id || ""}
                                    onChange={(v) => v && editTask(t.key, { assignee_id: v })}
                                    ariaLabel={`Who does ${t.title}`}
                                    testid={`decision-task-person-${t.key}`}
                                    placeholder={t.assignee_role ? `Pick who does this (${t.assignee_role} team)` : "Pick who does this"}
                                    variant="field"
                                    disabled={editBusy}
                                    triggerClassName={`h-9 rounded-pill px-3 text-xs ${t.assignee_id ? `text-slate-700 ${GLASS_PILL}` : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"}`}
                                    options={people.some((p) => p.value === t.assignee_id) || !t.assignee_id
                                      ? people
                                      : [{ value: t.assignee_id, label: t.assignee_name || "Current person" }, ...people]}
                                  />
                                </div>
                                <input type="date" value={(t.due_date || "").slice(0, 10)} disabled={editBusy}
                                  onChange={(e) => editTask(t.key, { due_date: e.target.value })}
                                  aria-label={`Due date for ${t.title}`} data-testid={`decision-task-due-${t.key}`}
                                  className={`h-9 rounded-pill px-3 text-xs text-slate-700 ${GLASS_PILL}`} />
                                <button type="button" onClick={() => removeItem("tasks", t.key)} disabled={editBusy}
                                  aria-label={`Remove ${t.title}`} data-testid={`decision-task-remove-${t.key}`}
                                  className={GLASS_ICON_BTN}>
                                  <X size={14} weight="bold" aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">
                                {/* E3-13: auto-assigned to a person, else the role pool, else unassigned */}
                                {t.assignee_name ? `Goes to ${t.assignee_name}`
                                  : t.assignee_role ? `Goes to the ${t.assignee_role} team`
                                  : "Unassigned"}
                                {t.due_date ? ` · due ${new Date(t.due_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                                {t.priority && t.priority !== "medium" ? ` · ${t.priority} priority` : ""}
                              </p>
                            )}
                            {(t.workflow_title || t.workflow_summary?.title) && (
                              <p className="mt-0.5 text-xs text-slate-500" data-testid={`decision-task-workflow-${t.id || t.key}`}>
                                Part of {t.workflow_title || t.workflow_summary.title}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                      {extras.map((x) => (
                        <li key={x.key} className="flex gap-3" data-testid={`decision-timeline-extra-${x.key}`}>
                          <TimelineDot tone="muted" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-800">{x.label}</p>
                            {x.sub && <p className="text-xs text-slate-500">{x.sub}</p>}
                          </div>
                          {editable && (
                            <button type="button" onClick={() => removeItem(x.kind, x.key)} disabled={editBusy}
                              aria-label={`Remove ${x.label}`} data-testid={`decision-extra-remove-${x.key}`}
                              className={`${GLASS_ICON_BTN} shrink-0`}>
                              <X size={14} weight="bold" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      ))}
                      {/* ASK-32 Phase 4 — after approving: the workflows it created or moved, as links. */}
                      {!proposing && d.status === "approved" && (d.workflows || []).map((w) => (
                        <li key={w.id} className="flex gap-3" data-testid={`decision-workflow-${w.id}`}>
                          <TimelineDot tone="green" check />
                          <div className="min-w-0 flex-1">
                            <a href={`/my-work?view=workflows&type=${encodeURIComponent(w.type || "")}&focus=${encodeURIComponent(w.id)}`}
                              className="text-sm text-slate-800 underline-offset-2 hover:underline">{w.title}</a>
                            <p className="text-xs capitalize text-slate-500">{String(w.stage || "").replace(/_/g, " ")}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Card>

                  {/* ASK-34 item 3 — NOT WHEN YOU RAISED IT YOURSELF.
                      ASK-32 Phase 3 built this as the approver's way back to
                      the person who RAISED the decision: a question about what
                      they meant, before signing it off. When an owner captures
                      through Dex they are both ends of that line, so the card
                      offered to send a note from them to themselves — and the
                      backend agrees it is not a message: comment_decision
                      (routers/decisions.py) builds its recipients as
                      `[p for p in participants if p != user["id"]]`, so a note
                      to yourself notifies nobody. Hidden, not disabled: there
                      is nothing here to do. Left EXACTLY as it was whenever
                      someone else raised it — that is the case it exists for,
                      and it works. This is not about task assignees; ASK-32
                      2.3 already tells them on approval. */}
                  {d.created_by !== user?.id && (
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
                  )}
                  {/* ASK-32 Phase 3 — on a phone the work to check comes first; the history follows it. */}
                  <div className="lg:hidden">{historyCard("-m")}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

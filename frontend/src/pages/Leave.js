import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, StickyHeader, EmptyState } from "../components/common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import {
  Plus, WarningOctagon, CheckCircle, XCircle, ChatCircleText, Gear, Clock, ArrowCounterClockwise, PaperPlaneTilt,
  CalendarBlank,
  // ASK-4 (2026-09-12): AI Impact Analysis retired at the leave-card level.
  // Sparkle / ArrowsClockwise / CalendarPlus / Eye / CircleNotch were the
  // ImpactDialog's private icon vocabulary and left with it.
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
import {
  CHIP, QUIET_CHIP, DRAWER_FIELD, DRAWER_TRACK, GLASS_PILL, INK_PILL, MAROON_PILL,
} from "../components/karma/glass";

const LEAVE_TYPES = [
  { key: "casual", label: "Casual" },
  { key: "sick", label: "Sick" },
  { key: "earned", label: "Earned" },
  { key: "permission", label: "Permission" },
  { key: "wfh", label: "Work From Home" },
  { key: "other", label: "Other" },
];
const ABSENCE_REASONS = [
  { key: "sick", label: "Sick" },
  { key: "family_emergency", label: "Family Emergency" },
  { key: "personal", label: "Personal" },
  { key: "other", label: "Other" },
];
/* 2026-09-14, founder — the leave card joins the task cards' vocabulary: every
   chip is the ASK-25 recipe (soft tint, hairline ring in the same hue) with an
   icon, and its actions are the task drawer's pills (components/karma/glass).
   Waiting on a decision is amber, as a waiting task is; a question back to the
   requester is violet, so the two open states never read alike. */
export const STATUS_META = {
  pending: { label: "Pending", tone: "bg-amber-50 text-amber-800 ring-amber-100", icon: Clock },
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 ring-emerald-100", icon: CheckCircle },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700 ring-rose-100", icon: XCircle },
  info_requested: { label: "Info Requested", tone: "bg-violet-50 text-violet-700 ring-violet-100", icon: ChatCircleText },
  // 2026-09-19 — taken back by the person who asked. Stored as "cancelled"
  // (routers/team.py LEAVE_WITHDRAWN); quiet grey, because it is over.
  cancelled: { label: "Withdrawn", tone: "bg-slate-100 text-slate-600 ring-slate-200", icon: ArrowCounterClockwise },
};

/* Your own request can be taken back while it waits on a decision, or once
   approved but before it starts. The server holds the same line. */
export const canWithdraw = (lv, today = new Date().toISOString().slice(0, 10)) =>
  lv.status === "pending" || lv.status === "info_requested"
  || (lv.status === "approved" && (lv.from_date || "") > today);
const LEAVE_SECONDARY = `flex h-11 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`;
const inp = "w-full nm-field px-3 py-2 text-sm";
export const typeLabel = (k) => LEAVE_TYPES.find((t) => t.key === k)?.label || k;
const fmtRange = (lv) => lv.from_date === lv.to_date ? lv.from_date : `${lv.from_date} → ${lv.to_date}`;

/* 2026-09-19 — exported: My Work's desktop toolbar opens this same form.
   `triggerClassName` lets a host dress the button in its own material. */
export function RequestLeaveDialog({ onDone, triggerClassName }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ leave_type: "casual", from_date: today, to_date: today, day_portion: "full", reason: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async () => {
    if (!form.from_date || !form.to_date) return toast.error("Pick dates");
    if (form.to_date < form.from_date) return toast.error("End date cannot be before start date");
    try {
      const { data } = await api.post("/leaves", form);
      // An owner (nobody above them) records leave — it comes back already
      // approved, so don't call it "submitted for approval".
      toast.success(data?.status === "approved" ? "Leave recorded" : "Leave request submitted");
      setOpen(false);
      setForm({ leave_type: "casual", from_date: today, to_date: today, day_portion: "full", reason: "" });
      onDone?.();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not submit"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          data-testid="request-leave-button"
          title="Plan time off in advance -- needs approval"
          className={triggerClassName || "kr-pop flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium"}
        >
          <Plus size={16} weight="bold" /> Request Leave
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Request Leave</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Your reporting manager or department approver will be notified.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="label-mono text-muted-foreground">Leave Type</label>
            <select data-testid="leave-type-select" className={`${inp} mt-1`} value={form.leave_type} onChange={set("leave_type")}>
              {LEAVE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-mono text-muted-foreground">From</label>
              <input data-testid="leave-from-date" type="date" className={`${inp} mt-1`} value={form.from_date} onChange={set("from_date")} />
            </div>
            <div>
              <label className="label-mono text-muted-foreground">To</label>
              <input data-testid="leave-to-date" type="date" className={`${inp} mt-1`} value={form.to_date} onChange={set("to_date")} />
            </div>
          </div>
          {/* KM-3 — same track treatment as leave-tabs above. */}
          <div className="kr-pressed flex items-center gap-1 rounded-pill p-1" data-testid="leave-portion-toggle">
            <button type="button" onClick={() => setForm({ ...form, day_portion: "full" })}
              className={`flex-1 rounded-pill px-3 py-2 text-xs font-medium transition-all ${form.day_portion === "full" ? "kr-pop text-foreground" : "text-foreground/60 hover:text-foreground/85"}`}>Full Day</button>
            <button type="button" onClick={() => setForm({ ...form, day_portion: "half" })}
              className={`flex-1 rounded-pill px-3 py-2 text-xs font-medium transition-all ${form.day_portion === "half" ? "kr-pop text-foreground" : "text-foreground/60 hover:text-foreground/85"}`}>Half Day</button>
          </div>
          <textarea data-testid="leave-reason-input" className={inp} rows={2} placeholder="Reason" value={form.reason} onChange={set("reason")} />
        </div>
        <DialogFooter>
          <button data-testid="leave-submit" onClick={submit} className="kr-lift rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white transition-all">Submit</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AbsenceDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "sick", note: "" });
  const submit = async () => {
    try {
      const { data } = await api.post("/leaves/absence", form);
      // Owners have no approver — their absence is recorded, not sent for sign-off.
      toast.success(data?.status === "approved" ? "Absence recorded" : "Absence reported — your approver was notified");
      setOpen(false);
      setForm({ reason: "sick", note: "" });
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not report"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          data-testid="report-absence-button"
          title="Same-day unplanned absence -- no approval needed"
          className="kr-pop flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium"
        >
          <WarningOctagon size={16} weight="bold" /> Report Absence Today
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-cardlg border border-nm-edge/40">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Report Absence Today</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Sends an immediate notification to your approver — no advance notice needed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="label-mono text-muted-foreground">Reason</label>
            <select data-testid="absence-reason-select" className={`${inp} mt-1`} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {ABSENCE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <textarea data-testid="absence-note-input" className={inp} rows={2} placeholder="Optional note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <DialogFooter>
          <button data-testid="absence-submit" onClick={submit} className="kr-lift rounded-pill bg-kr-ink px-5 py-2.5 text-sm font-medium text-white transition-all">Notify Now</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ASK-4 (2026-09-12) — ImpactDialog + ACTION_META removed.

   The founder's call: per-request AI Impact Analysis is not the useful
   question. Asking "what does THIS leave request do to cover" in
   isolation cannot answer what actually matters -- the combined effect
   of every pending / approved absence on the team over a period. A
   report has to be a report, not a per-card modal.

   The retired dialog fetched GET /leaves/:id/impact and let the
   approver reassign / extend / monitor specific tasks that the
   requester was blocking. All of it left with the button. The global
   version lives on the tracker as ASK-5 (Low, parked -- not yet
   ideated), so the report can come back in one place rather than
   twelve. Backend routes were left in place -- deleting them is a
   separate cleanup pass once ASK-5 has landed on a shape.

   Icons that left with this: Sparkle, ArrowsClockwise, CalendarPlus,
   Eye, CircleNotch. All were private to ImpactDialog. */

// ASK-6/-7 (2026-09-12): named export so Desk and Team can render individual
// leave requests without duplicating the card markup. The default export
// (the Leave page) is scheduled for retirement once the register move lands.
/* `mine` — the card is on the requester's own Leave page: it can answer the
   approver's question and withdraw the request (2026-09-19). */
export function LeaveCard({ lv, canAct, onRefresh, highlight, mine = false }) {
  const [action, setAction] = useState(null); // reject | info
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawNote, setWithdrawNote] = useState("");
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();
  // Show the server's answer on the card at once, then reload to confirm: a
  // slow list reload used to leave "Info Requested" up after the answer was
  // saved (seen in the browser, 2026-09-19).
  const applyNow = (updated) => {
    if (!updated?.id) return;
    qc.setQueriesData({ queryKey: ["leaves"] }, (old) => (
      Array.isArray(old) ? old.map((x) => (x.id === updated.id ? updated : x)) : old));
  };

  const answer = async () => {
    if (!reply.trim()) return toast.error("Write your answer first");
    setSending(true);
    try {
      const { data } = await api.post(`/leaves/${lv.id}/respond`, { note: reply.trim() });
      applyNow(data);
      toast.success("Answer sent — it's back with your approver");
      setReply("");
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not send"); }
    finally { setSending(false); }
  };

  const withdraw = async () => {
    setSending(true);
    try {
      const { data } = await api.post(`/leaves/${lv.id}/withdraw`, { note: withdrawNote.trim() });
      applyNow(data);
      toast.success("Request withdrawn — your approver was told");
      setWithdrawing(false); setWithdrawNote("");
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not withdraw"); }
    finally { setSending(false); }
  };
  // ASK-4 (2026-09-12): impactOpen state removed with the dialog itself.
  const st = STATUS_META[lv.status] || STATUS_META.pending;

  const decide = async (kind) => {
    try {
      await api.post(`/leaves/${lv.id}/${kind}`, { note });
      toast.success(kind === "approve" ? "Approved" : kind === "reject" ? "Rejected" : "Info requested");
      setAction(null); setNote("");
      // ASK-4: no auto-open on approve any more -- the Impact dialog is gone.
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  const StatusIcon = st.icon;
  return (
    <div data-testid={`leave-card-${lv.id}`} className={`kr-bento p-5 ${highlight ? "ring-2 ring-neutral-900/70 ring-offset-2" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${st.tone}`} data-testid={`leave-status-${lv.id}`}>
          <StatusIcon size={11} weight="bold" aria-hidden="true" /> {st.label}
        </span>
        <span className={`${CHIP} ${QUIET_CHIP}`} data-testid={`leave-type-${lv.id}`}>
          <CalendarBlank size={11} weight="bold" aria-hidden="true" /> {typeLabel(lv.leave_type)}
        </span>
        {lv.day_portion === "half" && <span className={`${CHIP} ${QUIET_CHIP}`}>Half day</span>}
        {lv.is_emergency && (
          <span className={`${CHIP} bg-rose-50 text-rose-700 ring-rose-100`}>
            <WarningOctagon size={11} weight="bold" aria-hidden="true" /> Emergency
          </span>
        )}
      </div>
      <p className="text-base font-semibold leading-tight text-neutral-900">{lv.user_name}</p>
      <p className="mt-1 text-sm tabular-nums text-neutral-800" data-testid={`leave-range-${lv.id}`}>{fmtRange(lv)}</p>
      {lv.reason && <p className="mt-1 text-sm text-neutral-500">{lv.reason}</p>}
      <p className="mt-2.5 flex items-center gap-1.5 text-xs text-neutral-500">
        <Clock size={12} weight="bold" aria-hidden="true" /> {timeAgo(lv.created_at)}{lv.approver_name ? ` · Approver: ${lv.approver_name}` : ""}
      </p>
      {/* The question, and — once given — the answer, kept together so both
          sides can read the whole exchange (2026-09-19). */}
      {lv.info_note && (lv.status === "info_requested" || lv.reply_note) && (
        <div className="mt-3 flex items-start gap-2 rounded-2xl bg-violet-50/80 px-3 py-2.5 text-xs text-violet-950 ring-1 ring-inset ring-violet-100" data-testid={`leave-info-note-${lv.id}`}>
          <ChatCircleText size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-violet-700" />
          <p><span className="font-semibold">{lv.approver_name ? `${lv.approver_name} asked` : "Info requested"}:</span> {lv.info_note}</p>
        </div>
      )}
      {lv.reply_note && (
        <div className="mt-2 flex items-start gap-2 rounded-2xl bg-white/70 px-3 py-2.5 text-xs text-neutral-800 ring-1 ring-inset ring-neutral-200" data-testid={`leave-reply-note-${lv.id}`}>
          <PaperPlaneTilt size={14} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-neutral-500" />
          <p><span className="font-semibold">{mine ? "Your answer" : `${(lv.user_name || "They").split(" ")[0]} answered`}:</span> {lv.reply_note}</p>
        </div>
      )}
      {lv.status === "cancelled" && lv.withdrawn_note && (
        <p className="mt-2 text-xs text-neutral-500" data-testid={`leave-withdrawn-note-${lv.id}`}>Withdrawn: {lv.withdrawn_note}</p>
      )}

      {/* The requester's side: answer the question, or take the request back. */}
      {mine && lv.status === "info_requested" && (
        <div className={`mt-3 space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`} data-testid={`leave-reply-${lv.id}`}>
          <textarea data-testid={`leave-reply-input-${lv.id}`} className={`${DRAWER_FIELD} resize-none text-sm`} rows={2}
            aria-label="Your answer" placeholder="Your answer" maxLength={1000}
            value={reply} onChange={(e) => setReply(e.target.value)} />
          <button onClick={answer} disabled={sending} data-testid={`leave-reply-send-${lv.id}`}
            className={`flex h-10 w-full items-center justify-center gap-1.5 rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" /> {sending ? "Sending…" : "Send answer"}
          </button>
        </div>
      )}
      {mine && canWithdraw(lv) && (
        withdrawing ? (
          <div className={`mt-3 space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`} data-testid={`leave-withdraw-confirm-${lv.id}`}>
            <p className="text-sm font-semibold text-neutral-900">Withdraw this request?</p>
            <p className="text-xs text-neutral-500">
              {lv.status === "approved"
                ? "It's approved — withdrawing takes it off the calendar, and your approver is told."
                : "Your approver is told, and it stays in your history as withdrawn."}
            </p>
            <input data-testid={`leave-withdraw-note-${lv.id}`} className={`${DRAWER_FIELD} text-sm`} maxLength={500}
              placeholder="Why? (optional)" aria-label="Reason for withdrawing"
              value={withdrawNote} onChange={(e) => setWithdrawNote(e.target.value)} />
            <div className="flex gap-2">
              <button onClick={withdraw} disabled={sending} data-testid={`leave-withdraw-go-${lv.id}`}
                className={`flex h-10 flex-1 items-center justify-center rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${MAROON_PILL}`}>
                {sending ? "Withdrawing…" : "Withdraw"}
              </button>
              <button onClick={() => { setWithdrawing(false); setWithdrawNote(""); }} data-testid={`leave-withdraw-keep-${lv.id}`}
                className={`h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>Keep it</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setWithdrawing(true)} data-testid={`leave-withdraw-${lv.id}`}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-neutral-600 underline-offset-2 hover:text-neutral-900 hover:underline">
            <ArrowCounterClockwise size={13} weight="bold" aria-hidden="true" /> Withdraw request
          </button>
        )
      )}

      {/* ASK-4 (2026-09-12): The per-card AI Impact Analysis button and
          its ImpactDialog have been removed. The founder's call was
          that "impact" is not a per-request question -- analysing one
          leave in isolation can't answer what the combined leave does
          to team cover. The team-level version is on the backlog as
          ASK-5 (Low priority, parked). */}

      {canAct && lv.status !== "approved" && lv.status !== "rejected" && lv.status !== "cancelled" && (
        <div className="mt-4">
          {!action ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => decide("approve")} data-testid={`leave-approve-${lv.id}`}
                className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
                <CheckCircle size={16} weight="bold" aria-hidden="true" /> Approve
              </button>
              <button onClick={() => setAction("reject")} data-testid={`leave-reject-${lv.id}`} className={LEAVE_SECONDARY}>
                <XCircle size={16} weight="bold" aria-hidden="true" /> Reject
              </button>
              <button onClick={() => setAction("info")} data-testid={`leave-info-${lv.id}`} className={LEAVE_SECONDARY}>
                <ChatCircleText size={16} weight="bold" aria-hidden="true" /> Info
              </button>
            </div>
          ) : (
            /* Reject or ask for info, inline: a gray track holding the glass
               field. Rejecting is the one final "no", so it commits in maroon;
               a question goes out in ink. */
            <div className={`space-y-2.5 rounded-[1.25rem] p-3 ${DRAWER_TRACK}`}>
              <textarea data-testid={`leave-note-${lv.id}`} className={`${DRAWER_FIELD} resize-none text-sm`} rows={2} autoFocus
                aria-label={action === "reject" ? "Reason for rejection" : "What info do you need?"}
                placeholder={action === "reject" ? "Reason for rejection (optional)" : "What info do you need?"}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => decide(action === "reject" ? "reject" : "request-info")} data-testid={`leave-confirm-${lv.id}`}
                  className={`flex h-10 flex-1 items-center justify-center rounded-pill px-4 text-sm font-medium ${action === "reject" ? MAROON_PILL : INK_PILL}`}>
                  {action === "reject" ? "Confirm reject" : "Send request"}
                </button>
                <button onClick={() => { setAction(null); setNote(""); }} data-testid={`leave-cancel-${lv.id}`}
                  className={`h-10 rounded-pill px-4 text-sm font-medium text-neutral-800 transition-colors hover:bg-white ${GLASS_PILL}`}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ASK-8 (2026-09-12): exported so Settings › Operations can render it.
// The founder's decision: routing config belongs with approval gates in
// Settings, not on a work surface. Suggested landing per ASK-8 is
// Settings > Operations ("Pipelines, stages, task templates and approval
// gates" already covers this shape).
export function ApproverConfig({ roleOptions, members }) {
  const qc = useQueryClient();
  const { tenant, refreshTenant } = useAuth();
  const [map, setMap] = useState(() => ({ ...(tenant?.leave_approvers || {}) }));
  const nonOwner = members.filter((m) => m.role !== "owner");
  const save = async () => {
    try {
      await api.patch("/tenant/leave-approvers", { approvers: map });
      toast.success("Leave approvers saved");
      if (refreshTenant) await refreshTenant();
      qc.invalidateQueries({ queryKey: ["leaves"] });
    } catch (e) { toast.error(e.response?.data?.detail || "Save failed"); }
  };
  return (
    <div className="nm-tile p-5" data-testid="leave-approver-config">
      <div className="flex items-center gap-2 mb-1"><Gear size={18} weight="regular" aria-hidden="true" className="text-muted-foreground" />
        <h3 className="text-base font-medium">Leave Approvers by Department</h3></div>
      <p className="text-xs text-muted-foreground mb-3">Choose who approves leave for each role. If an employee has a Reporting Manager set (in People → Employees), that manager takes priority. Otherwise this mapping is used, then the Owner.</p>
      <div className="space-y-2">
        {roleOptions.filter((r) => r.key !== "owner").map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-sm font-semibold">{r.label}</span>
            <select data-testid={`leave-approver-${r.key}`}
                className="kr-pressed h-11 w-full rounded-pill bg-transparent px-4 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kr-gold))]"
              value={map[r.key] || ""} onChange={(e) => setMap({ ...map, [r.key]: e.target.value })}>
              <option value="">Owner (default)</option>
              {nonOwner.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              {members.filter((m) => m.role === "owner").map((m) => <option key={m.id} value={m.id}>{m.name} · owner</option>)}
            </select>
          </div>
        ))}
      </div>
        <button onClick={save} data-testid="save-leave-approvers" className="kr-pop mt-4 flex h-11 items-center rounded-pill px-5 text-sm font-medium">Save approvers</button>
    </div>
  );
}

/* How many days a request covers: both ends counted, a half day as 0.5. */
function daysOf(lv) {
  if (lv.day_portion === "half") return 0.5;
  const a = new Date(`${lv.from_date}T00:00:00`);
  const b = new Date(`${lv.to_date || lv.from_date}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

const OPEN = new Set(["pending", "info_requested"]);

/* 2026-09-19 — YOUR leave, as a page again.
   ASK-6 (2026-09-12) retired /leave and sent every link to Team, which holds
   the company's leave register — so on a phone the "Leave" tile opened Team
   and there was no way to ask for time off at all. This is the requester's
   side: raise a request, report an absence today, and see every request you
   have made. Approving is not here — approvers do that in Approvals — and the
   approver-per-department setting stays in Settings › Operations (ASK-8). */
export default function Leave() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const highlightId = params.get("leave");

  const mineQ = useQuery({ queryKey: ["leaves", "mine"], queryFn: () => api.get("/leaves?scope=mine").then((r) => r.data) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["leaves"] });
  const mine = mineQ.data || [];

  const today = new Date().toISOString().slice(0, 10);
  const year = today.slice(0, 4);
  // Coming up = still waiting on a decision, or approved and not over yet.
  const upcoming = mine
    .filter((lv) => OPEN.has(lv.status) || (lv.status === "approved" && (lv.to_date || lv.from_date) >= today))
    .sort((a, b) => (a.from_date || "").localeCompare(b.from_date || ""));
  const upcomingIds = new Set(upcoming.map((lv) => lv.id));
  const history = mine
    .filter((lv) => !upcomingIds.has(lv.id))
    .sort((a, b) => (b.from_date || "").localeCompare(a.from_date || ""));

  const waiting = mine.filter((lv) => OPEN.has(lv.status)).length;
  const approvedThisYear = mine.filter((lv) => lv.status === "approved" && (lv.from_date || "").startsWith(year));
  const daysOff = approvedThisYear.reduce((n, lv) => n + daysOf(lv), 0);

  // A notification about a request lands here (?leave=<id>): bring it into view.
  useEffect(() => {
    if (!highlightId || !mine.length) return;
    const t = setTimeout(() => document.querySelector(`[data-testid="leave-card-${highlightId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    return () => clearTimeout(t);
  }, [highlightId, mine.length]);

  const actions = (
    <div className="flex flex-wrap items-center gap-2" data-testid="leave-actions">
      <RequestLeaveDialog onDone={refresh} />
      <AbsenceDialog onDone={refresh} />
    </div>
  );

  const stat = (label, value, testid) => (
    <div className="kr-pressed flex min-w-0 flex-1 flex-col rounded-2xl px-4 py-3" data-testid={testid}>
      <span className="font-display text-2xl tabular-nums leading-none">{value}</span>
      <span className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
    </div>
  );

  return (
    <div data-testid="leave-page">
      {/* KM-31 · laid out like every other room: the title pinned on a phone
          with the actions under it; the desktop header carries them beside. */}
      <StickyHeader className="mb-3 flex flex-col gap-4 lg:hidden" data-testid="leave-mobile-header">
        <h1 className="font-display text-3xl">Leave</h1>
        {actions}
      </StickyHeader>
      <div className="hidden lg:block">
        <PageHeader eyebrow="Time off" title="Leave">{actions}</PageHeader>
      </div>

      <div className="mb-6 flex gap-3" data-testid="leave-summary">
        {stat("Waiting", waiting, "leave-summary-waiting")}
        {stat(`Days off in ${year}`, daysOff % 1 ? daysOff.toFixed(1) : daysOff, "leave-summary-days")}
        {stat("Requests", mine.length, "leave-summary-total")}
      </div>

      {mineQ.isLoading && !mineQ.data ? (
        <p className="text-sm text-muted-foreground">Loading your leave…</p>
      ) : mine.length === 0 ? (
        <EmptyState title="No leave requests yet"
          hint="Use Request Leave to plan time off, or Report Absence Today if you can't come in." />
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section data-testid="leave-upcoming">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Coming up and waiting
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {upcoming.map((lv) => <LeaveCard key={lv.id} lv={lv} canAct={false} mine onRefresh={refresh} highlight={lv.id === highlightId} />)}
              </div>
            </section>
          )}
          {history.length > 0 && (
            <section data-testid="leave-history">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">History</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {history.map((lv) => <LeaveCard key={lv.id} lv={lv} canAct={false} mine onRefresh={refresh} highlight={lv.id === highlightId} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

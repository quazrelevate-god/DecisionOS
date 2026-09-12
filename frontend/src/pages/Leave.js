import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { PageHeader, StickyHeader, Chip, EmptyState } from "../components/common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import {
  AirplaneTakeoff, Plus, WarningOctagon, CheckCircle, XCircle, ChatCircleText, Gear, GearSix, Clock,
  // ASK-4 (2026-09-12): AI Impact Analysis retired at the leave-card level.
  // Sparkle / ArrowsClockwise / CalendarPlus / Eye / CircleNotch were the
  // ImpactDialog's private icon vocabulary and left with it.
} from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";

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
const STATUS_META = {
  pending: { label: "Pending", cls: "border-[0.5px] border-kr-ink text-foreground" },
  approved: { label: "Approved", cls: "bg-kr-ink text-white" },
  rejected: { label: "Rejected", cls: "bg-kr-accent text-white" },
  info_requested: { label: "Info Requested", cls: "border-[0.5px] border-kr-accent text-kr-accent" },
};
const inp = "w-full nm-field px-3 py-2 text-sm";
const typeLabel = (k) => LEAVE_TYPES.find((t) => t.key === k)?.label || k;
const fmtRange = (lv) => lv.from_date === lv.to_date ? lv.from_date : `${lv.from_date} → ${lv.to_date}`;

function RequestLeaveDialog({ onDone }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ leave_type: "casual", from_date: today, to_date: today, day_portion: "full", reason: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async () => {
    if (!form.from_date || !form.to_date) return toast.error("Pick dates");
    if (form.to_date < form.from_date) return toast.error("End date cannot be before start date");
    try {
      await api.post("/leaves", form);
      toast.success("Leave request submitted");
      setOpen(false);
      setForm({ leave_type: "casual", from_date: today, to_date: today, day_portion: "full", reason: "" });
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not submit"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          data-testid="request-leave-button"
          title="Plan time off in advance -- needs approval"
          className="kr-pop flex h-11 items-center gap-2 rounded-pill px-4 text-sm font-medium"
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
      await api.post("/leaves/absence", form);
      toast.success("Absence reported — your approver was notified");
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
export function LeaveCard({ lv, canAct, onRefresh, highlight }) {
  const [action, setAction] = useState(null); // reject | info
  const [note, setNote] = useState("");
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

  return (
    <div data-testid={`leave-card-${lv.id}`} className={`kr-bento p-4 ${highlight ? "ring-2 ring-kr-ink ring-offset-2" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Chip value={st.label} className={st.cls} data-testid={`leave-status-${lv.id}`} />
        <Chip value={typeLabel(lv.leave_type)} className="bg-kr-ink text-white" />
        {lv.day_portion === "half" && <Chip value="Half day" className="bg-white" />}
        {lv.is_emergency && <Chip value="Emergency" className="bg-black text-white" />}
      </div>
      <p className="font-medium text-base leading-tight">{lv.user_name}</p>
      <p className="text-sm mt-1" data-testid={`leave-range-${lv.id}`}>{fmtRange(lv)}</p>
      {lv.reason && <p className="text-sm text-muted-foreground mt-1">{lv.reason}</p>}
      <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1">
        <Clock size={11} weight="bold" /> {timeAgo(lv.created_at)}{lv.approver_name ? ` · Approver: ${lv.approver_name}` : ""}
      </p>
      {lv.status === "info_requested" && lv.info_note && (
        <div className="mt-2 rounded-control border-l-[3px] border-kr-accent bg-kr-accent/8 p-2.5 text-xs" data-testid={`leave-info-note-${lv.id}`}>
          <span className="font-semibold">Info requested:</span> {lv.info_note}
        </div>
      )}

      {/* ASK-4 (2026-09-12): The per-card AI Impact Analysis button and
          its ImpactDialog have been removed. The founder's call was
          that "impact" is not a per-request question -- analysing one
          leave in isolation can't answer what the combined leave does
          to team cover. The team-level version is on the backlog as
          ASK-5 (Low priority, parked). */}

      {canAct && lv.status !== "approved" && lv.status !== "rejected" && (
        <div className="mt-3">
          {!action ? (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => decide("approve")} data-testid={`leave-approve-${lv.id}`}
                className="kr-lift flex flex-1 items-center justify-center gap-1 rounded-pill bg-kr-ink py-2 text-xs font-medium text-white transition-all">
                <CheckCircle size={14} weight="bold" /> Approve
              </button>
              <button onClick={() => setAction("reject")} data-testid={`leave-reject-${lv.id}`}
                className="nm-btn flex items-center gap-1 px-3 py-2 text-xs font-medium">
                <XCircle size={14} weight="bold" /> Reject
              </button>
              <button onClick={() => setAction("info")} data-testid={`leave-info-${lv.id}`}
                className="flex items-center gap-1 rounded-pill border border-kr-accent px-3 py-2 text-xs font-medium text-kr-accent transition-colors hover:bg-kr-accent/10">
                <ChatCircleText size={14} weight="bold" /> Info
              </button>
            </div>
          ) : (
            <div className="nm-inset space-y-2 p-2.5">
              <textarea data-testid={`leave-note-${lv.id}`} className={`${inp} text-xs`} rows={2}
                placeholder={action === "reject" ? "Reason for rejection (optional)" : "What info do you need?"}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => decide(action === "reject" ? "reject" : "request-info")} data-testid={`leave-confirm-${lv.id}`}
                  className="kr-lift flex-1 rounded-pill bg-kr-ink py-2 text-xs font-medium text-white transition-colors">
                  {action === "reject" ? "Confirm Reject" : "Send Request"}
                </button>
                <button onClick={() => { setAction(null); setNote(""); }} className="nm-btn px-3 py-2 text-xs font-medium">Cancel</button>
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

export default function Leave({ embedded = false }) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const highlightId = params.get("leave");
  const [tab, setTab] = useState("mine");
  const canApprove = user?.role === "owner" || hasPerm(user, "leave_approve");
  const canManage = hasPerm(user, "team_manage");
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const mineQ = useQuery({ queryKey: ["leaves", "mine"], queryFn: () => api.get("/leaves?scope=mine").then((r) => r.data) });
  const apprQ = useQuery({ queryKey: ["leaves", "approvals"], queryFn: () => api.get("/leaves?scope=approvals").then((r) => r.data), enabled: canApprove });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), enabled: canManage });

  const refresh = () => qc.invalidateQueries({ queryKey: ["leaves"] });
  const mine = mineQ.data || [];
  const approvals = apprQ.data || [];
  const pendingApprovals = approvals.filter((l) => l.status === "pending" || l.status === "info_requested");

  /* KM-31 — Settings is NOT a tab. My Leave and Approvals are two views of the
     same list; Settings is a configuration screen that happens to live on this
     page, and putting it in the same track said all three were peers. It is a
     gear beside the track now, which is the shape every app uses for exactly
     this and needs no label to be understood. */
  const TABS = [
    { key: "mine", label: "My Leave", n: mine.length },
    ...(canApprove ? [{ key: "approvals", label: "Approvals", n: pendingApprovals.length }] : []),
  ];

  const actions = (
    <div className="flex items-center gap-2">
      <AbsenceDialog onDone={refresh} />
      <RequestLeaveDialog onDone={refresh} />
    </div>
  );

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end mb-4">{actions}</div>
      ) : (
        <>
          {/* KM-31 · the standalone page, laid out like every other room: the
              title pinned, and one row under it carrying both actions. They
              used to be black slabs floating to the right of the heading; they
              are the page's own controls, so they wear its raised material. */}
          <StickyHeader className="mb-3 flex flex-col gap-2.5 lg:hidden" data-testid="leave-mobile-header">
            <h1 className="font-display text-3xl">Leaves</h1>
            <div className="flex items-center gap-2">{actions}</div>
          </StickyHeader>
          <div className="hidden lg:block">
            <PageHeader eyebrow="Time off & availability" title="Leave & Absence">{actions}</PageHeader>
          </div>
        </>
      )}

      {/* KM-3 — the TRACK is .kr-pressed, not .nm-inset. nm-inset is a flat
          sunken FILL (bg-nm-sunken, border-0) and draws no shadow at all, so
          the bar read as a grey rectangle with good buttons sitting on it.
          .kr-pressed is the real thing: a dark inset from the top-left and a
          white inset from the bottom-right, i.e. the same held-pressed look a
          selected control has. The raised .kr-pop tab then sits IN a genuine
          depression instead of on a painted panel, which is the whole point of
          a segmented track. */}
      <div className="mb-6 flex items-center gap-2">
      <div className="kr-pressed flex w-fit items-center gap-1 rounded-pill p-1" data-testid="leave-tabs">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`leave-tab-${t.key}`}
            className={`flex h-9 items-center gap-2 rounded-pill px-4 text-sm font-medium transition-all ${tab === t.key ? "kr-pop text-foreground" : "text-foreground/60 hover:text-foreground/85"}`}>
            {t.label}
            {t.n > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-pill px-1 font-mono text-[10px] tabular-nums opacity-60">{t.n}</span>}
          </button>
        ))}
      </div>
        {/* KM-31 — the gear. Separated from the track by a gap because it is a
            different kind of thing: the track picks WHICH list, this opens the
            configuration behind them. .kr-pressed while open, matching the
            "selected means pushed in" grammar the rest of the app uses. */}
        {canManage && (
          <button
            type="button"
            onClick={() => setTab((cur) => (cur === "settings" ? "mine" : "settings"))}
            aria-pressed={tab === "settings"}
            aria-label="Leave settings"
            data-testid="leave-settings-toggle"
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tab === "settings" ? "kr-pressed" : "kr-pop"}`}
          >
            <GearSix size={18} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>

      {tab === "mine" && (
        <div className="grid md:grid-cols-2 gap-4" data-testid="my-leaves">
          {mine.length === 0 && <EmptyState title="No leave requests yet" hint="Use Request Leave to plan time off, or Report Absence Today for emergencies." />}
          {mine.map((lv) => <LeaveCard key={lv.id} lv={lv} canAct={false} onRefresh={refresh} highlight={lv.id === highlightId} />)}
        </div>
      )}

      {tab === "approvals" && canApprove && (
        <div className="grid md:grid-cols-2 gap-4" data-testid="leave-approvals">
          {approvals.length === 0 && <EmptyState title="Nothing to approve" hint="Leave requests routed to you will appear here." />}
          {approvals.map((lv) => <LeaveCard key={lv.id} lv={lv} canAct onRefresh={refresh} highlight={lv.id === highlightId} />)}
        </div>
      )}

      {tab === "settings" && canManage && (
        <ApproverConfig roleOptions={roleOptions} members={usersQ.data || []} />
      )}
    </div>
  );
}

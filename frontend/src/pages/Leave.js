import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { timeAgo } from "../lib/format";
import { toast } from "sonner";
import {
  AirplaneTakeoff, Plus, WarningOctagon, CheckCircle, XCircle, ChatCircleText, Gear, Clock,
  Sparkle, ArrowsClockwise, CalendarPlus, Eye, CircleNotch,
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
  pending: { label: "Pending", cls: "bg-status-pending-bg text-text" },
  approved: { label: "Approved", cls: "bg-success-600 text-white" },
  rejected: { label: "Rejected", cls: "bg-primary text-primary-foreground" },
  info_requested: { label: "Info Requested", cls: "bg-orange-500 text-white" },
};
const inp = "w-full border border-hairline px-3 py-2 text-sm text-label focus:outline-none focus:shadow-xs";
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
        <button data-testid="request-leave-button" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
          <Plus size={16} weight="bold" /> Request Leave
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md">
        <DialogHeader>
          <DialogTitle className="tracking-tight">Request Leave</DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">Your reporting manager or department approver will be notified.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-label text-text-secondary">Leave Type</label>
            <select data-testid="leave-type-select" className={`${inp} mt-1`} value={form.leave_type} onChange={set("leave_type")}>
              {LEAVE_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-label text-text-secondary">From</label>
              <input data-testid="leave-from-date" type="date" className={`${inp} mt-1`} value={form.from_date} onChange={set("from_date")} />
            </div>
            <div>
              <label className="text-label text-text-secondary">To</label>
              <input data-testid="leave-to-date" type="date" className={`${inp} mt-1`} value={form.to_date} onChange={set("to_date")} />
            </div>
          </div>
          <div className="flex border border-hairline rounded-md" data-testid="leave-portion-toggle">
            <button type="button" onClick={() => setForm({ ...form, day_portion: "full" })}
              className={`flex-1 px-3 py-2 text-xs font-semibold  transition-colors ${form.day_portion === "full" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>Full Day</button>
            <button type="button" onClick={() => setForm({ ...form, day_portion: "half" })}
              className={`flex-1 px-3 py-2 text-xs font-semibold  border-l border-hairline transition-colors ${form.day_portion === "half" ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>Half Day</button>
          </div>
          <textarea data-testid="leave-reason-input" className={inp} rows={2} placeholder="Reason" value={form.reason} onChange={set("reason")} />
        </div>
        <DialogFooter>
          <button data-testid="leave-submit" onClick={submit} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">Submit</button>
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
        <button data-testid="report-absence-button" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-hairline hover:shadow-sm transition-all rounded-md">
          <WarningOctagon size={16} weight="bold" /> Report Absence Today
        </button>
      </DialogTrigger>
      <DialogContent className="border border-hairline rounded-md">
        <DialogHeader>
          <DialogTitle className="tracking-tight">Report Absence Today</DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">Sends an immediate notification to your approver — no advance notice needed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-label text-text-secondary">Reason</label>
            <select data-testid="absence-reason-select" className={`${inp} mt-1`} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
              {ABSENCE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <textarea data-testid="absence-note-input" className={inp} rows={2} placeholder="Optional note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <DialogFooter>
          <button data-testid="absence-submit" onClick={submit} className="bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">Notify Now</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_META = {
  reassign: { label: "Reassign", cls: "bg-primary text-primary-foreground", Icon: ArrowsClockwise },
  extend: { label: "Extend due date", cls: "bg-orange-500 text-white", Icon: CalendarPlus },
  monitor: { label: "Monitor", cls: "bg-surface", Icon: Eye },
};

function ImpactDialog({ leaveId, open, onOpenChange, onApplied }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [applied, setApplied] = useState({});
  const [edits, setEdits] = useState({});

  useEffect(() => {
    if (!open) { setData(null); setApplied({}); setEdits({}); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.get(`/leaves/${leaveId}/impact`);
        if (cancelled) return;
        setData(res.data);
        const e = {};
        (res.data.tasks || []).forEach((t) => {
          e[t.id] = { assignee_id: t.assignee_id || "", due_date: t.suggested_due_date || "" };
        });
        setEdits(e);
      } catch (err) {
        if (!cancelled) toast.error(err.response?.data?.detail || "Could not analyze impact");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [open, leaveId]);

  const applyOne = async (t) => {
    const e = edits[t.id] || {};
    try {
      if (t.action === "reassign") {
        if (!e.assignee_id) return toast.error("Pick a teammate to reassign to");
        await api.patch(`/tasks/${t.id}`, { assignee_id: e.assignee_id });
      } else if (t.action === "extend") {
        if (!e.due_date) return toast.error("Pick a new due date");
        await api.patch(`/tasks/${t.id}`, { due_date: e.due_date });
      } else { return; }
      setApplied((a) => ({ ...a, [t.id]: true }));
      toast.success(t.action === "reassign" ? "Task reassigned" : "Due date extended");
      onApplied?.();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not apply"); }
  };

  const applyAll = async () => {
    const pending = (data?.tasks || []).filter((t) => (t.action === "reassign" || t.action === "extend") && !applied[t.id]);
    for (const t of pending) { await applyOne(t); }  // eslint-disable-line no-await-in-loop
  };

  const tasks = data?.tasks || [];
  const members = data?.available_members || [];
  const recCount = tasks.filter((t) => t.action === "reassign" || t.action === "extend").length;
  const allApplied = recCount > 0 && tasks.filter((t) => t.action === "reassign" || t.action === "extend").every((t) => applied[t.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-hairline rounded-md max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="leave-impact-dialog">
        <DialogHeader>
          <DialogTitle className="tracking-tight flex items-center gap-2">
            <Sparkle size={18} weight="fill" className="text-primary-text" /> AI Impact Analysis
          </DialogTitle>
          <DialogDescription className="text-sm text-text-secondary">
            {data ? `What ${data.person}'s leave affects, and how to keep work on track.` : "Checking active tasks affected by this leave…"}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12 text-text-secondary" data-testid="impact-loading">
            <CircleNotch size={34} weight="bold" className="animate-spin text-primary-text" />
            <p className="text-sm mt-3">Analyzing workload &amp; suggesting cover…</p>
          </div>
        )}

        {!loading && data && (
          <div className="space-y-3" data-testid="impact-content">
            {data.summary && (
              <div className="border border-hairline bg-background p-3 text-sm rounded-md" data-testid="impact-summary">{data.summary}</div>
            )}
            {tasks.length === 0 && (
              <EmptyState title="No tasks at risk" hint="This person has no active tasks due during their absence. You're all set." />
            )}
            {tasks.map((t) => {
              const m = ACTION_META[t.action] || ACTION_META.monitor;
              const e = edits[t.id] || {};
              const done = applied[t.id];
              return (
                <div key={t.id} data-testid={`impact-task-${t.id}`} className="border border-hairline p-3 rounded-md">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm leading-tight">{t.title}</p>
                      <p className="text-label text-text-secondary mt-1">
                        {t.priority} · {(t.status || "").replace("_", " ")}{t.due_date ? ` · due ${t.due_date}` : ""}
                      </p>
                    </div>
                    <Chip value={m.label} className={`${m.cls} shrink-0`} />
                  </div>
                  {t.reason && <p className="text-xs text-text-secondary mt-2">{t.reason}</p>}

                  {t.action === "reassign" && !done && (
                    <div className="flex gap-2 mt-2.5">
                      <select data-testid={`impact-assignee-${t.id}`} className={`${inp} text-sm`}
                        value={e.assignee_id} onChange={(ev) => setEdits((s) => ({ ...s, [t.id]: { ...s[t.id], assignee_id: ev.target.value } }))}>
                        <option value="">Select teammate…</option>
                        {members.map((mm) => <option key={mm.id} value={mm.id}>{mm.name} · {mm.role}</option>)}
                      </select>
                      <button onClick={() => applyOne(t)} data-testid={`impact-apply-${t.id}`}
                        className="shrink-0 flex items-center gap-1 bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
                        <ArrowsClockwise size={13} weight="bold" /> Reassign
                      </button>
                    </div>
                  )}
                  {t.action === "extend" && !done && (
                    <div className="flex gap-2 mt-2.5">
                      <input type="date" data-testid={`impact-date-${t.id}`} className={`${inp} text-sm`}
                        value={e.due_date} onChange={(ev) => setEdits((s) => ({ ...s, [t.id]: { ...s[t.id], due_date: ev.target.value } }))} />
                      <button onClick={() => applyOne(t)} data-testid={`impact-apply-${t.id}`}
                        className="shrink-0 flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 text-xs font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
                        <CalendarPlus size={13} weight="bold" /> Extend
                      </button>
                    </div>
                  )}
                  {done && (
                    <p className="mt-2.5 flex items-center gap-1 text-xs font-semibold text-status-completed-fg" data-testid={`impact-done-${t.id}`}>
                      <CheckCircle size={14} weight="fill" /> Applied
                    </p>
                  )}
                </div>
              );
            })}

            {recCount > 0 && (
              <DialogFooter className="pt-1">
                <button onClick={applyAll} disabled={allApplied} data-testid="impact-apply-all"
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all disabled:opacity-50 rounded-md">
                  <Sparkle size={15} weight="fill" /> {allApplied ? "All applied" : `Apply all recommended (${recCount})`}
                </button>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LeaveCard({ lv, canAct, onRefresh, highlight }) {
  const [action, setAction] = useState(null); // reject | info
  const [note, setNote] = useState("");
  const [impactOpen, setImpactOpen] = useState(false);
  const st = STATUS_META[lv.status] || STATUS_META.pending;

  const decide = async (kind) => {
    try {
      await api.post(`/leaves/${lv.id}/${kind}`, { note });
      toast.success(kind === "approve" ? "Approved" : kind === "reject" ? "Rejected" : "Info requested");
      setAction(null); setNote("");
      if (kind === "approve") setImpactOpen(true);  // auto-run AI impact analysis
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  return (
    <div data-testid={`leave-card-${lv.id}`} className={`rounded-lg border border-hairline bg-surface p-4 transition-all ${highlight ? "ring-4 ring-ring ring-offset-2" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Chip value={st.label} className={st.cls} data-testid={`leave-status-${lv.id}`} />
        <Chip value={typeLabel(lv.leave_type)} />
        {lv.day_portion === "half" && <Chip value="Half day" />}
        {lv.is_emergency && <Chip value="Emergency" />}
      </div>
      <p className="font-bold text-base leading-tight">{lv.user_name}</p>
      <p className="text-sm mt-1" data-testid={`leave-range-${lv.id}`}>{fmtRange(lv)}</p>
      {lv.reason && <p className="text-sm text-text-secondary mt-1">{lv.reason}</p>}
      <p className="text-label text-text-secondary mt-2 flex items-center gap-1">
        <Clock size={11} weight="bold" /> {timeAgo(lv.created_at)}{lv.approver_name ? ` · Approver: ${lv.approver_name}` : ""}
      </p>
      {lv.status === "info_requested" && lv.info_note && (
        <div className="mt-2 border border-orange-500 bg-orange-50 p-2 text-xs rounded-md" data-testid={`leave-info-note-${lv.id}`}>
          <span className="font-semibold">Info requested:</span> {lv.info_note}
        </div>
      )}

      {canAct && lv.status === "approved" && (
        <button onClick={() => setImpactOpen(true)} data-testid={`leave-impact-btn-${lv.id}`}
          className="mt-3 w-full flex items-center justify-center gap-1.5 bg-primary text-primary-foreground py-1.5 text-xs font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
          <Sparkle size={14} weight="fill" /> AI Impact Analysis
        </button>
      )}
      {canAct && <ImpactDialog leaveId={lv.id} open={impactOpen} onOpenChange={setImpactOpen} onApplied={onRefresh} />}

      {canAct && lv.status !== "approved" && lv.status !== "rejected" && (
        <div className="mt-3">
          {!action ? (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => decide("approve")} data-testid={`leave-approve-${lv.id}`}
                className="flex-1 flex items-center justify-center gap-1 bg-success-600 text-white py-1.5 text-xs font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">
                <CheckCircle size={14} weight="bold" /> Approve
              </button>
              <button onClick={() => setAction("reject")} data-testid={`leave-reject-${lv.id}`}
                className="flex items-center gap-1 bg-surface py-1.5 px-3 text-xs font-semibold border border-hairline hover:bg-destructive-tint transition-colors rounded-md">
                <XCircle size={14} weight="bold" /> Reject
              </button>
              <button onClick={() => setAction("info")} data-testid={`leave-info-${lv.id}`}
                className="flex items-center gap-1 bg-surface py-1.5 px-3 text-xs font-semibold border border-hairline hover:bg-orange-500 hover:text-white transition-colors rounded-md">
                <ChatCircleText size={14} weight="bold" /> Info
              </button>
            </div>
          ) : (
            <div className="space-y-2 border border-dashed border-hairline p-2 rounded-md">
              <textarea data-testid={`leave-note-${lv.id}`} className={`${inp} text-xs`} rows={2}
                placeholder={action === "reject" ? "Reason for rejection (optional)" : "What info do you need?"}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => decide(action === "reject" ? "reject" : "request-info")} data-testid={`leave-confirm-${lv.id}`}
                  className="flex-1 bg-primary text-primary-foreground py-1.5 text-xs font-semibold border border-hairline hover:bg-primary-hover transition-colors rounded-md">
                  {action === "reject" ? "Confirm Reject" : "Send Request"}
                </button>
                <button onClick={() => { setAction(null); setNote(""); }} className="px-3 py-1.5 text-xs font-semibold border border-hairline hover:bg-surface-hover rounded-md">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ApproverConfig({ roleOptions, members }) {
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
    <div className="rounded-lg border border-hairline bg-surface p-4" data-testid="leave-approver-config">
      <div className="flex items-center gap-2 mb-1"><Gear size={18} weight="bold" className="text-primary-text" />
        <h3 className="text-lg font-extrabold tracking-tight">Leave Approvers by Department</h3></div>
      <p className="text-xs text-text-secondary mb-3">Choose who approves leave for each role. If an employee has a Reporting Manager set (in People → Employees), that manager takes priority. Otherwise this mapping is used, then the Owner.</p>
      <div className="space-y-2">
        {roleOptions.filter((r) => r.key !== "owner").map((r) => (
          <div key={r.key} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-sm font-semibold">{r.label}</span>
            <select data-testid={`leave-approver-${r.key}`} className={inp}
              value={map[r.key] || ""} onChange={(e) => setMap({ ...map, [r.key]: e.target.value })}>
              <option value="">Owner (default)</option>
              {nonOwner.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              {members.filter((m) => m.role === "owner").map((m) => <option key={m.id} value={m.id}>{m.name} · owner</option>)}
            </select>
          </div>
        ))}
      </div>
      <button onClick={save} data-testid="save-leave-approvers" className="mt-4 bg-primary text-primary-foreground px-5 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all rounded-md">Save Approvers</button>
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

  const TABS = [
    { key: "mine", label: "My Leave", n: mine.length },
    ...(canApprove ? [{ key: "approvals", label: "Approvals", n: pendingApprovals.length }] : []),
    ...(canManage ? [{ key: "settings", label: "Settings" }] : []),
  ];

  const actions = (
    <div className="flex items-center gap-3 flex-wrap">
      <AbsenceDialog onDone={refresh} />
      <RequestLeaveDialog onDone={refresh} />
    </div>
  );

  return (
    <div>
      {embedded ? (
        <div className="flex justify-end mb-4">{actions}</div>
      ) : (
        <PageHeader eyebrow="Time off & availability" title="Leave & Absence">{actions}</PageHeader>
      )}

      <div className="flex border border-hairline mb-6 w-fit rounded-md" data-testid="leave-tabs">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`leave-tab-${t.key}`}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold  border-r border-hairline last:border-r-0 transition-colors ${tab === t.key ? "bg-primary text-primary-foreground" : "bg-surface hover:bg-surface-hover"}`}>
            {t.label}
            {t.n > 0 && <span className={`min-w-5 h-5 px-1 flex items-center justify-center text-[10px] border border-hairline ${tab === t.key ? "bg-surface text-text" : "bg-primary text-primary-foreground"} rounded-md`}>{t.n}</span>}
          </button>
        ))}
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

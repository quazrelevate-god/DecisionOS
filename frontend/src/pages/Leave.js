import { useState } from "react";
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
  pending: { label: "Pending", cls: "bg-brand-yellow text-black" },
  approved: { label: "Approved", cls: "bg-green-600 text-white" },
  rejected: { label: "Rejected", cls: "bg-brand-red text-white" },
  info_requested: { label: "Info Requested", cls: "bg-orange-500 text-white" },
};
const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";
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
        <button data-testid="request-leave-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> Request Leave
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Request Leave</DialogTitle>
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
          <div className="flex border border-black" data-testid="leave-portion-toggle">
            <button type="button" onClick={() => setForm({ ...form, day_portion: "full" })}
              className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${form.day_portion === "full" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Full Day</button>
            <button type="button" onClick={() => setForm({ ...form, day_portion: "half" })}
              className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider border-l border-black transition-colors ${form.day_portion === "half" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>Half Day</button>
          </div>
          <textarea data-testid="leave-reason-input" className={inp} rows={2} placeholder="Reason" value={form.reason} onChange={set("reason")} />
        </div>
        <DialogFooter>
          <button data-testid="leave-submit" onClick={submit} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Submit</button>
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
        <button data-testid="report-absence-button" className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <WarningOctagon size={16} weight="bold" /> Report Absence Today
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">Report Absence Today</DialogTitle>
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
          <button data-testid="absence-submit" onClick={submit} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Notify Now</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveCard({ lv, canAct, onRefresh, highlight }) {
  const [action, setAction] = useState(null); // reject | info
  const [note, setNote] = useState("");
  const st = STATUS_META[lv.status] || STATUS_META.pending;

  const decide = async (kind) => {
    try {
      await api.post(`/leaves/${lv.id}/${kind}`, { note });
      toast.success(kind === "approve" ? "Approved" : kind === "reject" ? "Rejected" : "Info requested");
      setAction(null); setNote("");
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
  };

  return (
    <div data-testid={`leave-card-${lv.id}`} className={`card-brutal p-4 transition-all ${highlight ? "ring-4 ring-brand-red ring-offset-2" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Chip value={st.label} className={st.cls} data-testid={`leave-status-${lv.id}`} />
        <Chip value={typeLabel(lv.leave_type)} className="bg-brand-blue text-white" />
        {lv.day_portion === "half" && <Chip value="Half day" className="bg-white" />}
        {lv.is_emergency && <Chip value="Emergency" className="bg-black text-white" />}
      </div>
      <p className="font-heading font-bold text-base leading-tight">{lv.user_name}</p>
      <p className="text-sm mt-1" data-testid={`leave-range-${lv.id}`}>{fmtRange(lv)}</p>
      {lv.reason && <p className="text-sm text-muted-foreground mt-1">{lv.reason}</p>}
      <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1">
        <Clock size={11} weight="bold" /> {timeAgo(lv.created_at)}{lv.approver_name ? ` · Approver: ${lv.approver_name}` : ""}
      </p>
      {lv.status === "info_requested" && lv.info_note && (
        <div className="mt-2 border border-orange-500 bg-orange-50 p-2 text-xs" data-testid={`leave-info-note-${lv.id}`}>
          <span className="font-semibold">Info requested:</span> {lv.info_note}
        </div>
      )}

      {canAct && lv.status !== "approved" && lv.status !== "rejected" && (
        <div className="mt-3">
          {!action ? (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => decide("approve")} data-testid={`leave-approve-${lv.id}`}
                className="flex-1 flex items-center justify-center gap-1 bg-green-600 text-white py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
                <CheckCircle size={14} weight="bold" /> Approve
              </button>
              <button onClick={() => setAction("reject")} data-testid={`leave-reject-${lv.id}`}
                className="flex items-center gap-1 bg-white py-1.5 px-3 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-brand-red hover:text-white transition-colors">
                <XCircle size={14} weight="bold" /> Reject
              </button>
              <button onClick={() => setAction("info")} data-testid={`leave-info-${lv.id}`}
                className="flex items-center gap-1 bg-white py-1.5 px-3 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-orange-500 hover:text-white transition-colors">
                <ChatCircleText size={14} weight="bold" /> Info
              </button>
            </div>
          ) : (
            <div className="space-y-2 border border-dashed border-black/40 p-2">
              <textarea data-testid={`leave-note-${lv.id}`} className={`${inp} text-xs`} rows={2}
                placeholder={action === "reject" ? "Reason for rejection (optional)" : "What info do you need?"}
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <button onClick={() => decide(action === "reject" ? "reject" : "request-info")} data-testid={`leave-confirm-${lv.id}`}
                  className="flex-1 bg-brand-ink text-white py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-brand-red transition-colors">
                  {action === "reject" ? "Confirm Reject" : "Send Request"}
                </button>
                <button onClick={() => { setAction(null); setNote(""); }} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-black/5">Cancel</button>
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
    <div className="card-brutal p-4" data-testid="leave-approver-config">
      <div className="flex items-center gap-2 mb-1"><Gear size={18} weight="bold" className="text-brand-red" />
        <h3 className="font-heading text-lg font-extrabold uppercase tracking-tight">Leave Approvers by Department</h3></div>
      <p className="text-xs text-muted-foreground mb-3">Choose who approves leave for each role. If an employee has a Reporting Manager set (in People → Employees), that manager takes priority. Otherwise this mapping is used, then the Owner.</p>
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
      <button onClick={save} data-testid="save-leave-approvers" className="mt-4 bg-brand-ink text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Save Approvers</button>
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

      <div className="flex border border-black mb-6 w-fit" data-testid="leave-tabs">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`leave-tab-${t.key}`}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold uppercase tracking-wider border-r border-black last:border-r-0 transition-colors ${tab === t.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            {t.label}
            {t.n > 0 && <span className={`min-w-5 h-5 px-1 flex items-center justify-center text-[10px] border border-black ${tab === t.key ? "bg-white text-black" : "bg-brand-red text-white"}`}>{t.n}</span>}
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

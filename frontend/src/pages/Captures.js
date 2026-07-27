import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { timeAgo, fullTime } from "../lib/format";
import { toast } from "sonner";
import {
  WhatsappLogo, CheckCircle, XCircle, ArrowsClockwise, Question, PencilSimple,
  ShieldWarning, Clock, FilePdf, ChatText,
} from "@phosphor-icons/react";

const inp = "w-full border border-black px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-red";

const CLASS_STYLE = {
  invoice: "bg-brand-blue text-white", payment: "bg-brand-blue text-white",
  purchase: "bg-purple-600 text-white", sales: "bg-green-600 text-white",
  hr: "bg-pink-600 text-white", meeting: "bg-amber-500 text-black",
  decision: "bg-brand-ink text-white", approval: "bg-brand-red text-white",
  workflow: "bg-teal-600 text-white", operational_task: "bg-black/10 text-black",
  other: "bg-black/10 text-black",
};
const STATUS_TABS = [
  { key: "pending_review", label: "Pending" },
  { key: "needs_attention", label: "Needs Attention" },
  { key: "clarification_requested", label: "Clarification" },
  { key: "executed", label: "Filed" },
  { key: "rejected", label: "Rejected" },
];
const ROLE_OPTS = ["sales", "finance", "purchase", "hr", "operations", "owner"];
const PRIORITY_OPTS = ["low", "medium", "high"];

export default function Captures() {
  return (
    <div>
      <PageHeader eyebrow="WhatsApp Smart Capture — review before it becomes work" title="Review Queue" />
      <CaptureReview />
    </div>
  );
}

export function CaptureReview() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState("pending_review");
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["captures", tab],
    queryFn: () => api.get(`/captures?status=${tab}`).then((r) => r.data),
    refetchInterval: 20000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["captures"] });
    qc.invalidateQueries({ queryKey: ["captures-pending"] });
    qc.invalidateQueries({ queryKey: ["tasks"] });
  };

  return (
    <div data-testid="captures-page">
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUS_TABS.map((t) => (
          <button key={t.key} data-testid={`capture-tab-${t.key}`} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border-2 border-black transition-all ${tab === t.key ? "bg-brand-ink text-white shadow-brutal-sm" : "bg-white hover:bg-black/5"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" hint="WhatsApp messages appear here as AI-drafted items for your review before anything is created." />
      ) : (
        <div className="space-y-4">
          {rows.map((c) => <CaptureCard key={c.id} c={c} user={user} onChange={refresh} />)}
        </div>
      )}
    </div>
  );
}

function CaptureCard({ c, user, onChange }) {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    classification: c.classification, reviewer_role: c.reviewer_role,
    priority: c.priority, due_date: c.due_date ? c.due_date.slice(0, 10) : "",
    assignee_id: c.assignee_id || "", summary: c.summary || "", text: c.text || "",
  });
  const [busy, setBusy] = useState(false);
  const isOwner = user?.role === "owner";
  const isPending = c.status === "pending_review" || c.status === "clarification_requested" || c.status === "needs_attention";
  const blockedByEscalation = c.needs_owner && !isOwner;

  const members = useQuery({
    queryKey: ["users"],
    enabled: edit,
    queryFn: () => api.get("/users").then((r) => r.data).catch(() => []),
  });
  const roleMembers = (members.data || []).filter((m) => m.role === form.reviewer_role);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); onChange(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Action failed"); }
    finally { setBusy(false); }
  };

  const saveEdit = () => act(async () => {
    await api.patch(`/captures/${c.id}`, {
      classification: form.classification, reviewer_role: form.reviewer_role,
      priority: form.priority, assignee_id: form.assignee_id || null,
      due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
      summary: form.summary, text: form.text,
    });
    setEdit(false);
  }, "Saved");

  const approve = () => act(() => api.post(`/captures/${c.id}/approve`), "Approved & actioned");
  const reject = () => {
    const reason = window.prompt("Reason for rejecting?") || "";
    return act(() => api.post(`/captures/${c.id}/reject`, { reason }), "Rejected");
  };
  const clarify = () => {
    const note = window.prompt("What clarification do you need? (sent back on WhatsApp)");
    if (!note) return;
    return act(() => api.post(`/captures/${c.id}/clarify`, { note }), "Clarification requested");
  };
  const reassign = () => {
    const role = window.prompt(`Reassign to which role? (${ROLE_OPTS.join(", ")})`, c.reviewer_role);
    if (!role) return;
    return act(() => api.post(`/captures/${c.id}/reassign`, { reviewer_role: role }), "Reassigned");
  };

  const recCounts = c.records
    ? `${(c.records.invoices || []).length} invoice, ${(c.records.payments || []).length} payment, ${(c.records.contacts || []).length} contact`
    : null;

  return (
    <div data-testid={`capture-card-${c.id}`} className="card-brutal p-4">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 shrink-0 flex items-center justify-center border-2 border-black bg-green-50">
          {c.kind === "pdf" || c.kind === "image" ? <FilePdf size={20} weight="bold" className="text-green-600" /> : <ChatText size={20} weight="bold" className="text-green-600" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Chip value={c.classification.replace("_", " ")} className={CLASS_STYLE[c.classification] || "bg-black/10 text-black"} />
            <Chip value={`review: ${c.reviewer_role}`} className="bg-white border-black" />
            <Chip value={c.priority} className={c.priority === "high" ? "bg-brand-red text-white" : "bg-white border-black"} />
            {c.needs_owner && <span data-testid={`capture-escalated-${c.id}`} className="inline-flex items-center gap-1 text-xs font-bold uppercase text-brand-red"><ShieldWarning size={13} weight="bold" /> Owner approval</span>}
            {c.status === "needs_attention" && <Chip value="needs attention" className="bg-amber-500 text-black" />}
            {c.auto_processed && <Chip value="auto-filed" className="bg-green-600 text-white" />}
            {c.duplicate_of && <Chip value="possible duplicate" className="bg-amber-500 text-black" />}
            {c.confidence != null && (() => {
              const pct = Math.round(c.confidence * 100);
              const tone = pct >= 80 ? "bg-green-600 text-white" : pct >= 50 ? "bg-amber-500 text-black" : "bg-brand-red text-white";
              return <span data-testid={`capture-confidence-${c.id}`} className={`label-mono px-1.5 py-0.5 rounded ${tone}`} title="AI confidence in this classification">AI {pct}%</span>;
            })()}
            <span className="label-mono text-muted-foreground ml-auto flex items-center gap-1" title={c.sender_name ? `${c.sender_name}${c.wa_from ? " · " + c.wa_from : ""} · ${fullTime(c.created_at)}` : fullTime(c.created_at)}>
              <WhatsappLogo size={12} weight="bold" />
              {c.sender_name
                ? <span data-testid={`capture-sender-${c.id}`}>{c.sender_name}{c.sender_role ? ` (${c.sender_role})` : ""}</span>
                : (c.wa_from || "whatsapp")}
              {" · "}{timeAgo(c.created_at)}
            </span>
          </div>
          <p className="text-sm font-semibold mt-2">{c.summary}</p>
          {c.intent && <p className="text-xs text-muted-foreground">Intent: {c.intent}</p>}
          {(() => {
            const parts = [];
            parts.push(`Read as “${(c.classification || "other").replace(/_/g, " ")}”`);
            if (c.reviewer_perm === "finance") parts.push("money item → routed to Finance");
            else if (c.reviewer_role) parts.push(`routed to the ${c.reviewer_role} team`);
            if (c.priority) parts.push(`${c.priority} priority`);
            if (c.needs_owner) parts.push("needs owner sign-off");
            if (c.confidence != null) {
              const pct = Math.round(c.confidence * 100);
              parts.push(pct >= 80 ? `high AI confidence (${pct}%)` : pct >= 50 ? `medium confidence (${pct}%) — worth a check` : `low confidence (${pct}%) — please verify`);
            }
            return (
              <p data-testid={`capture-why-${c.id}`} className="text-xs text-muted-foreground mt-1 border-l-2 border-black/20 pl-2">
                <span className="font-semibold text-foreground">Why AI routed this:</span> {parts.join(" · ")}.
              </p>
            );
          })()}
          {c.text && <p className="text-xs text-muted-foreground mt-1 italic">“{c.text.slice(0, 200)}”</p>}
          {recCounts && <p className="label-mono text-muted-foreground mt-1">Extracted: {recCounts}{c.amount ? ` · ₹${Number(c.amount).toLocaleString()}` : ""}</p>}
          {!recCounts && c.amount ? <p className="label-mono text-muted-foreground mt-1">Amount: ₹{Number(c.amount).toLocaleString()}</p> : null}
          {c.attention_reason && <p className="text-xs text-amber-700 mt-1">⚠ {c.attention_reason}</p>}
          {c.escalate_reason && <p className="text-xs text-brand-red mt-1">⚠ {c.escalate_reason}</p>}
          {c.clarification_note && <p className="text-xs text-amber-700 mt-1">Note: {c.clarification_note}</p>}
          {c.file_url && (
            <div className="mt-2">
              <p className="label-mono text-muted-foreground text-[10px] mb-1">Under review — original file</p>
              {c.kind === "image" ? (
                <a href={`${process.env.REACT_APP_BACKEND_URL}${c.file_url}`} target="_blank" rel="noopener noreferrer" data-testid={`capture-file-${c.id}`} title="Open full image" className="inline-block border-2 border-black hover:shadow-brutal-sm transition-all">
                  <img src={`${process.env.REACT_APP_BACKEND_URL}${c.file_url}`} alt={c.filename || "attachment"} className="h-28 w-auto object-cover" />
                </a>
              ) : (
                <a href={`${process.env.REACT_APP_BACKEND_URL}${c.file_url}`} target="_blank" rel="noopener noreferrer" data-testid={`capture-file-${c.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black px-3 py-1.5 hover:bg-brand-yellow transition-colors">
                  <FilePdf size={14} weight="bold" /> Open file{c.filename ? ` · ${c.filename}` : ""}
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {edit && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 border-t border-black/20 pt-3" data-testid={`capture-edit-${c.id}`}>
          <label className="block"><span className="label-mono text-muted-foreground text-[10px]">Type</span>
            <input className={inp} value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} /></label>
          <label className="block"><span className="label-mono text-muted-foreground text-[10px]">Reviewer role</span>
            <select className={inp} value={form.reviewer_role} onChange={(e) => setForm({ ...form, reviewer_role: e.target.value, assignee_id: "" })}>
              {ROLE_OPTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select></label>
          <label className="block"><span className="label-mono text-muted-foreground text-[10px]">Priority</span>
            <select className={inp} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select></label>
          <label className="block"><span className="label-mono text-muted-foreground text-[10px]">Due date</span>
            <input type="date" className={inp} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></label>
          {roleMembers.length > 0 && (
            <label className="block col-span-2"><span className="label-mono text-muted-foreground text-[10px]">Assign to</span>
              <select className={inp} value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}>
                <option value="">Auto (by workload)</option>
                {roleMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
          )}
          <label className="block col-span-2 md:col-span-4"><span className="label-mono text-muted-foreground text-[10px]">Summary</span>
            <input className={inp} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></label>
        </div>
      )}

      {isPending && (
        <div className="flex flex-wrap gap-2 mt-3 border-t border-black/20 pt-3">
          {edit ? (
            <>
              <button data-testid={`capture-save-${c.id}`} disabled={busy} onClick={saveEdit} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-brand-ink text-white flex items-center gap-1"><PencilSimple size={14} weight="bold" /> Save</button>
              <button onClick={() => setEdit(false)} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-white flex items-center gap-1">Cancel</button>
            </>
          ) : (
            <>
              <button data-testid={`capture-approve-${c.id}`} disabled={busy || blockedByEscalation}
                title={blockedByEscalation ? "Requires Owner approval" : ""}
                onClick={approve} className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 flex items-center gap-1 ${blockedByEscalation ? "bg-black/20 text-black/50 cursor-not-allowed" : "bg-green-600 text-white"}`}>
                <CheckCircle size={14} weight="bold" /> Approve
              </button>
              <button data-testid={`capture-edit-btn-${c.id}`} disabled={busy} onClick={() => setEdit(true)} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-white flex items-center gap-1"><PencilSimple size={14} weight="bold" /> Edit</button>
              <button data-testid={`capture-reassign-${c.id}`} disabled={busy} onClick={reassign} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-white flex items-center gap-1"><ArrowsClockwise size={14} weight="bold" /> Reassign</button>
              <button data-testid={`capture-clarify-${c.id}`} disabled={busy} onClick={clarify} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-white flex items-center gap-1"><Question size={14} weight="bold" /> Clarify</button>
              <button data-testid={`capture-reject-${c.id}`} disabled={busy} onClick={reject} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border-2 border-black transition-all hover:shadow-brutal-sm disabled:opacity-50 bg-white text-brand-red flex items-center gap-1"><XCircle size={14} weight="bold" /> Reject</button>
            </>
          )}
          {blockedByEscalation && <span className="text-xs text-brand-red self-center">Waiting for Owner — you can still edit or reassign.</span>}
        </div>
      )}

      {c.status === "executed" && <p className="text-xs text-green-700 mt-2 flex items-center gap-1"><CheckCircle size={13} weight="bold" /> {c.auto_processed ? "Auto-filed" : "Approved"} & created ({c.result_ref?.type})</p>}
      {c.status === "rejected" && <p className="text-xs text-brand-red mt-2 flex items-center gap-1"><XCircle size={13} weight="bold" /> Rejected</p>}
    </div>
  );
}

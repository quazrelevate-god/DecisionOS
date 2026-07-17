import { useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { timeAgo, fullTime } from "../lib/format";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { userPerms } from "../lib/perms";
import { toast } from "sonner";
import { TaskBoard, NewTaskDialog } from "./Tasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import Workflows from "./Workflows";
import Leave from "./Leave";
import {
  CheckCircle, Camera, Microphone, Stop, ChatCircleText,
  Sparkle, Plus, Trash, ArrowUp, ArrowDown, Robot, PencilSimple, ListChecks, CaretDown, ArrowsOutSimple,
  ArrowBendUpRight, WarningCircle, ChatText, ArrowRight, Kanban, ListChecks as ListIcon,
  Paperclip, UserCircle, ShieldCheck, Tag, ClockCounterClockwise,
  ArrowClockwise, XCircle, LockKey, X, AirplaneTakeoff, MagnifyingGlassPlus,
} from "@phosphor-icons/react";

const CTRL = "flex items-center justify-center gap-1.5 px-2 lg:px-4 py-2 text-[11px] lg:text-sm font-semibold uppercase tracking-wider border border-black transition-all text-center leading-tight";

const WORK_TABS = [
  { key: "all", label: "All" },
  { key: "operational", label: "Operational" },
  { key: "sales", label: "Sales" },
  { key: "purchase", label: "Purchase" },
  { key: "production", label: "Production" },
  { key: "finance", label: "Finance" },
  { key: "completed", label: "Completed" },
];

const STATUS_OPTIONS = [
  { key: "todo", label: "Not Started" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Under Review" },
  { key: "done", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const STATUS_LABEL = {
  todo: "Not Started", in_progress: "In Progress", waiting: "Waiting",
  review: "Under Review", done: "Completed", cancelled: "Cancelled", blocked: "Pending Approval",
};
const PROGRESS_OPTIONS = [0, 25, 50, 75, 100];
const isTerminal = (t) => t.status === "done" || t.status === "cancelled";
const isOverdue = (t) => t.due_date && new Date(t.due_date) < new Date() && !isTerminal(t);

function UpdateForm({ taskId, stepId, members, roleOptions, onDone, onCancel }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState("note");
  const [toId, setToId] = useState("");
  const [toRole, setToRole] = useState("");
  const [busy, setBusy] = useState(false);
  const inp = "w-full border border-black px-2 py-1.5 text-sm focus:outline-none";

  const submit = async () => {
    if (!text.trim()) return toast.error("Write what you found");
    if (action === "handoff" && !toId && !toRole) return toast.error("Pick a person or team to hand off to");
    setBusy(true);
    try {
      await api.post(`/tasks/${taskId}/updates`, {
        text, step_id: stepId || null, action,
        to_id: toId || null, to_role: toId ? null : (toRole || null),
      });
      toast.success(action === "note" ? "Update logged" : action === "escalate" ? "Escalated to owner" : "Handed off");
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not post update"); }
    finally { setBusy(false); }
  };

  const ACTIONS = [
    { key: "note", label: "Log note", icon: ChatText },
    { key: "handoff", label: "Hand off", icon: ArrowBendUpRight },
    { key: "escalate", label: "Escalate", icon: WarningCircle },
  ];

  return (
    <div className="border border-dashed border-black/50 p-3 space-y-2 bg-brand-paper" data-testid={`update-form-${taskId}`}>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid={`update-text-${taskId}`}
        placeholder="What did you find? e.g. Logistics can't commit to a date — supplier issue" className={inp} />
      <div className="flex gap-1">
        {ACTIONS.map((a) => (
          <button key={a.key} onClick={() => setAction(a.key)} data-testid={`update-action-${a.key}-${taskId}`}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black transition-colors ${action === a.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <a.icon size={13} weight="bold" /> {a.label}
          </button>
        ))}
      </div>
      {action === "handoff" && (
        <div className="space-y-2">
          <select className={inp} value={toId} onChange={(e) => setToId(e.target.value)} data-testid={`update-member-${taskId}`}>
            <option value="">— Hand off to a team member —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
          </select>
          <select className={inp} value={toRole} onChange={(e) => setToRole(e.target.value)} disabled={!!toId}>
            <option value="">…or to a whole team {toId ? "(member selected)" : ""}</option>
            {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
      )}
      {action === "escalate" && <p className="text-xs text-muted-foreground">This will alert the owner and create a follow-up for them.</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} data-testid={`update-submit-${taskId}`}
          className="flex-1 bg-brand-blue text-white py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">
          {busy ? "Posting…" : "Post"}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-black/5">Cancel</button>
      </div>
    </div>
  );
}

const UPDATE_ICON = { note: ChatText, handoff: ArrowBendUpRight, escalate: WarningCircle };

function TaskTrail({ t, members, roleOptions, onChange }) {
  const [open, setOpen] = useState(false);
  const updates = t.updates || [];
  return (
    <div className="mt-4 border-t border-black/10 pt-4" data-testid={`task-trail-${t.id}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 font-heading font-extrabold uppercase tracking-tight text-sm">
          <ChatCircleText size={16} weight="bold" className="text-brand-red" /> Activity &amp; Handoffs
        </span>
        {!open && (
          <button onClick={() => setOpen(true)} data-testid={`add-update-${t.id}`}
            className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-yellow transition-colors">
            <Plus size={12} weight="bold" /> Update / Escalate
          </button>
        )}
      </div>
      {updates.length > 0 && (
        <ul className="space-y-2 mb-2" data-testid={`trail-list-${t.id}`}>
          {updates.map((u) => {
            const Icon = UPDATE_ICON[u.kind] || ChatText;
            return (
              <li key={u.id} className="flex items-start gap-2 border border-black/15 p-2.5">
                <Icon size={15} weight="bold" className={`mt-0.5 shrink-0 ${u.kind === "escalate" ? "text-brand-red" : u.kind === "handoff" ? "text-brand-blue" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  {u.step_text && <p className="label-mono text-muted-foreground">On: {u.step_text}</p>}
                  <p className="text-sm">{u.text}</p>
                  <p className="label-mono text-muted-foreground mt-1">
                    {u.author_name}
                    {u.to_name && <> <ArrowRight size={10} weight="bold" className="inline" /> {u.to_name}</>}
                    {" · "}{new Date(u.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <UpdateForm taskId={t.id} stepId={null} members={members} roleOptions={roleOptions}
          onDone={() => { setOpen(false); onChange(); }} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

function ExecutionPlan({ t, onChange, members = [], roleOptions = [] }) {
  const plan = t.execution_plan;
  const [steps, setSteps] = useState(plan?.steps || []);
  const [editing, setEditing] = useState(!plan || plan.status === "draft");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [ask, setAsk] = useState({});
  const [updStep, setUpdStep] = useState(null);
  const [viewStep, setViewStep] = useState(null);

  useEffect(() => {
    setSteps(t.execution_plan?.steps || []);
    setEditing(!t.execution_plan || t.execution_plan.status === "draft");
  }, [t.execution_plan?.updated_at, t.execution_plan?.status]);  // eslint-disable-line

  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${t.id}/execution-plan/generate`);
      setSteps(data.execution_plan.steps);
      setEditing(true);
      toast.success("AI drafted an execution plan — review & customize");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not generate plan"); }
    finally { setBusy(false); }
  };

  const startManual = () => {
    setSteps([{ id: `new-${Date.now()}`, text: "", done: false }]);
    setEditing(true);
  };

  const cancelAIPlan = async () => {
    setBusy(true);
    try {
      await api.delete(`/tasks/${t.id}/execution-plan`);
      setSteps([]);
      setEditing(false);
      toast.success("Plan cleared");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not clear plan"); }
    finally { setBusy(false); }
  };

  const persist = async (nextSteps, status) => {
    const { data } = await api.patch(`/tasks/${t.id}/execution-plan`, {
      steps: nextSteps.map((s) => ({ id: s.id, text: s.text, done: !!s.done })), status,
    });
    setSteps(data.execution_plan.steps);
    onChange();
    return data;
  };

  const save = async (status) => {
    if (steps.some((s) => !s.text.trim())) return toast.error("Steps can't be empty");
    setBusy(true);
    try {
      await persist(steps, status);
      if (status === "accepted") setEditing(false);
      toast.success(status === "accepted" ? "Plan accepted — let's execute" : "Plan saved");
    } catch { toast.error("Save failed"); }
    finally { setBusy(false); }
  };

  const toggle = async (i) => {
    const ns = steps.map((s, idx) => (idx === i ? { ...s, done: !s.done } : s));
    setSteps(ns);
    try { await persist(ns, "accepted"); } catch { toast.error("Update failed"); }
  };

  const editStep = (i, v) => setSteps(steps.map((s, idx) => (idx === i ? { ...s, text: v } : s)));
  const removeStep = (i) => setSteps(steps.filter((_, idx) => idx !== i));
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const ns = [...steps];
    [ns[i], ns[j]] = [ns[j], ns[i]];
    setSteps(ns);
  };
  const addStep = () => {
    if (!newStep.trim()) return;
    setSteps([...steps, { id: `new-${Date.now()}`, text: newStep.trim(), done: false }]);
    setNewStep("");
  };

  const askAI = async (s) => {
    setAsk((a) => ({ ...a, [s.id]: { loading: true } }));
    try {
      const { data } = await api.post(`/tasks/${t.id}/steps/ask`, { step_text: s.text });
      setAsk((a) => ({ ...a, [s.id]: { data } }));
    } catch { setAsk((a) => ({ ...a, [s.id]: { error: true } })); }
  };

  const inp = "flex-1 border border-black px-2 py-1.5 text-sm focus:outline-none";

  if (!plan && !steps.length) {
    return (
      <div className="mt-4 flex flex-col sm:flex-row gap-2" data-testid={`exec-plan-empty-${t.id}`}>
        <button onClick={generate} disabled={busy} data-testid={`generate-plan-${t.id}`}
          className="flex-1 flex items-center justify-center gap-2 border border-dashed border-brand-red text-brand-red py-2.5 text-sm font-semibold uppercase tracking-wider hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50">
          <Sparkle size={16} weight="bold" /> {busy ? "Thinking…" : "Generate AI plan"}
        </button>
        <button onClick={startManual} disabled={busy} data-testid={`manual-plan-${t.id}`}
          className="flex-1 flex items-center justify-center gap-2 border border-dashed border-black text-brand-ink py-2.5 text-sm font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50">
          <PencilSimple size={16} weight="bold" /> Manual execution plan
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-black/10 pt-4" data-testid={`exec-plan-${t.id}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 font-heading font-extrabold uppercase tracking-tight text-sm">
          <ListChecks size={16} weight="bold" className="text-brand-red" /> AI Execution Guide
        </span>
        <span className="label-mono" data-testid={`exec-progress-${t.id}`}>{progress}%</span>
      </div>
      <div className="h-2 bg-black/10 border border-black mb-3">
        <div className="h-full bg-brand-blue transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.id} data-testid={`exec-step-${t.id}-${i}`}>
            <div className={editing ? "flex flex-col sm:flex-row sm:items-start gap-2" : "flex items-start gap-2"}>
              {editing ? (
                <>
                  <textarea value={s.text} onChange={(e) => editStep(i, e.target.value)} rows={2}
                    className={`${inp} w-full resize-y leading-snug`} />
                  <div className="flex gap-1 shrink-0 self-end sm:self-start">
                    <button onClick={() => setViewStep(s)} data-testid={`exec-expand-${t.id}-${i}`} className="p-2 sm:p-1 border border-black hover:bg-brand-blue hover:text-white" title="View full"><ArrowsOutSimple size={14} weight="bold" /></button>
                    <button onClick={() => moveStep(i, -1)} className="p-2 sm:p-1 border border-black hover:bg-black/5" title="Up"><ArrowUp size={14} weight="bold" /></button>
                    <button onClick={() => moveStep(i, 1)} className="p-2 sm:p-1 border border-black hover:bg-black/5" title="Down"><ArrowDown size={14} weight="bold" /></button>
                    <button onClick={() => removeStep(i)} data-testid={`exec-remove-${t.id}-${i}`} className="p-2 sm:p-1 border border-black hover:bg-brand-red hover:text-white" title="Remove"><Trash size={14} weight="bold" /></button>
                  </div>
                </>
              ) : (
                <>
                  <button onClick={() => toggle(i)} data-testid={`exec-toggle-${t.id}-${i}`}
                    className={`w-5 h-5 shrink-0 mt-0.5 border border-black flex items-center justify-center ${s.done ? "bg-brand-ink text-white" : "bg-white"}`}>
                    {s.done && <CheckCircle size={13} weight="bold" />}
                  </button>
                  <button onClick={() => setViewStep(s)} data-testid={`exec-view-${t.id}-${i}`}
                    className={`text-sm flex-1 min-w-0 text-left break-words hover:underline decoration-dotted ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.text}</button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => askAI(s)} data-testid={`exec-ask-${t.id}-${i}`}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-yellow transition-colors">
                      <Sparkle size={12} weight="bold" /> Ask AI
                    </button>
                    <button onClick={() => setUpdStep(updStep === s.id ? null : s.id)} data-testid={`exec-update-${t.id}-${i}`}
                      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-blue hover:text-white transition-colors">
                      <ArrowBendUpRight size={12} weight="bold" /> Update
                    </button>
                  </div>
                </>
              )}
            </div>
            {updStep === s.id && (
              <div className="ml-7 mt-1.5 mb-2" data-testid={`exec-update-form-${t.id}-${i}`}>
                <UpdateForm taskId={t.id} stepId={s.id} members={members} roleOptions={roleOptions}
                  onDone={() => { setUpdStep(null); onChange(); }} onCancel={() => setUpdStep(null)} />
              </div>
            )}
            {ask[s.id] && (
              <div className="ml-7 mt-1.5 mb-2 border border-black bg-brand-paper p-2.5 text-xs" data-testid={`exec-ask-result-${t.id}-${i}`}>
                {ask[s.id].loading ? <p className="font-mono">AI is thinking…</p>
                  : ask[s.id].error ? <p className="text-brand-red">Couldn't fetch a suggestion.</p>
                  : (
                    <>
                      <p className="flex items-start gap-1.5"><Robot size={13} weight="bold" className="text-brand-blue mt-0.5 shrink-0" /><span>{ask[s.id].data.suggestion}</span></p>
                      {(ask[s.id].data.objections || []).length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          <p className="label-mono text-muted-foreground">If they push back:</p>
                          {ask[s.id].data.objections.map((o, k) => (
                            <p key={`${o.objection}-${k}`}><span className="font-semibold">“{o.objection}”</span> — {o.response}</p>
                          ))}
                        </div>
                      )}
                      <button onClick={() => setAsk((a) => ({ ...a, [s.id]: undefined }))} className="mt-2 label-mono text-brand-red">dismiss</button>
                    </>
                  )}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="flex gap-2 mt-3">
          <input value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStep()}
            placeholder="Add your own step…" data-testid={`exec-newstep-${t.id}`} className={inp} />
          <button onClick={addStep} data-testid={`exec-add-${t.id}`} className="px-3 border border-black hover:bg-black/5"><Plus size={14} weight="bold" /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {editing ? (
          <>
            <button onClick={() => save("accepted")} disabled={busy} data-testid={`exec-accept-${t.id}`}
              className="flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">
              <CheckCircle size={16} weight="bold" /> Accept plan
            </button>
            <button onClick={generate} disabled={busy} data-testid={`exec-regenerate-${t.id}`}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-yellow transition-colors disabled:opacity-50">
              <ArrowClockwise size={15} weight="bold" /> Regenerate
            </button>
            <button onClick={cancelAIPlan} disabled={busy} data-testid={`exec-cancel-plan-${t.id}`}
              className="flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black text-brand-red hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50">
              <XCircle size={15} weight="bold" /> Cancel plan
            </button>
          </>
        ) : (
          t.status !== "done" && (
            <button onClick={() => setEditing(true)} data-testid={`exec-edit-${t.id}`}
              className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-black px-4 py-2 hover:bg-brand-ink hover:text-white transition-colors">
              <PencilSimple size={15} weight="bold" /> Customize steps
            </button>
          )
        )}
      </div>

      <Dialog open={!!viewStep} onOpenChange={(o) => !o && setViewStep(null)}>
        <DialogContent className="border border-black rounded-none">
          <DialogHeader>
            <DialogTitle className="font-heading uppercase tracking-tight text-base flex items-center gap-2"><ListChecks size={18} weight="bold" className="text-brand-red" /> Execution Step</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" data-testid={`exec-step-detail-${t.id}`}>{viewStep?.text}</p>
          <p className="label-mono text-muted-foreground mt-1">Tap outside to close</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PRIORITY_AXES = [
  { key: "business_impact", label: "Impact", color: "bg-brand-blue" },
  { key: "revenue", label: "Revenue", color: "bg-green-600" },
  { key: "risk", label: "Risk", color: "bg-brand-red" },
  { key: "urgency", label: "Urgency", color: "bg-orange-500" },
];

function PriorityScoreBars({ scores }) {
  return (
    <div className="mt-3 border border-black/15 bg-black/[0.02] p-3" data-testid="priority-score-bars">
      <div className="flex items-center justify-between mb-2">
        <span className="label-mono text-muted-foreground flex items-center gap-1"><Sparkle size={12} weight="bold" className="text-brand-red" /> AI Priority</span>
        {scores.priority_score != null && (
          <span className="font-heading font-black text-lg leading-none" data-testid="priority-score-value">{scores.priority_score}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {PRIORITY_AXES.map((a) => (
          <div key={a.key} className="flex items-center gap-2" data-testid={`axis-${a.key}`}>
            <span className="label-mono w-16 shrink-0 text-muted-foreground">{a.label}</span>
            <div className="flex-1 h-2 bg-black/10 border border-black/20">
              <div className={`h-full ${a.color}`} style={{ width: `${scores[a.key] || 0}%` }} />
            </div>
            <span className="label-mono w-7 text-right">{scores[a.key] || 0}</span>
          </div>
        ))}
      </div>
      {scores.reason && <p className="text-xs text-muted-foreground mt-2 italic">{scores.reason}</p>}
    </div>
  );
}

function TaskCard({ t, onChange, members = [], roleOptions = [], scores, showAssignee = false, highlight = false }) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);
  const canApprove = t.approval_required && (user?.role === "owner" || user?.id === t.approver_id || (!t.approver_id && userPerms(user).includes("approvals")));
  const awaitingApproval = t.approval_required && t.approval_status !== "approved";
  const lockedForAssignee = awaitingApproval && !canApprove;

  const approveTask = async () => {
    try { await api.post(`/tasks/${t.id}/approve`); toast.success("Task approved"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not approve"); }
  };
  const rejectTask = async () => {
    const reason = window.prompt("What changes are needed? (optional)") ?? "";
    try { await api.post(`/tasks/${t.id}/reject`, { reason }); toast.success("Changes requested"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not reject"); }
  };
  const clarifyTask = async () => {
    const reason = window.prompt("What do you need clarified?") ?? "";
    if (!reason.trim()) return;
    try { await api.post(`/tasks/${t.id}/clarify`, { reason }); toast.success("Clarification requested"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not request clarification"); }
  };

  const upload = async (file, kind) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file, file.name || `${kind}.dat`);
    fd.append("kind", kind);
    try {
      await api.post(`/tasks/${t.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`${kind === "photo" ? "Photo" : "Voice reply"} added`);
      onChange();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const onPhoto = (e) => {
    const f = e.target.files?.[0];
    if (f) upload(f, "photo");
  };

  const toggleVoice = async () => {
    if (recording) {
      cancelledRef.current = false;
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        if (cancelledRef.current) { chunksRef.current = []; return; }
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        upload(new File([blob], "voice.webm"), "voice");
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      toast.error("Mic access denied");
    }
  };

  const cancelVoice = () => {
    cancelledRef.current = true;
    mediaRef.current?.stop();
    setRecording(false);
    toast("Recording discarded");
  };

  const complete = async () => {
    if (!window.confirm(`Mark "${t.title}" as complete? You can reopen it later if needed.`)) return;
    await api.patch(`/tasks/${t.id}`, { status: "done" });
    toast.success("Task completed");
    onChange();
  };

  const reopen = async () => {
    await api.patch(`/tasks/${t.id}`, { status: "in_progress", progress: 0 });
    toast.success("Task reopened — back in your work");
    onChange();
  };

  const setStatus = async (status) => {
    await api.patch(`/tasks/${t.id}`, { status });
    toast.success(`Status: ${STATUS_LABEL[status] || status}`);
    onChange();
  };
  const setProgress = async (progress) => {
    await api.patch(`/tasks/${t.id}`, { progress: Number(progress) });
    onChange();
  };

  const isOp = t.task_type === "operational" || !!t.op_category;
  const selCls = "border border-black px-2 py-1 text-xs font-mono bg-white focus:outline-none";

  return (
    <div id={`task-card-${t.id}`} data-testid={`mywork-task-${t.id}`} className={`card-brutal p-5 transition-all ${highlight ? "ring-4 ring-brand-red ring-offset-2 ring-offset-brand-paper" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading font-bold text-lg leading-tight">{t.title}</p>
        <Chip value={t.priority} />
      </div>
      {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
      {showAssignee && !isOp && (
        <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1" data-testid={`assignee-line-${t.id}`}>
          <UserCircle size={13} weight="bold" />
          {t.assignee_name ? t.assignee_name : (t.assignee_role ? `${t.assignee_role} team` : "Unassigned")}
        </p>
      )}
      {scores && <PriorityScoreBars scores={scores} />}

      {isOp && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid={`op-meta-${t.id}`}>
          {t.op_category && <span className="inline-flex items-center gap-1 border border-black px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-brand-yellow"><Tag size={11} weight="bold" /> {t.op_category}</span>}
          {t.assignee_name && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><UserCircle size={13} weight="bold" /> {t.assignee_name}</span>}
          {t.support_name && <span className="text-xs text-muted-foreground">+ {t.support_name}</span>}
          {t.approval_required && (
            <span data-testid={`op-approval-${t.id}`} className={`inline-flex items-center gap-1 border border-black px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${t.approval_status === "approved" ? "bg-green-600 text-white" : t.approval_status === "pending" ? "bg-brand-yellow" : t.approval_status === "rejected" ? "bg-brand-red text-white" : "bg-brand-paper"}`}>
              <ShieldCheck size={11} weight="bold" /> {t.approval_status === "approved" ? "Approved" : t.approval_status === "pending" ? "Pending approval" : t.approval_status === "rejected" ? "Changes requested" : `${t.approver_name || "Approval"} required`}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center flex-wrap gap-1.5 mt-3">
        <span data-testid={`status-chip-${t.id}`} className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider border border-black bg-white">{STATUS_LABEL[t.status] || t.status}</span>
        {isOverdue(t) && <span data-testid={`overdue-${t.id}`} className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider border border-black bg-brand-red text-white">Overdue</span>}
        {t.source === "escalation" && <span data-testid={`badge-escalation-${t.id}`} className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider border border-black bg-brand-red text-white">Escalation</span>}
        {t.source === "handoff" && <span data-testid={`badge-handoff-${t.id}`} className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider border border-black bg-brand-blue text-white">Handoff</span>}
        {(t.attachment_count || 0) > 0 && <span data-testid={`att-count-${t.id}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip size={12} weight="bold" /> {t.attachment_count}</span>}
        {t.due_date && <span className="text-xs text-muted-foreground">due {new Date(t.due_date).toLocaleString(undefined, { day: "numeric", month: "short", ...(t.due_date.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}) })}</span>}
      </div>

      {t.updated_at && (
        <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1" data-testid={`task-updated-${t.id}`} title={fullTime(t.updated_at)}>
          <ClockCounterClockwise size={12} weight="bold" />
          {t.last_action || "Updated"} · {timeAgo(t.updated_at)}
        </p>
      )}

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono text-muted-foreground">Progress</span>
          <span className="label-mono" data-testid={`progress-value-${t.id}`}>{t.progress || 0}%</span>
        </div>
        <div className="h-2 bg-black/10 border border-black"><div className="h-full bg-brand-blue transition-all" style={{ width: `${t.progress || 0}%` }} /></div>
      </div>

      {!isTerminal(t) && !awaitingApproval && (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <label className="label-mono text-muted-foreground">Status</label>
          <select data-testid={`status-select-${t.id}`} value={t.status === "blocked" ? "todo" : t.status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
            {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <label className="label-mono text-muted-foreground ml-1">Set progress</label>
          <select data-testid={`progress-select-${t.id}`} value={PROGRESS_OPTIONS.includes(t.progress) ? t.progress : 0} onChange={(e) => setProgress(e.target.value)} className={selCls}>
            {PROGRESS_OPTIONS.map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
      )}

      {(t.attachments || []).length > 0 && (
        <div className="mt-3 border border-black/15 bg-black/[0.02] p-3" data-testid={`proof-block-${t.id}`}>
          <p className="label-mono text-muted-foreground flex items-center gap-1.5 mb-2">
            <Paperclip size={13} weight="bold" /> Proof of work · {t.attachments.length}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            {t.attachments.map((a) => (
              a.kind === "photo"
                ? <button key={a.url} type="button" onClick={() => setLightbox(`${process.env.REACT_APP_BACKEND_URL}${a.url}`)}
                    className="relative w-20 h-20 border border-black overflow-hidden group" title="Click to view full photo"
                    data-testid={`att-photo-${t.id}-${a.url}`}>
                    <img src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                      <MagnifyingGlassPlus size={20} weight="bold" className="text-white" />
                    </span>
                  </button>
                : <audio key={a.url} controls preload="none" src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-9" data-testid={`att-voice-${t.id}-${a.url}`} />
            ))}
          </div>
        </div>
      )}

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="border border-black rounded-none max-w-3xl p-2" data-testid={`photo-lightbox-${t.id}`}>
          <DialogHeader>
            <DialogTitle className="sr-only">Proof photo</DialogTitle>
          </DialogHeader>
          {lightbox && <img src={lightbox} alt="proof full" className="w-full h-auto max-h-[80vh] object-contain" />}
        </DialogContent>
      </Dialog>

      {canApprove && awaitingApproval && (
        <div className="flex flex-wrap gap-2 mt-4 border border-black bg-brand-yellow/40 p-3" data-testid={`approval-actions-${t.id}`}>
          <span className="w-full label-mono text-muted-foreground">This task needs your approval before {t.assignee_name || "the assignee"} can start work.</span>
          {t.approval_status === "rejected" && t.rejection_reason && <span className="w-full text-xs text-brand-red">Previously requested: {t.rejection_reason}</span>}
          <button onClick={approveTask} data-testid={`approve-${t.id}`} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> Approve
          </button>
          <button onClick={rejectTask} data-testid={`reject-${t.id}`} className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <WarningCircle size={16} weight="bold" /> Request changes
          </button>
          <button onClick={clarifyTask} data-testid={`clarify-${t.id}`} className="flex items-center gap-2 bg-orange-500 text-black px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <ChatText size={16} weight="bold" /> Ask clarification
          </button>
        </div>
      )}

      {lockedForAssignee && (
        <div className="flex items-start gap-2 mt-4 border border-black bg-brand-paper p-3" data-testid={`approval-locked-${t.id}`}>
          <LockKey size={18} weight="bold" className="text-brand-red shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight">{t.approval_status === "rejected" ? "Changes requested" : "Awaiting approval"}</p>
            <p className="text-xs text-muted-foreground">You can start once {t.approver_name || "the approver"} approves this task. Status, progress and the execution plan are locked until then.</p>
            {t.approval_status === "rejected" && t.rejection_reason && <p className="text-xs text-brand-red mt-1">Note: {t.rejection_reason}</p>}
          </div>
        </div>
      )}

      {!isTerminal(t) && !awaitingApproval && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={complete} data-testid={`complete-${t.id}`} className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> Complete
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid={`photo-${t.id}`} className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
            <Camera size={16} weight="bold" /> Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <button onClick={toggleVoice} data-testid={`voice-${t.id}`} className={`flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${recording ? "bg-brand-red text-white" : "hover:bg-black/5"}`}>
            {recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />} {recording ? "Stop & send" : "Voice reply"}
          </button>
          {recording && (
            <button onClick={cancelVoice} data-testid={`voice-cancel-${t.id}`} className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
              <X size={16} weight="bold" /> Cancel
            </button>
          )}
        </div>
      )}

      {isTerminal(t) && !awaitingApproval && (
        <div className="flex flex-wrap gap-2 mt-4" data-testid={`reopen-actions-${t.id}`}>
          <button onClick={reopen} data-testid={`reopen-${t.id}`} className="flex items-center gap-2 bg-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
            <ArrowClockwise size={16} weight="bold" /> Reopen
          </button>
          <span className="flex items-center text-xs text-muted-foreground">Completed by mistake? Reopen brings it back to your active work.</span>
        </div>
      )}

      {!awaitingApproval && <ExecutionPlan t={t} onChange={onChange} members={members} roleOptions={roleOptions} />}
      <TaskTrail t={t} onChange={onChange} members={members} roleOptions={roleOptions} />
    </div>
  );
}

export default function MyWork() {
  const qc = useQueryClient();
  const { tenant, user } = useAuth();
  const [params] = useSearchParams();
  const isOwner = user?.role === "owner";
  const focusTaskId = params.get("task");
  const initialView = params.get("view") === "board" ? "board" : params.get("view") === "workflows" ? "workflows" : params.get("view") === "leave" ? "leave" : "mywork";
  const [view, setView] = useState(focusTaskId ? "mywork" : initialView);
  const canSeeWorkflows = isOwner || userPerms(user).includes("workflows");
  const [scope, setScope] = useState("mine");
  const [tab, setTab] = useState("all");
  const [aiPriority, setAiPriority] = useState(false);
  const mine = !(isOwner && scope === "all");
  const showAssignee = isOwner && scope === "all";
  const tasksQ = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data) });
  const focusQ = useQuery({
    queryKey: ["task", focusTaskId],
    queryFn: () => api.get(`/tasks/${focusTaskId}`).then((r) => r.data),
    enabled: !!focusTaskId, retry: false,
  });
  const focusDenied = !!focusTaskId && focusQ.isError && [403, 404].includes(focusQ.error?.response?.status);
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const prioritiesQ = useQuery({ queryKey: ["priorities"], queryFn: () => api.post("/tasks/prioritize").then((r) => r.data), enabled: aiPriority });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  useEffect(() => {
    if (!focusTaskId || !focusQ.data) return;
    const ft = focusQ.data;
    setView("mywork");
    if (isOwner && ft.assignee_id !== user?.id && scope !== "all") { setScope("all"); return; }
    setTab(isTerminal(ft) ? "completed" : "all");
    const timer = setTimeout(() => {
      document.getElementById(`task-card-${focusTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, focusQ.data, scope]);

  const scoreMap = {};
  (prioritiesQ.data?.tasks || []).forEach((pt) => { if (pt.ai_scores) scoreMap[pt.id] = pt.ai_scores; });
  const scoring = aiPriority && prioritiesQ.isFetching && !prioritiesQ.data;

  const all = tasksQ.data || [];
  const countFor = (key) => {
    if (key === "completed") return all.filter(isTerminal).length;
    if (key === "all") return all.filter((t) => !isTerminal(t)).length;
    return all.filter((t) => !isTerminal(t) && t.task_type === key).length;
  };

  let list;
  if (tab === "completed") {
    list = all.filter(isTerminal);
  } else if (tab === "all") {
    list = all.filter((t) => !isTerminal(t));
  } else {
    list = all.filter((t) => !isTerminal(t) && t.task_type === tab);
  }
  if (aiPriority && tab !== "completed") {
    list = [...list].sort((a, b) => (scoreMap[b.id]?.priority_score || 0) - (scoreMap[a.id]?.priority_score || 0));
  }

  return (
    <div>
      <PageHeader eyebrow="Your day, simplified" title="My Work">
        <div className="grid grid-cols-4 gap-2 w-full lg:flex lg:flex-wrap lg:w-auto lg:items-center" data-testid="mywork-controls">
          {view === "mywork" && (
            <>
              <NewTaskDialog onCreated={refresh} roleOptions={roleOptions} members={members}
                triggerClassName={`${CTRL} bg-brand-ink text-white hover:shadow-brutal-sm`} />
              {isOwner && (
                <>
                  <button onClick={() => setScope("mine")} data-testid="work-scope-mine"
                    className={`${CTRL} ${scope === "mine" ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>My Tasks</button>
                  <button onClick={() => setScope("all")} data-testid="work-scope-all"
                    className={`${CTRL} ${scope === "all" ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>All Tasks</button>
                </>
              )}
              <button onClick={() => setAiPriority((v) => !v)} data-testid="ai-priority-toggle"
                className={`${CTRL} ${aiPriority ? "bg-brand-red text-white shadow-brutal-sm" : "bg-brand-yellow hover:shadow-brutal-sm"}`}>
                <Sparkle size={15} weight="bold" /> {scoring ? "Scoring…" : aiPriority ? "AI Priority: On" : "AI Priority"}
              </button>
            </>
          )}
          <button onClick={() => setView("mywork")} data-testid="work-view-mywork"
            className={`${CTRL} ${view === "mywork" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <ListIcon size={15} weight="bold" /> My Work
          </button>
          <button onClick={() => setView("board")} data-testid="work-view-board"
            className={`${CTRL} ${view === "board" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <Kanban size={15} weight="bold" /> Board
          </button>
          {canSeeWorkflows && (
            <button onClick={() => setView("workflows")} data-testid="work-view-workflows"
              className={`${CTRL} ${view === "workflows" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              <ArrowRight size={15} weight="bold" /> Workflows
            </button>
          )}
          <button onClick={() => setView("leave")} data-testid="work-view-leave"
            className={`${CTRL} ${view === "leave" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
            <AirplaneTakeoff size={15} weight="bold" /> Leave
          </button>
        </div>
      </PageHeader>

      {focusDenied && (
        <div data-testid="access-restricted-banner" className="card-brutal p-4 mb-6 bg-brand-red text-white flex items-center gap-3">
          <LockKey size={22} weight="bold" className="shrink-0" />
          <div>
            <p className="font-bold uppercase tracking-tight">Access restricted</p>
            <p className="text-sm opacity-90">You don't have access to open this work item. Ask an owner if you think this is a mistake.</p>
          </div>
        </div>
      )}

      {view === "board" ? (
        <TaskBoard />
      ) : view === "workflows" ? (
        <Workflows embedded />
      ) : view === "leave" ? (
        <Leave embedded />
      ) : (
      <div data-testid="mywork-list">
        <div>
          <div className="flex flex-wrap gap-1.5 mb-5 border-b border-black/10 pb-3" data-testid="work-tabs">
            {WORK_TABS.map((tb) => (
              <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`work-tab-${tb.key}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black transition-colors ${tab === tb.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
                {tb.label}
                <span className={`px-1.5 py-0.5 text-[10px] leading-none border ${tab === tb.key ? "border-white/40" : "border-black/20 text-muted-foreground"}`}>{countFor(tb.key)}</span>
              </button>
            ))}
          </div>
          {list.length === 0 && <EmptyState title={tab === "completed" ? "Nothing completed yet" : "Nothing here"} hint={tab === "all" ? "You're all caught up!" : "No tasks in this category."} />}
          <div className="space-y-4">
            {list.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} members={members} roleOptions={roleOptions} showAssignee={showAssignee} highlight={t.id === focusTaskId} scores={aiPriority && tab !== "completed" ? scoreMap[t.id] : undefined} />)}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

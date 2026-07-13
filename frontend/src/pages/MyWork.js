import { useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { TaskBoard, NewTaskDialog } from "./Tasks";
import {
  CheckCircle, Camera, Microphone, Stop, ChatCircleText,
  Sparkle, Plus, Trash, ArrowUp, ArrowDown, Robot, PencilSimple, ListChecks, CaretDown,
  ArrowBendUpRight, WarningCircle, ChatText, ArrowRight, Kanban, ListChecks as ListIcon,
  Paperclip, UserCircle, ShieldCheck, Tag,
} from "@phosphor-icons/react";

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
      <button onClick={generate} disabled={busy} data-testid={`generate-plan-${t.id}`}
        className="mt-4 w-full flex items-center justify-center gap-2 border border-dashed border-brand-red text-brand-red py-2.5 text-sm font-semibold uppercase tracking-wider hover:bg-brand-red hover:text-white transition-colors disabled:opacity-50">
        <Sparkle size={16} weight="bold" /> {busy ? "Thinking…" : "Generate AI execution plan"}
      </button>
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
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <input value={s.text} onChange={(e) => editStep(i, e.target.value)} className={inp} />
                  <button onClick={() => moveStep(i, -1)} className="p-1 border border-black hover:bg-black/5" title="Up"><ArrowUp size={12} weight="bold" /></button>
                  <button onClick={() => moveStep(i, 1)} className="p-1 border border-black hover:bg-black/5" title="Down"><ArrowDown size={12} weight="bold" /></button>
                  <button onClick={() => removeStep(i)} data-testid={`exec-remove-${t.id}-${i}`} className="p-1 border border-black hover:bg-brand-red hover:text-white" title="Remove"><Trash size={12} weight="bold" /></button>
                </>
              ) : (
                <>
                  <button onClick={() => toggle(i)} data-testid={`exec-toggle-${t.id}-${i}`}
                    className={`w-5 h-5 shrink-0 border border-black flex items-center justify-center ${s.done ? "bg-brand-ink text-white" : "bg-white"}`}>
                    {s.done && <CheckCircle size={13} weight="bold" />}
                  </button>
                  <span className={`text-sm flex-1 ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.text}</span>
                  <button onClick={() => askAI(s)} data-testid={`exec-ask-${t.id}-${i}`}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-yellow transition-colors">
                    <Sparkle size={12} weight="bold" /> Ask AI
                  </button>
                  <button onClick={() => setUpdStep(updStep === s.id ? null : s.id)} data-testid={`exec-update-${t.id}-${i}`}
                    className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-blue hover:text-white transition-colors">
                    <ArrowBendUpRight size={12} weight="bold" /> Update
                  </button>
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

      <div className="flex gap-2 mt-4">
        {editing ? (
          <>
            <button onClick={() => save("accepted")} disabled={busy} data-testid={`exec-accept-${t.id}`}
              className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">
              <CheckCircle size={16} weight="bold" /> Accept &amp; start
            </button>
            <button onClick={() => save("draft")} disabled={busy} data-testid={`exec-save-${t.id}`}
              className="px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-black/5">Save</button>
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

function TaskCard({ t, onChange, members = [], roleOptions = [], scores, showAssignee = false }) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const canApprove = t.approval_required && (user?.role === "owner" || user?.id === t.approver_id);

  const approveTask = async () => {
    try { await api.post(`/tasks/${t.id}/approve`); toast.success("Task approved"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not approve"); }
  };
  const rejectTask = async () => {
    const reason = window.prompt("What changes are needed? (optional)") ?? "";
    try { await api.post(`/tasks/${t.id}/reject`, { reason }); toast.success("Changes requested"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not reject"); }
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
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
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

  const complete = async () => {
    await api.patch(`/tasks/${t.id}`, { status: "done" });
    toast.success("Task completed");
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
    <div data-testid={`mywork-task-${t.id}`} className="card-brutal p-5">
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

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="label-mono text-muted-foreground">Progress</span>
          <span className="label-mono" data-testid={`progress-value-${t.id}`}>{t.progress || 0}%</span>
        </div>
        <div className="h-2 bg-black/10 border border-black"><div className="h-full bg-brand-blue transition-all" style={{ width: `${t.progress || 0}%` }} /></div>
      </div>

      {!isTerminal(t) && (
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
        <div className="flex flex-wrap gap-2 mt-3">
          {t.attachments.map((a) => (
            a.kind === "photo"
              ? <img key={a.url} src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-16 h-16 object-cover border border-black" data-testid={`att-photo-${t.id}-${a.url}`} />
              : <audio key={a.url} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`att-voice-${t.id}-${a.url}`} />
          ))}
        </div>
      )}

      {canApprove && t.status === "review" && (
        <div className="flex flex-wrap gap-2 mt-4 border border-black bg-brand-yellow/40 p-3" data-testid={`approval-actions-${t.id}`}>
          <span className="w-full label-mono text-muted-foreground">Awaiting your approval</span>
          <button onClick={approveTask} data-testid={`approve-${t.id}`} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> Approve
          </button>
          <button onClick={rejectTask} data-testid={`reject-${t.id}`} className="flex items-center gap-2 bg-brand-red text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <WarningCircle size={16} weight="bold" /> Request changes
          </button>
        </div>
      )}

      {!isTerminal(t) && !(canApprove && t.status === "review") && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={complete} data-testid={`complete-${t.id}`} className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> {t.approval_required && t.approval_status !== "approved" ? "Submit for approval" : "Complete"}
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid={`photo-${t.id}`} className="flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider hover:bg-black/5">
            <Camera size={16} weight="bold" /> Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <button onClick={toggleVoice} data-testid={`voice-${t.id}`} className={`flex items-center gap-2 border border-black px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${recording ? "bg-brand-red text-white" : "hover:bg-black/5"}`}>
            {recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />} {recording ? "Stop" : "Voice reply"}
          </button>
        </div>
      )}

      {t.status !== "blocked" && <ExecutionPlan t={t} onChange={onChange} members={members} roleOptions={roleOptions} />}
      <TaskTrail t={t} onChange={onChange} members={members} roleOptions={roleOptions} />
    </div>
  );
}

export default function MyWork() {
  const qc = useQueryClient();
  const { tenant, user } = useAuth();
  const [params] = useSearchParams();
  const isOwner = user?.role === "owner";
  const [view, setView] = useState(params.get("view") === "board" ? "board" : "mywork");
  const [scope, setScope] = useState("mine");
  const [tab, setTab] = useState("all");
  const [aiPriority, setAiPriority] = useState(false);
  const mine = !(isOwner && scope === "all");
  const showAssignee = isOwner && scope === "all";
  const tasksQ = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data) });
  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data) });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const prioritiesQ = useQuery({ queryKey: ["priorities"], queryFn: () => api.post("/tasks/prioritize").then((r) => r.data), enabled: aiPriority });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

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
        <div className="flex items-center gap-3 flex-wrap">
          {view === "mywork" && (
            <>
              <NewTaskDialog onCreated={refresh} roleOptions={roleOptions} members={members} />
              {isOwner && (
                <div className="flex border border-black" data-testid="work-scope-toggle">
                  <button onClick={() => setScope("mine")} data-testid="work-scope-mine"
                    className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black transition-colors ${scope === "mine" ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>My Tasks</button>
                  <button onClick={() => setScope("all")} data-testid="work-scope-all"
                    className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${scope === "all" ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>All Tasks</button>
                </div>
              )}
              <button onClick={() => setAiPriority((v) => !v)} data-testid="ai-priority-toggle"
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black transition-all ${aiPriority ? "bg-brand-red text-white shadow-brutal-sm" : "bg-brand-yellow hover:shadow-brutal-sm"}`}>
                <Sparkle size={16} weight="bold" /> {scoring ? "Scoring…" : aiPriority ? "AI Priority: On" : "AI Priority"}
              </button>
            </>
          )}
          <div className="flex border border-black" data-testid="work-view-toggle">
            <button onClick={() => setView("mywork")} data-testid="work-view-mywork"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider border-r border-black transition-colors ${view === "mywork" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              <ListIcon size={16} weight="bold" /> My Work
            </button>
            <button onClick={() => setView("board")} data-testid="work-view-board"
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors ${view === "board" ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              <Kanban size={16} weight="bold" /> Board
            </button>
          </div>
        </div>
      </PageHeader>

      {view === "board" ? (
        <TaskBoard />
      ) : (
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
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
            {list.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} members={members} roleOptions={roleOptions} showAssignee={showAssignee} scores={aiPriority && tab !== "completed" ? scoreMap[t.id] : undefined} />)}
          </div>
        </div>

        <div>
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4 flex items-center gap-2">
            <ChatCircleText size={22} weight="bold" /> Messages
          </h2>
          <div className="card-brutal divide-y divide-black/10" data-testid="mywork-messages">
            {(notifQ.data?.notifications || []).length === 0 && <p className="p-4 text-sm text-muted-foreground">No messages.</p>}
            {(notifQ.data?.notifications || []).slice(0, 15).map((n) => (
              <div key={n.id} className="p-4">
                <p className="text-sm">{n.message}</p>
                <Chip value={n.level} className="mt-2" />
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

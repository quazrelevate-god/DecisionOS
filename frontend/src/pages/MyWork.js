import { useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import {
  CheckCircle, Camera, Microphone, Stop, ChatCircleText,
  Sparkle, Plus, Trash, ArrowUp, ArrowDown, Robot, PencilSimple, ListChecks, CaretDown,
} from "@phosphor-icons/react";

function ExecutionPlan({ t, onChange }) {
  const plan = t.execution_plan;
  const [steps, setSteps] = useState(plan?.steps || []);
  const [editing, setEditing] = useState(!plan || plan.status === "draft");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [ask, setAsk] = useState({});

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
                </>
              )}
            </div>
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
                            <p key={k}><span className="font-semibold">“{o.objection}”</span> — {o.response}</p>
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

function TaskCard({ t, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

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

  return (
    <div data-testid={`mywork-task-${t.id}`} className="card-brutal p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading font-bold text-lg leading-tight">{t.title}</p>
        <Chip value={t.priority} />
      </div>
      {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
      <div className="flex items-center gap-1.5 mt-3">
        <Chip value={t.status} />
        {t.due_date && <span className="text-xs text-muted-foreground">due {new Date(t.due_date).toLocaleDateString()}</span>}
      </div>

      {(t.attachments || []).length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {t.attachments.map((a, i) => (
            a.kind === "photo"
              ? <img key={i} src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} alt="proof" className="w-16 h-16 object-cover border border-black" data-testid={`att-photo-${t.id}-${i}`} />
              : <audio key={i} controls src={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} className="h-8" data-testid={`att-voice-${t.id}-${i}`} />
          ))}
        </div>
      )}

      {t.status !== "done" && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={complete} data-testid={`complete-${t.id}`} className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
            <CheckCircle size={16} weight="bold" /> Complete
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

      {t.status !== "blocked" && <ExecutionPlan t={t} onChange={onChange} />}
    </div>
  );
}

export default function MyWork() {
  const qc = useQueryClient();
  const tasksQ = useQuery({ queryKey: ["tasks", true], queryFn: () => api.get("/tasks?mine=true").then((r) => r.data) });
  const notifQ = useQuery({ queryKey: ["notifications"], queryFn: () => api.get("/notifications").then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks", true] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const open = (tasksQ.data || []).filter((t) => t.status !== "done");
  const done = (tasksQ.data || []).filter((t) => t.status === "done");

  return (
    <div>
      <PageHeader eyebrow="Your day, simplified" title="My Work" />

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">My Tasks</h2>
          {open.length === 0 && <EmptyState title="Nothing pending" hint="You're all caught up!" />}
          <div className="space-y-4">
            {open.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} />)}
          </div>
          {done.length > 0 && (
            <>
              <h3 className="font-heading font-extrabold uppercase tracking-tight text-lg mt-8 mb-3 text-muted-foreground">Completed</h3>
              <div className="space-y-3">
                {done.map((t) => <TaskCard key={t.id} t={t} onChange={refresh} />)}
              </div>
            </>
          )}
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
    </div>
  );
}

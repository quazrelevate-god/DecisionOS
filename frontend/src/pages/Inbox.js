import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { Chip, EmptyState } from "../components/common";
import { ThinkingCanvas } from "../components/ThinkingCanvas";
import ExecutionSummary from "../components/ExecutionSummary";
import { DecisionDialog, raisedByLabel, RaisedByIcon } from "../components/DecisionDialog";
import { money, timeAgo } from "../lib/format";
import { toast } from "sonner";
import { Button, ApprovalCard, FilterPills, Skeleton, SkeletonBrief, SkeletonRows, Tooltip } from "@/components/ds";
import { TodayBrief } from "../components/TodayBrief";
import { whatMatters } from "../lib/whatMatters";
import {
  Microphone, Stop, PaperPlaneTilt, CheckCircle, XCircle, Spinner,
  UsersThree, Truck, Receipt, CurrencyCircleDollar, Warning, CheckSquare,
  SealCheck, Bell, Brain, Check, X, ArrowClockwise, User, UserPlus, Question,
  WarningCircle, ArrowBendUpRight, ChatCircleText, Eye, Pause, Play, PencilSimple,
  Paperclip, File as FileIcon, ShieldCheck, Camera, UploadSimple, Translate,
} from "@phosphor-icons/react";

function SwipeRow({ children, onLeft, onRight, rightLabel = "View", testid }) {
  const [dx, setDx] = useState(0);
  const s = useRef(null);
  const engaged = useRef(false);
  const THRESH = 70, MAX = 110;
  const start = (e) => { const t = e.touches[0]; s.current = { x: t.clientX, y: t.clientY }; engaged.current = false; };
  const move = (e) => {
    if (!s.current) return;
    const t = e.touches[0];
    let d = t.clientX - s.current.x;
    const dy = t.clientY - s.current.y;
    if (!engaged.current) {
      if (Math.abs(d) < Math.abs(dy) || Math.abs(d) < 10) return;
      engaged.current = true;
    }
    if (!onRight && d > 0) d = 0;
    if (!onLeft && d < 0) d = 0;
    setDx(Math.max(-MAX, Math.min(MAX, d)));
  };
  const end = () => {
    if (dx >= THRESH && onRight) onRight();
    else if (dx <= -THRESH && onLeft) onLeft();
    setDx(0); s.current = null; engaged.current = false;
  };
  const committedR = dx >= THRESH, committedL = dx <= -THRESH;
  return (
    <div className="relative overflow-hidden border border-hairline rounded-md" data-testid={testid}>
      {onRight && (
        <div className={`absolute inset-y-0 left-0 flex items-center gap-1 px-5 text-white text-xs font-semibold  transition-colors ${committedR ? "bg-primary brightness-125" : "bg-primary/70"}`} style={{ opacity: dx > 8 ? 1 : 0 }}>
          <Eye size={16} weight="bold" /> {committedR ? `Release · ${rightLabel}` : rightLabel}
        </div>
      )}
      {onLeft && (
        <div className={`absolute inset-y-0 right-0 flex items-center gap-1 px-5 text-white text-xs font-semibold  transition-colors ${committedL ? "bg-primary brightness-125" : "bg-primary"}`} style={{ opacity: dx < -8 ? 1 : 0 }}>
          {committedL ? "Release · Dismiss" : "Dismiss"} <X size={16} weight="bold" />
        </div>
      )}
      <div onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        className="relative bg-surface"
        style={{ transform: `translateX(${dx}px)`, transition: dx === 0 ? "transform .2s ease" : "none", touchAction: "pan-y" }}>
        {children}
      </div>
    </div>
  );
}

function EscalationCard({ t, onRespond, highlight }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const isEsc = t.source === "escalation";

  const send = async () => {
    if (!text.trim()) return toast.error("Type a response first");
    setSending(true);
    try {
      await onRespond(t.id, text.trim());
      setText("");
    } catch (e) {
      // toast already shown by onRespond; keep the typed text so the user can retry
      console.debug("task response failed (toast already shown)", e);
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid={`escalation-card-${t.id}`} className={`rounded-lg border border-hairline bg-surface p-5 transition-all ${highlight ? "ring-4 ring-ring ring-offset-2" : ""}`}>
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span data-testid={`escalation-badge-${t.id}`}
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold  border border-hairline ${isEsc ? "bg-primary text-primary-foreground" : "bg-primary text-primary-foreground"} rounded-md`}>
          {isEsc ? <WarningCircle size={12} weight="bold" /> : <ArrowBendUpRight size={12} weight="bold" />}
          {isEsc ? "Escalation" : "Handoff"}
        </span>
        <Chip value={t.priority} />
      </div>
      <p className="font-bold text-lg leading-tight">{t.title}</p>
      {t.description && <p className="text-sm text-text-secondary mt-2">{t.description}</p>}
      {t.raised_step_text && (
        <p className="text-xs text-text-secondary mt-2 border-l-2 pl-2 italic">On step: {t.raised_step_text}</p>
      )}
      {t.raised_by_name && (
        <p className="text-label text-text-secondary mt-3 flex items-center gap-1">
          <User size={12} weight="bold" /> Raised by {t.raised_by_name}
        </p>
      )}
      <div className="mt-4 border-t-hairline pt-3">
        <textarea data-testid={`escalation-response-${t.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder={isEsc ? `Type your decision — this goes back to ${t.raised_by_name || "the person who raised it"}` : `Reply to ${t.raised_by_name || "the sender"}`}
          className="w-full border border-hairline p-2.5 text-sm text-label focus:outline-none focus:shadow-xs transition-shadow resize-none rounded-md" />
        <button onClick={send} disabled={sending || !text.trim()} data-testid={`escalation-send-${t.id}`}
          className="mt-2 flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold border border-hairline hover:shadow-xs transition-all disabled:opacity-50 rounded-md">
          <PaperPlaneTilt size={15} weight="bold" /> {sending ? "Sending…" : "Send response"}
        </button>
      </div>
    </div>
  );
}

function ReviewTaskRow({ t: task, members, roleOptions, onRefresh }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const inp = "border border-hairline px-2 py-1 text-xs text-label focus:outline-none bg-surface flex-1 min-w-0";
  const refs = (task.attachments || []).filter((a) => a.kind === "reference");
  const reassign = async (payload) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/reassign`, payload);
      toast.success("Task reassigned");
      setEditing(false);
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not reassign"); }
    finally { setBusy(false); }
  };
  const attachReference = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f, f.name);
    fd.append("kind", "reference");
    try {
      await api.post(`/tasks/${task.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Reference attached — AI is reading it");
      onRefresh();
    } catch (e2) { toast.error(e2.response?.data?.detail || "Upload failed"); }
    finally { setUploading(false); }
  };
  const toggleEvidence = async (checked) => {
    try {
      await api.patch(`/tasks/${task.id}`, { evidence_required: checked });
      toast.success(checked ? "Proof required to complete" : "Proof requirement removed");
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update"); }
  };
  return (
    <li className="border border-hairline px-3 py-2 rounded-md" data-testid={`review-task-${task.id}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm min-w-0">{task.title}</span>
        <button onClick={() => setEditing((v) => !v)} data-testid={`reassign-toggle-${task.id}`}
          className="shrink-0 inline-flex items-center gap-1 hover:opacity-80 transition-opacity" title={t("inbox.change_assignee")}>
          {task.assignee_name ? (
            <span className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-2 py-0.5 text-xs font-semibold">
              <User size={11} weight="bold" /> {task.assignee_name}
            </span>
          ) : task.assignee_role ? (
            <Chip value={task.assignee_role} />
          ) : (
            <span className="text-xs text-text-secondary italic">Unassigned</span>
          )}
          <PencilSimple size={12} weight="bold" className="text-text-tertiary" />
        </button>
      </div>
      {editing && (
        <div className="mt-2 flex flex-col sm:flex-row gap-2" data-testid={`reassign-form-${task.id}`}>
          <select className={inp} defaultValue={task.assignee_id || ""} disabled={busy} data-testid={`reassign-member-${task.id}`}
            onChange={(e) => e.target.value && reassign({ assignee_id: e.target.value })}>
            <option value="">{t("inbox.change_to_member")}</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
          </select>
          <select className={inp} defaultValue="" disabled={busy} data-testid={`reassign-role-${task.id}`}
            onChange={(e) => e.target.value && reassign({ assignee_role: e.target.value })}>
            <option value="">{t("inbox.change_to_role")}</option>
            {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
      )}
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`review-refs-${task.id}`}>
          {refs.map((a) => (
            <a key={a.url} href={`${process.env.REACT_APP_BACKEND_URL}${a.url}`} target="_blank" rel="noreferrer"
              data-testid={`review-ref-${task.id}-${a.url}`}
              className="inline-flex items-center gap-1 border border-hairline-strong/40 bg-primary-tint text-primary-text px-2 py-0.5 text-[11px] text-label max-w-[160px] hover:bg-primary/10 transition-colors rounded-md">
              <FileIcon size={11} weight="bold" /> <span className="truncate">{a.filename || "reference"}</span>
            </a>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button onClick={() => fileRef.current?.click()} disabled={uploading} data-testid={`attach-reference-${task.id}`}
          className="inline-flex items-center gap-1 border border-hairline px-2 py-1 text-[11px] font-semibold hover:bg-status-pending-bg transition-colors disabled:opacity-50 rounded-md">
          <Paperclip size={12} weight="bold" /> {uploading ? "Uploading…" : "Attach reference"}
        </button>
        <input ref={fileRef} type="file" className="hidden" onChange={attachReference} />
        <label className="inline-flex items-center gap-1.5 text-[11px] text-label cursor-pointer" title="Assignee must upload proof before completing">
          <input type="checkbox" data-testid={`require-proof-${task.id}`} className="w-3.5 h-3.5 border border-hairline rounded-md"
            checked={!!task.evidence_required} onChange={(e) => toggleEvidence(e.target.checked)} />
          <ShieldCheck size={12} weight="bold" className="text-primary-text" /> Require proof
        </label>
      </div>
    </li>
  );
}

function PendingApprovalCard({ d, members, roleOptions, onApprove, onReject, onRefresh, onDiscuss, highlight }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", assignee_id: "", assignee_role: "", priority: "medium" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const inp = "w-full border border-hairline px-2 py-1.5 text-xs text-label focus:outline-none";

  const addTask = async () => {
    if (!form.title.trim()) return toast.error("Task title required");
    if (!form.assignee_id && !form.assignee_role) return toast.error("Pick a member or role");
    try {
      await api.post(`/decisions/${d.id}/tasks`, {
        title: form.title,
        assignee_id: form.assignee_id || null,
        assignee_role: form.assignee_id ? null : (form.assignee_role || null),
        priority: form.priority,
      });
      toast.success("Team member added to this decision");
      setForm({ title: "", assignee_id: "", assignee_role: "", priority: "medium" });
      setAdding(false);
      onRefresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not add task"); }
  };

  return (
    // The DS card owns the hierarchy — badges, title, provenance, the asymmetric
    // action row — and the editable task rows stay as children, because they do
    // things the plain `tasks` prop cannot express (attach a reference, require
    // proof, reassign inline). Migration keeps the behaviour and takes the shape.
    <ApprovalCard
      data-testid={`decision-card-${d.id}`}
      className={highlight ? "ring-focus ring-ring ring-offset-2" : undefined}
      title={d.title}
      kind={d.dtype}
      summary={d.summary}
      provenance={raisedByLabel(d)}
      provenanceIcon={<RaisedByIcon d={d} size={13} weight="bold" />}
      timeLabel={d.created_at ? timeAgo(d.created_at) : undefined}
      testids={{
        status: `decision-status-${d.id}`,
        provenance: `decision-raised-by-${d.id}`,
        approve: `inbox-approve-${d.id}`,
        reject: `inbox-reject-${d.id}`,
        discuss: `decision-discuss-${d.id}`,
      }}
      onApprove={() => onApprove(d.id)}
      onReject={() => onReject(d.id)}
      onDiscuss={() => onDiscuss(d.id)}
    >
      {d.detected_language_name && (
        <p data-testid={`decision-language-${d.id}`} title="Language auto-detected by Sarvam"
          className="mt-2 inline-flex items-center gap-1 text-small text-text-tertiary">
          <Translate size={12} weight="bold" /> Spoken in {d.detected_language_name}
        </p>
      )}
      {d.tasks?.length > 0 && (
        <div className="mt-4 border-t-hairline pt-3">
          <p className="mb-1 text-label text-text-tertiary">
            {d.tasks.length === 1 ? "Task it will unblock" : "Tasks it will unblock"}
          </p>
          <ul className="space-y-2" data-testid={`decision-tasks-${d.id}`}>
            {d.tasks.map((t) => (
              <ReviewTaskRow key={t.id} t={t} members={members} roleOptions={roleOptions} onRefresh={onRefresh} />
            ))}
          </ul>
        </div>
      )}

      {adding ? (
        <div className="mt-3 border border-dashed border-hairline p-3 space-y-2 rounded-md" data-testid={`add-task-form-${d.id}`}>
          <input data-testid={`add-task-title-${d.id}`} className={inp} placeholder="What should they do?" value={form.title} onChange={set("title")} />
          <select data-testid={`add-task-member-${d.id}`} className={inp} value={form.assignee_id} onChange={set("assignee_id")}>
            <option value="">— Assign to a team member —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
          </select>
          <select className={inp} value={form.assignee_role} onChange={set("assignee_role")} disabled={!!form.assignee_id}>
            <option value="">…or by role {form.assignee_id ? "(member selected)" : ""}</option>
            {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button data-testid={`add-task-save-${d.id}`} onClick={addTask} className="flex-1 bg-primary text-primary-foreground py-1.5 text-xs font-semibold border border-hairline hover:bg-primary-hover transition-colors rounded-md">Add</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs font-semibold border border-hairline hover:bg-surface-hover rounded-md">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} data-testid={`add-member-${d.id}`}
          className="mt-3 w-full flex items-center justify-center gap-2 border border-dashed border-hairline py-2 text-xs font-semibold hover:bg-surface-hover transition-colors rounded-md">
          <UserPlus size={15} weight="bold" /> Add team member / task
        </button>
      )}

      {/* Approve / Reject / Discuss are rendered by ApprovalCard itself, so the
          asymmetry cannot be re-litigated per screen. The old row was a solid
          blue Approve beside an equally heavy black Reject — two competing
          slabs, and neither read as the recommended path. */}
    </ApprovalCard>
  );
}

const PROCESSING = ["queued", "transcribing", "structuring"];

function AttachChips({ files, onRemove, testid }) {
  if (!files.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2 justify-center" data-testid={testid}>
      {files.map((f, i) => (
        <li key={i} data-testid={`${testid}-chip-${i}`} className="inline-flex items-center gap-1.5 border border-hairline-strong/40 bg-primary-tint text-primary-text px-2.5 py-1 text-xs text-label max-w-[200px] rounded-md">
          <FileIcon size={12} weight="bold" /> <span className="truncate">{f.name}</span>
          <button onClick={() => onRemove(i)} data-testid={`${testid}-remove-${i}`} className="ml-0.5 hover:text-primary-text"><X size={12} weight="bold" /></button>
        </li>
      ))}
    </ul>
  );
}

function ThinkingOverlay({ show }) {
  return (
    <div aria-hidden={!show} data-testid="thinking-overlay"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center transition-opacity duration-[600ms] ease-out ${show ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
      {/* frosted application backdrop */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-2xl app-canvas opacity-95" />
      <div className="relative flex flex-col items-center">
        <p className="thinking-text font-black tracking-[0.35em] text-text text-4xl sm:text-5xl">Thinking</p>
        <div className="relative w-[min(82vw,520px)] aspect-square -mt-2">
          <div className="absolute inset-[28%] rounded-pill bg-primary-tint blur-[70px] animate-pulse" aria-hidden />
          <ThinkingCanvas active={show} />
        </div>
        <p className="text-sm text-text-secondary text-label -mt-4 tracking-wide">DecisionOS is connecting the dots…</p>
      </div>
    </div>
  );
}

const CLASS_META = {
  customer: { icon: UsersThree, color: "bg-primary text-primary-foreground", label: "Customer" },
  supplier: { icon: Truck, color: "bg-status-pending-bg text-text", label: "Supplier" },
  invoice: { icon: Receipt, color: "bg-primary text-primary-foreground", label: "Invoice" },
  payment: { icon: CurrencyCircleDollar, color: "bg-success-600 text-white", label: "Payment" },
  complaint: { icon: Warning, color: "bg-surface-sunken text-white", label: "Complaint" },
  task: { icon: CheckSquare, color: "bg-surface text-text", label: "Task" },
  approval: { icon: SealCheck, color: "bg-primary text-primary-foreground", label: "Approval" },
  reminder: { icon: Bell, color: "bg-status-pending-bg text-text", label: "Reminder" },
  decision: { icon: Brain, color: "bg-primary text-primary-foreground", label: "Decision" },
};
const FILTERS = ["all", "customer", "supplier", "invoice", "payment", "complaint", "task", "approval", "reminder"];

function useElapsed(ticking, running) {
  const [t, setT] = useState(0);
  useEffect(() => { if (!running) setT(0); }, [running]);
  useEffect(() => {
    if (!ticking) return;
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [ticking]);
  return t;
}

export default function Inbox() {
  const { user, tenant } = useAuth();
  const { t } = useTranslation();
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [text, setText] = useState("");
  const [clarify, setClarify] = useState(null);
  const [answers, setAnswers] = useState({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [filter, setFilter] = useState("all");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [approvalsExpanded, setApprovalsExpanded] = useState(false);
  const [feedShowAll, setFeedShowAll] = useState(false);
  const [submittedNoteId, setSubmittedNoteId] = useState(null);
  const [execPanel, setExecPanel] = useState(null);
  const [voiceFiles, setVoiceFiles] = useState([]);
  const [textFiles, setTextFiles] = useState([]);
  const [uploadFiles, setUploadFiles] = useState([]);
  const voiceAttachRef = useRef(null);
  const textAttachRef = useRef(null);
  const voiceCameraRef = useRef(null);
  const textCameraRef = useRef(null);
  const uploadRef = useRef(null);
  const uploadCameraRef = useRef(null);
  const languageRef = useRef("auto");
  languageRef.current = language;
  const voiceFilesRef = useRef([]);
  voiceFilesRef.current = voiceFiles;
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);
  const elapsed = useElapsed(recording && !paused, recording);

  const notesQ = useQuery({
    queryKey: ["voice-notes"],
    queryFn: () => api.get("/voice-notes").then((r) => r.data),
    refetchInterval: (q) => ((q.state.data || []).some((n) => PROCESSING.includes(n.status)) ? 2500 : false),
  });
  const processing = (notesQ.data || []).some((n) => PROCESSING.includes(n.status));
  const inboxQ = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.get("/inbox").then((r) => r.data),
    refetchInterval: processing ? 2500 : false,
  });
  const decisionsQ = useQuery({ queryKey: ["decisions"], queryFn: () => api.get("/decisions").then((r) => r.data) });
  const myTasksQ = useQuery({ queryKey: ["tasks", true], queryFn: () => api.get("/tasks?mine=true").then((r) => r.data) });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), enabled: hasPerm(user, "decisions_approve") || hasPerm(user, "team_manage") });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["voice-notes"] });
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["inbox"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["tasks", true] });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) { chunksRef.current = []; toast("Recording discarded"); return; }
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "note.webm");
        fd.append("language", languageRef.current);
        setBusy(true);
        try {
          const refIds = await uploadRefs(voiceFilesRef.current);
          if (refIds.length) fd.append("file_ids", refIds.join(","));
          const { data } = await api.post("/voice-notes", fd, { headers: { "Content-Type": "multipart/form-data" } });
          if (data?.id) setSubmittedNoteId(data.id);
          setVoiceFiles([]);
          toast.success("Got it — thinking…");
          refresh();
        } catch { toast.error("Upload failed"); } finally { setBusy(false); }
      };
      mediaRef.current = mr;
      mr.start();
      setPaused(false);
      setRecording(true);
    } catch { toast.error("Microphone access denied"); }
  };
  const stopRec = () => { cancelledRef.current = false; setBusy(true); mediaRef.current?.stop(); setRecording(false); setPaused(false); };
  const cancelRec = () => { cancelledRef.current = true; mediaRef.current?.stop(); setRecording(false); setPaused(false); };
  const pauseRec = () => { if (mediaRef.current?.state === "recording") { mediaRef.current.pause(); setPaused(true); } };
  const resumeRec = () => { if (mediaRef.current?.state === "paused") { mediaRef.current.resume(); setPaused(false); } };

  const uploadRefs = async (files) => {
    const ids = [];
    for (const f of (files || [])) {
      const fd = new FormData();
      fd.append("file", f, f.name);
      fd.append("kind", "reference");
      try {
        const { data } = await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
        if (data?.id) ids.push(data.id);
      } catch { toast.error(`Couldn't upload "${f.name}"`); }
    }
    return ids;
  };

  const runCapture = async (finalText, files = []) => {
    setBusy(true);
    try {
      const file_ids = await uploadRefs(files);
      const { data } = await api.post("/voice-notes/text", { text: finalText, language, file_ids });
      if (data?.id) setSubmittedNoteId(data.id);
      setText(""); setClarify(null); setAnswers({}); setTextFiles([]); setUploadFiles([]);
      toast.success("Got it — thinking…");
      refresh();
    } catch (e) { toast.error(e.response?.data?.detail || "Submit failed"); } finally { setBusy(false); }
  };

  const structureFiles = async () => {
    if (!uploadFiles.length) return toast.error("Attach a file first");
    await runCapture("", uploadFiles);
  };

  // When the just-submitted directive finishes structuring, reveal the Execution Summary.
  useEffect(() => {
    if (!submittedNoteId) return;
    const note = (notesQ.data || []).find((n) => n.id === submittedNoteId);
    if (!note) return;
    if (note.status === "done" && note.execution_summary) {
      const hasAny = Object.values(note.execution_summary).some((v) => (v || 0) > 0);
      if (hasAny) setExecPanel({ ...note.execution_summary, decisionId: note.decision_id });
      setSubmittedNoteId(null);
      // processing produced new tasks/workflows/meetings — refresh those views
      ["decisions", "inbox", "dashboard", "calendar", ["tasks", true]].forEach((k) =>
        qc.invalidateQueries({ queryKey: Array.isArray(k) ? k : [k] }));
      qc.invalidateQueries({ queryKey: ["workflows"] });
    } else if (note.status === "failed") {
      setSubmittedNoteId(null);
    }
  }, [notesQ.data, submittedNoteId, qc]);

  const reviewFromSummary = () => {
    const id = execPanel?.decisionId;
    setExecPanel(null);
    if (id) setParams({ focus: `approval:${id}` });
  };

  const submitText = async () => {
    if (!text.trim()) return;
    setChecking(true);
    try {
      const { data } = await api.post("/capture/clarify", { text });
      if (data.complete) { await runCapture(text, textFiles); }
      else { setClarify(data); setAnswers({}); }
    } catch { await runCapture(text, textFiles); }  // never block capture on clarify failure
    finally { setChecking(false); }
  };

  const submitWithDetails = () => {
    const details = (clarify?.questions || [])
      .filter((q) => (answers[q.id] || "").trim())
      .map((q) => `- ${q.question} ${answers[q.id].trim()}`).join("\n");
    runCapture(details ? `${text}\n\nDetails provided:\n${details}` : text, textFiles);
  };

  const decide = async (id, action) => {
    try { await api.post(`/decisions/${id}/${action}`); toast.success(`Decision ${action}d`); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };

  const respondEscalation = async (id, text) => {
    try {
      await api.post(`/tasks/${id}/respond`, { text });
      toast.success("Response sent — routed back to the person who raised it");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send response");
      throw e; // let the card keep the typed text; caller swallows this
    }
  };

  const setStatus = async (id, status) => {
    try { await api.post(`/inbox/${id}/status`, { status }); refresh(); }
    catch { toast.error("Failed"); }
  };

  const openItem = (it) => {
    if (it.ref_type === "ingestion") navigate("/ingest");
    else if (it.classification === "complaint") navigate("/contacts");
  };

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  /* Four independent queries used to land in four visible jumps, each one
     reflowing whatever the founder was already reaching for. Grouped by what
     each region actually needs rather than gated on all four, so a slow feed
     cannot hold up the brief. */
  const deskLoading = decisionsQ.isLoading || myTasksQ.isLoading;
  const feedLoading = inboxQ.isLoading || decisionsQ.isLoading || myTasksQ.isLoading;

  const inbox = inboxQ.data || { items: [], counts: {}, open_total: 0 };
  const rawItems = (inbox.items || []).filter((i) => i.status !== "dismissed" && (filter === "all" || i.classification === filter));

  /**
   * Collapse residual duplicates into one row carrying a count.
   *
   * The same invoice parsed twice, or a task captured from both a voice note and
   * the WhatsApp forward of it, arrives as two or three separate cards.
   * Deduplicating at ingestion is the real fix and is backend work; this is the
   * display half, so a feed that has already been polluted still reads as one
   * row per thing.
   *
   * The key is title + classification + amount + status. Status is deliberately
   * part of it: an open copy and a done copy are different states, and merging
   * them would hide work rather than tidy it.
   */
  const items = (() => {
    const seen = new Map();
    for (const it of rawItems) {
      const key = [
        (it.title || "").trim().toLowerCase(),
        it.classification || "",
        it.amount ?? "",
        it.status || "",
      ].join("|");
      const hit = seen.get(key);
      if (hit) hit.duplicateCount = (hit.duplicateCount || 1) + 1;
      else seen.set(key, { ...it });
    }
    return [...seen.values()];
  })();
  const pending = (decisionsQ.data || []).filter((d) => d.status === "pending_approval");
  /* The Desk shows the decisions that have waited longest first, so "here is
     the one that has waited longest" is a true statement about the card above
     it and not just a label. Undated records sort last rather than winning by
     accident. */
  pending.sort((a, b) => new Date(a.created_at || 8.64e15) - new Date(b.created_at || 8.64e15));
  const decMap = {};
  (decisionsQ.data || []).forEach((d) => { decMap[d.id] = d; });
  const escalations = (myTasksQ.data || []).filter((t) => (t.source === "escalation" || t.source === "handoff") && t.status !== "done");

  /* The feed's "today" is the brief's "today" — literally the same function,
     not a second implementation that agrees with it for now. Three endpoints
     with three definitions of a countable task is exactly the bug this app
     already has at the backend (MIGRATION-FOLLOWUPS.md B1); adding a fourth
     definition in the frontend would be doing it to ourselves on purpose. */
  const todayIds = new Set(
    whatMatters({ decisions: decisionsQ.data || [], tasks: myTasksQ.data || [], limit: Infinity }).items.map((i) => i.id)
  );
  const matchesToday = (it) => todayIds.has(it.ref_id);

  /* The feed defaults to what needs you today. This is the change on this page
     that could most easily become concealment, so the disclosure is
     unconditional: the control below the feed renders whether or not anything
     is hidden, and it carries the total — "Show everything (11)" — rather than
     a bare "Show more". A founder must never have to wonder whether the app is
     holding something back. */
  const feedItems = feedShowAll ? items : items.filter(matchesToday);
  const feedHiddenCount = items.length - feedItems.length;

  // Live status of any voice/text note still being processed (non-blocking indicator)
  const procNotes = (notesQ.data || []).filter((n) => PROCESSING.includes(n.status));
  const procLabel = "Thinking…";

  // Deep-link from CEO Brief: ?focus=approval:<id> or attention:<id> — scroll to & highlight the card.
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  const [highlightId, setHighlightId] = useState(null);
  const [openDecision, setOpenDecision] = useState(null);

  /* "See the other N" lands here — above the approvals, escalations and feed,
     which together are the remainder. The count in the brief is only honest
     while the rest is reachable, so the affordance and the number ship
     together or not at all. */
  const restRef = useRef(null);
  const scrollToRest = () => restRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  /* Never collapse a surface someone is part-way through using. A clarify
     panel is a question waiting for an answer and typed text is unsaved work;
     folding either away to save height would be the collapse causing the data
     loss it was meant to prevent.
     Derived rather than an effect that forces the state open: an effect only
     fires when its dependencies change, so it re-opened on the next keystroke
     but did nothing about the click that had just closed it — the input
     vanished with text still in it. This cannot express that state at all. */
  const captureLocked = !!clarify || !!text.trim();
  const captureExpanded = captureOpen || captureLocked;
  useEffect(() => {
    const dq = params.get("decision");
    if (dq) setOpenDecision(dq);
  }, [params]);
  const dataReady = (decisionsQ.data || myTasksQ.data) ? true : false;
  useEffect(() => {
    if (!focus) return;
    const [type, id] = focus.split(":");
    const testid = type === "approval" ? `decision-card-${id}` : type === "attention" ? `escalation-card-${id}` : null;
    if (!testid) return;
    const timer = setTimeout(() => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(id);
        setParams({}, { replace: true });
        setTimeout(() => setHighlightId(null), 3500);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, dataReady]);

  return (
    <div>
      <ThinkingOverlay show={busy || !!submittedNoteId} />
      <ExecutionSummary data={execPanel} onClose={() => setExecPanel(null)} onReview={reviewFromSummary} />
      <DecisionDialog decisionId={openDecision} open={!!openDecision}
        onClose={() => { setOpenDecision(null); if (params.get("decision")) setParams({}, { replace: true }); }} />

      {processing && !submittedNoteId && (
        <div data-testid="structuring-banner"
          className="sticky top-2 z-30 mb-6 flex items-center gap-3 border border-hairline bg-status-pending-bg px-4 py-3 shadow-xs rounded-md">
          <Spinner size={20} weight="bold" className="animate-spin text-primary-text shrink-0" />
          <div className="min-w-0">
            <p className="font-bold tracking-tight text-sm" data-testid="structuring-status">
              {procLabel}{procNotes.length > 1 ? ` (${procNotes.length})` : ""}
            </p>
            <p className="text-xs text-text-secondary">{t("inbox.structuring_desc")}</p>
          </div>
        </div>
      )}

      {/* What matters today — the business before the input.
          Deliberately above the capture block: the measured problem was a
          morning screen that opened on three ways to type and nothing about
          the company. Collapsing capture is a separate, later change; this one
          only decides what comes first. */}
      {/* The brief ranks decisions and tasks together, so it needs both queries
          in before it can say anything true. Rendering it on one of the two
          would state a summary — "3 overdue" — that is about to change, and a
          number that corrects itself is worse than a number that waited. */}
      {deskLoading ? (
        <SkeletonBrief testid="today-brief-skeleton" />
      ) : (
        <TodayBrief
          decisions={decisionsQ.data || []}
          tasks={myTasksQ.data || []}
          onOpenDecision={setOpenDecision}
          onSeeRest={scrollToRest}
        />
      )}

      {/* Capture.
          Collapsed by default to one primary: the mic, which stays visible and
          stays the primary because speak-first is the product thesis, not a
          layout preference. Type and Upload are named on the control that
          reveals them — "Type or upload instead" — so this is a fold, not a
          removal: nothing here is a count of work, so naming the two methods
          is the whole of what disclosure requires.

          It opens automatically while recording and while a clarify panel is
          waiting for answers, because collapsing the surface someone is
          mid-way through using is worse than the height it saves. */}
      {canCapture ? (
        <div className="mb-8 space-y-4" data-testid="capture-block">
          <div className={captureExpanded ? "grid lg:grid-cols-2 gap-4" : ""}>
            {/* WAY 1 — Speak. One element, two layouts: vertical and full when
                expanded, a compact row when collapsed. Duplicating the button
                would duplicate the record handler, which is the kind of thing
                that drifts. */}
            <div className={`rounded-lg border border-hairline bg-surface ${captureExpanded ? "p-6 flex flex-col items-center justify-center text-center" : "p-4 flex items-center gap-4"}`}>
              {captureExpanded && <p className="text-label text-primary-text mb-2 self-start">Way 1 · Speak</p>}
              <button onClick={recording ? stopRec : startRec} disabled={busy} data-testid="voice-record-button"
                className={`rounded-pill shrink-0 ${captureExpanded ? "w-24 h-24" : "w-16 h-16"} flex items-center justify-center border border-hairline transition-all ${recording ? (paused ? "bg-primary text-primary-foreground" : "bg-primary text-primary-foreground recording-pulse") : "bg-primary text-primary-foreground hover:shadow-sm"}`}>
                {recording ? <Stop size={captureExpanded ? 38 : 26} weight="fill" /> : <Microphone size={captureExpanded ? 38 : 26} weight="fill" />}
              </button>

              <div className={captureExpanded ? "contents" : "min-w-0 flex-1"}>
              <p className={`font-bold tracking-tight ${captureExpanded ? "mt-4" : ""}`}>{recording ? (paused ? t("inbox.paused") : t("inbox.recording")) : busy ? t("inbox.thinking") : captureExpanded ? t("inbox.tap_to_speak") : "Capture a decision"}</p>
              <p className="text-label text-sm text-text-secondary mt-1" data-testid="record-timer">{recording ? mmss : "Speak in any language — AI writes it up in English"}</p>
              {recording && (
                <div className={`flex flex-wrap items-center gap-2 mt-3 ${captureExpanded ? "justify-center" : ""}`}>
                  {paused ? (
                    <button onClick={resumeRec} data-testid="voice-resume-button"
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-hairline bg-primary text-primary-foreground hover:shadow-xs transition-all rounded-md">
                      <Play size={15} weight="fill" /> Resume
                    </button>
                  ) : (
                    <button onClick={pauseRec} data-testid="voice-pause-button"
                      className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-hairline bg-surface hover:bg-surface-hover transition-colors rounded-md">
                      <Pause size={15} weight="fill" /> Pause
                    </button>
                  )}
                  <button onClick={stopRec} data-testid="voice-finalise-button"
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-hairline bg-primary text-primary-foreground hover:shadow-xs transition-all rounded-md">
                    <CheckCircle size={15} weight="bold" /> Finalise
                  </button>
                  <button onClick={cancelRec} data-testid="voice-cancel-button"
                    className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border border-hairline hover:bg-surface-hover transition-colors rounded-md">
                    <X size={15} weight="bold" /> Cancel
                  </button>
                </div>
              )}
              {/* Attaching is a companion to speaking, so it follows the mic
                  into the fold — an action, not information, and it returns
                  the moment the block is open. Chips stay whatever the state:
                  a file already attached must never vanish silently. */}
              {captureExpanded && (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button onClick={() => voiceAttachRef.current?.click()} data-testid="voice-attach-file"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold border border-hairline px-3 py-1.5 hover:bg-status-pending-bg transition-colors rounded-md">
                    <Paperclip size={13} weight="bold" /> Attach files
                  </button>
                  <button onClick={() => voiceCameraRef.current?.click()} data-testid="voice-capture-photo"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold border border-hairline px-3 py-1.5 hover:bg-status-pending-bg transition-colors rounded-md">
                    <Camera size={13} weight="bold" /> Add photo
                  </button>
                </div>
              )}
              <input ref={voiceAttachRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden"
                onChange={(e) => { setVoiceFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
              <input ref={voiceCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setVoiceFiles((prev) => [...prev, f]); e.target.value = ""; }} />
              <AttachChips files={voiceFiles} testid="voice-attachments" onRemove={(i) => setVoiceFiles(voiceFiles.filter((_, j) => j !== i))} />
              </div>

              {/* The disclosure names what is behind it. "Show more" would not.
                  Withdrawn entirely while there is unsaved work, rather than
                  left present and inert: a control that is visible and does
                  nothing teaches people the interface is broken. */}
              {!captureLocked && (
                <Button
                  variant="tertiary"
                  size="sm"
                  className={captureExpanded ? "mt-4" : "shrink-0"}
                  onClick={() => setCaptureOpen((v) => !v)}
                  data-testid="capture-toggle"
                >
                  {captureExpanded ? "Hide type and upload" : "Type or upload instead"}
                </Button>
              )}
            </div>

            {/* WAY 2 — Type */}
            {captureExpanded && (
            <div className="rounded-lg border border-hairline bg-surface p-6">
              <p className="text-label text-primary-text mb-2">Way 2 · Type</p>
              <p className="text-label text-text-secondary mb-3">{t("inbox.type_directive")}</p>
              <textarea data-testid="text-directive-input" value={text} onChange={(e) => setText(e.target.value)} rows={5}
                placeholder="e.g. Tell sales to send the revised quote to the Delhi retailer by Friday and ask finance to clear the packaging invoice."
                className="w-full border border-hairline p-3 text-sm text-label focus:outline-none focus:shadow-xs transition-shadow resize-none rounded-md" />

              {clarify ? (
                <div className="mt-3 rounded-lg border border-dashed border-hairline-strong p-3" data-testid="clarify-panel">
                  <p className="flex items-center gap-2 text-label text-primary-text mb-2">
                    <Question size={15} weight="bold" /> A few quick details for a sharper plan
                  </p>
                  <div className="space-y-2">
                    {clarify.questions.map((q) => (
                      <div key={q.id} data-testid={`clarify-q-${q.id}`}>
                        <label className="text-xs font-medium block mb-1">{q.question}</label>
                        <input value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                          data-testid={`clarify-a-${q.id}`} placeholder={q.hint}
                          className="w-full border border-hairline px-2 py-1.5 text-sm focus:outline-none rounded-md" />
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {/* The red was on the SAFE path: "Submit with details" —
                        answering what the Brain asked — was the solid red
                        button, while "Skip & structure anyway", which discards
                        those answers, was an unstyled outline. Red was not
                        guarding the risky action; it was decorating the
                        recommended one, and the hierarchy was inverted.
                        Answering is now the primary; skipping is secondary. */}
                    <Button
                      onClick={submitWithDetails}
                      loading={busy}
                      data-testid="clarify-submit"
                      leadingIcon={<PaperPlaneTilt size={15} weight="bold" />}
                    >
                      Submit with details
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => runCapture(text, textFiles)}
                      disabled={busy}
                      data-testid="clarify-skip"
                    >
                      Skip &amp; structure anyway
                    </Button>
                    <Button variant="tertiary" onClick={() => setClarify(null)} data-testid="clarify-cancel">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {/* The one primary action of the capture module. */}
                  <Button
                    size="lg"
                    onClick={submitText}
                    disabled={busy || !text.trim()}
                    loading={checking}
                    data-testid="submit-text-directive"
                    leadingIcon={<PaperPlaneTilt size={16} weight="bold" />}
                  >
                    Structure it
                  </Button>
                  <button onClick={() => textAttachRef.current?.click()} data-testid="text-attach-file"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold border border-hairline px-3 py-2 hover:bg-status-pending-bg transition-colors rounded-md">
                    <Paperclip size={13} weight="bold" /> Attach files
                  </button>
                  <button onClick={() => textCameraRef.current?.click()} data-testid="text-capture-photo"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold border border-hairline px-3 py-2 hover:bg-status-pending-bg transition-colors rounded-md">
                    <Camera size={13} weight="bold" /> Add photo
                  </button>
                </div>
              )}
              <input ref={textAttachRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden"
                onChange={(e) => { setTextFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
              <input ref={textCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setTextFiles((prev) => [...prev, f]); e.target.value = ""; }} />
              {textFiles.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" data-testid="text-attachments">
                  {textFiles.map((f, i) => (
                    <li key={i} data-testid={`text-attachments-chip-${i}`} className="inline-flex items-center gap-1.5 border border-hairline-strong/40 bg-primary-tint text-primary-text px-2.5 py-1 text-xs text-label max-w-[200px] rounded-md">
                      <FileIcon size={12} weight="bold" /> <span className="truncate">{f.name}</span>
                      <button onClick={() => setTextFiles(textFiles.filter((_, j) => j !== i))} data-testid={`text-attachments-remove-${i}`} className="ml-0.5 hover:text-primary-text"><X size={12} weight="bold" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            )}
          </div>

          {/* WAY 3 — Create from an image or file */}
          {captureExpanded && (
          <div className="rounded-lg border border-hairline bg-surface p-6" data-testid="capture-upload">
            <p className="text-label text-primary-text mb-2">Way 3 · Upload an image or file</p>
            <div className="flex items-start gap-2 mb-4">
              <UploadSimple size={20} weight="bold" className="text-primary-text mt-0.5 shrink-0" />
              <div>
                <p className="font-bold tracking-tight text-sm">No need to speak or type — the file is the directive</p>
                <p className="text-xs text-text-secondary">Upload files or snap photos of an order, invoice, list, business card, PDF, Word or Excel. Add <strong>several pages together</strong> (e.g. front &amp; back of a card, a multi-page order) — AI reads them all as one and proposes the decision, tasks, assignments &amp; deadlines, then it goes to Review &amp; Approve.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => uploadRef.current?.click()} data-testid="attach-file-button"
                className="flex items-center gap-2 border border-hairline px-4 py-2 text-sm font-semibold hover:bg-surface-hover transition-colors rounded-md">
                <UploadSimple size={16} weight="bold" /> Upload image / PDF / doc
              </button>
              <input ref={uploadRef} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden"
                onChange={(e) => { setUploadFiles((prev) => [...prev, ...Array.from(e.target.files || [])]); e.target.value = ""; }} />
              <button onClick={() => uploadCameraRef.current?.click()} data-testid="capture-photo-button"
                className="flex items-center gap-2 border border-hairline px-4 py-2 text-sm font-semibold hover:bg-surface-hover transition-colors rounded-md">
                <Camera size={16} weight="bold" /> Capture photo
              </button>
              <input ref={uploadCameraRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setUploadFiles((prev) => [...prev, f]); e.target.value = ""; }} />
              {/* Secondary: a second solid slab here would mean two primaries on
                  one screen and neither would read as the one that matters. */}
              <Button
                variant="secondary"
                onClick={structureFiles}
                disabled={busy || uploadFiles.length === 0}
                data-testid="structure-file-button"
                leadingIcon={<Brain size={16} weight="bold" />}
              >
                Analyse &amp; structure
              </Button>
            </div>
            {uploadFiles.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2" data-testid="attachment-chips">
                {uploadFiles.map((f, i) => (
                  <li key={i} data-testid={`attachment-chip-${i}`} className="inline-flex items-center gap-1.5 border border-hairline-strong/40 bg-primary-tint text-primary-text px-2.5 py-1 text-xs text-label max-w-[220px] rounded-md">
                    <FileIcon size={12} weight="bold" /> <span className="truncate">{f.name}</span>
                    <button onClick={() => setUploadFiles(uploadFiles.filter((_, j) => j !== i))} data-testid={`attachment-remove-${i}`} className="ml-0.5 hover:text-primary-text"><X size={12} weight="bold" /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
        </div>
      ) : (
        <div className="border border-hairline bg-status-pending-bg p-4 text-sm mb-8 rounded-md" data-testid="owner-only-notice">
          Voice/text capture isn't enabled for your access. Your inbox below shows everything happening across the business.
        </div>
      )}

      {/* Everything the brief counted but did not show starts here. */}
      <div ref={restRef} aria-hidden="true" data-testid="desk-rest-anchor" />

      {/* Approvals hold their own space while the decisions query is in flight.
          Without this the whole lower page jumped up by a card height the
          moment it resolved. */}
      {deskLoading && hasPerm(user, "decisions_approve") && (
        <div className="mb-10">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-6 w-72" />
          <div className="mt-4">
            <SkeletonRows rows={1} testid="approvals-skeleton" />
          </div>
        </div>
      )}

      {/* Pending approvals (owner).
          One card, not six. Six full approval cards is 1,800px of identical
          chrome demanding the same act six times, and the sixth is no more
          decidable than the first — a queue rendered at full size reads as a
          workload, not as a decision.

          The count is stated in words above the card, because "5 more" in
          grey is exactly the subtlety that made the old Desk feel like it was
          managing the founder's attention rather than reporting to them. */}
      {hasPerm(user, "decisions_approve") && pending.length > 0 && (
        <div className="mb-10" data-testid="approvals-section">
          <h2 className="text-2xl font-extrabold tracking-tight mb-1">{t("inbox.decision_approvals")}</h2>
          <p className="text-lg text-text-secondary mb-4" data-testid="approvals-waiting-line">
            {pending.length === 1
              ? "1 decision still needs you."
              : `${pending.length} decisions still need you.`}
            {!approvalsExpanded && pending.length > 1 && " Here is the one that has waited longest."}
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {(approvalsExpanded ? pending : pending.slice(0, 1)).map((d) => (
              <PendingApprovalCard
                key={d.id}
                d={d}
                members={members}
                roleOptions={roleOptions}
                onApprove={(id) => decide(id, "approve")}
                onReject={(id) => decide(id, "reject")}
                onRefresh={refresh}
                onDiscuss={setOpenDecision}
                highlight={highlightId === d.id}
              />
            ))}
          </div>
          {pending.length > 1 && (
            <div className="mt-4">
              <Button
                variant="secondary"
                onClick={() => setApprovalsExpanded((v) => !v)}
                data-testid="approvals-toggle"
              >
                {approvalsExpanded
                  ? "Show only the longest waiting"
                  : `Show all ${pending.length} decisions`}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Needs your attention (escalations & handoffs) */}
      {escalations.length > 0 && (
        <div className="mb-10" data-testid="needs-attention-section">
          <h2 className="text-2xl font-extrabold tracking-tight mb-4 flex items-center gap-2">
            <WarningCircle size={22} weight="bold" className="text-primary-text" /> {t("inbox.needs_attention")}
            <span className="min-w-5 h-5 px-1.5 flex items-center justify-center text-xs border border-hairline bg-primary text-primary-foreground rounded-md">{escalations.length}</span>
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {escalations.map((t) => (
              <EscalationCard key={t.id} t={t} onRespond={respondEscalation} highlight={highlightId === t.id} />
            ))}
          </div>
        </div>
      )}

      {/* Tasks feed */}
      <h2 className="text-2xl font-extrabold tracking-tight mb-4">{t("inbox.tasks_activity")}</h2>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="inbox-filters">
        {/* Counts were red badges — "there are two customer items" is not an
            alarm, and a row of red numbers made routine filtering look like a
            list of problems. */}
        <FilterPills
          label={t("inbox.tasks_activity")}
          value={filter}
          onValueChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f,
            label: f === "all" ? t("inbox.filter_all") : CLASS_META[f]?.label || f,
            count: f === "all" ? inbox.open_total : inbox.counts?.[f] || 0,
            testid: `inbox-filter-${f}`,
          }))}
        />
        {processing && <span className="flex items-center gap-1.5 text-xs text-text-secondary"><ArrowClockwise size={14} className="animate-spin" /> {t("inbox.processing")}</span>}
      </div>

      {/* Unified feed */}
      <p className="sm:hidden text-[11px] text-text-secondary mb-2 flex items-center gap-2" data-testid="inbox-swipe-hint">
        <Eye size={12} weight="bold" /> {t("inbox.swipe_hint")}
      </p>
      <div className="space-y-2 mb-4" data-testid="inbox-feed">
        {/* The feed needs all three: the rows come from /inbox, but whether a
            row counts as "today" is decided against decisions and tasks. An
            empty state rendered before those arrive would claim the day is
            clear when it is only unmeasured — the worst thing this screen
            could say. */}
        {feedLoading && <SkeletonRows rows={4} testid="feed-skeleton" />}
        {!feedLoading && feedItems.length === 0 && (
          <EmptyState
            title={feedShowAll ? t("inbox.inbox_zero") : "Nothing in the feed needs you today"}
            hint={feedShowAll ? t("inbox.inbox_zero_hint") : "Everything here is either scheduled for later or already closed."}
          />
        )}
          {!feedLoading && feedItems.map((it) => {
          const meta = CLASS_META[it.classification] || CLASS_META.task;
          const Icon = meta.icon;
          const done = it.status === "done";
          const dec = it.ref_type === "decision" ? decMap[it.ref_id] : null;
          const decTasks = dec?.tasks || [];
          const pendingApproval = dec?.status === "pending_approval";
          let onRight = null, rightLabel = "View";
          if (it.ref_type === "ingestion" || it.classification === "complaint") { onRight = () => openItem(it); rightLabel = "View"; }
          else if (decTasks.length > 0) { onRight = () => navigate("/my-work?view=board"); rightLabel = "Board"; }
          else if (!done) { onRight = () => setStatus(it.id, "done"); rightLabel = "Done"; }
          return (
            <SwipeRow key={it.id} testid={`inbox-swipe-${it.id}`} onRight={onRight} rightLabel={rightLabel}
              onLeft={() => setStatus(it.id, "dismissed")}>
              <div data-testid={`inbox-item-${it.id}`} className={`p-3 flex items-center gap-3 flex-wrap ${done ? "opacity-60" : ""}`}>
                {/* The icon carries the category; the colour used to, and that
                    is what made the palette a filing system instead of a signal. */}
                <div className="w-9 h-9 shrink-0 flex items-center justify-center rounded-md border border-hairline bg-surface-sunken text-text-secondary"><Icon size={18} weight="bold" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip value={meta.label} data-testid={`inbox-class-${it.id}`} />
                    {it.duplicateCount > 1 && (
                      <span
                        data-testid={`inbox-duplicate-count-${it.id}`}
                        title={`This arrived ${it.duplicateCount} times — collapsed into one row`}
                        className="inline-flex items-center rounded-pill bg-surface-sunken px-2 py-0.5 text-badge font-semibold text-text-secondary"
                      >
                        {it.duplicateCount}×
                      </span>
                    )}
                    <span className="text-label text-text-secondary">{it.source}</span>
                    {it.amount != null && <span className="text-xs font-semibold">{money(it.amount)}</span>}
                    {decTasks.length > 0 && (
                      <span data-testid={`inbox-tasks-badge-${it.id}`}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold  border border-hairline ${pendingApproval ? "bg-status-pending-bg" : "bg-surface"} rounded-md`}>
                        <CheckSquare size={11} weight="bold" /> {decTasks.length} task{decTasks.length > 1 ? "s" : ""}{pendingApproval ? " · Pending your approval" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold mt-1 truncate">{it.title}</p>
                  {it.preview && <p className="text-xs text-text-secondary truncate">{it.preview}</p>}
                </div>
                <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                  {pendingApproval && hasPerm(user, "decisions_approve") && (
                    <button onClick={() => decide(dec.id, "approve")} data-testid={`inbox-approve-tasks-${it.id}`}
                      className="flex items-center gap-1 text-xs font-semibold border border-hairline px-2 py-1 bg-success-600 text-white hover:shadow-xs transition-all rounded-md">
                      <CheckCircle size={13} weight="bold" /> Approve
                    </button>
                  )}
                  {decTasks.length > 0 && (
                    <button onClick={() => navigate("/my-work?view=board")} data-testid={`inbox-view-board-${it.id}`}
                      className="text-xs font-semibold border border-hairline px-2 py-1 hover:bg-primary hover:text-white transition-colors rounded-md">Board</button>
                  )}
                  {(it.ref_type === "ingestion" || it.classification === "complaint") && (
                    <button onClick={() => openItem(it)} data-testid={`inbox-open-${it.id}`} className="text-xs font-semibold border border-hairline px-2 py-1 hover:bg-primary hover:text-white transition-colors rounded-md">View</button>
                  )}
                  {!done && (
                    <Tooltip label="Mark done">
                      <button onClick={() => setStatus(it.id, "done")} data-testid={`inbox-done-${it.id}`} aria-label="Mark done" className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-success-600 hover:text-white transition-colors rounded-md"><Check size={14} weight="bold" /></button>
                    </Tooltip>
                  )}
                  <Tooltip label="Dismiss">
                    <button onClick={() => setStatus(it.id, "dismissed")} data-testid={`inbox-dismiss-${it.id}`} aria-label="Dismiss" className="w-8 h-8 flex items-center justify-center border border-hairline hover:bg-destructive-tint transition-colors rounded-md"><X size={14} weight="bold" /></button>
                  </Tooltip>
                </div>
              </div>
            </SwipeRow>
          );
        })}
      </div>

      {/* Always rendered, never conditional on something being hidden. A
          disclosure that appears only when it has something to disclose is a
          disclosure you cannot trust the absence of. */}
      <div className="mb-10 flex items-center gap-3" data-testid="feed-disclosure">
        <Button
          variant="secondary"
          onClick={() => setFeedShowAll((v) => !v)}
          data-testid="feed-show-all"
        >
          {feedShowAll ? "Show only what needs you today" : `Show everything (${items.length})`}
        </Button>
        <span className="text-sm text-text-secondary" data-testid="feed-hidden-count">
          {feedShowAll
            ? `Showing all ${items.length}.`
            : feedHiddenCount === 0
            ? "Nothing is hidden."
            : `${feedHiddenCount} not needed today — scheduled later or already closed.`}
        </span>
      </div>
    </div>
  );
}

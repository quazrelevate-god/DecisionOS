import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { money } from "../lib/format";
import { toast } from "sonner";
import {
  Microphone, Stop, PaperPlaneTilt, CheckCircle, XCircle, Spinner,
  UsersThree, Truck, Receipt, CurrencyCircleDollar, Warning, CheckSquare,
  SealCheck, Bell, Brain, FileArrowUp, Check, X, ArrowClockwise, User, UserPlus,
} from "@phosphor-icons/react";

function PendingApprovalCard({ d, members, roleOptions, onApprove, onReject, onRefresh }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", assignee_id: "", assignee_role: "", priority: "medium" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const inp = "w-full border border-black px-2 py-1.5 text-xs font-mono focus:outline-none";

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
    <div data-testid={`decision-card-${d.id}`} className="card-brutal p-5">
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <Chip value={d.status} data-testid={`decision-status-${d.id}`} />
        {d.dtype && <Chip value={d.dtype} className="bg-brand-blue text-white" />}
      </div>
      <p className="font-heading font-bold text-lg leading-tight">{d.title}</p>
      {d.summary && <p className="text-sm text-muted-foreground mt-2">{d.summary}</p>}
      {d.tasks?.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid={`decision-tasks-${d.id}`}>
          {d.tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 border border-black/15 px-3 py-2">
              <span className="text-sm">{t.title}</span>
              {t.assignee_name ? (
                <span className="inline-flex items-center gap-1 bg-brand-ink text-white px-2 py-0.5 text-xs font-semibold shrink-0">
                  <User size={11} weight="bold" /> {t.assignee_name}
                </span>
              ) : t.assignee_role ? (
                <Chip value={t.assignee_role} className="bg-white shrink-0" />
              ) : (
                <span className="text-xs text-muted-foreground italic shrink-0">Unassigned</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-3 border border-dashed border-black/40 p-3 space-y-2" data-testid={`add-task-form-${d.id}`}>
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
            <button data-testid={`add-task-save-${d.id}`} onClick={addTask} className="flex-1 bg-brand-ink text-white py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-brand-red transition-colors">Add</button>
            <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black hover:bg-black/5">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} data-testid={`add-member-${d.id}`}
          className="mt-3 w-full flex items-center justify-center gap-2 border border-dashed border-black/50 py-2 text-xs font-semibold uppercase tracking-wider hover:bg-black/5 transition-colors">
          <UserPlus size={15} weight="bold" /> Add team member / task
        </button>
      )}

      <div className="flex gap-2 mt-4">
        <button onClick={() => onApprove(d.id)} data-testid={`inbox-approve-${d.id}`}
          className="flex-1 flex items-center justify-center gap-2 bg-brand-blue text-white py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">
          <CheckCircle size={16} weight="bold" /> Approve
        </button>
        <button onClick={() => onReject(d.id)} data-testid={`inbox-reject-${d.id}`}
          className="flex items-center gap-2 bg-white py-2 px-4 text-sm font-semibold uppercase tracking-wider border border-black hover:bg-brand-ink hover:text-white transition-colors">
          <XCircle size={16} weight="bold" /> Reject
        </button>
      </div>
    </div>
  );
}

const PROCESSING = ["queued", "transcribing", "structuring"];

const CLASS_META = {
  customer: { icon: UsersThree, color: "bg-brand-blue text-white", label: "Customer" },
  supplier: { icon: Truck, color: "bg-brand-yellow text-black", label: "Supplier" },
  invoice: { icon: Receipt, color: "bg-brand-ink text-white", label: "Invoice" },
  payment: { icon: CurrencyCircleDollar, color: "bg-green-600 text-white", label: "Payment" },
  complaint: { icon: Warning, color: "bg-purple-600 text-white", label: "Complaint" },
  task: { icon: CheckSquare, color: "bg-white text-black", label: "Task" },
  approval: { icon: SealCheck, color: "bg-brand-red text-white", label: "Approval" },
  reminder: { icon: Bell, color: "bg-brand-yellow text-black", label: "Reminder" },
  decision: { icon: Brain, color: "bg-brand-blue text-white", label: "Decision" },
};
const FILTERS = ["all", "customer", "supplier", "invoice", "payment", "complaint", "task", "approval", "reminder"];

function useElapsed(active) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active) return setT(0);
    const i = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, [active]);
  return t;
}

export default function Inbox() {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState("auto");
  const [filter, setFilter] = useState("all");
  const languageRef = useRef("auto");
  languageRef.current = language;
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const elapsed = useElapsed(recording);
  const canUpload = hasPerm(user, "data_input");

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
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), enabled: user?.role === "owner" });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["voice-notes"] });
    qc.invalidateQueries({ queryKey: ["decisions"] });
    qc.invalidateQueries({ queryKey: ["inbox"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "note.webm");
        fd.append("language", languageRef.current);
        setBusy(true);
        try {
          await api.post("/voice-notes", fd, { headers: { "Content-Type": "multipart/form-data" } });
          toast.success("Voice note uploaded — processing…");
          refresh();
        } catch { toast.error("Upload failed"); } finally { setBusy(false); }
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
    } catch { toast.error("Microphone access denied"); }
  };
  const stopRec = () => { mediaRef.current?.stop(); setRecording(false); };

  const submitText = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post("/voice-notes/text", { text, language });
      setText("");
      toast.success("Directive submitted — structuring…");
      refresh();
    } catch { toast.error("Submit failed"); } finally { setBusy(false); }
  };

  const decide = async (id, action) => {
    try { await api.post(`/decisions/${id}/${action}`); toast.success(`Decision ${action}d`); refresh(); }
    catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
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
  const inbox = inboxQ.data || { items: [], counts: {}, open_total: 0 };
  const items = (inbox.items || []).filter((i) => i.status !== "dismissed" && (filter === "all" || i.classification === filter));
  const pending = (decisionsQ.data || []).filter((d) => d.status === "pending_approval");

  return (
    <div>
      <PageHeader eyebrow="Your day in one place" title="Inbox">
        {canUpload && (
          <button data-testid="inbox-upload-button" onClick={() => navigate("/ingest")}
            className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
            <FileArrowUp size={16} weight="bold" /> Upload data
          </button>
        )}
      </PageHeader>

      {/* Capture */}
      {user?.role === "owner" ? (
        <div className="grid lg:grid-cols-2 gap-4 mb-8">
          <div className="card-brutal p-6 flex flex-col items-center justify-center text-center">
            <button onClick={recording ? stopRec : startRec} disabled={busy} data-testid="voice-record-button"
              className={`w-24 h-24 flex items-center justify-center border border-black transition-all ${recording ? "bg-brand-red text-white recording-pulse" : "bg-brand-ink text-white hover:shadow-brutal"}`}>
              {recording ? <Stop size={38} weight="fill" /> : <Microphone size={38} weight="fill" />}
            </button>
            <p className="mt-4 font-heading font-bold uppercase tracking-tight">{recording ? "Recording…" : busy ? "Uploading…" : "Tap to speak a decision"}</p>
            <p className="font-mono text-sm text-muted-foreground mt-1" data-testid="record-timer">{recording ? mmss : "AI structures it into tasks"}</p>
            <div className="flex border border-black mt-4" data-testid="language-selector">
              {[{ key: "auto", label: "Auto" }, { key: "en", label: "EN" }, { key: "ta", label: "தமிழ்" }, { key: "tanglish", label: "Tanglish" }].map((l) => (
                <button key={l.key} onClick={() => setLanguage(l.key)} data-testid={`lang-${l.key}`}
                  className={`px-3 py-1.5 text-xs font-semibold border-r border-black last:border-r-0 transition-colors ${language === l.key ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>{l.label}</button>
              ))}
            </div>
          </div>
          <div className="card-brutal p-6">
            <p className="label-mono text-muted-foreground mb-3">Type a directive</p>
            <textarea data-testid="text-directive-input" value={text} onChange={(e) => setText(e.target.value)} rows={5}
              placeholder="e.g. Tell sales to send the revised quote to the Delhi retailer by Friday and ask finance to clear the packaging invoice."
              className="w-full border border-black p-3 text-sm font-mono focus:outline-none focus:shadow-brutal-sm transition-shadow resize-none" />
            <button onClick={submitText} disabled={busy || !text.trim()} data-testid="submit-text-directive"
              className="mt-3 flex items-center gap-2 bg-brand-red text-white px-5 py-2.5 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50">
              <PaperPlaneTilt size={16} weight="bold" /> Structure it
            </button>
          </div>
        </div>
      ) : (
        <div className="border border-black bg-brand-yellow/40 p-4 text-sm mb-8" data-testid="owner-only-notice">
          Voice/text capture is owner-only. Your inbox below shows everything happening across the business.
        </div>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-4" data-testid="inbox-filters">
        {FILTERS.map((f) => {
          const active = filter === f;
          const n = f === "all" ? inbox.open_total : (inbox.counts?.[f] || 0);
          const label = f === "all" ? "All" : CLASS_META[f]?.label || f;
          return (
            <button key={f} data-testid={`inbox-filter-${f}`} onClick={() => setFilter(f)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider border border-black transition-colors ${active ? "bg-brand-ink text-white" : "bg-white hover:bg-black/5"}`}>
              {label}{n > 0 && <span className={`min-w-4 h-4 px-1 flex items-center justify-center text-[10px] border border-black ${active ? "bg-white text-black" : "bg-brand-red text-white"}`}>{n}</span>}
            </button>
          );
        })}
        {processing && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ArrowClockwise size={14} className="animate-spin" /> processing…</span>}
      </div>

      {/* Unified feed */}
      <div className="space-y-2 mb-10" data-testid="inbox-feed">
        {items.length === 0 && <EmptyState title="Inbox zero" hint="Captured voice notes, uploads, invoices, payments and complaints will appear here — classified automatically." />}
        {items.map((it) => {
          const meta = CLASS_META[it.classification] || CLASS_META.task;
          const Icon = meta.icon;
          const done = it.status === "done";
          return (
            <div key={it.id} data-testid={`inbox-item-${it.id}`} className={`border border-black bg-white p-3 flex items-center gap-3 flex-wrap ${done ? "opacity-60" : ""}`}>
              <div className={`w-9 h-9 shrink-0 flex items-center justify-center border border-black ${meta.color}`}><Icon size={18} weight="bold" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip value={meta.label} className={meta.color} data-testid={`inbox-class-${it.id}`} />
                  <span className="label-mono text-muted-foreground">{it.source}</span>
                  {it.amount != null && <span className="text-xs font-semibold">{money(it.amount)}</span>}
                </div>
                <p className="text-sm font-semibold mt-1 truncate">{it.title}</p>
                {it.preview && <p className="text-xs text-muted-foreground truncate">{it.preview}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {(it.ref_type === "ingestion" || it.classification === "complaint") && (
                  <button onClick={() => openItem(it)} data-testid={`inbox-open-${it.id}`} className="text-xs font-semibold uppercase tracking-wider border border-black px-2 py-1 hover:bg-brand-ink hover:text-white transition-colors">View</button>
                )}
                {!done && <button onClick={() => setStatus(it.id, "done")} data-testid={`inbox-done-${it.id}`} title="Mark done" className="w-8 h-8 flex items-center justify-center border border-black hover:bg-green-600 hover:text-white transition-colors"><Check size={14} weight="bold" /></button>}
                <button onClick={() => setStatus(it.id, "dismissed")} data-testid={`inbox-dismiss-${it.id}`} title="Dismiss" className="w-8 h-8 flex items-center justify-center border border-black hover:bg-brand-red hover:text-white transition-colors"><X size={14} weight="bold" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pending approvals (owner) */}
      {user?.role === "owner" && pending.length > 0 && (
        <>
          <h2 className="font-heading text-2xl font-extrabold uppercase tracking-tight mb-4">Pending Approvals</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {pending.map((d) => (
              <PendingApprovalCard
                key={d.id}
                d={d}
                members={members}
                roleOptions={roleOptions}
                onApprove={(id) => decide(id, "approve")}
                onReject={(id) => decide(id, "reject")}
                onRefresh={refresh}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

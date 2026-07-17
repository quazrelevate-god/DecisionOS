import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { toast } from "sonner";
import { timeAgo, fullTime } from "../lib/format";
import { userPerms } from "../lib/perms";
import { Plus, User, Paperclip, ClockCounterClockwise } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const COLUMNS = [
  { key: "blocked", label: "Pending Approval" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];
const NEXT = { blocked: null, todo: "in_progress", in_progress: "done", done: "todo" };

export const TASK_TYPES = [
  { key: "operational", label: "Operational" },
  { key: "sales", label: "Sales" },
  { key: "purchase", label: "Purchase" },
  { key: "production", label: "Production" },
  { key: "finance", label: "Finance" },
  { key: "hr", label: "HR" },
  { key: "other", label: "Other" },
];

export const OP_CATEGORIES = [
  "Presentation", "Meeting", "Documentation", "Proposal", "Planning", "Review",
  "Administration", "Compliance", "Marketing", "HR Activity", "Travel", "Event", "IT Support", "Other",
];

const EMPTY_FORM = {
  title: "", description: "", task_type: "operational", op_category: "Presentation",
  assignee_id: "", assignee_role: "", support_id: "", priority: "medium",
  due_date: "", due_time: "", expected_output: "", approval_required: false, approver_id: "",
};

export function NewTaskDialog({ onCreated, roleOptions, members, defaultType, triggerClassName }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, task_type: defaultType || "operational" });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isOp = form.task_type === "operational";

  const create = async () => {
    if (!form.title.trim()) return toast.error("Task title is required");
    setBusy(true);
    try {
      const { data: task } = await api.post("/tasks", {
        title: form.title, description: form.description,
        task_type: form.task_type,
        op_category: isOp ? form.op_category : null,
        assignee_id: form.assignee_id || null,
        assignee_role: form.assignee_id ? null : (form.assignee_role || null),
        support_id: form.support_id || null,
        priority: form.priority,
        due_date: form.due_date || null,
        due_time: form.due_time || null,
        expected_output: form.expected_output || null,
        approval_required: form.approval_required,
        approver_id: form.approval_required ? (form.approver_id || null) : null,
      });
      if (file && task?.id) {
        const fd = new FormData();
        fd.append("file", file, file.name);
        fd.append("kind", "file");
        try { await api.post(`/tasks/${task.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } }); }
        catch { toast.error("Task created, but attachment upload failed"); }
      }
      toast.success("Task created");
      setForm({ ...EMPTY_FORM, task_type: defaultType || "operational" });
      setFile(null);
      setOpen(false);
      onCreated();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setBusy(false); }
  };

  const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm bg-white";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-task-button" className={triggerClassName || "flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all"}>
          <Plus size={16} weight="bold" /> New Task
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading uppercase tracking-tight">New Task</DialogTitle>
          <DialogDescription className="label-mono text-muted-foreground">Capture any company task — operational or department work.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input data-testid="task-title-input" className={inp} placeholder="Task title" value={form.title} onChange={set("title")} />
          <textarea data-testid="task-description-input" className={inp} rows={2} placeholder="Description" value={form.description} onChange={set("description")} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-mono text-muted-foreground">Task type</label>
              <select data-testid="task-type-select" className={`${inp} mt-1`} value={form.task_type} onChange={set("task_type")}>
                {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </div>
            {isOp && (
              <div data-testid="op-category-wrap">
                <label className="label-mono text-muted-foreground">Operational category</label>
                <select data-testid="op-category-select" className={`${inp} mt-1`} value={form.op_category} onChange={set("op_category")}>
                  {OP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-mono text-muted-foreground">Assigned employee</label>
              <select data-testid="task-member-select" className={`${inp} mt-1`} value={form.assignee_id} onChange={set("assignee_id")}>
                <option value="">— Pick a person —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
            </div>
            <div>
              <label className="label-mono text-muted-foreground">Supporting employee (optional)</label>
              <select data-testid="task-support-select" className={`${inp} mt-1`} value={form.support_id} onChange={set("support_id")}>
                <option value="">— None —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
            </div>
          </div>
          {!form.assignee_id && (
            <div>
              <label className="label-mono text-muted-foreground">…or assign by team/role</label>
              <select data-testid="task-role-select" className={`${inp} mt-1`} value={form.assignee_role} onChange={set("assignee_role")}>
                <option value="">Any / unassigned</option>
                {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label-mono text-muted-foreground">Priority</label>
              <select data-testid="task-priority-select" className={`${inp} mt-1`} value={form.priority} onChange={set("priority")}>
                {["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="label-mono text-muted-foreground">Due date</label>
              <input data-testid="task-due-date" type="date" className={`${inp} mt-1`} value={form.due_date} onChange={set("due_date")} />
            </div>
            <div>
              <label className="label-mono text-muted-foreground">Due time</label>
              <input data-testid="task-due-time" type="time" className={`${inp} mt-1`} value={form.due_time} onChange={set("due_time")} />
            </div>
          </div>
          <input data-testid="task-expected-output" className={inp} placeholder="Expected output (e.g. Final deck in PDF)" value={form.expected_output} onChange={set("expected_output")} />
          <label className="flex items-center gap-2 text-sm font-mono cursor-pointer">
            <input data-testid="task-approval-required" type="checkbox" className="w-4 h-4 border border-black" checked={form.approval_required} onChange={(e) => setForm({ ...form, approval_required: e.target.checked })} />
            Approval required
          </label>
          {form.approval_required && (
            <div data-testid="task-approver-wrap">
              <label className="label-mono text-muted-foreground">Approver</label>
              <select data-testid="task-approver-select" className={`${inp} mt-1`} value={form.approver_id} onChange={set("approver_id")}>
                <option value="">— Anyone with approval access —</option>
                {members.filter((m) => m.role === "owner" || userPerms(m).includes("approvals")).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
              <p className="label-mono text-muted-foreground mt-1">Grant approval access to a user in People → Access Control.</p>
            </div>
          )}
          <div>
            <label className="label-mono text-muted-foreground flex items-center gap-1"><Paperclip size={12} weight="bold" /> Attachment</label>
            <input data-testid="task-attachment-input" type="file" className={`${inp} mt-1`} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </div>
          <p className="label-mono text-muted-foreground">Created by: {user?.name}</p>
        </div>
        <DialogFooter>
          <button data-testid="task-create-submit" onClick={create} disabled={busy} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all disabled:opacity-50">{busy ? "Creating…" : "Create"}</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskBoard() {
  const qc = useQueryClient();
  const { tenant, user } = useAuth();
  const isOwner = user?.role === "owner";
  const [mine, setMine] = useState(false);
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];
  const { data } = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data) });
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const members = users || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["tasks", mine] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const move = async (t) => {
    const next = NEXT[t.status];
    if (!next) return toast.info("Task is blocked until its decision is approved");
    try { await api.patch(`/tasks/${t.id}`, { status: next }); invalidate(); }
    catch { toast.error("Update failed"); }
  };

  const reassign = async (t, memberId) => {
    if (!memberId) return;
    try {
      const { data: updated } = await api.patch(`/tasks/${t.id}`, { assignee_id: memberId });
      toast.success(`Assigned to ${updated.assignee_name || "member"}`);
      invalidate();
    } catch { toast.error("Reassign failed"); }
  };

  const overdue = (t) => t.due_date && new Date(t.due_date) < new Date() && t.status !== "done";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        {isOwner ? (
          <button onClick={() => setMine(!mine)} data-testid="toggle-mine"
            className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black transition-colors ${mine ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>
            {mine ? "My Tasks" : "All Tasks"}
          </button>
        ) : (
          <span data-testid="lane-badge" className="px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black bg-brand-blue text-white">
            {user?.role} lane
          </span>
        )}
        <NewTaskDialog onCreated={invalidate} roleOptions={roleOptions} members={members} />
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = (data || []).filter((t) => t.status === col.key);
          return (
            <div key={col.key} data-testid={`task-column-${col.key}`} className="border border-black bg-white">
              <div className="px-4 py-3 border-b border-black flex items-center justify-between bg-brand-paper">
                <p className="label-mono">{col.label}</p>
                <span className="font-heading font-black">{cards.length}</span>
              </div>
              <div className="p-3 space-y-3 min-h-[200px]">
                {cards.length === 0 && <p className="text-xs text-muted-foreground p-2">Empty</p>}
                {cards.map((t) => (
                  <div key={t.id} data-testid={`task-card-${t.id}`} className="border border-black p-3 shadow-hover">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm leading-tight">{t.title}</p>
                      <Chip value={t.priority} />
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {t.assignee_name ? (
                        <span data-testid={`task-assignee-${t.id}`} className="inline-flex items-center gap-1 bg-brand-ink text-white px-2 py-0.5 text-xs font-semibold">
                          <User size={11} weight="bold" /> {t.assignee_name}
                        </span>
                      ) : t.assignee_role ? (
                        <Chip value={t.assignee_role} className="bg-white" data-testid={`task-assignee-${t.id}`} />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Unassigned</span>
                      )}
                      {overdue(t) && <Chip value="overdue" className="bg-brand-red text-white" />}
                    </div>
                    {t.updated_at && (
                      <p className="label-mono text-muted-foreground mt-2 flex items-center gap-1" data-testid={`task-updated-${t.id}`} title={fullTime(t.updated_at)}>
                        <ClockCounterClockwise size={11} weight="bold" /> {t.last_action || "Updated"} · {timeAgo(t.updated_at)}
                      </p>
                    )}
                    <select
                      data-testid={`reassign-task-${t.id}`}
                      value={t.assignee_id || ""}
                      onChange={(e) => reassign(t, e.target.value)}
                      className="mt-3 w-full border border-black px-2 py-1.5 text-xs font-mono bg-white focus:outline-none focus:shadow-brutal-sm">
                      <option value="">Reassign to…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
                    </select>
                    {NEXT[t.status] && (
                      <button onClick={() => move(t)} data-testid={`advance-task-${t.id}`}
                        className="mt-2 w-full border border-black py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
                        Move to {NEXT[t.status].replace(/_/g, " ")}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

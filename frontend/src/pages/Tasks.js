import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { toast } from "sonner";
import { Plus, User } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const COLUMNS = [
  { key: "blocked", label: "Pending Approval" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];
const NEXT = { blocked: null, todo: "in_progress", in_progress: "done", done: "todo" };

function NewTaskDialog({ onCreated, roleOptions, members }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assignee_id: "", assignee_role: "", priority: "medium", due_in_days: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api.post("/tasks", {
        title: form.title, description: form.description,
        assignee_id: form.assignee_id || null,
        assignee_role: form.assignee_id ? null : (form.assignee_role || null),
        priority: form.priority,
        due_in_days: form.due_in_days ? Number(form.due_in_days) : null,
      });
      toast.success("Task created");
      setForm({ title: "", description: "", assignee_id: "", assignee_role: "", priority: "medium", due_in_days: "" });
      setOpen(false);
      onCreated();
    } catch { toast.error("Create failed"); }
  };
  const inp = "w-full border border-black px-3 py-2 text-sm font-mono focus:outline-none focus:shadow-brutal-sm";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-task-button" className="flex items-center gap-2 bg-brand-ink text-white px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all">
          <Plus size={16} weight="bold" /> New Task
        </button>
      </DialogTrigger>
      <DialogContent className="border border-black rounded-none">
        <DialogHeader><DialogTitle className="font-heading uppercase tracking-tight">New Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input data-testid="task-title-input" className={inp} placeholder="Task title" value={form.title} onChange={set("title")} />
          <textarea className={inp} rows={2} placeholder="Description" value={form.description} onChange={set("description")} />
          <div>
            <label className="label-mono text-muted-foreground">Assign to team member</label>
            <select data-testid="task-member-select" className={`${inp} mt-1`} value={form.assignee_id} onChange={set("assignee_id")}>
              <option value="">— Pick a person —</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </select>
          </div>
          <div>
            <label className="label-mono text-muted-foreground">…or assign by role {form.assignee_id && "(ignored — member selected)"}</label>
            <select data-testid="task-role-select" className={`${inp} mt-1`} value={form.assignee_role} onChange={set("assignee_role")} disabled={!!form.assignee_id}>
              <option value="">Any / unassigned</option>
              {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex gap-3">
            <select className={inp} value={form.priority} onChange={set("priority")}>
              {["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input className={inp} type="number" placeholder="Due in days" value={form.due_in_days} onChange={set("due_in_days")} />
          </div>
        </div>
        <DialogFooter>
          <button data-testid="task-create-submit" onClick={create} className="bg-brand-red text-white px-5 py-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal-sm transition-all">Create</button>
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

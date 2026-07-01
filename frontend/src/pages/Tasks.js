import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { PageHeader, Chip, EmptyState } from "../components/common";
import { toast } from "sonner";
import { Plus } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "../components/ui/dialog";

const COLUMNS = [
  { key: "blocked", label: "Blocked" },
  { key: "todo", label: "To Do" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];
const NEXT = { blocked: null, todo: "in_progress", in_progress: "done", done: "todo" };
const ROLES = ["owner", "sales", "production", "finance"];

function NewTaskDialog({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", assignee_role: "", priority: "medium", due_in_days: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const create = async () => {
    if (!form.title.trim()) return;
    try {
      await api.post("/tasks", {
        title: form.title, description: form.description,
        assignee_role: form.assignee_role || null, priority: form.priority,
        due_in_days: form.due_in_days ? Number(form.due_in_days) : null,
      });
      toast.success("Task created");
      setForm({ title: "", description: "", assignee_role: "", priority: "medium", due_in_days: "" });
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
          <select data-testid="task-role-select" className={inp} value={form.assignee_role} onChange={set("assignee_role")}>
            <option value="">Assign role…</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
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

export default function Tasks() {
  const qc = useQueryClient();
  const [mine, setMine] = useState(false);
  const { data } = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data) });

  const move = async (t) => {
    const next = NEXT[t.status];
    if (!next) return toast.info("Task is blocked until its decision is approved");
    try {
      await api.patch(`/tasks/${t.id}`, { status: next });
      qc.invalidateQueries({ queryKey: ["tasks", mine] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch { toast.error("Update failed"); }
  };

  const overdue = (t) => t.due_date && new Date(t.due_date) < new Date() && t.status !== "done";

  return (
    <div>
      <PageHeader eyebrow="Team execution" title="Tasks">
        <div className="flex items-center gap-3">
          <button onClick={() => setMine(!mine)} data-testid="toggle-mine"
            className={`px-4 py-2 text-sm font-semibold uppercase tracking-wider border border-black transition-colors ${mine ? "bg-brand-blue text-white" : "bg-white hover:bg-black/5"}`}>
            {mine ? "My Tasks" : "All Tasks"}
          </button>
          <NewTaskDialog onCreated={() => qc.invalidateQueries({ queryKey: ["tasks", mine] })} />
        </div>
      </PageHeader>

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
                      {t.assignee_role && <Chip value={t.assignee_role} className="bg-white" />}
                      {overdue(t) && <Chip value="overdue" className="bg-brand-red text-white" />}
                    </div>
                    {NEXT[t.status] && (
                      <button onClick={() => move(t)} data-testid={`advance-task-${t.id}`}
                        className="mt-3 w-full border border-black py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors">
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

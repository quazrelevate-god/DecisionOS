import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
import { timeAgo, fullTime } from "../lib/format";
import { userPerms } from "../lib/perms";
import { Plus, User, Paperclip, ClockCounterClockwise, X } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";

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
  evidence_required: false,
};

/**
 * @param {string} [triggerClassName]   classes for the trigger button
 * @param {node}   [triggerChildren]    KM-2: overrides the default
 *   "+ New Task" label. The phone toolbar renders this as a bare circular
 *   plus inside the task-view lens group, where a worded button would not fit
 *   and would not read as a member of that group.
 * @param {string} [triggerAriaLabel]   required whenever triggerChildren is
 *   icon-only — the default trigger carries its own visible text, an icon
 *   one carries nothing.
 */
export function NewTaskDialog({ onCreated, roleOptions, members, defaultType, triggerClassName, triggerChildren, triggerAriaLabel }) {
  const { user, tenant } = useAuth();
  const cats = opModel(tenant).task_categories;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM, task_type: defaultType || cats[0]?.key || "operational" });
  const [files, setFiles] = useState([]);
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
        evidence_required: form.evidence_required,
      });
      if (files.length && task?.id) {
        for (const f of files) {
          const fd = new FormData();
          fd.append("file", f, f.name);
          fd.append("kind", "reference");
          try { await api.post(`/tasks/${task.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } }); }
          catch { toast.error(`Task created, but "${f.name}" failed to upload`); }
        }
      }
      toast.success("Task created");
      setForm({ ...EMPTY_FORM, task_type: defaultType || "operational" });
      setFiles([]);
      setOpen(false);
      onCreated();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setBusy(false); }
  };

  /* KM-3 — the dialog joins the design system. Was: a hand-rolled
     `border border-border ... font-mono bg-white` field and `label-mono`
     captions, both survivors of the retired brutalist system — a monospace
     form in an app whose whole voice is Urbanist. Now the field is the
     .nm-field recipe (soft-depth control, rounded-control, the outline token
     as its boundary) and labels are plain sans at label weight. */
  /* KM-10 — the fields are SUNKEN now, which is the actual point of a
     neumorphic form. KM-3 moved them off the retired mono/hairline styling
     onto .nm-field, but .nm-field is a RAISED surface with a hairline
     boundary — a white box on a grey sheet — so the form still read flat.
     .kr-pressed is the concave twin: dark inset from the top-left, light
     inset from the bottom-right, no border at all. A field you type into
     should look like a groove, not a card. */
  const inp = "w-full kr-pressed rounded-control border-0 px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40";
  const lbl = "block text-xs font-medium text-muted-foreground";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button data-testid="new-task-button"
          aria-label={triggerAriaLabel}
          title={triggerAriaLabel}
          className={triggerClassName || "flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-sm font-medium border border-border transition-all"}>
          {triggerChildren || (<><Plus size={16} weight="bold" /> New Task</>)}
        </button>
      </DialogTrigger>
      {/* KM-10 — .kr-bento: the app's glass-over-neumorphic tile, so the sheet
          the fields sit in is the same material as every card behind it. The
          default close X is hidden and replaced below, aligned with the title
          rather than floating in the corner. */}
      <DialogContent className="kr-bento max-h-[90vh] overflow-y-auto rounded-cardlg border-0 [&>button.absolute]:hidden">
        <DialogHeader className="pr-11">
          <DialogPrimitiveClose
            data-testid="task-dialog-close"
            aria-label="Close"
            className="kr-pop absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full text-foreground/70">
            <X size={15} weight="bold" aria-hidden="true" />
          </DialogPrimitiveClose>
          <DialogTitle className="font-display text-xl">New Task</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Capture any company task — operational or department work.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input data-testid="task-title-input" className={inp} placeholder="Task title" value={form.title} onChange={set("title")} />
          <textarea data-testid="task-description-input" className={inp} rows={2} placeholder="Description" value={form.description} onChange={set("description")} />
          <div className="kr-form-row">
            <div>
              <label className={lbl}>Task type</label>
              <select data-testid="task-type-select" className={`${inp} mt-1`} value={form.task_type} onChange={set("task_type")}>
                {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            {isOp && (
              <div data-testid="op-category-wrap">
                <label className={lbl}>Operational category</label>
                <select data-testid="op-category-select" className={`${inp} mt-1`} value={form.op_category} onChange={set("op_category")}>
                  {OP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="kr-form-row">
            <div>
              <label className={lbl}>Assigned employee</label>
              <select data-testid="task-member-select" className={`${inp} mt-1`} value={form.assignee_id} onChange={set("assignee_id")}>
                <option value="">— Pick a person —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Supporting employee (optional)</label>
              <select data-testid="task-support-select" className={`${inp} mt-1`} value={form.support_id} onChange={set("support_id")}>
                <option value="">— None —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
            </div>
          </div>
          {!form.assignee_id && (
            <div>
              <label className={lbl}>…or assign by team/role</label>
              <select data-testid="task-role-select" className={`${inp} mt-1`} value={form.assignee_role} onChange={set("assignee_role")}>
                <option value="">Any / unassigned</option>
                {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          )}
          <div className="kr-form-row kr-form-row--3">
            <div>
              <label className={lbl}>Priority</label>
              <select data-testid="task-priority-select" className={`${inp} mt-1`} value={form.priority} onChange={set("priority")}>
                {["low", "medium", "high"].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Due date</label>
              <input data-testid="task-due-date" type="date" className={`${inp} mt-1`} value={form.due_date} onChange={set("due_date")} />
            </div>
            <div>
              <label className={lbl}>Due time</label>
              <input data-testid="task-due-time" type="time" className={`${inp} mt-1`} value={form.due_time} onChange={set("due_time")} />
            </div>
          </div>
          <input data-testid="task-expected-output" className={inp} placeholder="Expected output (e.g. Final deck in PDF)" value={form.expected_output} onChange={set("expected_output")} />
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input data-testid="task-approval-required" type="checkbox" className="w-4 h-4 border border-border" checked={form.approval_required} onChange={(e) => setForm({ ...form, approval_required: e.target.checked })} />
            Approval required
          </label>
          {form.approval_required && (
            <div data-testid="task-approver-wrap">
              <label className={lbl}>Approver</label>
              <select data-testid="task-approver-select" className={`${inp} mt-1`} value={form.approver_id} onChange={set("approver_id")}>
                <option value="">— Anyone with approval access —</option>
                {members.filter((m) => m.role === "owner" || userPerms(m).includes("approvals")).map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
              <p className="label-mono text-muted-foreground mt-1">Grant approval access to a user in People → Access Control.</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input data-testid="task-evidence-required" type="checkbox" className="w-4 h-4 border border-border" checked={form.evidence_required} onChange={(e) => setForm({ ...form, evidence_required: e.target.checked })} />
            Require proof of work before completion
          </label>
          <div>
            <label className="label-mono text-muted-foreground flex items-center gap-1"><Paperclip size={12} weight="bold" /> Reference material (optional)</label>
            <input data-testid="task-attachment-input" type="file" multiple className={`${inp} mt-1`} onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            <p className="label-mono text-muted-foreground mt-1">Attach images, PDFs or docs to give the assignee context. AI reads them and summarises what to do.</p>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="task-attachment-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${f.size}-${f.lastModified}`} className="flex items-center justify-between gap-2 border border-border px-2 py-1 text-xs font-mono">
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-danger-600 font-bold shrink-0">Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className={lbl}>Created by: {user?.name}</p>
        </div>
        <DialogFooter>
          {/* KM-10 — ink, not brand-600 (the retired indigo), and a pill at
              the app's control height. */}
          <button data-testid="task-create-submit" onClick={create} disabled={busy}
            className="kr-lift flex h-11 w-full items-center justify-center rounded-pill bg-kr-ink px-5 text-sm font-medium text-white disabled:opacity-50 sm:w-auto">
            {busy ? "Creating…" : "Create task"}
          </button>
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
            className={`px-4 py-2 text-sm font-medium border border-border transition-colors ${mine ? "bg-primary text-primary-foreground" : "bg-white hover:bg-accent"}`}>
            {mine ? "My Tasks" : "All Tasks"}
          </button>
        ) : (
          <span data-testid="lane-badge" className="px-4 py-2 text-sm font-medium border border-border bg-primary text-primary-foreground">
            {user?.role} lane
          </span>
        )}
        <NewTaskDialog onCreated={invalidate} roleOptions={roleOptions} members={members} />
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = (data || []).filter((t) => t.status === col.key);
          return (
            <div key={col.key} data-testid={`task-column-${col.key}`} className="nm-tile">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-brand-paper">
                <p className="label-mono">{col.label}</p>
                <span className="font-medium">{cards.length}</span>
              </div>
              <div className="p-3 space-y-3 min-h-[200px]">
                {cards.length === 0 && <p className="text-xs text-muted-foreground p-2">Empty</p>}
                {cards.map((t) => (
                  <div key={t.id} data-testid={`task-card-${t.id}`} className="border border-border p-3 shadow-hover">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm leading-tight">{t.title}</p>
                      <Chip value={t.priority} />
                    </div>
                    {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {t.assignee_name ? (
                        <span data-testid={`task-assignee-${t.id}`} className="inline-flex items-center gap-1 bg-primary text-primary-foreground px-2 py-0.5 text-xs font-semibold">
                          <User size={11} weight="bold" /> {t.assignee_name}
                        </span>
                      ) : t.assignee_role ? (
                        <Chip value={t.assignee_role} className="bg-white" data-testid={`task-assignee-${t.id}`} />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Unassigned</span>
                      )}
                      {overdue(t) && <Chip value="overdue" className="bg-danger-600 text-white" />}
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
                      className="mt-3 w-full border border-border px-2 py-1.5 text-xs font-mono bg-white focus:outline-none focus:shadow-sm">
                      <option value="">Reassign to…</option>
                      {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
                    </select>
                    {NEXT[t.status] && (
                      <button onClick={() => move(t)} data-testid={`advance-task-${t.id}`}
                        className="mt-2 w-full border border-border py-1.5 text-xs font-medium hover:bg-accent transition-colors">
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

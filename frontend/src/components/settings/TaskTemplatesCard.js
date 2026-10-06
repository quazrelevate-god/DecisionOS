/* Task templates (2026-10-05).
 *
 * Free-standing task templates were a section at the bottom of Business ›
 * Company Details, sharing that card's save button and state with the
 * company's address, products and teams. The Operations tab's own description
 * already says "task templates" live there, so they do now — a card of their
 * own with their own save, which also ends the old trap where saving one
 * section of the shared card could wipe unsaved edits in another.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ListChecks, Plus, Trash } from "@phosphor-icons/react";
import api, { formatApiError } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../lib/perms";
import { GlassSelect } from "../karma/GlassSelect";
import { DRAWER_FIELD, GLASS_PILL, INK_PILL } from "../karma/glass";

const OP_CATS = ["Presentation", "Meeting", "Documentation", "Proposal", "Planning", "Review", "Administration",
  "Compliance", "Marketing", "HR Activity", "Travel", "Event", "IT Support", "Other"];
const uid = () => Math.random().toString(36).slice(2, 9);

export function TaskTemplatesCard() {
  const { tenant, user, refreshTenant } = useAuth();
  const canManage = hasPerm(user, "team_manage");
  const [opTasks, setOpTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!tenant || dirty.current) return;
    setOpTasks((tenant.operational_task_templates || []).map((t) => ({ title: t.title || "", category: t.category || "Other", _key: uid() })));
  }, [tenant]);

  const touch = () => { dirty.current = true; };
  const add = () => { touch(); setOpTasks((t) => [...t, { title: "", category: "Other", _key: uid() }]); };
  const setField = (i, k, v) => { touch(); setOpTasks((t) => t.map((it, idx) => (idx === i ? { ...it, [k]: v } : it))); };
  const remove = (i) => { touch(); setOpTasks((t) => t.filter((_, idx) => idx !== i)); };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/tenant/os-blueprint", {
        operational_task_templates: opTasks.filter((t) => t.title.trim()).map(({ _key, ...r }) => r),
      });
      dirty.current = false;
      await refreshTenant();
      toast.success("Task templates saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Couldn't save the task templates");
    } finally { setBusy(false); }
  };

  if (!canManage) return null;
  return (
    <div className="kr-bento p-5 sm:p-6" data-testid="os-blueprint-section">
      <h2 className="flex items-center gap-2 text-base font-medium">
        <ListChecks size={18} weight="bold" className="text-muted-foreground" aria-hidden="true" /> Task templates
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Everyday tasks that sit outside a workflow &mdash; a weekly review, a monthly filing. Approvals are set on each task, and on workflow stages above.
      </p>
      <div className="mt-4 space-y-2" data-testid="os-optasks-list">
        {opTasks.map((t, i) => (
          <div key={t._key || i} className="flex gap-2" data-testid={`os-optask-${i}`}>
            <input data-testid={`os-optask-title-${i}`} aria-label="Task title" className={DRAWER_FIELD} value={t.title}
              onChange={(e) => setField(i, "title", e.target.value)} placeholder="Task title" />
            <div className="w-36 shrink-0">
              <GlassSelect variant="field" testid={`os-optask-cat-${i}`} ariaLabel="Task category" align="end"
                value={t.category} onChange={(v) => setField(i, "category", v)}
                options={OP_CATS.map((c) => ({ value: c, label: c }))}
                triggerClassName="h-full min-h-11 rounded-2xl bg-white/80 px-3 text-xs ring-1 ring-inset ring-slate-900/[0.06]" />
            </div>
            <button type="button" onClick={() => remove(i)} data-testid={`os-optask-remove-${i}`} aria-label="Remove task"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600">
              <Trash size={15} weight="bold" aria-hidden="true" />
            </button>
          </div>
        ))}
        {opTasks.length === 0 && <p className="text-sm text-muted-foreground">No task templates yet.</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={add} data-testid="os-optask-add"
          className={`inline-flex h-10 items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-700 hover:bg-white ${GLASS_PILL}`}>
          <Plus size={14} weight="bold" aria-hidden="true" /> Add a template
        </button>
        <button type="button" onClick={save} disabled={busy} data-testid="os-save-button"
          className={`inline-flex h-10 items-center rounded-pill px-4 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
          {busy ? "Saving…" : "Save task templates"}
        </button>
      </div>
    </div>
  );
}

export default TaskTemplatesCard;

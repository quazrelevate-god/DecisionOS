/* The workflow card, opened.
 *
 * Yokesh, 2026-09-21: "When I see the workflow I have to know what is going on
 * in the company. That's the goal of the product." Until this screen existed,
 * nothing in the app could answer that. The board shows a card's CURRENT stage
 * and, at most, the open tasks sitting on it — so a founder looking at "Kumar
 * Fabrics order, In production" could not see what had already been done, who
 * was holding the next piece, what the card was waiting on, or when it had
 * arrived where it is.
 *
 * One request (GET /workflows/{id}) answers all of it, and this drawer is that
 * answer laid out in the order a person asks the questions:
 *
 *   1. Can it move, and if not, WHY NOT              — the banner
 *   2. What has happened, stage by stage             — the rail
 *   3. Who is holding each piece and when it is due  — the tasks under a stage
 *   4. What did people do to it                      — the history
 *
 * And the three things a person could not do at all, which now live here
 * because they are all "a thing you do to a stage":
 *   · add a task to a stage (B1) — the headline gap: the API has always taken
 *     workflow_id + stage_key and NO screen ever sent them, so only the engine
 *     could put work on a card;
 *   · give the approval a stage is waiting for (A3);
 *   · correct the card's own details (A4).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  X, Check, CircleNotch, Plus, PencilSimple, ArrowRight, Clock,
  WarningCircle, SealCheck, CalendarBlank, Lock,
} from "@phosphor-icons/react";

import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { userPerms } from "../../lib/perms";
import { canAssignPerson } from "../../lib/taskAccess";
import { money, timeAgo, fullTime } from "../../lib/format";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "../ui/sheet";
import {
  DRAWER_CARD, DRAWER_FIELD, DRAWER_LABEL, GLASS_PILL, INK_PILL, CHIP, QUIET_CHIP,
} from "../karma/glass";

const CLOSED = new Set(["done", "cancelled"]);

const STATUS_CHIP = {
  done: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  cancelled: "bg-slate-500/[0.07] text-slate-500 ring-slate-500/10",
  in_progress: "bg-sky-50 text-sky-700 ring-sky-100",
  blocked: "bg-amber-50 text-amber-800 ring-amber-100",
  waiting: "bg-amber-50 text-amber-800 ring-amber-100",
};
const STATUS_WORD = {
  todo: "To do", in_progress: "In progress", blocked: "Blocked",
  waiting: "Waiting", done: "Done", cancelled: "Cancelled",
};

function initials(name) {
  if (!name) return "?";
  const p = String(name).trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase() || "?";
}

/** Today / Tomorrow / a date, plus how late it is. Dates only — the hour a
 *  task is due matters to the person doing it, not to the card. */
function dueLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((midnight(d) - midnight(new Date())) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < -1) return `${Math.abs(days)} days ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const isOverdue = (t) => !!t.due_date && !CLOSED.has(t.status) && new Date(t.due_date) < new Date();

/* ─────────────────────────────── one task row ─────────────────────────── */
function TaskRow({ task }) {
  const late = isOverdue(task);
  const waiting = task.waiting_on && Object.keys(task.waiting_on).length > 0;
  return (
    <a
      href={`/my-work?task=${encodeURIComponent(task.id)}`}
      data-testid={`wf-detail-task-${task.id}`}
      className={`flex items-start gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-white/70 ${
        CLOSED.has(task.status) ? "opacity-60" : ""
      }`}
    >
      <span
        title={task.assignee_name || task.assignee_role || "Nobody yet"}
        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
          task.assignee_id ? "bg-slate-900 text-white" : "bg-slate-500/[0.12] text-slate-500"
        }`}
      >
        {task.assignee_id ? initials(task.assignee_name) : "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[13.5px] leading-snug text-slate-800 ${
          task.status === "done" ? "line-through decoration-slate-400" : ""
        }`}>
          {task.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`${CHIP} ${STATUS_CHIP[task.status] || QUIET_CHIP}`}>
            {STATUS_WORD[task.status] || task.status}
          </span>
          {task.due_date && (
            <span className={`${CHIP} ${late ? "bg-rose-50 text-rose-700 ring-rose-100" : QUIET_CHIP}`}>
              <CalendarBlank size={10} weight="bold" aria-hidden="true" />
              {late ? `Due ${dueLabel(task.due_date)}` : `Due ${dueLabel(task.due_date)}`}
            </span>
          )}
          {waiting && (
            <span className={`${CHIP} bg-amber-50 text-amber-800 ring-amber-100`}>
              Waiting on {task.waiting_on.name || "someone"}
            </span>
          )}
          {task.status === "blocked" && (task.depends_on || []).length > 0
            && !(task.approval_required && task.approval_status === "pending") && (
            <span className={`${CHIP} bg-slate-900/[0.07] text-slate-700 ring-slate-900/10`}>
              <Lock size={10} weight="bold" aria-hidden="true" /> Waits for earlier work
            </span>
          )}
          {task.approval_required && task.approval_status === "pending" && (
            <span className={`${CHIP} bg-violet-50 text-violet-700 ring-violet-100`}>
              <Lock size={10} weight="bold" aria-hidden="true" /> Needs approval
            </span>
          )}
          {!task.assignee_id && !task.assignee_role && (
            <span className={`${CHIP} ${QUIET_CHIP}`}>Nobody yet</span>
          )}
        </span>
      </span>
    </a>
  );
}

/* ───────────────────── add a task to THIS stage (B1) ──────────────────── */
function AddTaskToStage({ workflowId, stage, members, user, onAdded, priorTasks = [] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const assignable = useMemo(
    () => (members || []).filter((m) => canAssignPerson(user, m)),
    [members, user],
  );

  const submit = async (e) => {
    e?.preventDefault?.();
    const clean = title.trim();
    if (!clean || busy) return;
    setBusy(true);
    try {
      /* The whole point of this screen. POST /tasks has accepted these two
         fields since the engine was built and no screen had ever sent them,
         so a person could not put work on a workflow at all. A task created
         here counts toward the stage's gate exactly like a template one: the
         card will not advance until it is done. */
      await api.post("/tasks", {
        title: clean,
        workflow_id: workflowId,
        stage_key: stage.key,
        assignee_id: assignee || undefined,
        assignee_role: !assignee ? (stage.owner_role || undefined) : undefined,
        due_date: due || undefined,
        /* D3 — work that has to wait its turn. It starts blocked and opens by
           itself, telling whoever holds it, the moment the task before it is
           done. Offered here because a stage is exactly where order matters:
           "pack it" after "check stock". */
        depends_on: after ? [after] : undefined,
      });
      toast.success(`Added to ${stage.label}`);
      setTitle(""); setAssignee(""); setDue(""); setAfter(""); setOpen(false);
      onAdded?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not add the task.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`wf-add-task-${stage.key}`}
        className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-2xl px-3 py-2 text-[13px] font-medium text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-800"
      >
        <Plus size={13} weight="bold" aria-hidden="true" /> Add a task to {stage.label}
      </button>
    );
  }

  return (
    <form onSubmit={submit} data-testid={`wf-add-task-form-${stage.key}`} className="mt-1 space-y-2 rounded-2xl bg-white/70 p-3">
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`What needs doing at ${stage.label}?`}
        aria-label="Task"
        data-testid={`wf-add-task-title-${stage.key}`}
        className={`${DRAWER_FIELD} !py-2.5 !text-[14px]`}
      />
      <div className="flex flex-wrap gap-2">
        <select
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          aria-label="Who does it"
          data-testid={`wf-add-task-assignee-${stage.key}`}
          className={`${DRAWER_FIELD} !w-auto flex-1 !py-2.5 !text-[13.5px]`}
        >
          <option value="">
            {stage.owner_role ? `Anyone in ${stage.owner_role}` : "Nobody yet"}
          </option>
          {assignable.map((m) => (
            <option key={m.id} value={m.id}>{m.name || m.email}</option>
          ))}
        </select>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          data-testid={`wf-add-task-due-${stage.key}`}
          className={`${DRAWER_FIELD} !w-auto !py-2.5 !text-[13.5px]`}
        />
      </div>
      {priorTasks.length > 0 && (
        <select
          value={after}
          onChange={(e) => setAfter(e.target.value)}
          aria-label="Starts after"
          data-testid={`wf-add-task-after-${stage.key}`}
          className={`${DRAWER_FIELD} !py-2.5 !text-[13.5px]`}
        >
          <option value="">Can start right away</option>
          {priorTasks.map((p) => (
            <option key={p.id} value={p.id}>Starts after: {p.title}</option>
          ))}
        </select>
      )}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)}
          className={`min-h-10 rounded-pill px-4 text-[13px] font-medium text-slate-700 ${GLASS_PILL}`}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !title.trim()}
          data-testid={`wf-add-task-submit-${stage.key}`}
          className={`min-h-10 rounded-pill px-5 text-[13px] font-semibold disabled:opacity-50 ${INK_PILL}`}>
          {busy ? "Adding…" : "Add task"}
        </button>
      </div>
    </form>
  );
}

/* ───────────────────────────── one stage block ────────────────────────── */
function StageBlock({ stage, card, members, user, canEdit, onApprove, approving, onChanged, priorTasks = [] }) {
  const current = stage.state === "current";
  const complete = stage.state === "done";
  const gate = stage.approval;
  const gateOpen = gate?.required && !(gate.given || []).length;
  const canApprove = user?.role === "owner" || user?.role === gate?.role;
  const overdueHere = (stage.tasks || []).filter(isOverdue).length;

  return (
    <section
      data-testid={`wf-stage-${stage.key}`}
      data-state={stage.state}
      className={`${DRAWER_CARD} p-4 ${current ? "ring-2 ring-slate-900/15" : ""}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
          complete ? "bg-emerald-600 text-white"
            : current ? "bg-slate-900 text-white"
            : "bg-slate-500/[0.12] text-slate-500"
        }`}>
          {complete ? <Check size={12} weight="bold" aria-hidden="true" /> : null}
        </span>
        <h3 className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-slate-900">
          {stage.label}
          {current && <span className={`${CHIP} ml-2 bg-slate-900 text-white ring-slate-900`}>Here now</span>}
        </h3>
        {stage.task_total > 0 && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500"
            data-testid={`wf-stage-progress-${stage.key}`}>
            {stage.task_done} of {stage.task_total} done
          </span>
        )}
      </header>

      <p className="mt-1 pl-[34px] text-[11.5px] text-slate-500">
        {stage.owner_role ? `${stage.owner_role} owns this stage` : "No owner set for this stage"}
        {stage.entered_at ? ` · arrived ${timeAgo(stage.entered_at)}` : ""}
        {overdueHere ? ` · ${overdueHere} overdue` : ""}
      </p>

      {/* The approval gate, which until now had no door anywhere in the app:
          Settings let an owner require it and only an owner OVERRIDE could
          get past it. */}
      {gate?.required && (
        <div data-testid={`wf-stage-approval-${stage.key}`}
          className={`mt-3 flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2.5 text-[12.5px] ${
            gateOpen ? "bg-violet-50 text-violet-800" : "bg-emerald-50 text-emerald-800"
          }`}>
          <SealCheck size={14} weight="bold" aria-hidden="true" className="shrink-0" />
          {gateOpen ? (
            <>
              <span className="min-w-0 flex-1">Needs {gate.role} sign-off before it can leave this stage</span>
              {current && canApprove && (
                <button type="button" onClick={onApprove} disabled={approving}
                  data-testid={`wf-approve-stage-${stage.key}`}
                  className={`min-h-9 shrink-0 rounded-pill px-4 text-[12.5px] font-semibold disabled:opacity-50 ${INK_PILL}`}>
                  {approving ? "Approving…" : "Approve this stage"}
                </button>
              )}
            </>
          ) : (
            <span className="min-w-0 flex-1">
              Approved by {(gate.given || []).map((a) => a.actor_name || "someone").join(", ")}
              {gate.given?.[0]?.recorded_at ? ` · ${timeAgo(gate.given[0].recorded_at)}` : ""}
            </span>
          )}
        </div>
      )}

      <div className="mt-2">
        {(stage.tasks || []).length === 0 && (
          <p className="px-3 py-2 text-[12.5px] text-slate-500">
            {complete ? "Nothing was tracked here." : "No work on this stage yet."}
          </p>
        )}
        {(stage.tasks || []).map((t) => <TaskRow key={t.id} task={t} />)}
        {canEdit && card.stage && (
          <AddTaskToStage
            workflowId={card.id}
            stage={stage}
            members={members}
            user={user}
            onAdded={onChanged}
            priorTasks={priorTasks}
          />
        )}
      </div>
    </section>
  );
}

/* ──────────────────────── correct the card (A4) ───────────────────────── */
function EditCard({ card, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: card.title || "",
    counterparty: card.counterparty || "",
    amount: card.amount ?? "",
    detail: card.detail || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e?.preventDefault?.();
    if (!form.title.trim() || busy) return;
    setBusy(true);
    try {
      await api.patch(`/workflows/${card.id}`, {
        title: form.title.trim(),
        counterparty: form.counterparty.trim(),
        amount: form.amount === "" ? null : Number(form.amount),
        detail: form.detail.trim(),
      });
      toast.success("Card updated");
      onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not save the card.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} data-testid="wf-edit-form" className={`${DRAWER_CARD} space-y-2.5 p-4`}>
      <p className={DRAWER_LABEL}>Correct this card</p>
      <input value={form.title} onChange={set("title")} aria-label="Title"
        data-testid="wf-edit-title" className={`${DRAWER_FIELD} !py-2.5`} />
      <div className="flex flex-wrap gap-2">
        <input value={form.counterparty} onChange={set("counterparty")} placeholder="Customer or supplier"
          aria-label="Customer or supplier" data-testid="wf-edit-counterparty"
          className={`${DRAWER_FIELD} !w-auto flex-1 !py-2.5`} />
        <input value={form.amount} onChange={set("amount")} type="number" inputMode="decimal" placeholder="Amount"
          aria-label="Amount" data-testid="wf-edit-amount"
          className={`${DRAWER_FIELD} !w-auto !py-2.5`} />
      </div>
      <textarea value={form.detail} onChange={set("detail")} rows={2} placeholder="Anything worth noting"
        aria-label="Detail" data-testid="wf-edit-detail" className={`${DRAWER_FIELD} resize-none !py-2.5`} />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel}
          className={`min-h-10 rounded-pill px-4 text-[13px] font-medium text-slate-700 ${GLASS_PILL}`}>
          Cancel
        </button>
        <button type="submit" disabled={busy || !form.title.trim()} data-testid="wf-edit-save"
          className={`min-h-10 rounded-pill px-5 text-[13px] font-semibold disabled:opacity-50 ${INK_PILL}`}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/* ═══════════════════════════════ the drawer ═══════════════════════════ */
export default function WorkflowDetail({ workflowId, open, onOpenChange, onAdvance, onChanged }) {
  const { user, tenant } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [approving, setApproving] = useState(false);
  const closeRef = useRef(null);

  const canEdit = user?.role === "owner" || userPerms(user).includes("workflows");

  const cardQ = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => api.get(`/workflows/${workflowId}`).then((r) => r.data),
    enabled: !!workflowId && open,
  });
  const membersQ = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
    enabled: !!workflowId && open,
  });

  useEffect(() => { if (!open) setEditing(false); }, [open]);

  const card = cardQ.data;
  const reload = () => {
    qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
    onChanged?.();
  };

  const approve = async () => {
    setApproving(true);
    try {
      const { data } = await api.post(`/workflows/${workflowId}/approve-stage`);
      toast.success(data.already_recorded ? "Already approved" : "Stage approved");
      reload();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not record the approval.");
    } finally {
      setApproving(false);
    }
  };

  const stages = card?.stages_detail || [];
  const currentIdx = stages.findIndex((s) => s.state === "current");
  const next = currentIdx >= 0 ? stages[currentIdx + 1] : null;
  const ready = card?.readiness?.ready;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideClose
        data-testid="workflow-detail"
        className="w-full max-w-none overflow-hidden rounded-[0px] border-l-0 p-0 sm:max-w-none lg:max-w-2xl lg:rounded-l-[2rem] bg-[linear-gradient(165deg,hsl(0_0%_95%),hsl(0_0%_90.5%))] lg:shadow-[-30px_0_80px_-30px_hsl(0_0%_0%/0.45)]"
        onOpenAutoFocus={(e) => { e.preventDefault(); closeRef.current?.focus(); }}
      >
        <div className="h-full overflow-y-auto">
          <SheetHeader className="sticky top-0 z-10 flex-row items-start gap-3 space-y-0 bg-[hsl(0_0%_95%/0.85)] px-5 pb-4 pt-[max(1.25rem,var(--sa-top))] text-left backdrop-blur-xl lg:px-7 lg:pt-6">
            <div className="min-w-0 flex-1 pt-1.5">
              <SheetTitle className="text-left text-[22px] font-semibold leading-tight tracking-tight text-slate-900">
                {card?.title || "Workflow"}
              </SheetTitle>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-500">
                {card?.pipeline_label && <span>{card.pipeline_label}</span>}
                {card?.counterparty && <span>· {card.counterparty}</span>}
                {card?.amount != null && (
                  <span className="font-mono tabular-nums">· {money(card.amount, tenant?.currency)}</span>
                )}
              </p>
            </div>
            {canEdit && card && !editing && (
              <button type="button" onClick={() => setEditing(true)} data-testid="wf-detail-edit"
                aria-label="Correct this card" title="Correct this card"
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-700 ${GLASS_PILL}`}>
                <PencilSimple size={17} weight="bold" aria-hidden="true" />
              </button>
            )}
            <SheetClose
              ref={closeRef}
              data-testid="workflow-detail-close"
              aria-label="Close workflow"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/90 text-slate-900 ring-1 ring-inset ring-white shadow-[0_8px_22px_-8px_hsl(0_0%_0%/0.45),0_0_0_4px_hsl(0_0%_0%/0.07)] backdrop-blur-md transition-shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </SheetClose>
          </SheetHeader>

          <div className="space-y-3 px-4 pb-16 pt-1 lg:px-7">
            {cardQ.isLoading && (
              <p className="flex items-center gap-2 px-2 py-8 text-[13px] text-slate-500">
                <CircleNotch size={14} weight="bold" className="animate-spin" aria-hidden="true" /> Loading the card…
              </p>
            )}
            {cardQ.isError && (
              <p className="px-2 py-8 text-[13px] text-slate-500" data-testid="workflow-detail-error">
                This card could not be loaded.
              </p>
            )}

            {card && editing && (
              <EditCard card={card} onCancel={() => setEditing(false)}
                onSaved={() => { setEditing(false); reload(); }} />
            )}

            {/* 1. Can it move, and if not why not. The first question anyone
                 has about a card, and the board could only answer it by
                 refusing the move with a 409 after you tried. */}
            {card && (
              <div data-testid="wf-detail-status"
                className={`${DRAWER_CARD} flex flex-wrap items-center gap-3 p-4`}>
                {ready ? (
                  <>
                    <Check size={17} weight="bold" aria-hidden="true" className="shrink-0 text-emerald-600" />
                    <span className="min-w-0 flex-1 text-[13.5px] text-slate-700">
                      {next ? `Everything at this stage is done — ready to move to ${next.label}.`
                        : "This card is at its last stage."}
                    </span>
                    {next && onAdvance && (
                      <button type="button" data-testid="wf-detail-advance"
                        onClick={() => onAdvance(card, next.key)}
                        className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-pill px-5 text-[13px] font-semibold ${INK_PILL}`}>
                        Move to {next.label}
                        <ArrowRight size={13} weight="bold" aria-hidden="true" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <WarningCircle size={17} weight="bold" aria-hidden="true" className="shrink-0 text-amber-600" />
                    <span className="min-w-0 flex-1 text-[13.5px] text-slate-700">
                      Held here: {card.readiness?.reason || "this stage is not finished"}.
                    </span>
                  </>
                )}
              </div>
            )}

            {/* 2 + 3. Every stage, its work, and who holds it. */}
            {stages.map((s, i) => (
              <StageBlock
                key={s.key}
                stage={s}
                /* Anything already on this stage or an earlier one can be the
                   thing a new task waits for; a later stage cannot, because by
                   then the card has moved past this one. */
                priorTasks={stages.slice(0, i + 1).flatMap((p) => (p.tasks || []))
                  .filter((t) => !CLOSED.has(t.status))}
                card={card}
                members={membersQ.data || []}
                user={user}
                canEdit={canEdit}
                approving={approving}
                onApprove={approve}
                onChanged={reload}
              />
            ))}

            {/* Work pointed at this card but at no stage — older rows. Shown
                rather than existing where nobody can see them. */}
            {card?.unstaged_tasks?.length > 0 && (
              <section className={`${DRAWER_CARD} p-4`} data-testid="wf-detail-unstaged">
                <p className={DRAWER_LABEL}>On this card, not on a stage</p>
                {card.unstaged_tasks.map((t) => <TaskRow key={t.id} task={t} />)}
              </section>
            )}

            {/* 4. What people did to it. */}
            {card?.history?.length > 0 && (
              <section className={`${DRAWER_CARD} p-4`} data-testid="wf-detail-history">
                <p className={DRAWER_LABEL}>History</p>
                <ol className="space-y-2.5">
                  {[...card.history].reverse().map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex items-start gap-2.5 text-[12.5px]">
                      <Clock size={12} weight="bold" aria-hidden="true" className="mt-1 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 text-slate-700">
                        {h.note || "Moved"}
                        <span className="block text-[11.5px] text-slate-500" title={fullTime(h.at)}>
                          {timeAgo(h.at)}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

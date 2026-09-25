import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Chip } from "../components/common";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
import { timeAgo, fullTime } from "../lib/format";
import { userPerms } from "../lib/perms";
import { canAssignPerson, canAssignTeam } from "../lib/taskAccess";
import { Plus, User, Paperclip, ClockCounterClockwise, X, CloudArrowUp } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "../components/ui/dialog";
import { Close as DialogPrimitiveClose } from "@radix-ui/react-dialog";
import { PersonAvatar } from "../components/karma/PersonAvatar";
import { GLASS_PILL, INK_PILL } from "../components/karma/glass";
import { ScopeSlider } from "../components/karma/ScopeSlider";
import { DesignCheckbox } from "../components/karma/DesignCheckbox";
import { ApprovalPanel } from "../components/karma/ApprovalPanel";
import { GlassSelect } from "../components/karma/GlassSelect";
import { DraftNote } from "../components/karma/DraftNote";
import { useDraft } from "../hooks/useDraft";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "../components/ui/alert-dialog";

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

// ASK-28 TK-05 — the approval choices live with their panel now
// (components/karma/ApprovalPanel), shared with the Decision review card.

const EMPTY_FORM = {
  title: "", description: "", task_type: "",
  // ASK-29 — one "Assign to" control: "u:<userId>" for a person, "r:<roleKey>"
  // for a team (the server hands a team task to its least busy member).
  assign: "",
  co_assignee_ids: [],   // ASK-26 — helpers alongside the person doing it
  priority: "medium",
  due_preset: "", due_date: "", due_time: "",
  // D1 — how often this comes back. "" is a one-off, which is most tasks.
  repeat_every: "", repeat_interval: "1", repeat_until: "",
  expected_output: "", approval: "none", approver_id: "",
  evidence_required: false,
};

/* ASK-29 — due presets. A date with no time is due for that whole day.
   PILOT-1 C — "No date" is gone, and it was the default. The pilot client:
   "Any task assigned should have deadline. Only then you can show 'Due today'."
   Most tasks were made dateless and so were never due, never late, never
   counted. Nothing is preselected either: the person chooses when the work is
   due, rather than a default choosing it for them. The server refuses a task
   without one as well. */
const DUE_PRESETS = [
  { key: "today", label: "Today", days: 0 },
  { key: "tomorrow", label: "Tomorrow", days: 1 },
  { key: "week", label: "In a week", days: 7 },
  { key: "pick", label: "Pick a date" },
];
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const presetDate = (key) => {
  const p = DUE_PRESETS.find((x) => x.key === key);
  if (!p || p.days == null) return "";
  const d = new Date();
  d.setDate(d.getDate() + p.days);
  return ymdLocal(d);
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
export function NewTaskDialog({ onCreated, onOpenChange, roleOptions, members, defaultType, triggerClassName, triggerChildren, triggerAriaLabel }) {
  const { user, tenant } = useAuth();
  const cats = opModel(tenant).task_categories;
  // Opens on the Department My Work is filtered to, when that is a real one.
  const firstType = () => (cats.some((c) => c.key === defaultType) ? defaultType : cats[0]?.key || "operational");
  const blank = () => ({ ...EMPTY_FORM, task_type: firstType() });
  const [open, setOpen] = useState(false);
  /* PILOT-1 A — a half-written task is kept (lib/drafts.js). The dialog
     already refused stray clicks outside; what it could not survive was the
     page going away — another screen, a reload, a phone closing the app. The
     words come back the next time New Task opens; Create, or Discard on the
     line that says they were kept, is what throws them away. (Attached files
     are not kept: a browser cannot store them for later.) */
  const [form, setForm, formDraft] = useDraft("new-task", blank());
  const [titleError, setTitleError] = useState("");
  const [dueError, setDueError] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  /* J9-02 (JOURNEY-1) — LEAVING A HALF-WRITTEN TASK NOW ASKS.
     The words were never actually lost: useDraft has kept them since PILOT-1 A
     and brings them back the next time New Task opens. But the closing gave no
     sign of that, so a tester who pressed Back believed they had lost the lot —
     and the one person it really costs is the one who MEANT to throw it away
     and now carries it around. Founder's call: offer both. */
  const [askLeave, setAskLeave] = useState(false);
  const written = () => !!(form.title.trim() || form.description.trim()
    || form.expected_output.trim() || files.length);
  const close = (keep) => {
    if (!keep) { formDraft.discard(); setForm(blank()); }
    setFiles([]); setTitleError(""); setDueError("");
    setAskLeave(false); setOpen(false); onOpenChange?.(false);
  };
  const fileRef = useRef(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const personId = form.assign.startsWith("u:") ? form.assign.slice(2) : "";
  const teamKey = form.assign.startsWith("r:") ? form.assign.slice(2) : "";
  const dueDate = form.due_preset === "pick" ? form.due_date : presetDate(form.due_preset);
  const roleLabel = (key) => roleOptions.find((r) => r.key === key)?.label || key;
  // ASK-28 TK-08 (plan 5.5 / 6.3) — only the teams and people this person may
  // give work to; the server refuses the rest.
  const teams = roleOptions.filter((r) => r.key !== "owner" && canAssignTeam(user, r.key));
  const assignable = members.filter((m) => canAssignPerson(user, m));
  const helperChoices = assignable.filter((m) => m.id !== personId && !form.co_assignee_ids.includes(m.id));
  // RBAC P1 (2026-09-15): an approver who isn't an owner can't be on the task —
  // not the person asking, the doer or a helper (the server refuses the same).
  const approvers = members.filter((m) => m.role === "owner"
    || (userPerms(m).includes("approvals") && m.id !== user?.id && m.id !== personId && !form.co_assignee_ids.includes(m.id)));
  // Yokesh 2026-09-15 — nobody picked: the server names your reporting manager
  // when they may approve tasks, else the owner. Say who that will be.
  const myManagerId = user?.reporting_manager_id || members.find((m) => m.id === user?.id)?.reporting_manager_id;
  const myManager = myManagerId ? members.find((m) => m.id === myManagerId) : null;
  const firstOwner = members.find((m) => m.role === "owner");
  const managerOnTask = !!myManager && (myManager.id === personId || form.co_assignee_ids.includes(myManager.id));
  const defaultApproverLabel = user?.role === "owner" ? "You"
    : myManager && !managerOnTask && approvers.some((a) => a.id === myManager.id) ? `${myManager.name} · your manager`
    : myManager && !managerOnTask ? "Your manager, or the owner if they can't approve"
    : firstOwner ? `${firstOwner.name} · owner` : "The owner";
  const pickAssign = (v) => {
    const pid = v.startsWith("u:") ? v.slice(2) : "";
    // Choosing someone already listed as a helper makes them the doer instead
    // of listing them twice; a team or nobody has no helpers.
    setForm({ ...form, assign: v, co_assignee_ids: pid ? form.co_assignee_ids.filter((id) => id !== pid) : [] });
  };

  const create = async () => {
    if (!form.title.trim()) { setTitleError("Give the task a title"); return; }
    if (!dueDate) {
      setDueError(form.due_preset === "pick" ? "Pick the day it's due" : "Choose when it's due");
      document.getElementById("task-due-label")?.scrollIntoView?.({ block: "center" });
      return;
    }
    // The date is what repeats, so a cadence without one means nothing. Said
    // here rather than letting the server refuse a filled-in form.
    if (form.repeat_every && !dueDate) { toast.error("A repeating task needs a due date — the date is what repeats"); return; }
    setBusy(true);
    try {
      const { data: task } = await api.post("/tasks", {
        title: form.title.trim(), description: form.description,
        task_type: form.task_type,
        assignee_id: personId || null,
        assignee_role: personId ? null : (teamKey || null),
        co_assignee_ids: personId ? form.co_assignee_ids : [],
        priority: form.priority,
        due_date: dueDate || null,
        due_time: dueDate && form.due_time ? form.due_time : null,
        expected_output: form.expected_output.trim() || null,
        approval_required: form.approval !== "none",
        approval_stage: form.approval !== "none" ? form.approval : null,
        approver_id: form.approval !== "none" ? (form.approver_id || null) : null,
        evidence_required: form.evidence_required,
        repeat_every: form.repeat_every || null,
        repeat_interval: form.repeat_every ? (parseInt(form.repeat_interval, 10) || 1) : null,
        repeat_until: form.repeat_every ? (form.repeat_until || null) : null,
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
      // ASK-28 TK-06 — a team task says where it went, instead of a silent pick.
      if (teamKey && task?.auto_assigned && task?.assignee_name) {
        toast.success(`Task created. Assigned to ${task.assignee_name}: fewest open tasks in ${roleLabel(teamKey)}.`);
      } else if (teamKey && !task?.assignee_id) {
        toast.success(`Task created for the ${roleLabel(teamKey)} team. Nobody in it can take it yet.`);
      } else {
        toast.success("Task created");
      }
      formDraft.discard();
      setFiles([]);
      setTitleError("");
      setDueError("");
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
  /* ASK-29 follow-up (founder): the groove keeps its inset light, and gets a
     HAIRLINE so the field's edge reads at a glance inside a tight form; on
     focus that hairline goes to full ink — thin and black, not the 2px brand
     outline the global focus net paints. `border-solid` is load-bearing:
     .kr-pressed sets `border: 0`, which also resets the style to none. */
  const inp = "w-full kr-pressed rounded-control border border-solid border-kr-ink/25 px-3.5 py-2.5 text-sm text-foreground placeholder:text-foreground/40 transition-colors focus:border-kr-ink focus:outline-none focus-visible:outline-none";
  const lbl = "block text-xs font-medium text-muted-foreground";
  /* ASK-50 — THE TITLE IS A PLAIN TEXT FIELD. It wore `inp`, the same sunken
     glass as the Department and Assign-to menus under it, so the one thing you
     TYPE looked like one more thing you pick from. It is a writing line now:
     no box, a hairline under it that turns ink on focus (the same focus signal
     `inp` uses — the border, not an outline), and the card's own display face
     at the size of what it is, the task's name. */
  const titleInp = "w-full rounded-none border-0 border-b-2 border-solid border-kr-ink/15 bg-transparent px-0.5 pb-2 pt-1 font-display text-xl text-foreground placeholder:text-foreground/35 transition-colors focus:border-kr-ink focus:outline-none focus-visible:outline-none aria-[invalid=true]:border-kr-accent";
  return (
    <Dialog open={open} onOpenChange={(o) => {
      // J9-02: closing with words in the form asks first (keep, or discard).
      // Escape and the X both land here; an empty form closes straight away.
      if (!o && written()) { setAskLeave(true); return; }
      setOpen(o);
      // J14-01 — this dialog is hidden, not unmounted, so ask the draft to read
      // itself again on the way in; otherwise words kept from a previous visit
      // come back with nothing saying they were kept.
      if (o) formDraft.reload();
      // A fresh form picks up the Department My Work is on now.
      if (o && !form.title) setForm((f) => ({ ...f, task_type: firstType() }));
      onOpenChange?.(o);
    }}>
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
      {/* KM-51 — the dialog "jumps off" because it is CENTRED and its height
          CHANGES while you use it.

          Three blocks in this form are conditional: the operational-category
          select appears with `isOp`, the assign-by-role select DISAPPEARS the
          moment you pick a person, and the approver select appears with the
          approval checkbox. Radix centres the panel — top:50% with a -50%
          translate — so removing ~70px of field moves the top edge down 35px
          and pulls everything below it up 70px. Two motions at once, on the
          exact click that caused them. Founder: "click any options and menu,
          it jumps off in both desktop, android and iOS." Three platforms
          because it was never a platform bug.

          Desktop: KM-51 answered this by anchoring the panel to the TOP, so
          height grew downward only. ASK-21 puts it back in the CENTRE on the
          founder's ask and pays for it the other way: the panel now has a
          FIXED height, so the thing that caused the jump — a changing height
          under a -50% translate — cannot happen at all. Measured variance
          across the three conditional blocks is 86px (804 / 891 / 823 at a
          1080 viewport), which centred would have moved the top edge 43px on
          a single click. h-[min(86vh,55rem)] clears the tallest state on a
          tall screen and falls back to 86vh on a short one; the body scrolls
          inside either way and the panel's box never moves.

          Phone: go full-bleed, which is the founder's own fallback ("if can't
          fix then make it as a full screen page") and independently right —
          iOS shrinks the visual viewport when a <select> picker opens, so a
          vh-sized centred box really does slide off. Pinned to all four edges
          it has nowhere to go, and h-full resolves against the layout
          viewport, which the picker does not touch.

          The slide offsets are zeroed FOR THE PHONE ONLY — they were written
          for a centred panel and would otherwise start the full-bleed sheet
          48% of its own height above the screen. At lg the panel is centred
          again, so the base values have to come back: tailwindcss-animate's
          `enter` keyframe carries only a `from` frame and interpolates to the
          element's own computed transform, so leaving the vars at 0 against a
          translate(-50%,-50%) panel would fly it in from half a screen away.
          -50% / -48% makes that a 2% settle instead. They are written as
          VARIABLES rather than `slide-in-from-*` classes: those names are not
          in tailwind-merge's group table, so cn() keeps both and the
          arbitrary `-[48%]` wins on source order. Measured: the override
          class was present and --tw-enter-translate-y was still -48%. Setting
          the custom property has no such contest. */}
      {/* ASK-21 — `flex flex-col`, overriding Radix's base `grid`. A grid with
          a FIXED height sizes its auto rows to fill that height, so showing
          the approver select did not scroll the body, it redistributed the
          whole panel: measured the Priority row moving UP 30px while the
          Create button moved DOWN 31px, with scrollHeight pinned at 880 the
          whole time. As a flex column the header holds its size, the body
          scrolls, and nothing else moves. */}
      {/* 2026-09-14, founder — the card opens FULL: every field shows at once,
          with no "More options" row to open first. On desktop it is wide (2xl)
          so the second half of the form sits in two columns; in one column the
          whole form measured 969px, past a 900px screen, and in two it fits a
          1366×768 laptop. It grows to hold its content rather than scrolling
          inside a fixed height; max-h keeps it inside a very short screen,
          where the card itself — not a region within it — scrolls. The phone
          stays full-bleed with a scrolling body.
          Clicking outside does not close it: a half-filled task was lost to a
          stray click. Close with the X or Escape. */}
      <DialogContent
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className={`kr-bento flex flex-col border-0 [&>button.absolute]:hidden
                   left-0 top-0 h-full max-h-none w-full max-w-none translate-x-0 translate-y-0
                   [border-radius:0]
                   [padding-top:max(1rem,var(--sa-top))]
                   [padding-bottom:max(1rem,var(--sa-bottom))]
                   lg:left-[50%] lg:top-[50%] lg:h-auto lg:max-h-[calc(100dvh/var(--ui-scale,1)-2rem)] lg:overflow-y-auto lg:max-w-2xl
                   lg:-translate-x-1/2 lg:-translate-y-1/2
                   lg:[border-radius:var(--radius-card)]
                   lg:[padding-block:1.25rem]
                   data-[state=open]:[--tw-enter-translate-x:0] data-[state=open]:[--tw-enter-translate-y:0]
                   data-[state=closed]:[--tw-exit-translate-x:0] data-[state=closed]:[--tw-exit-translate-y:0]
                   lg:data-[state=open]:[--tw-enter-translate-x:-50%] lg:data-[state=open]:[--tw-enter-translate-y:-48%]
                   lg:data-[state=closed]:[--tw-exit-translate-x:-50%] lg:data-[state=closed]:[--tw-exit-translate-y:-48%]`}
      >
        <DialogHeader className="shrink-0 pr-11">
          {/* J13b-07 (JOURNEY-1) — 44px on touch, the app's own floor. It was
              h-9 (36px, and 35 under the phone's ui-scale) and it is this
              sheet's ONLY way out on a phone. A mouse keeps the smaller one.
              J14-06 — h-11 was still 35 ON THE GLASS, because the phone's zoom
              shrinks it: 44 CSS pixels at --ui-scale 0.8 is 35 real ones, which
              is what the audit measured and what a thumb misses. --touch-min
              divides by the scale, so this lands at 44 wherever it is drawn. */}
          <DialogPrimitiveClose
            data-testid="task-dialog-close"
            aria-label="Close"
            className="kr-pop absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full text-foreground/70 [min-height:var(--touch-min)] [min-width:var(--touch-min)] lg:h-9 lg:w-9 lg:[min-height:auto] lg:[min-width:auto]">
            <X size={16} weight="bold" aria-hidden="true" className="lg:hidden" />
            <X size={15} weight="bold" aria-hidden="true" className="hidden lg:block" />
          </DialogPrimitiveClose>
          <DialogTitle className="font-display text-xl">New Task</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">What, who and when. The rest is optional.</DialogDescription>
          {formDraft.restored && (
            <DraftNote onDiscard={() => { formDraft.discard(); setTitleError(""); }}
              label="Kept from before — not created yet" testid="new-task-draft" className="-mb-2 pt-1" />
          )}
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5 lg:flex-none lg:overflow-visible lg:pr-0">
          {/* ASK-29 (2026-09-14): what, which department, who and when come
              first; the rest of the task follows below (it waited under "More
              options" until the founder asked for the full card). Removed:
              Operational category (stored, never read anywhere) and Supporting
              employee (never shown to or told anything) — a helper is the same
              idea, and helpers see the task and its updates. */}
          <div>
            <label className="sr-only" htmlFor="task-title">Task title</label>
            <input id="task-title" data-testid="task-title-input" autoFocus className={titleInp}
              placeholder="What needs to be done?" value={form.title}
              aria-invalid={titleError ? "true" : undefined}
              aria-describedby={titleError ? "task-title-error" : undefined}
              onChange={(e) => { setForm({ ...form, title: e.target.value }); if (titleError) setTitleError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); create(); } }} />
            {titleError && (
              <p id="task-title-error" data-testid="task-title-error" className="mt-1.5 text-xs font-medium text-kr-accent">{titleError}</p>
            )}
          </div>

          <div className="kr-form-row">
            <div>
              {/* The task's own department, not the doer's: a sales task can be
                  handed to anyone in a small company and still count as Sales. */}
              {/* 2026-09-14, founder — every dropdown here is GlassSelect: the
                  field keeps this form's look, the list is the app's glass,
                  never the operating system's. */}
              <label className={lbl} htmlFor="task-department">Department</label>
              <GlassSelect id="task-department" testid="task-type-select" variant="field" triggerClassName={`${inp} mt-1`}
                value={form.task_type} onChange={(v) => setForm({ ...form, task_type: v })}
                options={cats.map((c) => ({ value: c.key, label: c.label }))} />
            </div>
            <div>
              <label className={lbl} htmlFor="task-assign">Assign to</label>
              <GlassSelect id="task-assign" testid="task-assign-select" variant="field" triggerClassName={`${inp} mt-1`}
                value={form.assign} onChange={pickAssign}
                options={[
                  { value: "", label: "Nobody yet" },
                  { label: "People", options: assignable.map((m) => ({
                    value: `u:${m.id}`,
                    label: m.id === user?.id ? `Me · ${m.name}` : `${m.name} · ${roleLabel(m.role)}`,
                  })) },
                  ...(teams.length > 0
                    ? [{ label: "A team (least busy person)", options: teams.map((r) => ({ value: `r:${r.key}`, label: `${r.label} team` })) }]
                    : []),
                ]} />
            </div>
          </div>
          {teamKey && (
            <p className="-mt-2 text-xs text-muted-foreground" data-testid="task-team-hint">
              Goes to whoever in {roleLabel(teamKey)} has the least open work.
            </p>
          )}

          <div>
            <span className={lbl} id="task-due-label">Due <span className="text-kr-accent" aria-hidden="true">*</span></span>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="task-due-label"
              aria-describedby={dueError ? "task-due-error" : undefined}>
              {DUE_PRESETS.map((p) => {
                const on = form.due_preset === p.key;
                return (
                  <button key={p.key} type="button" aria-pressed={on}
                    data-testid={`task-due-${p.key}`}
                    onClick={() => { setForm({ ...form, due_preset: p.key }); if (dueError) setDueError(""); }}
                    className={`h-9 rounded-pill px-3.5 text-xs ${on ? "kr-pressed font-semibold text-foreground" : "kr-pop text-foreground/75"}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
            {form.due_preset === "pick" && (
              <input data-testid="task-due-date" type="date" aria-label="Due date" className={`${inp} mt-2`}
                value={form.due_date} onChange={(e) => { setForm({ ...form, due_date: e.target.value }); if (dueError) setDueError(""); }} />
            )}
            {dueError && (
              <p id="task-due-error" role="alert" data-testid="task-due-error" className="mt-1.5 text-xs font-medium text-kr-accent">
                {dueError}
              </p>
            )}
            {/* D1 (2026-09-21) — HOW OFTEN IT COMES BACK.
                Nothing in the product could repeat: the GST filing, the
                salary run, the Monday stock count were all typed again from
                scratch every cycle, and the "recurring tasks" collected during
                onboarding were stored and read by nothing at all. Offered only
                once there IS a date, because the date is what repeats — which
                also keeps this out of the way of the ordinary one-off task. */}
            {dueDate && (
              <div className="mt-2.5" data-testid="task-repeat">
                <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Repeats</span>
                  {/* The app's own glass list, not the OS picker (founder rule). */}
                  <span className="inline-block w-40">
                    <GlassSelect value={form.repeat_every} onChange={(v) => setForm({ ...form, repeat_every: v })}
                      ariaLabel="How often this task repeats" testid="task-repeat-every"
                      variant="field" triggerClassName={`${inp} !h-9 !py-0 text-xs`}
                      options={[
                        { value: "", label: "Just once" },
                        { value: "day", label: "Every day" },
                        { value: "week", label: "Every week" },
                        { value: "month", label: "Every month" },
                      ]} />
                  </span>
                  {form.repeat_every && (
                    <>
                      <span>every</span>
                      <input type="number" min={1} max={52} value={form.repeat_interval}
                        onChange={set("repeat_interval")} aria-label="How many"
                        data-testid="task-repeat-interval" className={`${inp} !h-9 !w-16 !py-0 text-xs`} />
                      <span>{form.repeat_every}{(parseInt(form.repeat_interval, 10) || 1) === 1 ? "" : "s"}, until</span>
                      <input type="date" value={form.repeat_until} onChange={set("repeat_until")}
                        aria-label="Repeat until" data-testid="task-repeat-until"
                        className={`${inp} !h-9 !w-auto !py-0 text-xs`} />
                      <span>(blank = keeps going)</span>
                    </>
                  )}
                </label>
                {form.repeat_every && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    The next one appears when this one is marked done, so there is only ever one live.
                  </p>
                )}
              </div>
            )}
            {dueDate && form.due_preset !== "pick" && (
              <p className="mt-1.5 text-xs text-muted-foreground" data-testid="task-due-summary">
                Due {new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </p>
            )}
          </div>

          {/* 2026-09-14, founder — no "More options" row: the rest of the task
              is always open. Desktop sets it in two columns (the card is wide
              enough to hold them); the phone keeps one column, in the same
              order. */}
          {/* ASK-50 — ROWS, NOT TWO COLUMNS OF STACKS. The founder wants the
              Description box as tall as the Needs approval box beside it; in
              two independent column stacks nothing ties their heights. As one
              grid, the two share a row, a grid row is as tall as its tallest
              cell, and the textarea fills its cell — so they are the same
              height whatever the panel holds. Every cell names its column so
              the order on a phone (one column) is the order below.
              "Expected result" is gone on the founder's call — its testid,
              task-expected-output, goes with it; nothing is sent in its place
              (the form still sends expected_output: null, as it did when the
              field was left empty). */}
          <div data-testid="task-details" className="space-y-4 lg:grid lg:grid-cols-2 lg:gap-x-6 lg:gap-y-4 lg:space-y-0">
            {/* ASK-50 — a segment bar, not three pills: the app's one segment
                material (ScopeSlider, the Company/You control), sliding between
                the three, its thumb washed — barely — in the priority's own hue
                (index.css .kr-prio-thumb--*). Same testids on the three. */}
            <div className="lg:col-start-1">
              <span className={lbl} id="task-priority-label">Priority</span>
              <ScopeSlider fluid className="mt-1.5" label="Priority" testid="task-priority"
                options={[{ key: "low", label: "Low" }, { key: "medium", label: "Medium" }, { key: "high", label: "High" }]}
                value={form.priority} onChange={(p) => setForm({ ...form, priority: p })}
                thumbClassName={`kr-prio-thumb--${form.priority}`} />
            </div>

              {dueDate && (
                <div className="lg:col-start-2">
                  <label className={lbl} htmlFor="task-due-time">Due time</label>
                  <input id="task-due-time" data-testid="task-due-time" type="time" className={`${inp} mt-1`} value={form.due_time} onChange={set("due_time")} />
                </div>
              )}

              {/* ASK-26 — helpers alongside the person doing it. Offered once a
                  person is chosen; that person stays the one approvals and
                  hand-offs act on. Each helper is a pill you tap to take off. */}
              {personId && (
                <div data-testid="task-co-assignees" className="lg:col-start-1">
                  <label className={lbl} htmlFor="task-helper-add">Helpers</label>
                  {form.co_assignee_ids.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {form.co_assignee_ids.map((id) => {
                        const m = members.find((x) => x.id === id);
                        return (
                          <button key={id} type="button"
                            onClick={() => setForm({ ...form, co_assignee_ids: form.co_assignee_ids.filter((x) => x !== id) })}
                            aria-label={`Remove ${m?.name || "member"}`}
                            data-testid={`task-co-remove-${id}`}
                            className="inline-flex items-center gap-1.5 rounded-pill bg-slate-500/[0.07] py-1 pl-1 pr-2.5 text-sm ring-1 ring-inset ring-slate-500/10 transition-colors hover:bg-slate-500/[0.13]">
                            <PersonAvatar name={m?.name} src={m?.avatar_url} size={22} ring={false} />
                            {m?.name || "Member"}
                            <X size={11} weight="bold" aria-hidden="true" className="text-muted-foreground" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {helperChoices.length > 0 ? (
                    <>
                      <GlassSelect id="task-helper-add" testid="task-co-assignee-select" variant="field" triggerClassName={`${inp} mt-1.5`}
                        value="" placeholder="+ Add a helper"
                        onChange={(id) => id && setForm({ ...form, co_assignee_ids: [...form.co_assignee_ids, id] })}
                        options={helperChoices.map((m) => ({ value: m.id, label: `${m.name} · ${roleLabel(m.role)}` }))} />
                      <p className="mt-1 text-xs text-muted-foreground">Helpers see the task in My Tasks and get its updates.</p>
                    </>
                  ) : (
                    /* ASK-28 TK-08 — nobody else this person may add: say so,
                       instead of a dropdown that opens empty. */
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="task-co-assignee-none">
                      {form.co_assignee_ids.length > 0
                        ? "Everyone you can add is already helping."
                        : "There's no one else you can add. People outside your team need someone with “Assign tasks to anyone”."}
                    </p>
                  )}
                </div>
              )}

              {/* The label sits INSIDE the box, as "Needs approval" sits inside
                  its panel, so the two boxes start on one line and end on one
                  line — equal heights, not merely equal bottoms. The box is the
                  field's own recipe (`inp`'s sunken glass and ink-on-focus
                  border, carried by focus-within) and the textarea inside it is
                  bare and fills it. Clicking anywhere in it is clicking the
                  field: the whole box is the <label>. */}
              <label htmlFor="task-description" data-testid="task-description-box"
                className="flex min-h-[8rem] cursor-text flex-col rounded-control border border-solid border-kr-ink/25 px-3.5 pb-2.5 pt-2.5 kr-pressed transition-colors focus-within:border-kr-ink lg:col-start-1">
                <span className={lbl}>Description</span>
                <textarea id="task-description" data-testid="task-description-input" rows={3}
                  className="mt-1 min-h-0 w-full flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-foreground/40 focus:outline-none focus-visible:outline-none"
                  placeholder="Anything they need to know" value={form.description} onChange={set("description")} />
              </label>

              {/* ASK-28 TK-05 — when the approval happens, chosen per task.
                  ASK-50 — the panel is components/karma/ApprovalPanel now,
                  shared with the Decision review card; same testids. */}
              <ApprovalPanel value={form.approval} testid="task-approval" className="lg:col-start-2"
                onChange={(k) => setForm({ ...form, approval: k, approver_id: k === "none" ? "" : form.approver_id })} />

              <div className="space-y-2 lg:col-start-2">
                {form.approval !== "none" && (
                  <div data-testid="task-approver-wrap">
                    <label className={lbl} htmlFor="task-approver">Approver</label>
                    <GlassSelect id="task-approver" testid="task-approver-select" variant="field" triggerClassName={`${inp} mt-1`}
                      value={form.approver_id} onChange={(v) => setForm({ ...form, approver_id: v })}
                      options={[
                        { value: "", label: defaultApproverLabel },
                        ...approvers.map((m) => ({ value: m.id, label: `${m.name} · ${roleLabel(m.role)}` })),
                      ]} />
                  </div>
                )}
                <DesignCheckbox testid="task-evidence-required" checked={form.evidence_required}
                  onChange={(e) => setForm({ ...form, evidence_required: e.target.checked })}>
                  Needs proof (photo, voice note or file) before it can be completed
                </DesignCheckbox>
              </div>

            <div className="lg:col-span-2">
              {/* 2026-09-14, founder — the browser's own "Choose file" control
                  is replaced by a glass pill. The real <input> stays (hidden)
                  and the pill opens it. Picking again ADDS to the list, and
                  each chosen file is a glass chip with its own remove. */}
              <span className={`${lbl} flex items-center gap-1`} id="task-files-label"><Paperclip size={12} weight="bold" aria-hidden="true" /> Reference files</span>
              <input ref={fileRef} id="task-files" data-testid="task-attachment-input" type="file" multiple className="hidden"
                aria-labelledby="task-files-label"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  const key = (f) => `${f.name}-${f.size}-${f.lastModified}`;
                  setFiles((prev) => [...prev, ...picked.filter((f) => !prev.some((p) => key(p) === key(f)))]);
                  e.target.value = "";
                }} />
              {/* 2026-09-15, founder reference — a dashed drop area replaces the
                  pill. Same hidden input, same testid, same add-to-list behaviour. */}
              <button type="button" onClick={() => fileRef.current?.click()} data-testid="task-attachment-add"
                aria-describedby="task-files-hint"
                className="mt-1.5 flex w-full flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-neutral-400/60 px-4 py-4 text-center transition-colors hover:border-neutral-500 hover:bg-neutral-900/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <CloudArrowUp size={20} weight="fill" aria-hidden="true" /> {files.length ? "Add more files" : "Add files"}
                </span>
                <span className="text-xs text-muted-foreground">Images, PDFs or documents for context.</span>
              </button>
              <p id="task-files-hint" className="mt-1.5 text-xs text-muted-foreground">AI reads them and summarises what to do.</p>
              {files.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="task-attachment-list">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${f.size}-${f.lastModified}`}
                      className={`inline-flex max-w-full items-center gap-1.5 rounded-pill py-1 pl-3 pr-1 text-xs text-neutral-800 ${GLASS_PILL}`}>
                      <Paperclip size={12} weight="bold" aria-hidden="true" className="shrink-0 text-neutral-500" />
                      <span className="max-w-[13rem] truncate">{f.name}</span>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}
                        aria-label={`Remove ${f.name}`} data-testid={`task-attachment-remove-${i}`}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-900/5 hover:text-neutral-900">
                        <X size={12} weight="bold" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground lg:hidden"><User size={14} weight="fill" aria-hidden="true" /> Created by {user?.name}</p>
        </div>
        {/* Desktop: "Created by" shares the footer row with the button, which
            gives the open form back a line of height. */}
        <DialogFooter className="lg:items-center lg:justify-between">
          <p className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground lg:flex"><User size={14} weight="fill" aria-hidden="true" /> Created by {user?.name}</p>
          {/* KM-10 — ink, not brand-600 (the retired indigo), and a pill at
              the app's control height. */}
          <button data-testid="task-create-submit" onClick={create} disabled={busy}
            className={`flex h-11 w-full items-center justify-center rounded-pill px-6 text-sm font-medium disabled:opacity-50 sm:w-auto ${INK_PILL}`}>
            {busy ? "Creating…" : "Create task"}
          </button>
        </DialogFooter>
      </DialogContent>

      {/* J9-02 — the ask, on the way out. Escape or a click outside goes back
          to the form, which is the third answer and needs no button. */}
      <AlertDialog open={askLeave} onOpenChange={setAskLeave}>
        <AlertDialogContent data-testid="new-task-leave-ask" className="kr-bento max-w-md border-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">Keep this task for later?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              You have written something and not created it yet. Keep it and the words come back
              the next time you open New Task on this device. Discard throws them away now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel asChild>
              <button data-testid="new-task-leave-discard" onClick={() => close(false)}
                className={`flex h-11 items-center justify-center rounded-pill px-5 text-sm font-medium text-foreground/80 ${GLASS_PILL}`}>
                Discard
              </button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <button data-testid="new-task-leave-keep" onClick={() => close(true)}
                className={`flex h-11 items-center justify-center rounded-pill px-5 text-sm font-medium ${INK_PILL}`}>
                Keep it
              </button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

import { Fragment, useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { timeAgo, fullTime } from "../lib/format";
import { PageHeader, Chip, EmptyState, SkeletonCard, StickyHeader } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { userPerms } from "../lib/perms";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
// WE-14 (2026-08-16): TaskBoard import retired -- the Board sub-tab
// under Workflows is gone. NewTaskDialog stays -- it is used by the
// New-task launcher.
import { NewTaskDialog } from "./Tasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "../components/ui/sheet";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "../components/ui/dropdown-menu";
import Workflows from "./Workflows";
// ASK-25 — the Approvals view: every approval that is not a decision. Task
// sign-offs render in the SAME grid and cards as the task list (a card
// opened there carries Approve / Request changes / Ask clarification
// natively); leave uses the LeaveCard the register uses.
import { LeaveCard } from "./Leave";
import { ScopeSlider } from "../components/karma";
// UI-SCALE — the page scales with the screen (pilot: this page only).
import { useUiScale } from "../hooks/useUiScale";
// ASK-6 (2026-09-12): Leave no longer embedded here. Register lives on
// Team, approvals live on Desk, config lives on Settings > Operations.
// Import retired. If a follow-up ever needs the Request Leave dialog
// on this page, it can be pulled from pages/Leave.js as a named export.
import {
  CheckCircle, Camera, Microphone, Stop, ChatCircleText,
  Sparkle, Plus, Trash, PencilSimple, ListChecks, CaretDown, CaretUp,
  ArrowBendUpRight, WarningCircle, ChatText, ArrowRight, Kanban,
  Paperclip, UserCircle, ShieldCheck, Tag, ClockCounterClockwise,
  ArrowClockwise, XCircle, LockKey, X, MagnifyingGlassPlus,
  File, FileArrowUp, Lightbulb, Info,
  FlowArrow,  // WE-11 stage chip
  SlidersHorizontal,  // KR-14.6 · mobile MyWork filter icon (reference)
  Buildings, CalendarBlank, // KR-14.22 · mobile expanded task card
  DotsThreeVertical, // MW-02 · overflow menu on the summary row
  Check, Clock, ArrowFatLinesUp, // ASK-25 · card checkbox, Overdue + Escalation pills
  ChartBar, UserPlus, // ASK-27 · % control, add a person
} from "@phosphor-icons/react";
import { AvatarStack, PersonAvatar } from "../components/karma/PersonAvatar";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from "../components/ui/alert-dialog";
import { motion, useReducedMotion } from "framer-motion";

// RD-2 (2026-08-17): the toolbar control. Was uppercase + wide tracking +
// hard black border — eight of these in a row read as a control panel. Now a
// hairline pill in sentence case; the active state each call-site applies on
// top (indigo tint) is what carries the emphasis, not the frame.
// KR-11 — one recipe for every toolbar control, and it is the pill the rest
// of the app now wears: black hairline, no fill, the selected one at full
// strength against faded neighbours. The old CTRL was an nm-btn whose active
// state was an indigo tint, which put three different "on" colours (indigo
// tint, indigo solid, grey) in one 8-button row.
// KR-11.3 — THREE GROUPS, THREE TREATMENTS.
// The founder could not tell the app's top nav from this page's own controls
// because all five wore the identical hairline pill. They are different
// kinds of thing and now look it:
//
//   scope        My Tasks · All Tasks — a pair joined by geometry, no box.
//   AI priority  its own button, same shape as Leave, carrying the accent
//                because it is a MODE the whole list switches into.
//   workflows    INVERTED: sunken at rest, popping up when you are in it.
//                Everything else in the row does the opposite, which is what
//                makes it read as a destination rather than a filter.
//   leave        a quiet section switch. Standalone, raised, grouped with
//                nothing.
//
// KR-11.4 — NO CONTAINER around the pair. The founder: "remove the gray
// grouping… group My Tasks and All Tasks alone, but don't use gray or any
// colour. Just make it look like it's grouped."
// So they are joined by GEOMETRY: the two buttons touch, outer corners round
// and inner corners square, with a hairline on the seam. A segmented control
// drawn with nothing but shape. Selected is pressed, unselected is raised.
// NO TRANSITION ON THESE, and it is a bug fix, not a taste call.
// With transition-all (and still with transition-colors) the live buttons got
// STUCK mid-transition: the class swapped to text-foreground, the stylesheet
// had the rule, and the element kept painting the previous colour — for
// seconds. Proved by cloning the live node into the same parent: identical
// classes, correct colour on the clone, stale colour on the original. Only a
// running transition can produce that gap.
// These controls swap between .kr-pop (outset shadow pair) and .kr-pressed
// (inset pair), which are not interpolable, and the wedged animation takes
// the whole transition group down with it.
// Selection should snap anyway — a state indicator that fades in over 150ms
// is a worse indicator. .kr-pop keeps its own hover transition; this is only
// about the selected/unselected swap.
const SEG = "flex h-10 items-center justify-center gap-1.5 px-4 text-xs font-medium leading-tight lg:text-sm";
const SEG_ON = "kr-pressed font-semibold text-foreground";
const SEG_OFF = "kr-pop text-foreground/70";
// ASK-25 — the Approvals view's Tasks sub-tab lenses. ALL is everything this
// person may sign off (an owner: the whole tenant); MINE is only what was
// routed to them by name (approver_id).
const APPR_SCOPES = [{ key: "all", label: "All approvals" }, { key: "mine", label: "My approvals" }];
const SECTION_BTN = "flex h-10 items-center justify-center gap-1.5 rounded-pill px-4 text-xs font-medium leading-tight lg:text-sm";

/* ASK-11 (2026-09-13): terminal states removed from the desktop status
   dropdown. Complete and Cancel each have their own button, and the
   Complete button carries the evidence-required guard the dropdown
   route did not. Two routes to the same ending, one of them silent, is
   what the founder called out. Same call the mobile progress pills
   made earlier (see KM-6 comment below): a terminal state chosen via
   a control that lives inside the task deletes the control's own
   container, and there is no evidence check on the way. STATUS_LABEL
   below keeps "Completed" and "Cancelled" -- those are still needed
   for read-only rendering of a task already in either state. */
const STATUS_OPTIONS = [
  { key: "todo", label: "Not Started" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Under Review" },
];
const STATUS_LABEL = {
  todo: "Not Started", in_progress: "In Progress", waiting: "Waiting",
  review: "Under Review", done: "Completed", cancelled: "Cancelled", blocked: "Pending Approval",
};

/* KM-6 — the bar is a PROGRESS track now, not a status dropdown in disguise.
   Completed and Cancelled are gone from it, and that was a correctness fix
   rather than a layout one: both are TERMINAL, so choosing either removed the
   task from the list the bar was sitting in — the control deleted its own
   context. Complete already has its own button below, and Cancel now sits
   beside it, which is where an ending belongs.
   What remains is the four states a task actually passes THROUGH, in order,
   each carrying its own colour: yellow at rest, warming through orange as the
   work heats up, lime when it is out for review. */
const M_STATUS_PILLS = [
  { key: "todo",        label: "Not Started", on: "bg-yellow-200 text-yellow-900" },
  { key: "in_progress", label: "In Progress", on: "bg-orange-500 text-white" },
  { key: "waiting",     label: "Waiting",     on: "bg-orange-300 text-orange-950" },
  { key: "review",      label: "Review",      on: "bg-lime-600 text-white" },
];
const isTerminal = (t) => t.status === "done" || t.status === "cancelled";
/* ASK-29 — a due date with no time ("2026-09-14") is due for that whole day.
   new Date() parses it as UTC midnight, which is 05:30 in India, so a task due
   "Today" read as Overdue by breakfast. Compare calendar days instead; a date
   that carries a time still compares as an instant. */
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isOverdue = (t) => {
  if (!t.due_date || isTerminal(t)) return false;
  const due = String(t.due_date);
  if (due.length <= 10) return due < todayYmd();
  return new Date(due) < new Date();
};
// ASK-25 — a task waiting for a sign-off: the Approvals view's predicate,
// shared with the Desk's Task approvals card so the two never disagree.
const isPendingApproval = (t) => !!t.approval_required && t.approval_status === "pending" && !isTerminal(t);
// ASK-25 F4 — the Desk's "Due today" card lands here. Same calendar rule as
// ASK-29's isOverdue: a date-only due string IS a local day, a timestamp is
// read in local time and compared by calendar day.
const isDueToday = (t) => {
  if (!t.due_date || isTerminal(t)) return false;
  const due = String(t.due_date);
  return (due.length <= 10 ? due : ymdOf(new Date(due))) === todayYmd();
};

function UpdateForm({ taskId, stepId, members, roleOptions, onDone, onCancel, noteOnly = false }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState("note");
  const [toId, setToId] = useState("");
  const [toRole, setToRole] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim()) return toast.error("Write what you found");
    if (action === "handoff" && !toId && !toRole) return toast.error("Pick a person or team to hand off to");
    setBusy(true);
    try {
      await api.post(`/tasks/${taskId}/updates`, {
        text, step_id: stepId || null, action,
        to_id: toId || null, to_role: toId ? null : (toRole || null),
      });
      toast.success(action === "note" ? "Update logged" : action === "escalate" ? "Escalated to owner" : "Handed off");
      onDone();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not post update"); }
    finally { setBusy(false); }
  };

  // ASK-28 TK-01 — the person who asked for a task can leave a note on it;
  // handing off and escalating stay with the people doing the work (the
  // server holds the same line).
  const ACTIONS = [
    { key: "note", label: "Log note", icon: ChatText },
    { key: "handoff", label: "Hand off", icon: ArrowBendUpRight },
    { key: "escalate", label: "Escalate", icon: WarningCircle },
  ].filter((a) => !noteOnly || a.key === "note");

  return (
    /* ASK-28 — the form that opens from "Log update or hand off" (and from a
       step's ⋮) was still the retired neumorphic kit: an nm-btn slab with
       square nm-field inputs and a tiny 12px pill row, inside a drawer that
       is otherwise frosted glass. It now speaks the drawer's language: a
       glass card, a soft white field, the three kinds of update as a
       segmented track whose chosen segment lifts out as a glass pill (no
       transition — outset and inset shadows do not interpolate, MW-08),
       glass select pills for the hand-off target, and the navy Post. */
    <div className={`${DRAWER_CARD} space-y-3 p-4`} data-testid={`update-form-${taskId}`}>
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} data-testid={`update-text-${taskId}`}
        placeholder="What did you find? e.g. Logistics can't commit to a date — supplier issue"
        className={`${DRAWER_FIELD} resize-none leading-relaxed`} />
      <div className={`flex gap-1 rounded-pill p-1 ${DRAWER_TRACK}`} role="group" aria-label="Kind of update">
        {ACTIONS.map((a) => {
          const on = action === a.key;
          return (
            <button key={a.key} type="button" onClick={() => setAction(a.key)} aria-pressed={on}
              data-testid={`update-action-${a.key}-${taskId}`}
              className={`flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill px-2 text-sm font-medium ${
                on ? `${GLASS_PILL} text-slate-900` : "text-slate-500 hover:text-slate-800"
              }`}>
              <a.icon size={15} weight="bold" aria-hidden="true" /> <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>
      {action === "handoff" && (
        <div className="space-y-2">
          <label className={`relative flex items-center rounded-pill ${GLASS_PILL}`}>
            <select className={DRAWER_SELECT} value={toId} onChange={(e) => setToId(e.target.value)}
              data-testid={`update-member-${taskId}`} aria-label="Hand off to a team member">
              <option value="">Hand off to a team member</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </select>
            <CaretDown size={16} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 text-slate-500" />
          </label>
          <label className={`relative flex items-center rounded-pill ${GLASS_PILL}`}>
            <select className={DRAWER_SELECT} value={toRole} onChange={(e) => setToRole(e.target.value)}
              disabled={!!toId} aria-label="Or hand off to a whole team">
              <option value="">…or to a whole team {toId ? "(member selected)" : ""}</option>
              {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
            <CaretDown size={16} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 text-slate-500" />
          </label>
        </div>
      )}
      {action === "escalate" && (
        <p className="px-1 text-sm text-slate-500">This will alert the owner and create a follow-up for them.</p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={submit} disabled={busy} data-testid={`update-submit-${taskId}`}
          className={`flex h-11 flex-1 items-center justify-center rounded-pill text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
          {busy ? "Posting…" : "Post"}
        </button>
        <button type="button" onClick={onCancel}
          className={`flex h-11 items-center rounded-pill px-5 text-sm font-medium text-slate-700 transition-colors hover:bg-white ${GLASS_PILL}`}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ASK-29 — how each kind of event draws on the Activity timeline: its glyph,
// the dot on the line, and the glyph's tone. Unknown kinds get the default.
const TIMELINE_KIND = {
  // ASK-30 — grayscale: the kinds are told apart by glyph, and the ones that
  // change where a task stands (status, done, escalate, rejected) get the
  // darkest dot.
  task_created:    { icon: Plus, dot: "bg-neutral-400", tone: "text-neutral-500" },
  task_status:     { icon: Clock, dot: "bg-neutral-900", tone: "text-neutral-900" },
  task_progress:   { icon: ChartBar, dot: "bg-neutral-500", tone: "text-neutral-600" },
  task_people:     { icon: UserPlus, dot: "bg-neutral-600", tone: "text-neutral-700" },
  task_assigned:   { icon: UserPlus, dot: "bg-neutral-600", tone: "text-neutral-700" },
  task_note:       { icon: ChatText, dot: "bg-neutral-400", tone: "text-neutral-600" },
  task_reply:      { icon: ChatText, dot: "bg-neutral-400", tone: "text-neutral-600" },
  task_handoff:    { icon: ArrowBendUpRight, dot: "bg-neutral-600", tone: "text-neutral-700" },
  task_escalate:   { icon: WarningCircle, dot: "bg-neutral-900", tone: "text-neutral-900" },
  task_approved:   { icon: ShieldCheck, dot: "bg-neutral-600", tone: "text-neutral-700" },
  task_rejected:   { icon: XCircle, dot: "bg-neutral-900", tone: "text-neutral-900" },
  task_clarify:    { icon: ChatText, dot: "bg-neutral-500", tone: "text-neutral-600" },
  task_plan:       { icon: ListChecks, dot: "bg-neutral-600", tone: "text-neutral-700" },
  task_step:       { icon: CheckCircle, dot: "bg-neutral-500", tone: "text-neutral-700" },
  task_attachment: { icon: Paperclip, dot: "bg-neutral-400", tone: "text-neutral-500" },
  task_done:       { icon: CheckCircle, dot: "bg-neutral-900", tone: "text-neutral-900", strong: true },
  default:         { icon: Clock, dot: "bg-neutral-400", tone: "text-neutral-500" },
};

/* ASK-27 — the task drawer's material, on the founder's reference: a pale
   frosted sheet, content grouped on soft raised glass, small-caps section
   labels, and one navy ink for the two actions that move a task on (Complete,
   Log update or hand off). Strings beside the drawer rather than new CSS, so
   every surface in it reads from one place. */
const DRAWER_LABEL = "mb-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500";
const DRAWER_CARD = "rounded-[1.4rem] bg-white/60 ring-1 ring-inset ring-white/80 shadow-[0_10px_30px_-14px_hsl(0_0%_10%/0.22)] backdrop-blur-xl";
const GLASS_PILL = "bg-white/75 ring-1 ring-inset ring-slate-900/[0.05] shadow-[0_6px_16px_-8px_hsl(216_30%_25%/0.35),inset_0_1px_0_hsl(0_0%_100%/0.9)]";
const GLASS_ICON_BTN = `grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-700 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`;
// ASK-30 — black and gray, not navy: the founder's palette for the drawer. The
// filled pills are a black gradient; the sheet is a light neutral gray so the
// white pills stand off it; the only colour left is the maroon Delete.
const INK_PILL = "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white shadow-[0_12px_26px_-12px_hsl(0_0%_0%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.16)] transition-[filter] hover:brightness-125";
// ASK-29 — the same pill as INK_PILL, in maroon: the one destructive action.
const MAROON_PILL = "bg-[linear-gradient(180deg,hsl(350_52%_40%),hsl(349_62%_27%))] text-white shadow-[0_12px_26px_-12px_hsl(349_62%_22%/0.7),inset_0_1px_0_hsl(0_0%_100%/0.18)] transition-[filter] hover:brightness-110";
// ASK-28 — fields and segmented tracks for forms that open inside the drawer.
const DRAWER_FIELD = "w-full rounded-2xl bg-white/80 px-4 py-3 text-[15px] text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.06] shadow-[inset_0_1px_2px_hsl(216_30%_25%/0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";
const DRAWER_TRACK = "bg-slate-500/[0.08] ring-1 ring-inset ring-slate-900/[0.04]";
const DRAWER_SELECT = "h-12 w-full cursor-pointer appearance-none rounded-pill bg-transparent pl-5 pr-10 text-[15px] text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:cursor-not-allowed disabled:opacity-50";

/* ASK-27 — "Set % manually" with no toggle in front of it: the bar IS the
   control. It used to be a <select> hidden behind a disclosure; the founder
   took the toggle out, so the value is dragged (or arrow-keyed) along the bar
   in 5% steps and saved once, when the hand lets go — not on every step. */
/* ASK-28 — and it is only adjustable when the task has NO checklist. With an
   Execution Guide, progress is the share of its steps ticked: the bar shows
   that number, the thumb goes away, and the label says where it comes from.
   The server holds the same rule (PATCH ignores a manual value on a task
   with steps), so the number cannot drift from the list. */
function ProgressControl({ value, onCommit, testid, valueTestid, checklist }) {
  const [pct, setPct] = useState(value);
  const locked = !!checklist;
  // The release handler reads the LATEST value from a ref, not from the render
  // it was bound in: a release that lands before React re-renders would
  // otherwise compare the old value with itself and skip the save (measured:
  // bar at 70%, no PATCH sent).
  const latest = useRef(value);
  const committed = useRef(value);
  useEffect(() => { setPct(value); latest.current = value; committed.current = value; }, [value]);
  const commit = () => {
    if (latest.current === committed.current) return;
    committed.current = latest.current;
    onCommit(latest.current);
  };
  const shown = locked ? value : pct;
  return (
    <div className="min-w-0 flex-1" data-progress-source={locked ? "checklist" : "manual"}>
      <div className="mb-2 flex items-center gap-2.5 text-sm text-slate-600">
        <span className={`grid h-8 w-8 place-items-center rounded-full text-neutral-800 ${GLASS_PILL}`}>
          <ChartBar size={16} weight="bold" aria-hidden="true" />
        </span>
        {locked
          ? <span>From checklist · {checklist.done} of {checklist.total} steps</span>
          : "Set % manually"}
      </div>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={100} step={5} value={shown}
          disabled={locked}
          onChange={(e) => { if (locked) return; latest.current = Number(e.target.value); setPct(latest.current); }}
          onPointerUp={locked ? undefined : commit} onKeyUp={locked ? undefined : commit} onBlur={locked ? undefined : commit}
          aria-label={locked ? "Progress, from the Execution Guide" : "Progress"} aria-valuetext={`${shown}%`}
          title={locked ? "Progress follows the Execution Guide — tick its steps to move it" : undefined}
          data-testid={testid}
          className={`kr-progress-range min-w-0 flex-1 ${locked ? "cursor-default" : "cursor-pointer"}`}
          style={{ "--pct": `${shown}%` }} />
        <span className="w-10 shrink-0 text-right text-sm tabular-nums text-slate-600" data-testid={valueTestid}>{shown}%</span>
      </div>
    </div>
  );
}

function TaskTrail({ t, members, roleOptions, onChange, openTrigger = 0, noteOnly = false }) {
  const [open, setOpen] = useState(false);
  // MW-09 fix: the mobile "Log update or hand off" button on the collapsed
  // card can nudge this counter; each nudge opens the UpdateForm here.
  // useEffect (not a lazy initializer) so a second tap while the form is
  // closed reopens it.
  useEffect(() => {
    if (openTrigger > 0) setOpen(true);
  }, [openTrigger]);
  const updates = t.updates || [];
  /* ASK-29 — the timeline is the task's whole activity log (status, progress,
     people, approvals, checklist, attachments, completion) merged with the
     notes and hand-offs on its trail, newest first, from
     GET /tasks/{id}/activity. The founder found status moves printed under
     the drawer's title instead; they belong here. Keyed on updated_at and the
     trail length — every change to a task moves updated_at — so any edit
     refetches it. Until it answers, or if it fails, the trail still shows. */
  const activityQ = useQuery({
    queryKey: ["task-activity", t.id, t.updated_at, updates.length],
    queryFn: () => api.get(`/tasks/${t.id}/activity`).then((r) => r.data),
    staleTime: 15000,
  });
  const fallback = [...updates].reverse().map((u) => ({
    id: u.id, kind: `task_${u.kind}`, text: u.text, actor_name: u.author_name,
    to_name: u.to_name, step_text: u.step_text, created_at: u.created_at,
  }));
  const entries = Array.isArray(activityQ.data) ? activityQ.data : fallback;
  const hasUpdates = entries.length > 0;
  // U7-05.EXP: when there is no activity, the heavy "ACTIVITY &
  // HANDOFFS" header + right-aligned button read as an empty section
  // to fill. Softer treatment when empty: single line with the action
  // inline. Full section header only when there's actual activity to
  // frame.
  return (
    /* ASK-27 — the reference's order: an ACTIVITY label with its clock, the
       trail (or a quiet "No activity yet"), a rule, then "Log update or hand
       off" alone across the full width. It used to sit ABOVE the trail and
       share its row with "View details", which is now in the ⋯ menu. The
       ASK-9 weight holds: this is still the primary action, in the same navy
       as Complete. */
    <div className="border-t border-slate-900/[0.07] pt-5" data-testid={`task-trail-${t.id}`}>
      <p className={`${DRAWER_LABEL} flex items-center gap-2`}>
        <Clock size={16} weight="regular" aria-hidden="true" className="text-slate-500" /> Activity
      </p>
      {!hasUpdates && !open && (
        <p className="pl-6 text-sm text-slate-500">{activityQ.isLoading ? "Loading activity…" : "No activity yet"}</p>
      )}
      {hasUpdates && (
        /* A single line down the left (the ::before), a dot on it per event
           coloured by kind, and beside each dot the glyph, the line of text,
           and who did it, when. Newest at the top. */
        <ol className="relative ml-1.5 space-y-4 pl-7 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-slate-900/[0.12] before:content-['']"
          data-testid={`trail-list-${t.id}`}>
          {entries.map((e, i) => {
            const meta = TIMELINE_KIND[e.kind] || TIMELINE_KIND.default;
            const Icon = meta.icon;
            return (
              <li key={e.id || `${e.kind}-${i}`} className="relative" data-kind={e.kind}>
                <span aria-hidden="true"
                  className={`absolute -left-7 top-1.5 h-[11px] w-[11px] rounded-full ring-4 ring-[hsl(0_0%_93%)] ${meta.dot}`} />
                <div className="flex items-start gap-2">
                  <Icon size={15} weight="bold" aria-hidden="true" className={`mt-0.5 shrink-0 ${meta.tone}`} />
                  <div className="min-w-0 flex-1">
                    {e.step_text && <p className="truncate text-xs text-slate-500">On: {e.step_text}</p>}
                    <p className={`break-words text-sm leading-snug ${meta.strong ? "font-medium text-slate-900" : "text-slate-700"}`}>{e.text}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {e.actor_name || "Someone"}
                      {e.to_name && <> <ArrowRight size={10} weight="bold" className="inline" aria-hidden="true" /> {e.to_name}</>}
                      {e.created_at && <> · <time dateTime={e.created_at} title={fullTime(e.created_at)}>{timeAgo(e.created_at)}</time></>}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {open && (
        <div className="mt-3">
          <UpdateForm taskId={t.id} stepId={null} members={members} roleOptions={roleOptions} noteOnly={noteOnly}
            onDone={() => { setOpen(false); onChange(); }} onCancel={() => setOpen(false)} />
        </div>
      )}
      {!open && (
        <div className="mt-5 border-t border-slate-900/[0.07] pt-5">
          <button
            onClick={() => setOpen(true)}
            data-testid={`add-update-${t.id}`}
            className={`flex h-14 w-full items-center justify-center gap-2.5 rounded-pill text-base font-medium ${INK_PILL}`}
          >
            {/* ASK-28 TK-01 — the person who asked can only leave a note. */}
            <Plus size={18} weight="bold" aria-hidden="true" /> {noteOnly ? "Leave a note" : "Log update or hand off"}
          </button>
        </div>
      )}
    </div>
  );
}

/* KM-6 · StepRow — the drag-to-reorder gesture is REVERTED.
   KM-5 replaced the up/down buttons with long-press-and-drag plus live
   reflow. The founder's verdict is that it was not built well enough to keep,
   and he is right that an invisible 450ms hold is a lot to ask of a control
   whose whole job is "move this up one". So reordering goes back to explicit
   arrows: a small stacked pair on the right of each field, sized to sit
   INSIDE the field's height rather than beside it.

   What survives from KM-5, because both are discoverable and both tested
   clean: tap the field to expand and edit (two lines collapsed, grows on
   focus), and swipe sideways to delete with a red ground bleeding in. Only
   the reorder gesture goes.

   Note on the arrow sizes: index.css puts a 44px min-height touch floor on
   every button below lg, which would make a stacked pair 88px tall — taller
   than the 62px field they must fit inside. These two are the deliberate
   exception, declared via .kr-step-nudge in index.css, and they stay
   comfortably tappable because they are the only things in that column. */
function StepRow({
  step, index, count, editing, inpClass,
  onEdit, onRemove, onMove, highlight = false,
}) {
  const rowRef = useRef(null);
  const start = useRef(null);
  /* Gesture state in REFS, not state: two pointermove events can land in the
     same frame, and a closure read still holds the previous render's value —
     which is what made an earlier cut of the swipe never move. */
  const axisRef = useRef(null);
  const dxRef = useRef(0);
  const [dx, setDx] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const onPointerDown = (e) => {
    if (e.target.closest("button")) return;
    start.current = { x: e.clientX, y: e.clientY };
    axisRef.current = null;
  };

  const onPointerMove = (e) => {
    if (!start.current) return;
    const mx = e.clientX - start.current.x;
    const my = e.clientY - start.current.y;
    if (!axisRef.current) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      axisRef.current = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (axisRef.current === "y") return;   // a vertical drag is a scroll
    }
    if (axisRef.current === "x") {
      e.preventDefault();
      dxRef.current = mx;
      setDx(mx);
    }
  };

  const endGesture = () => {
    if (Math.abs(dxRef.current) > (rowRef.current?.offsetWidth || 300) / 3) onRemove(index);
    dxRef.current = 0;
    setDx(0);
    axisRef.current = null;
    start.current = null;
  };

  if (!editing) return null;

  const killPct = Math.min(1, Math.abs(dx) / ((rowRef.current?.offsetWidth || 300) / 3));

  return (
    /* ASK-29 — `highlight` is the step that was just moved: a blue glow that
       fades out over ~0.7s once it is released, so the eye can follow it to
       its new place. Both states are two-layer shadows, so the change
       interpolates instead of snapping. */
    <div ref={rowRef}
      className={`relative rounded-[1.1rem] transition-shadow duration-700 ${
        highlight
          ? "shadow-[0_0_0_2.5px_hsl(0_0%_8%/0.7),0_0_28px_4px_hsl(0_0%_0%/0.22)]"
          : "shadow-[0_0_0_0_hsl(0_0%_8%/0),0_0_0_0_hsl(0_0%_0%/0)]"
      }`}
      data-testid={`exec-step-row-${index}`} data-highlight={highlight ? "true" : "false"}>
      {/* The delete ground, revealed BY the swipe rather than drawn over it. */}
      {dx !== 0 && (
        <div aria-hidden="true"
          className="absolute inset-0 flex items-center justify-between rounded-control bg-red-600 px-4 text-white"
          style={{ opacity: 0.25 + killPct * 0.75 }}>
          <Trash size={16} weight="bold" />
          <Trash size={16} weight="bold" />
        </div>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        className="relative flex items-stretch gap-1.5"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dx === 0 ? "transform 180ms cubic-bezier(.22,1,.36,1)" : "none",
          touchAction: "pan-y",
        }}
      >
        {/* ASK-29 — delete this one step: a red-tinted circle on the left. The
            sideways swipe still works; this is the way you can see. */}
        <button type="button" onClick={() => onRemove(index)}
          data-testid={`exec-remove-${index}`} aria-label={`Delete step ${index + 1}`} title="Delete step"
          className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-full bg-red-50/90 text-red-600 ring-1 ring-inset ring-red-200/80 transition-colors hover:bg-red-100">
          <Trash size={14} weight="bold" aria-hidden="true" />
        </button>
        <textarea
          value={step.text}
          onChange={(e) => onEdit(index, e.target.value)}
          onFocus={() => setExpanded(true)}
          onBlur={() => setExpanded(false)}
          data-testid={`exec-step-input-${index}`}
          aria-label={`Step ${index + 1} of ${count}`}
          className={`${inpClass} min-w-0 flex-1 resize-none leading-snug`}
          style={{
            height: expanded ? "auto" : "3.9rem",
            minHeight: "3.9rem",
            maxHeight: expanded ? "12rem" : "3.9rem",
            overflowY: expanded ? "auto" : "hidden",
          }}
        />

        {/* The arrows: stacked, on the right, and together no taller than the
            collapsed field (3.9rem) so the row's height is still set by the
            text and never by its controls. */}
        <div className="flex w-7 shrink-0 flex-col justify-center gap-1">
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0}
            data-testid={`exec-up-${index}`} aria-label="Move step up"
            className="kr-step-nudge kr-pop grid h-[27px] w-7 place-items-center rounded-full text-foreground/70 disabled:opacity-30">
            <CaretUp size={11} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === count - 1}
            data-testid={`exec-down-${index}`} aria-label="Move step down"
            className="kr-step-nudge kr-pop grid h-[27px] w-7 place-items-center rounded-full text-foreground/70 disabled:opacity-30">
            <CaretDown size={11} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ExecutionPlan({ t, onChange, onPatched, members = [], roleOptions = [] }) {
  const plan = t.execution_plan;
  const [steps, setSteps] = useState(plan?.steps || []);
  const [editing, setEditing] = useState(!plan || plan.status === "draft");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [updStep, setUpdStep] = useState(null);
  const [viewStep, setViewStep] = useState(null);
  // ASK-29 — the step last moved glows for a moment; see StepRow.
  const [movedId, setMovedId] = useState(null);
  const glowTimer = useRef(null);
  useEffect(() => () => clearTimeout(glowTimer.current), []);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    setSteps(t.execution_plan?.steps || []);
    setEditing(!t.execution_plan || t.execution_plan.status === "draft");
  }, [t.execution_plan?.updated_at, t.execution_plan?.status]);

  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  /* ASK-28 — the AI draft is BACK. ASK-27 took out the whole AI side of the
     guide; the founder had only asked for the per-step star (Ask AI on one
     step) to go. Ask Dex and Regenerate return as they were. `onPatched`
     writes the returned task into the cache at once, so the drawer's
     progress bar follows the checklist without waiting for a refetch. */
  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${t.id}/execution-plan/generate`);
      setSteps(data.execution_plan.steps);
      setEditing(true);
      onPatched?.(data);
      toast.success("AI drafted an execution plan — review & customize");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not generate plan"); }
    finally { setBusy(false); }
  };

  const startManual = () => {
    setSteps([{ id: `new-${Date.now()}`, text: "", done: false }]);
    setEditing(true);
  };

  const clearPlan = async () => {
    setBusy(true);
    try {
      await api.delete(`/tasks/${t.id}/execution-plan`);
      setSteps([]);
      setEditing(false);
      toast.success("Plan cleared");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not clear plan"); }
    finally { setBusy(false); }
  };

  const persist = async (nextSteps, status) => {
    const { data } = await api.patch(`/tasks/${t.id}/execution-plan`, {
      steps: nextSteps.map((s) => ({ id: s.id, text: s.text, done: !!s.done })), status,
    });
    setSteps(data.execution_plan.steps);
    onPatched?.(data);
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
  /* KM-6 — back to a neighbour swap, which is all the arrows can express and
     all the founder asked for. */
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const ns = [...steps];
    [ns[i], ns[j]] = [ns[j], ns[i]];
    setSteps(ns);
    setMovedId(steps[i].id);
    clearTimeout(glowTimer.current);
    glowTimer.current = setTimeout(() => setMovedId(null), 1400);
  };

  const addStep = () => {
    if (!newStep.trim()) return;
    setSteps([...steps, { id: `new-${Date.now()}`, text: newStep.trim(), done: false }]);
    setNewStep("");
  };

  // ASK-28 — the step editor's fields in the drawer's glass, not nm-field.
  const inp = "flex-1 rounded-2xl bg-white/80 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.06] shadow-[inset_0_1px_2px_hsl(216_30%_25%/0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25";

  if (!plan && !steps.length) {
    /* ASK-28 — the two routes in are back (KM-5's shape: side by side, equal
       weight, "or" between), on the drawer's glass under the guide's name. */
    return (
      <div className={`${DRAWER_CARD} p-4`} data-testid={`exec-plan-empty-${t.id}`}>
        <span className="mb-3 flex items-center gap-2.5 px-1 text-[15px] font-semibold text-slate-800">
          <ListChecks size={20} weight="regular" aria-hidden="true" className="text-slate-600" /> AI Execution Guide
        </span>
        <div className="flex items-center gap-3">
          <button onClick={startManual} disabled={busy} data-testid={`manual-plan-${t.id}`}
            className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
            <PencilSimple size={15} weight="bold" aria-hidden="true" /> Add manually
          </button>
          <span className="shrink-0 text-sm text-slate-500">or</span>
          <button onClick={generate} disabled={busy} data-testid={`generate-plan-${t.id}`}
            className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-3 text-sm font-semibold text-slate-800 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
            <Sparkle size={15} weight="bold" aria-hidden="true" className="text-neutral-900" /> {busy ? "Thinking…" : "Ask Dex"}
          </button>
        </div>
      </div>
    );
  }

  return (
    /* ASK-27 — the guide is its own glass card: the list glyph and name on the
       left, "N% complete" on the right, and no second progress bar — the
       drawer's Status section already carries one (ASK-28: and takes its
       number from this list). */
    <div className={`${DRAWER_CARD} p-4`} data-testid={`exec-plan-${t.id}`}>
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold text-slate-800">
          <ListChecks size={20} weight="regular" aria-hidden="true" className="text-slate-600" /> AI Execution Guide
        </span>
        <span className="text-sm text-slate-500"><span data-testid={`exec-progress-${t.id}`}>{progress}%</span> complete</span>
      </div>

      <div className="space-y-2.5">
        {steps.map((s, i) => (
          /* ASK-29 — `layout` makes a reorder travel: when a step and its
             neighbour swap, framer-motion animates each from its old place to
             its new one (keyed on the step's id, so it knows which is which).
             Off under prefers-reduced-motion. */
          <motion.div key={s.id} data-testid={`exec-step-${t.id}-${i}`}
            layout={reduceMotion ? false : "position"}
            transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.8 }}>
            {editing ? (
              /* KM-5 — the four buttons are gone; the row IS the control.
                 Tap to expand and edit, long-press to drag-reorder with live
                 reflow, swipe sideways to delete. See StepRow. */
              <StepRow
                step={s}
                index={i}
                count={steps.length}
                editing
                inpClass={inp}
                onEdit={editStep}
                onRemove={removeStep}
                onMove={moveStep}
                highlight={movedId === s.id}
              />
            ) : (
              /* KM-5 · ACCEPTED PLAN ROW — rebuilt.
                 Was: a 20px square check, a bare text button that wrapped to
                 as many lines as it liked, and two full-width worded buttons
                 ("Ask AI", "Update") that dominated the row and pushed the
                 text into a narrow column. The founder's shape instead — a
                 two-line field carrying the step, a properly-sized circular
                 check on the left, and the two actions reduced to small
                 circular icon buttons whose expanded views open on tap. */
              /* KM-6 · ONE STRIP, NOT THREE OBJECTS.
                 The row was a loose check square, a two-line text plate and
                 two 36px circles floating beside each other, so a checklist
                 read as a stack of separate widgets rather than a list. Now a
                 single .kr-pop strip holds all of it: check on the left, the
                 step on ONE line (tap opens the full text), the two actions on
                 the right. Fixed height, so ten steps make ten identical bars.

                 On the icon sizes: index.css puts a 44px min-height/min-width
                 touch floor on every button below lg, so these stay 44px TAP
                 TARGETS while the drawn glyph inside each is small — the
                 founder's "shrink the icons" without shrinking what a thumb
                 has to hit. */
              /* ASK-27 — the reference's row: an open ring to tick, the step on
                 one line, and a ⋮ on the right that opens the update / hand-off
                 form for that step. The star (Ask AI) is gone. */
              <div className={`flex h-14 items-center gap-1 rounded-2xl pl-2 pr-1 ${GLASS_PILL}`}>
                <button onClick={() => toggle(i)} data-testid={`exec-toggle-${t.id}-${i}`}
                  aria-pressed={s.done}
                  aria-label={s.done ? "Mark step not done" : "Mark step done"}
                  className="grid h-11 w-10 shrink-0 place-items-center">
                  <span className={`grid h-6 w-6 place-items-center rounded-full transition-colors ${
                    s.done ? "bg-[linear-gradient(180deg,hsl(0_0%_24%),hsl(0_0%_6%))] text-white" : "border-[1.5px] border-neutral-400/80 text-transparent"
                  }`}>
                    <Check size={13} weight="bold" aria-hidden="true" />
                  </span>
                </button>

                <button onClick={() => setViewStep(s)} data-testid={`exec-view-${t.id}-${i}`}
                  className={`min-w-0 flex-1 truncate text-left text-[15px] ${
                    s.done ? "text-slate-400 line-through" : "text-slate-700"
                  }`}>
                  {s.text}
                </button>

                <button onClick={() => setUpdStep(updStep === s.id ? null : s.id)} data-testid={`exec-update-${t.id}-${i}`}
                  aria-label="Log an update or hand off on this step" title="Update or hand off"
                  aria-expanded={updStep === s.id}
                  className={`grid h-11 w-10 shrink-0 place-items-center rounded-full hover:text-slate-900 ${
                    updStep === s.id ? "text-slate-900" : "text-slate-500"
                  }`}>
                  <DotsThreeVertical size={18} weight="bold" aria-hidden="true" />
                </button>
              </div>
            )}
            {updStep === s.id && (
              <div className="ml-7 mt-1.5 mb-2" data-testid={`exec-update-form-${t.id}-${i}`}>
                <UpdateForm taskId={t.id} stepId={s.id} members={members} roleOptions={roleOptions}
                  onDone={() => { setUpdStep(null); onChange(); }} onCancel={() => setUpdStep(null)} />
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {editing && (
        /* KM-7 — the add row joins the material. The field is .nm-field like
           every other input in the app, and the plus is a round .kr-pop button
           rather than a square .nm-tile with a colour hover. */
        <div className="mt-3 flex items-center gap-2">
          <input value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStep()}
            placeholder="Add your own step…" data-testid={`exec-newstep-${t.id}`}
            className="h-11 min-w-0 flex-1 rounded-pill bg-white/80 px-4 text-sm text-slate-800 placeholder:text-slate-400 ring-1 ring-inset ring-slate-900/[0.06] shadow-[inset_0_1px_2px_hsl(216_30%_25%/0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25" />
          <button onClick={addStep} data-testid={`exec-add-${t.id}`} aria-label="Add step"
            className="kr-pop grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground">
            <Plus size={15} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {editing ? (
          <>
            {/* KM-7 — all three on ONE row. Accept takes the space it needs
                and Regenerate the rest; Cancel plan drops its word and becomes
                a circle on the right, which is what makes the row fit at
                343px. Its icon is translucent red — present enough to read as
                the destructive one, quiet enough not to compete with the two
                controls you actually came here to press. */}
            {/* ASK-28 — Accept, Regenerate (AI, back) and the clear-plan circle,
                as KM-7 laid them out, in the drawer's material. */}
            <button onClick={() => save("accepted")} disabled={busy} data-testid={`exec-accept-${t.id}`}
              className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill px-3 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
              <CheckCircle size={15} weight="bold" aria-hidden="true" /> Accept plan
            </button>
            <button onClick={generate} disabled={busy} data-testid={`exec-regenerate-${t.id}`}
              className={`flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-pill px-3 text-sm font-medium text-slate-800 transition-colors hover:bg-white disabled:opacity-50 ${GLASS_PILL}`}>
              <ArrowClockwise size={15} weight="bold" aria-hidden="true" /> {busy ? "Thinking…" : "Regenerate"}
            </button>
            <button onClick={clearPlan} disabled={busy} data-testid={`exec-cancel-plan-${t.id}`}
              aria-label="Clear plan" title="Clear plan"
              className={`${GLASS_ICON_BTN} text-danger-600/70`}>
              <XCircle size={16} weight="bold" aria-hidden="true" />
            </button>
          </>
        ) : (
          t.status !== "done" && (
            /* KM-6 — .kr-pop and a real height, matching every other pill on
               this card. It was .nm-btn with a colour hover, the flat idiom
               the redesign replaced, and py-2 left it sitting a few pixels
               short of its neighbours. */
            <button onClick={() => setEditing(true)} data-testid={`exec-edit-${t.id}`}
              className={`flex h-11 items-center gap-2 rounded-pill px-5 text-sm font-medium text-slate-800 transition-colors hover:bg-white ${GLASS_PILL}`}>
              <PencilSimple size={16} weight="bold" aria-hidden="true" /> Customize steps
            </button>
          )
        )}
      </div>

      {/* KM-7 — the step detail joins the design system. It was the retired
          system's last corner in this file: a hairline-framed panel, a
          font-heading title and a `label-mono` footnote, with the close X
          inheriting the dialog default and sitting off the title's baseline.
          Now a .kr-bento sheet, sans throughout, the step itself pressed into
          a .nm-inset well so the text reads as the CONTENT rather than more
          chrome, and the X replaced by an explicit .kr-pop Close so it is
          aligned by the layout instead of floating. */}
      <Dialog open={!!viewStep} onOpenChange={(o) => !o && setViewStep(null)}>
        <DialogContent className="kr-bento rounded-cardlg border-0 [&>button.absolute]:hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <ListChecks size={17} weight="regular" aria-hidden="true" className="text-muted-foreground" />
              Execution step
            </DialogTitle>
          </DialogHeader>
          <div className="nm-inset rounded-control p-3.5">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed"
               data-testid={`exec-step-detail-${t.id}`}>
              {viewStep?.text}
            </p>
          </div>
          <button type="button" onClick={() => setViewStep(null)} data-testid={`exec-step-close-${t.id}`}
            className="kr-pop mt-1 flex h-11 w-full items-center justify-center rounded-pill text-sm font-medium text-foreground">
            Close
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PRIORITY_AXES = [
  { key: "business_impact", label: "Impact", color: "bg-foreground/70",
    tip: "How much this moves the business -- customer relationship weight, workflow blockage, cross-team dependencies." },
  { key: "revenue", label: "Revenue", color: "bg-foreground/70",
    tip: "Amount tied to this task -- unpaid invoices, overdue collections, deal value." },
  { key: "risk", label: "Risk", color: "bg-foreground/70",
    tip: "Downside if this slips -- customer complaints, compliance dates, financial penalties." },
  { key: "urgency", label: "Urgency", color: "bg-foreground/70",
    tip: "Time pressure -- days overdue, hours to due-date, escalation history." },
];

function PriorityScoreBars({ scores }) {
  return (
    <div className="mt-3 nm-inset p-3" data-testid="priority-score-bars">
      <div className="flex items-center justify-between mb-2">
        <span className="label-mono text-muted-foreground flex items-center gap-1"><Sparkle size={12} weight="bold" aria-hidden="true" className="text-muted-foreground" /> AI Priority</span>
        {scores.priority_score != null && (
          <span
            className="font-heading font-black text-lg leading-none"
            data-testid="priority-score-value"
            title="Overall ranking. Weighted mix of the four signals below."
          >{scores.priority_score}</span>
        )}
      </div>
      <div className="space-y-1.5">
        {PRIORITY_AXES.map((a) => (
          <div
            key={a.key}
            className="flex items-center gap-2"
            data-testid={`axis-${a.key}`}
            title={a.tip}
          >
            <span className="label-mono w-16 shrink-0 text-muted-foreground cursor-help">{a.label}</span>
            <div className="flex-1 h-2 overflow-hidden rounded-pill nm-inset">
              <div className={`h-full rounded-pill ${a.color}`} style={{ width: `${scores[a.key] || 0}%` }} />
            </div>
            <span className="label-mono w-7 text-right tabular-nums">{scores[a.key] || 0}</span>
          </div>
        ))}
      </div>
      {scores.reason && <p className="text-xs text-muted-foreground mt-2 italic">{scores.reason}</p>}
    </div>
  );
}

function TaskDetailDialog({ t, open, onOpenChange, onChange }) {
  const { user } = useAuth();
  const [zoom, setZoom] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const isOwner = user?.role === "owner";
  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tasks/${t.id}`);
      toast.success("Task deleted");
      onOpenChange(false);
      onChange?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not delete task");
    } finally { setDeleting(false); }
  };
  const steps = t.execution_plan?.steps || [];
  const attachments = t.attachments || [];
  const updates = t.updates || [];
  const refs = attachments.filter((a) => a.kind === "reference");
  const proof = attachments.filter((a) => a.kind !== "reference");
  const insights = t.reference_insights || [];
  const photos = proof.filter((a) => a.kind === "photo" || (a.content_type || "").startsWith("image/"));
  const voices = proof.filter((a) => !(a.kind === "photo" || (a.content_type || "").startsWith("image/")));
  const url = (u) => `${process.env.REACT_APP_BACKEND_URL}${u}`;
  const isImg = (a) => a.kind === "photo" || (a.content_type || "").startsWith("image/");
  const isAudio = (a) => a.kind === "voice" || (a.content_type || "").startsWith("audio/");
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setZoom(null); setConfirmDel(false); } onOpenChange(o); }}>
      <DialogContent className="rounded-cardlg border border-nm-edge/40 max-w-2xl max-h-[90vh] overflow-y-auto" data-testid={`task-detail-${t.id}`}>
        <DialogHeader>
          <DialogTitle className="font-heading tracking-tight text-base pr-6">{t.title}</DialogTitle>
        </DialogHeader>
        {zoom ? (
          <div className="space-y-3">
            <button onClick={() => setZoom(null)} data-testid={`detail-zoom-back-${t.id}`} className="flex items-center gap-1 text-xs font-medium nm-btn px-2 py-1 hover:bg-accent"><X size={14} weight="bold" /> Back to details</button>
            <img src={zoom} alt="proof full" className="w-full h-auto max-h-[70vh] object-contain nm-tile" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-nm-sunken text-muted-foreground">{STATUS_LABEL[t.status] || t.status}</span>
              {t.assignee_name && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><UserCircle size={13} weight="bold" /> {t.assignee_name}</span>}
              {t.due_date && <span className="text-xs text-muted-foreground">due {new Date(t.due_date).toLocaleDateString()}</span>}
              <span className="label-mono text-muted-foreground ml-auto">{t.progress || 0}%</span>
            </div>
            {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}

            {steps.length > 0 && (
              <div>
                <p className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm mb-2"><ListChecks size={16} weight="bold" aria-hidden="true" className="text-muted-foreground" /> What was done</p>
                <ul className="space-y-1.5">
                  {steps.map((s) => (
                    <li key={s.id} className="flex items-start gap-2 text-sm" data-testid={`detail-step-${t.id}-${s.id}`}>
                      <CheckCircle size={16} weight={s.done ? "fill" : "regular"} className={`mt-0.5 shrink-0 ${s.done ? "text-foreground" : "text-muted-foreground"}`} />
                      <span className={s.done ? "line-through text-muted-foreground" : ""}>{s.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {refs.length > 0 && (
              <div data-testid={`detail-reference-${t.id}`}>
                <p className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm mb-2"><Paperclip size={15} weight="bold" className="text-brand-blue" /> Reference material · {refs.length}</p>
                <div className="flex flex-wrap gap-2 items-center">
                  {refs.map((a) => (
                    isImg(a)
                      ? <button key={a.url} type="button" onClick={() => setZoom(url(a.url))} data-testid={`detail-ref-photo-${t.id}-${a.url}`}
                          className="relative w-24 h-24 nm-tile overflow-hidden group" title="Click to view full image">
                          <img src={url(a.url)} alt={a.filename || "reference"} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><MagnifyingGlassPlus size={20} weight="bold" className="text-white" /></span>
                        </button>
                      : isAudio(a)
                        ? <audio key={a.url} controls preload="none" src={url(a.url)} className="h-9 w-full" data-testid={`detail-ref-voice-${t.id}-${a.url}`} />
                        : <a key={a.url} href={url(a.url)} target="_blank" rel="noreferrer" data-testid={`detail-ref-file-${t.id}-${a.url}`}
                            className="inline-flex items-center gap-1.5 nm-tile px-2.5 py-1.5 text-xs font-mono hover:bg-accent transition-colors max-w-[220px]">
                            <File size={14} weight="bold" /> <span className="truncate">{a.filename || "file"}</span>
                          </a>
                  ))}
                </div>
                {insights.map((ins, i) => (
                  <div key={`${ins.filename || "ref"}-${(ins.summary || "").slice(0, 40)}`} className="nm-inset mt-3 p-3" data-testid={`detail-ref-insight-${t.id}-${i}`}>
                    <p className="flex items-center gap-1.5 label-mono text-brand-blue mb-1"><Lightbulb size={13} weight="fill" className="text-brand-yellow" /> AI read this reference{ins.filename ? ` · ${ins.filename}` : ""}</p>
                    <p className="text-sm">{ins.summary}</p>
                    {(ins.points || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {ins.points.map((p) => <li key={p} className="flex items-start gap-1.5 text-xs text-muted-foreground"><ArrowRight size={11} weight="bold" className="mt-0.5 shrink-0 text-brand-blue" /> {p}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div>
              <p className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm mb-2"><Paperclip size={15} weight="bold" aria-hidden="true" className="text-muted-foreground" /> Proof of work{proof.length > 0 ? ` · ${proof.length}` : ""}</p>
              {proof.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid={`detail-no-proof-${t.id}`}>No proof uploaded for this task.</p>
              ) : (
                <div className="space-y-2">
                  {photos.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {photos.map((a) => (
                        <button key={a.url} type="button" onClick={() => setZoom(url(a.url))} data-testid={`detail-photo-${t.id}-${a.url}`}
                          className="relative w-24 h-24 nm-tile overflow-hidden group" title="Click to view full photo">
                          <img src={url(a.url)} alt="proof" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><MagnifyingGlassPlus size={20} weight="bold" className="text-white" /></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {voices.map((a) => (
                    isAudio(a)
                      ? <audio key={a.url} controls preload="none" src={url(a.url)} className="h-9 w-full" data-testid={`detail-voice-${t.id}-${a.url}`} />
                      : <a key={a.url} href={url(a.url)} target="_blank" rel="noreferrer" data-testid={`detail-proof-file-${t.id}-${a.url}`}
                          className="inline-flex items-center gap-1.5 nm-tile px-2.5 py-1.5 text-xs font-mono hover:bg-accent transition-colors max-w-[220px]">
                          <File size={14} weight="bold" /> <span className="truncate">{a.filename || "file"}</span>
                        </a>
                  ))}
                </div>
              )}
            </div>

            {updates.length > 0 && (
              <div>
                <p className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm mb-2"><ChatCircleText size={16} weight="bold" aria-hidden="true" className="text-muted-foreground" /> Activity &amp; Handoffs</p>
                <ul className="space-y-2">
                  {updates.map((u) => (
                    <li key={u.id} className="flex items-start gap-2 nm-tile p-2.5">
                      <ChatText size={15} weight="bold" className="mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        {u.step_text && <p className="label-mono text-muted-foreground">On: {u.step_text}</p>}
                        <p className="text-sm">{u.text}</p>
                        <p className="label-mono text-muted-foreground mt-1">{u.author_name}{u.to_name && <> <ArrowRight size={10} weight="bold" className="inline" /> {u.to_name}</>}{" · "}{new Date(u.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {isOwner && (
              <div className="border-t border-nm-edge/40 pt-3">
                {!confirmDel ? (
                  <button onClick={() => setConfirmDel(true)} data-testid={`delete-task-${t.id}`}
                    className="nm-btn flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
                    <Trash size={13} weight="bold" /> Delete task
                  </button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">Delete this task permanently?</span>
                    <button onClick={doDelete} disabled={deleting} data-testid={`delete-task-confirm-${t.id}`}
                      className="kr-lift rounded-pill bg-kr-ink px-3.5 py-2 text-xs font-medium text-white transition-all disabled:opacity-60">
                      {deleting ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button onClick={() => setConfirmDel(false)} disabled={deleting}
                      className="text-xs font-medium nm-tile px-3 py-1.5 hover:bg-accent transition-colors">
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// U7-05.3: BulkActionBar -- sticky bar shown above the list when 1+
// tasks are selected. Actions apply client-side one PATCH per task
// (real bulk endpoint tracked as backend backlog item).
function BulkActionBar({ selectedIds, tasks = [], busy, onClear, onComplete, openReassign }) {
  const openCount = tasks.filter((t) => !isTerminal(t)).length;
  const doneCount = tasks.filter(isTerminal).length;
  return (
    <div
      /* KR-11 — the plan's call: a worklist has no hero moment, so My Work's
         Karma-dark ingredient is this bar rather than a full band. Ink pill,
         floating, only present while a selection exists. */
      className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-pill bg-kr-ink px-5 py-3 text-white shadow-none"
      data-testid="bulk-action-bar"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <ListChecks size={16} weight="bold" className="shrink-0" />
        <p className="text-sm font-semibold">
          {selectedIds.length} selected
          {openCount > 0 && doneCount > 0 && (
            <span className="label-mono text-muted-foreground ml-2">
              · {openCount} open · {doneCount} done
            </span>
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onComplete}
        disabled={busy || openCount === 0}
        className="kr-lift inline-flex items-center gap-1.5 rounded-pill bg-white px-3.5 py-2 text-xs font-medium text-kr-ink disabled:opacity-40"
        data-testid="bulk-complete"
      >
        <CheckCircle size={13} weight="bold" />
        Complete{openCount ? ` ${openCount}` : ""}
      </button>
      {/* ASK-10 fix (2026-09-12): Reassign was styled for a light ground
          (bg-nm on #E9EAEC) while inheriting the bar's white text, so
          the label read at 1.2:1 -- functionally invisible on the near-
          black bar. Re-themed as a proper outline/ghost secondary on
          dark: transparent fill, white/45 hairline border, white text.
          Contrast on the label is now ~19:1 against bg-kr-ink (the same
          as any other white text on the bar), and the border stays
          visible without competing with Complete's filled white pill.
          Complete stays untouched -- it's already correctly themed and
          reads as the primary action by virtue of being the filled
          pill in a row of two outlines. */}
      <button
        type="button"
        onClick={openReassign}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-pill border border-white/45 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-40"
        data-testid="bulk-reassign"
      >
        <ArrowBendUpRight size={13} weight="bold" />
        Reassign
      </button>
      {/* ASK-10 fix: Clear was text-muted-foreground (#585551) on the
          near-black bar -- 2.64:1, below the AA floor. And it was 45x16
          pixels, under WCAG's 24x24 target-size minimum. Now white/80
          (~12:1) on a proper h-9 px-3 pill so a shaky thumb still
          lands on it. Hover deepens to full white for the affordance. */}
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex h-9 items-center gap-1 rounded-pill px-3 text-xs font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
        data-testid="bulk-clear"
      >
        <X size={12} weight="bold" /> Clear
      </button>
    </div>
  );
}

/* ASK-25 — the card face's vocabulary, on the founder's reference card.
   One pill recipe for every chip, each meaning in its own soft tint: a light
   wash, a hairline ring in the same hue, and text dark enough to read on it
   (every pair below clears 4.5:1). Nothing bright — the stripe is the only
   saturated colour on the card, and it is the priority. */
const PILL = "inline-flex shrink-0 items-center gap-1 rounded-pill px-2 py-[3px] text-[11px] font-medium leading-none ring-1 ring-inset";
const QUIET_PILL = "bg-slate-500/[0.07] text-slate-600 ring-slate-500/10";
const PRIO_STRIPE = { high: "bg-red-500", medium: "bg-blue-500", low: "bg-neutral-500" };
const PRIO_LABEL = { high: "High", medium: "Medium", low: "Low" };
/* `arc` is how far through the flow a status sits — the ring's fill — and
   deliberately NOT t.progress: an In Progress task at 0% would otherwise draw
   an empty ring and read as Not Started. Waiting shares In Progress's point
   in the flow; its amber is what says it has paused. */
const STATUS_TONE = {
  todo:        { pill: QUIET_PILL, ring: "#64748b", arc: 0 },
  blocked:     { pill: "bg-teal-50 text-teal-700 ring-teal-100", ring: "#0d9488", arc: 0.2 },
  in_progress: { pill: "bg-blue-50 text-blue-700 ring-blue-100", ring: "#3b82f6", arc: 0.72 },
  waiting:     { pill: "bg-amber-50 text-amber-800 ring-amber-100", ring: "#d97706", arc: 0.72 },
  review:      { pill: "bg-violet-50 text-violet-700 ring-violet-100", ring: "#7c3aed", arc: 0.88 },
  done:        { pill: "bg-emerald-50 text-emerald-700 ring-emerald-100", ring: "#059669", arc: 1 },
  cancelled:   { pill: "bg-stone-100 text-stone-600 ring-stone-200/70", ring: "#78716c", arc: 0 },
};

function StatusRing({ status, tone }) {
  if (tone.arc >= 1) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
        <circle cx="7" cy="7" r="6.5" fill={tone.ring} />
        <path d="M4.3 7.2l1.8 1.8 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const r = 5.25;
  const c = 2 * Math.PI * r;
  const untouched = tone.arc === 0 && status !== "cancelled";
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
      {/* Not Started is a dashed track: nothing filled, and visibly so. */}
      <circle cx="7" cy="7" r={r} fill="none" stroke={tone.ring} strokeWidth="2.5"
        strokeOpacity={untouched ? 0.6 : 0.22} strokeDasharray={untouched ? "2.1 1.6" : undefined} />
      {tone.arc > 0 && (
        <circle cx="7" cy="7" r={r} fill="none" stroke={tone.ring} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={`${c * tone.arc} ${c}`} transform="rotate(-90 7 7)" />
      )}
      {status === "cancelled" && <path d="M3.8 10.2l6.4-6.4" stroke={tone.ring} strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

/* ASK-26 — everyone on a task: the lead (assignee_id) first, then the people
   added alongside them (co_assignee_ids). A role queue with nobody named yet
   keeps the team glyph. Names come from /users so a photo set on Team shows
   up here; the task's own enriched names are the fallback for anyone no
   longer in that list. */
function cardPeople(t, members, roleOptions) {
  const coNames = Object.fromEntries((t.co_assignees || []).map((c) => [c.id, c.name]));
  const person = (id, fallback) => {
    const m = members.find((x) => x.id === id);
    return { id, name: m?.name || fallback || "Member", avatar_url: m?.avatar_url };
  };
  const co = (t.co_assignee_ids || [])
    .filter((id) => id && id !== t.assignee_id)
    .map((id) => person(id, coNames[id]));
  if (t.assignee_id) return [person(t.assignee_id, t.assignee_name || "Assignee"), ...co];
  if (t.assignee_role) {
    const label = roleOptions.find((r) => r.key === t.assignee_role)?.label || t.assignee_role;
    return [{ id: `role:${t.assignee_role}`, kind: "team", name: `${label} team` }, ...co];
  }
  return co;
}

/* ASK-26 — who is on the task, at the top of the drawer, and the one place
   to change it after the task exists. The lead keeps the lead's jobs —
   approvals, hand-offs and Reassign all act on assignee_id — so the lead is
   shown, not removable here; everyone else can be added or taken off. The
   server re-checks who may do this (owner, team_manage, the creator, the
   lead). ASK-27: every person is a raised glass pill, as in the founder's
   reference; the ones you can take off carry an ×. */
function AssigneesEditor({ t, members, roleOptions, canEdit, onPatched }) {
  const [busy, setBusy] = useState(false);
  const people = cardPeople(t, members, roleOptions);
  const co = (t.co_assignee_ids || []).filter((id) => id && id !== t.assignee_id);
  const addable = members.filter((m) => m.id !== t.assignee_id && !co.includes(m.id));
  const save = async (next, done) => {
    setBusy(true);
    try {
      const { data } = await api.patch(`/tasks/${t.id}`, { co_assignee_ids: next });
      onPatched(data);
      toast.success(done);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change who is on this task");
    } finally {
      setBusy(false);
    }
  };
  const showAdd = canEdit && !!t.assignee_id && addable.length > 0;
  return (
    <section data-testid={`task-people-${t.id}`}>
      <p className={DRAWER_LABEL}>Assigned to</p>
      {/* People on the left, "Add a person" beside them on desktop — the
          reference's two columns. Below lg the drawer is too narrow for that,
          so the picker drops under the people. */}
      <div className={`grid gap-3 ${showAdd ? "lg:grid-cols-2" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {people.length === 0 && <span className="text-sm text-slate-500">Nobody yet</span>}
          {people.map((p) => {
            const lead = !!t.assignee_id && p.id === t.assignee_id;
            const removable = canEdit && !lead && p.kind !== "team";
            const pill = `inline-flex h-12 max-w-full items-center gap-2.5 rounded-pill pl-1.5 pr-4 ${GLASS_PILL}`;
            const body = (
              <>
                {p.kind === "team"
                  ? <AvatarStack people={[p]} size={34} />
                  : <PersonAvatar name={p.name} src={p.avatar_url} size={34} ring={false} />}
                <span className="truncate text-[15px] font-medium text-slate-800">{p.name}</span>
                {lead && co.length > 0 && <span className="text-xs text-slate-500">lead</span>}
                {removable && <X size={13} weight="bold" aria-hidden="true" className="text-slate-400" />}
              </>
            );
            return removable ? (
              <button key={p.id} type="button" disabled={busy}
                onClick={() => save(co.filter((x) => x !== p.id), `Removed ${p.name}`)}
                aria-label={`Remove ${p.name} from this task`}
                data-testid={`task-people-remove-${p.id}`}
                className={`${pill} transition-colors hover:bg-white disabled:opacity-50`}>
                {body}
              </button>
            ) : (
              <span key={p.id} className={pill}>{body}</span>
            );
          })}
        </div>
        {showAdd && (
          <label className={`relative flex h-12 min-w-0 items-center rounded-pill ${GLASS_PILL}`}>
            <UserPlus size={20} weight="regular" aria-hidden="true" className="pointer-events-none absolute left-4 text-slate-500" />
            <select value="" disabled={busy} aria-label="Add a person to this task"
              data-testid={`task-people-add-${t.id}`}
              onChange={(e) => {
                const id = e.target.value;
                if (id) save([...co, id], `Added ${members.find((m) => m.id === id)?.name || "a member"}`);
              }}
              className="h-full w-full min-w-0 cursor-pointer appearance-none rounded-pill bg-transparent pl-12 pr-10 text-[15px] text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 disabled:opacity-50">
              <option value="">Add a person</option>
              {addable.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
            </select>
            <CaretDown size={16} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 text-slate-500" />
          </label>
        )}
      </div>
    </section>
  );
}

// "Mon, 29 Sep" — the reference's form; the year only when it is not this one.
function dueLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  const mo = d.toLocaleDateString(undefined, { month: "short" });
  const yr = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${wd}, ${d.getDate()} ${mo}${yr}`;
}

/**
 * KR-11.2 — `expanded` is now CONTROLLED by the grid.
 *
 * It used to be TaskCard's own useState, which was fine for a stack of rows
 * and impossible for a bento: the grid has to know which tile is open so it
 * can hand that tile the whole row (col-span-full) and let auto-placement
 * push everything else underneath. A child cannot tell its siblings to move.
 * `open`/`onToggleOpen` are optional — omit them and the card falls back to
 * local state, so any future call site outside the grid still works.
 *
 * ASK-25 — priority is read from the task (TIER_OF) and drawn as the stripe
 * in every view, so `tier` and `hidePrio` are gone. ASK-26 retired
 * `showAssignee` too: the faces on the card and the Assigned section in the
 * drawer show everyone on the task, for everyone.
 */
function TaskCard({ hideStatus = false, t, onChange, members = [], roleOptions = [], scores, highlight = false, selected = false, onToggleSelect, open, onToggleOpen }) {
  const { user } = useAuth();
  // MW-01 fix: the queryClient is used to write PATCH responses straight
  // into the cache before onChange() invalidates. The old flow was
  // PATCH -> onChange (invalidate) -> refetch, and the refetch raced the
  // server's read-after-write consistency window and returned the PRE-
  // change value, which overwrote the UI. Writing the response into the
  // cache first means the card shows the new status immediately; the
  // subsequent invalidate + refetch just confirms it.
  const qc = useQueryClient();
  const applyPatched = (patched) => {
    if (!patched?.id) return;
    // The tasks list query is keyed by `mine` (boolean). We update both
    // possible cache entries because a user can flip between "my tasks"
    // and "all tasks" without a refetch in between, and both should hold
    // the fresh row when they land back.
    for (const mineFlag of [true, false]) {
      qc.setQueryData(["tasks", mineFlag], (rows) => {
        if (!Array.isArray(rows)) return rows;
        return rows.map((r) => (r.id === patched.id ? { ...r, ...patched } : r));
      });
    }
    qc.setQueryData(["task", patched.id], (prev) => ({ ...(prev || {}), ...patched }));
  };
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // U7-05.2 (2026-08-17): density fix. Card collapses to a summary row by
  // default (title + priority + status + due + assignee-if-owner + quick
  // actions). Expand-on-click reveals description, op-meta, stage chip,
  // status band, progress, attachments, updates, action buttons, plan,
  // trail. Highlighted cards (deep-link focus) auto-expand.
  const [selfExpanded, setSelfExpanded] = useState(highlight);
  // KR-14.24 — mobile "Set % manually" toggle. When on, the percent select
  // renders inline in the same status row instead of dropping a new block.
  const controlled = open !== undefined;
  const expanded = controlled ? open : selfExpanded;
  const setExpanded = controlled ? () => onToggleOpen?.() : setSelfExpanded;
  const toggleCard = () => (controlled ? onToggleOpen?.() : setSelfExpanded((v) => !v));
  // MW-20 — is this event really from the card, or did it reach us through
  // the drawer's portal? React bubbles portal events along the COMPONENT
  // tree; `contains` asks the DOM, where the portal is not a descendant.
  const fromCard = (e) => e.currentTarget.contains(e.target);
  // U7-05 polish: replaced window.prompt() for reject + clarify with real
  // dialogs -- prompt is anti-pattern that blocks browser thread and
  // returns null in embed contexts (FUP-49 hit this pattern for confirm).
  const [reasonDialog, setReasonDialog] = useState(null); // {kind: 'reject'|'clarify'}
  const [reasonText, setReasonText] = useState("");
  const [reasonBusy, setReasonBusy] = useState(false);
  const fileRef = useRef(null);
  const closeRef = useRef(null);   // MW-17 — focus target when the drawer opens
  const evidenceRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelledRef = useRef(false);
  const proofAtts = (t.attachments || []).filter((a) => a.kind !== "reference");
  const hasEvidence = proofAtts.length > 0;
  const canApprove = t.approval_required && (user?.role === "owner" || user?.id === t.approver_id || (!t.approver_id && userPerms(user).includes("approvals")));
  const awaitingApproval = t.approval_required && t.approval_status !== "approved";
  const lockedForAssignee = awaitingApproval && !canApprove;
  const overdue = isOverdue(t);
  const terminal = isTerminal(t);
  // ASK-25 — what the card face draws.
  const prio = TIER_OF(t);
  const tone = STATUS_TONE[t.status] || STATUS_TONE.todo;
  const people = cardPeople(t, members, roleOptions);
  // ASK-26 — who may change the people on a task. PATCH holds the same rule.
  // ASK-28 TK-01 — someone who asked for this task but isn't on it: they can
  // note, not hand off or escalate. Mirrors can_note_task / _can_work_task.
  const onThisTask = user?.role === "owner" || t.assignee_id === user?.id
    || (t.co_assignee_ids || []).includes(user?.id)
    || (!!t.assignee_role && t.assignee_role === user?.role);
  const noteOnly = !onThisTask && t.created_by === user?.id;
  const canEditPeople = user?.role === "owner" || userPerms(user).includes("team_manage")
    || t.created_by === user?.id || t.assignee_id === user?.id;
  const onPeoplePatched = (data) => { applyPatched(data); onChange(); };
  // ASK-28 — progress comes from the checklist whenever the task has one.
  const planSteps = t.execution_plan?.steps || [];
  const planDone = planSteps.filter((s) => s.done).length;
  const checklist = planSteps.length
    ? { done: planDone, total: planSteps.length, pct: Math.round((planDone / planSteps.length) * 100) }
    : null;
  // ASK-28 — delete, from the bottom of the drawer, behind a confirmation.
  // Owner-only, because DELETE /tasks/{id} is (require_role("owner")).
  const canDelete = user?.role === "owner";
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteTask = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tasks/${t.id}`);
      for (const mineFlag of [true, false]) {
        qc.setQueryData(["tasks", mineFlag], (rows) => (Array.isArray(rows) ? rows.filter((r) => r.id !== t.id) : rows));
      }
      setConfirmDelete(false);
      if (expanded) setExpanded();
      toast.success("Task deleted");
      onChange();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not delete the task");
    } finally {
      setDeleting(false);
    }
  };

  const approveTask = async () => {
    try { await api.post(`/tasks/${t.id}/approve`); toast.success("Task approved"); onChange(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not approve"); }
  };

  const openReasonDialog = (kind) => { setReasonText(""); setReasonDialog({ kind }); };
  const submitReason = async () => {
    if (!reasonDialog) return;
    const { kind } = reasonDialog;
    if (kind === "clarify" && !reasonText.trim()) {
      return toast.error("Say what you need clarified");
    }
    setReasonBusy(true);
    try {
      const endpoint = kind === "reject" ? "reject" : "clarify";
      await api.post(`/tasks/${t.id}/${endpoint}`, { reason: reasonText });
      toast.success(kind === "reject" ? "Changes requested" : "Clarification requested");
      setReasonDialog(null);
      onChange();
    } catch (e) {
      toast.error(e.response?.data?.detail || `Could not ${kind === "reject" ? "reject" : "request clarification"}`);
    } finally {
      setReasonBusy(false);
    }
  };
  const rejectTask = () => openReasonDialog("reject");
  const clarifyTask = () => openReasonDialog("clarify");

  const upload = async (file, kind) => {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file, file.name || `${kind}.dat`);
    fd.append("kind", kind);
    try {
      await api.post(`/tasks/${t.id}/attachment`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      const label = kind === "photo" ? "Photo" : kind === "voice" ? "Voice reply" : "File";
      toast.success(`${label} added`);
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

  const onEvidence = (e) => {
    const f = e.target.files?.[0];
    if (f) upload(f, "evidence");
    e.target.value = "";
  };

  const toggleVoice = async () => {
    if (recording) {
      cancelledRef.current = false;
      mediaRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((x) => x.stop());
        if (cancelledRef.current) { chunksRef.current = []; return; }
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

  const cancelVoice = () => {
    cancelledRef.current = true;
    mediaRef.current?.stop();
    setRecording(false);
    toast("Recording discarded");
  };

  const complete = async () => {
    // FUP-49 (2026-08-15): removed window.confirm() -- some browsers /
    // embed contexts silently returned without showing UI, so the click
    // looked like a silent no-op. Reopen button already covers undo.
    if (t.evidence_required && !hasEvidence) {
      return toast.error("This task requires proof — add a photo, voice note, or file before completing.");
    }
    try {
      // MW-01 fix: consume the PATCH response and write it into the
      // cache before onChange() invalidates. Same pattern in every
      // status/progress mutation below.
      const { data } = await api.patch(`/tasks/${t.id}`, { status: "done" });
      applyPatched(data);
      toast.success("Task completed — reopen from the card if needed.");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not complete task"); }
  };

  const reopen = async () => {
    const { data } = await api.patch(`/tasks/${t.id}`, { status: "in_progress", progress: 0 });
    applyPatched(data);   // MW-01 fix
    toast.success("Task reopened — back in your work");
    onChange();
  };

  const setStatus = async (status) => {
    try {
      const { data } = await api.patch(`/tasks/${t.id}`, { status });
      applyPatched(data);   // MW-01 fix
      toast.success(`Status: ${STATUS_LABEL[status] || status}`);
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update status"); }
  };
  const setProgress = async (progress) => {
    const { data } = await api.patch(`/tasks/${t.id}`, { progress: Number(progress) });
    applyPatched(data);   // MW-01 fix
    onChange();
  };

  const isOp = t.task_type === "operational" || !!t.op_category;

  return (
    /* KR-11.2 — the red left stripe is GONE on the founder's call ("don't
       copy the old red strip… just use the overdue pill, that's it"). The
       pill in the summary row below already says Overdue, and a full-height
       colour bar on every late card turned a grid of them into a barcode. */
    <div id={`task-card-${t.id}`} data-testid={`mywork-task-${t.id}`}
      data-open={expanded ? "true" : "false"}
      data-tier={prio}
      role="button" tabIndex={0}
      aria-expanded={expanded}
      aria-controls={`task-card-body-${t.id}`}
      /* MW-20 — fromCard() is the whole fix, and it has to be a DOM test.
         The drawer's <Sheet> is rendered inside this component, and React
         sends synthetic events through a PORTAL along the component tree, not
         the DOM tree — so a click anywhere in the drawer arrived here and
         toggled the card shut (10 of 10 clicks; the drawer is the only place
         a task can be worked, so nothing in it was usable). The same path hit
         onKeyDown, where preventDefault() on " " meant you could not type a
         space into an update note.
         `contains` asks a question about the DOM, where the portal really is
         a sibling of this card rather than a descendant, so a drawer event
         fails it and a genuine card event passes. Cheaper and harder to
         forget than stopPropagation on every control inside the drawer. */
      onClick={(e) => { if (fromCard(e)) toggleCard(); }}
      onKeyDown={(e) => {
        if (!fromCard(e)) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCard();
        }
      }}
      className={`kr-bento flex h-full min-w-0 flex-col overflow-hidden cursor-pointer ${highlight ? "ring-2 ring-kr-ink ring-offset-2 ring-offset-background" : ""}`}>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">

      {/* ASK-25 (2026-09-13): the card face, rebuilt on the founder's
          reference card. The layout ASK-19 set stays — checkbox top-left,
          chips pinned to the bottom by mt-auto — and the grid cell still owns
          the height, so the card is the length it was.
          - Priority is the STRIPE and nothing else: red high, blue medium,
            grey low. The "Medium" word is gone. Colour alone is invisible to
            a screen reader, so the stripe also says it in sr-only text.
          - Due date is a pill at the top-right.
          - Status leads with a progress ring; Overdue, Escalation, Handoff and
            the workflow stage wear the same pill in their own tints.
          - Assignees are faces at the bottom-right — photos from Team,
            initials until one is set. */}
      <div className={`group relative flex w-full flex-1 flex-col py-3.5 pl-5 pr-3.5 transition-colors ${selected ? "bg-kr-ink/[0.05]" : ""}`}>
        <span aria-hidden="true" data-testid={`priority-stripe-${t.id}`} data-priority={prio}
          className={`absolute bottom-3.5 left-2 top-3.5 w-1 rounded-full ${PRIO_STRIPE[prio]}`} />
        <span className="sr-only">{PRIO_LABEL[prio]} priority.</span>

        {/* TOP ROW — checkbox, title, due date */}
        <div className="flex min-w-0 items-start gap-2.5">
          {onToggleSelect && (
            /* -m-1 p-1 grows the hit area to 26px without moving the box. */
            <label
              className="relative -m-1 grid shrink-0 cursor-pointer place-items-center p-1"
              onClick={(e) => e.stopPropagation()}
              title={selected ? "Deselect" : "Select for bulk action"}
            >
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                data-testid={`bulk-select-${t.id}`}
                className="peer h-[18px] w-[18px] cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-slate-300 bg-[#fff] transition-colors checked:border-kr-ink checked:bg-kr-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/40"
                aria-label={`Select task ${t.title}`}
              />
              <Check size={12} weight="bold" aria-hidden="true"
                className="pointer-events-none absolute hidden text-white peer-checked:block" />
            </label>
          )}
          {/* Two lines at most. The date pill shares this row, so a title
              gets less width than it used to; unclamped, that alone made the
              card 14–38px taller than before (measured A/B on the same tasks),
              and "same length as today" was the brief. The whole title is on
              hover and at the top of the drawer. */}
          <p data-testid={`task-summary-${t.id}`} title={t.title}
             className="line-clamp-2 min-w-0 flex-1 text-[15px] font-semibold leading-snug text-foreground">
            {t.title}
          </p>
          {t.due_date && (
            <span data-testid={`due-pill-${t.id}`} className={`${PILL} ${QUIET_PILL}`}>
              <CalendarBlank size={11} weight="bold" aria-hidden="true" />
              {dueLabel(t.due_date)}
            </span>
          )}
        </div>

        {/* BOTTOM ROW — the pills wrap on the left; the people hold the right. */}
        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {!hideStatus && (
              <span data-testid={`status-chip-${t.id}`} className={`${PILL} ${tone.pill}`}
                title={awaitingApproval ? "Waiting for approval before work can start" : undefined}>
                <StatusRing status={t.status} tone={tone} />
                {STATUS_LABEL[t.status] || t.status}
                {awaitingApproval && t.status !== "blocked" && (
                  <LockKey size={11} weight="bold" aria-label="awaiting approval" />
                )}
              </span>
            )}
            {overdue && !terminal && (
              <span data-testid={`overdue-${t.id}`} className={`${PILL} bg-red-50 text-red-700 ring-red-100`}>
                <Clock size={12} weight="bold" aria-hidden="true" /> Overdue
              </span>
            )}
            {t.source === "escalation" && (
              <span data-testid={`escalation-${t.id}`} className={`${PILL} bg-orange-50 text-orange-700 ring-orange-100`}>
                <ArrowFatLinesUp size={12} weight="bold" aria-hidden="true" /> Escalation
              </span>
            )}
            {t.source === "handoff" && (
              <span className={`${PILL} ${QUIET_PILL}`}>
                <ArrowBendUpRight size={12} weight="bold" aria-hidden="true" /> Handoff
              </span>
            )}
            {t.workflow_summary?.id && (
              /* The only pill that is a link, so on a phone it is a 44px touch
                 box (a[data-testid] — the MPWA-01 floor in index.css). With the
                 tint on the link itself that box drew as a 44px-tall pill. The
                 tint lives on the inner span instead: the link keeps the floor,
                 the pill keeps the shape of its neighbours. */
              <a
                href={`/my-work?view=workflows&type=${encodeURIComponent(t.workflow_summary.type || "")}&focus=${encodeURIComponent(t.workflow_summary.id)}`}
                onClick={(e) => e.stopPropagation()}
                data-testid={`wf-chip-${t.id}`}
                className="group/wf inline-flex shrink-0 items-center rounded-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/40"
                title={`Open workflow: ${t.workflow_summary.title}`}
              >
                <span className={`${PILL} ${QUIET_PILL} transition-colors group-hover/wf:bg-slate-500/[0.13]`}>
                  <FlowArrow size={12} weight="bold" aria-hidden="true" />
                  <span className="max-w-[8rem] truncate capitalize">{(t.workflow_summary.stage || "").replace(/_/g, " ")}</span>
                </span>
              </a>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(t.attachment_count || 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground"
                title={`${t.attachment_count} attached`}>
                <Paperclip size={12} weight="bold" aria-hidden="true" /> {t.attachment_count}
              </span>
            )}
            <AvatarStack people={people} size={26} testid={`assignees-${t.id}`} />
          </div>
        </div>
      </div>

      {/* ASK-15 (2026-09-13): task detail slides in from the right as a
          Sheet, not an inline expand — kept as one drawer holding BOTH the
          mobile and desktop bodies so the two `hidden`/`lg:hidden` gates
          decide which one renders at each breakpoint. */}
      <Sheet open={expanded} onOpenChange={(o) => { if (!o && expanded) setExpanded(); }}>
        <SheetContent side="right"
          hideClose
          /* MW-15 — w-[92%] below sm, not w-full. The in-header close fixed
             the dead end, but at full width there is no scrim left to tap,
             and tapping outside is the gesture a phone user reaches for
             first. An 8% strip costs nothing and restores it, so the drawer
             now has three ways out on a phone: the close, the scrim, and
             Escape for anyone on a keyboard. */
          /* ASK-27 — the founder's frosted sheet, with a rounded leading edge
             and a long soft shadow onto the page. ASK-30: its wash is a light
             neutral gray now, not blue-white — just dark enough that the
             white pills sit visibly on top of it. */
          className="w-[92%] overflow-hidden border-l-0 p-0 sm:w-full sm:max-w-2xl sm:rounded-l-[2rem] bg-[linear-gradient(165deg,hsl(0_0%_95%),hsl(0_0%_90.5%))] shadow-[-30px_0_80px_-30px_hsl(0_0%_0%/0.45)]"
          data-testid={`task-drawer-${t.id}`}
          /* MW-17 — the drawer supplies its own close, so send focus there on
             open. Without this Radix focuses the stock close. */
          onOpenAutoFocus={(e) => { e.preventDefault(); closeRef.current?.focus(); }}>
          <div className="h-full overflow-y-auto">
          {/* ASK-27 — the close is INSIDE the sheet now, at every width. It
              was a tab hanging off the left edge, which the founder read as
              detached from the card. It sits at the header's right as a
              glass button with a soft blue halo, so it is the easiest thing
              in the drawer to find; MW-15's rule (one close, reachable at
              every width) holds without the tab. ASK-28: the ⋯ beside it is
              gone on the founder's call — Delete now sits at the bottom of
              the drawer and attachments already show in its body. */}
          <SheetHeader className="sticky top-0 z-10 flex-row items-start gap-3 space-y-0 bg-[hsl(0_0%_95%/0.85)] px-5 pb-4 pt-5 text-left backdrop-blur-xl lg:px-7 lg:pt-6">
            <div className="min-w-0 flex-1 pt-1.5">
              <SheetTitle className="text-left text-[22px] font-semibold leading-tight tracking-tight text-slate-900">{t.title}</SheetTitle>
              {/* The due date sits under the title on desktop (the phone body
                  has its own info card for it). ASK-29: the "Status → waiting
                  2 min ago" line that used to share this row is gone — every
                  change is on the Activity timeline at the bottom instead. */}
              {t.due_date && (
                <p className="mt-1.5 hidden items-center gap-1 text-[13px] text-slate-500 lg:flex" data-testid={`task-meta-${t.id}`}>
                  <CalendarBlank size={13} weight="bold" aria-hidden="true" /> Due {dueLabel(t.due_date)}
                </p>
              )}
            </div>
            <SheetClose
              ref={closeRef}
              data-testid={`task-drawer-close-${t.id}`}
              aria-label="Close task"
              title="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/90 text-slate-900 ring-1 ring-inset ring-white shadow-[0_8px_22px_-8px_hsl(0_0%_0%/0.45),0_0_0_4px_hsl(0_0%_0%/0.07)] backdrop-blur-md transition-shadow hover:bg-white hover:shadow-[0_10px_26px_-8px_hsl(0_0%_0%/0.5),0_0_0_4px_hsl(0_0%_0%/0.13)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40">
              <X size={18} weight="bold" aria-hidden="true" />
            </SheetClose>
          </SheetHeader>
      {/* KR-14.22 · MOBILE EXPANDED BODY — reference-driven layout for the
          task expanded view on phones. Uses the same handlers/state as the
          desktop body below; the desktop body is `hidden lg:block` from
          here on. */}
      <div className="px-4 pb-5 space-y-5 pt-4 lg:hidden" data-testid={`task-body-m-${t.id}`}>
        {/* KR-14.23 — a single accent status pill leads the body. The
            summary row above already shows the full meta row (status +
            due + context), so repeating it here made the pill look
            doubled on tasks that had all three fields. */}
        <div>
          <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-xs font-medium ${
            overdue && !terminal ? "bg-kr-accent text-white"
            : "bg-orange-50 text-kr-accent"
          }`}>
            {STATUS_LABEL[t.status] || t.status}
          </span>
        </div>

        <AssigneesEditor t={t} members={members} roleOptions={roleOptions}
          canEdit={canEditPeople} onPatched={onPeoplePatched} />

        {/* Description card (orange) */}
        {t.description && (
          <div className="flex items-start gap-3 rounded-cardlg bg-orange-50/70 p-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-tile bg-orange-100 text-kr-accent">
              <File size={18} weight="regular" />
            </span>
            <p className="text-sm leading-relaxed">{t.description}</p>
          </div>
        )}

        {/* Info card — the top row (workflow / due date) only renders when
            there is something to show; the created-ago footnote only gets a
            top border when the top row is present. Prevents the hollow
            curve above a lone "Created X ago" line. */}
        {(t.workflow_summary?.title || t.due_date || t.created_at) && (() => {
          const hasTop = !!(t.workflow_summary?.title || t.due_date);
          return (
            <div className="rounded-cardlg border border-nm-edge/40 p-3">
              {hasTop && (
                <div className="flex items-center gap-2">
                  {t.workflow_summary?.title && (
                    <>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-500">
                        <Buildings size={14} weight="regular" />
                      </span>
                      <span className="min-w-0 truncate text-sm">{t.workflow_summary.title}</span>
                    </>
                  )}
                  {t.workflow_summary?.title && t.due_date && (
                    <span className="mx-1 h-5 w-px shrink-0 bg-nm-edge/60" />
                  )}
                  {t.due_date && (
                    <>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-green-50 text-green-600">
                        <ClockCounterClockwise size={14} weight="regular" />
                      </span>
                      <span className="min-w-0 truncate text-sm">
                        Due {new Date(t.due_date).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", ...(t.due_date.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}) })}
                      </span>
                    </>
                  )}
                </div>
              )}
              {t.created_at && (
                <div className={`flex items-center gap-1 text-xs text-muted-foreground ${hasTop ? "mt-3 border-t border-nm-edge/30 pt-2" : ""}`}>
                  <span aria-hidden="true" className="h-1 w-1 rounded-full bg-muted-foreground/60" />
                  Created {timeAgo(t.created_at)}
                </div>
              )}
            </div>
          );
        })()}

        {/* KM-5 · STATUS — ONE ROW, A SEGMENTED BAR.
            KM-6 note: `blocked` (pending approval) still matches no segment —
            it is a gate the approver controls, not a state the assignee sets.
            KM-3 put five pills in a flex-wrap, which at 343px could not hold
            them and broke onto a second line — and five states genuinely do
            not fit one row, so "Waiting" goes on the founder's call. Four
            remain and they are the states work actually moves through.
            It is a segmented bar now rather than five loose chips: a single
            .kr-pressed track with four equal segments, and the selected one
            fills with ITS OWN status colour, so choosing a status visibly
            moves the coloured pill along the track. Not Started stays the
            default and has no segment — it is the absence of a choice, and
            tapping the active segment returns to it.
            No transition utility: the track's children swap fills, and the
            selected segment also swaps against .kr-pressed's shadow, which is
            not interpolable against an outset pair. */}
        {!terminal && !awaitingApproval && !noteOnly && (
          <div className="kr-pressed flex items-center gap-1 rounded-pill p-1" role="group"
               aria-label="Task status" data-testid={`status-pills-m-${t.id}`}>
            {M_STATUS_PILLS.map((sp) => {
              const on = t.status === sp.key;
              return (
                <button
                  key={sp.key}
                  type="button"
                  onClick={() => setStatus(sp.key)}
                  aria-pressed={on}
                  data-testid={`status-pill-m-${sp.key}-${t.id}`}
                  /* text-[10px] and px-0.5: four segments share 323px of a
                     343px row, so each label gets ~76px and "Not Started" is
                     the one that decides the size. */
                  className={`flex h-9 min-w-0 flex-1 basis-0 items-center justify-center rounded-pill px-0.5 text-[10px] leading-tight ${
                    /* KM-6 — the selected segment is RAISED, not a flat
                       swatch: .kr-pop supplies the lift and the colour
                       utility overrides its white ground (utilities layer
                       beats components), so the moving pill reads as a
                       physical thing sitting in the track. */
                    on ? `kr-pop ${sp.on} font-semibold` : "text-foreground/60"
                  }`}
                >
                  <span className="truncate">{sp.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* ASK-27 — the Execution Guide is NOT rendered here any more. MW-16
            already renders it (and the trail) once, below both bodies, for
            every width — this second copy put the guide and its buttons on
            the phone twice. */}

        {/* Actions row — Complete + attach controls, now below the two
            plan-building buttons above. */}
        {!isTerminal(t) && !awaitingApproval && !noteOnly && (
          /* KM-6 — flex-wrap. Cancel joining this row made five controls
             (Complete, Cancel, photo, file, voice) share 343px, and Complete
             was truncating to "Comp…". Wrapping lets the two endings hold the
             first line and the three attachment circles drop to the second. */
          <div className="flex items-center gap-2">
            {/* KM-7 — Complete and Cancel are ONE welded control, and Cancel is
                icon-only. Five worded/round controls could not share 343px, so
                KM-6 wrapped the row onto two lines; dropping the word "Cancel"
                and joining the two endings into a single .kr-pop group buys
                back enough width for the whole row to fit again.
                Cancel keeps a real aria-label and title — an icon-only
                destructive action with no name is not a control, it is a
                guess. */}
            <div className="kr-pop flex shrink-0 items-center gap-1 rounded-pill p-1"
                 role="group" aria-label="Finish this task">
              <button
                onClick={complete}
                data-testid={`complete-m-${t.id}`}
                title={t.evidence_required && !hasEvidence ? "Add proof first" : "Mark as complete"}
                className="flex h-9 items-center gap-1.5 rounded-pill bg-kr-ink px-3.5 text-xs font-medium text-white"
              >
                <CheckCircle size={13} weight="bold" aria-hidden="true" /> Complete
              </button>
              <button
                onClick={() => setStatus("cancelled")}
                data-testid={`cancel-m-${t.id}`}
                aria-label="Cancel this task"
                title="Cancel this task"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground/70"
              >
                <XCircle size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              data-testid={`photo-m-${t.id}`}
              aria-label="Attach a photo"
              className="kr-pop grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground disabled:opacity-40"
            >
              <Camera size={16} weight="regular" />
            </button>
            <button
              onClick={() => evidenceRef.current?.click()}
              disabled={uploading}
              data-testid={`upload-file-m-${t.id}`}
              aria-label="Upload a file"
              className="kr-pop grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground disabled:opacity-40"
            >
              <FileArrowUp size={16} weight="regular" />
            </button>
            <button
              onClick={toggleVoice}
              data-testid={`voice-m-${t.id}`}
              aria-label={recording ? "Stop recording" : "Record voice reply"}
              className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${recording ? "bg-kr-accent text-white" : "kr-pop text-foreground"}`}
            >
              {recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="regular" />}
            </button>
          </div>
        )}

        {/* ASK-27 — the phone footer ("No activity yet" + its own "Log update
            or hand off") is gone: TaskTrail below renders both, full width, at
            every size, so the phone drawer showed each of them twice. */}
      </div>

      {/* EXPANDED BODY (desktop) — ASK-27 layout, top to bottom as in the
          founder's reference: the context card, Assigned to, Status with the
          % control beside it, then Complete and Attach. The Execution Guide
          and Activity follow below both bodies (MW-16). */}
      <div id={`task-card-body-${t.id}`} className="hidden space-y-6 px-7 pb-6 pt-2 lg:block">
      {t.description && (
        <div className={`${DRAWER_CARD} flex items-start gap-4 p-4`} data-testid={`task-context-${t.id}`}>
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(160deg,hsl(0_0%_100%),hsl(0_0%_88%))] text-neutral-800 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.9)]">
            <File size={24} weight="duotone" aria-hidden="true" />
          </span>
          <p className="min-w-0 whitespace-pre-line pt-1 text-[15px] leading-relaxed text-slate-600">{t.description}</p>
        </div>
      )}
      {/* ASK-26 — replaces the owner-only one-name assignee line: everyone on
          the task, for everyone who opens it. */}
      <AssigneesEditor t={t} members={members} roleOptions={roleOptions}
        canEdit={canEditPeople} onPatched={onPeoplePatched} />
      {/* U7-05.4: AI-priority bars get a "why?" tooltip on the container
          so users understand what drove the ranking. */}
      {scores && (
        <div title="AI ranker: higher score = more urgent to open next. Bars show what drove it -- priority signal, overdue, workflow blockage, complaints touched." data-testid={`ai-scores-${t.id}`}>
          <PriorityScoreBars scores={scores} />
        </div>
      )}

      {isOp && (
        <div className="flex flex-wrap items-center gap-2" data-testid={`op-meta-${t.id}`}>
          {t.op_category && <span className="inline-flex items-center gap-1 nm-tile px-2 py-0.5 text-xs font-medium"><Tag size={11} weight="bold" /> {t.op_category}</span>}
          {t.assignee_name && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><UserCircle size={13} weight="bold" /> {t.assignee_name}</span>}
          {t.support_name && <span className="text-xs text-muted-foreground">+ {t.support_name}</span>}
          {t.approval_required && (
            <span data-testid={`op-approval-${t.id}`} className={`inline-flex items-center gap-1 nm-tile px-2 py-0.5 text-xs font-medium ${t.approval_status === "approved" ? "bg-kr-ink text-white" : t.approval_status === "rejected" ? "bg-kr-accent text-white" : "bg-nm-sunken"}`}>
              <ShieldCheck size={11} weight="bold" /> {t.approval_status === "approved" ? "Approved" : t.approval_status === "pending" ? "Pending approval" : t.approval_status === "rejected" ? "Changes requested" : `${t.approver_name || "Approval"} required`}
            </span>
          )}
        </div>
      )}

      {/* Full workflow chip in the expanded body -- carries the full title
          alongside the stage, since we only show the stage snippet in
          the summary row. */}
      {t.workflow_summary && t.workflow_summary.id && (
        <div>
          <a
            href={`/my-work?view=workflows&type=${encodeURIComponent(t.workflow_summary.type || "")}&focus=${encodeURIComponent(t.workflow_summary.id)}`}
            data-testid={`wf-chip-full-${t.id}`}
            className="inline-flex items-center gap-1.5 nm-tile px-2.5 py-1 text-xs font-mono bg-nm-sunken hover:bg-accent transition-colors"
            title={`Open workflow: ${t.workflow_summary.title}`}
          >
            <FlowArrow size={12} weight="bold" aria-hidden="true" className="text-muted-foreground" />
            <span className="font-medium text-[10px]">
              {(t.workflow_summary.title || "Workflow").slice(0, 40)}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className=" text-[10px]">
              {(t.workflow_summary.stage || "").replace(/_/g, " ")}
            </span>
          </a>
        </div>
      )}

      {/* ASK-27 — STATUS: the status pill on the left, a rule, and the %
          control on the right. "Set % manually" is no longer behind a
          disclosure toggle — the bar beside it is the control. */}
      {!terminal && !awaitingApproval && (
        noteOnly ? (
          /* ASK-28 TK-01 — the person who asked sees where the work is, not
             the controls that move it: those belong to whoever does it. */
          <section data-testid={`task-status-${t.id}`}>
            <p className={DRAWER_LABEL}>Status</p>
            <p className="text-[15px] font-medium text-slate-800" data-testid={`requester-status-${t.id}`}>
              {STATUS_LABEL[t.status] || t.status} · {checklist ? checklist.pct : (t.progress || 0)}% done
            </p>
          </section>
        ) : (
        <section data-testid={`task-status-${t.id}`}>
          <p className={DRAWER_LABEL}>Status</p>
          <div className="flex items-stretch gap-5">
            <label className={`relative flex h-12 w-56 shrink-0 items-center rounded-pill ${GLASS_PILL}`}>
              <Clock size={20} weight="regular" aria-hidden="true" className="pointer-events-none absolute left-4 text-neutral-800" />
              <select data-testid={`status-select-${t.id}`} aria-label="Task status"
                value={t.status === "blocked" ? "todo" : t.status} onChange={(e) => setStatus(e.target.value)}
                className="h-full w-full cursor-pointer appearance-none rounded-pill bg-transparent pl-12 pr-10 text-[15px] font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25">
                {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <CaretDown size={16} weight="bold" aria-hidden="true" className="pointer-events-none absolute right-4 text-slate-500" />
            </label>
            <span aria-hidden="true" className="w-px shrink-0 bg-slate-900/10" />
            <ProgressControl value={checklist ? checklist.pct : (t.progress || 0)} onCommit={setProgress}
              checklist={checklist}
              testid={`progress-select-${t.id}`} valueTestid={`progress-bar-${t.id}`} />
          </div>
        </section>
        )
      )}

      {(() => {
        const beUrl = process.env.REACT_APP_BACKEND_URL;
        const atts = t.attachments || [];
        const refs = atts.filter((a) => a.kind === "reference");
        const proof = atts.filter((a) => a.kind !== "reference");
        const insights = t.reference_insights || [];
        const isImg = (a) => a.kind === "photo" || (a.content_type || "").startsWith("image/");
        const isAudio = (a) => a.kind === "voice" || (a.content_type || "").startsWith("audio/");
        const renderAtt = (a) => (
          isImg(a)
            ? <button key={a.url} type="button" onClick={() => setLightbox(`${beUrl}${a.url}`)}
                className="relative w-20 h-20 nm-tile overflow-hidden group" title="Click to view full image"
                data-testid={`att-photo-${t.id}-${a.url}`}>
                <img src={`${beUrl}${a.url}`} alt={a.filename || "attachment"} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                  <MagnifyingGlassPlus size={20} weight="bold" className="text-white" />
                </span>
              </button>
            : isAudio(a)
              ? <audio key={a.url} controls preload="none" src={`${beUrl}${a.url}`} className="h-9" data-testid={`att-voice-${t.id}-${a.url}`} />
              : <a key={a.url} href={`${beUrl}${a.url}`} target="_blank" rel="noreferrer" data-testid={`att-file-${t.id}-${a.url}`}
                  className="inline-flex items-center gap-1.5 nm-tile px-2.5 py-1.5 text-xs font-mono hover:bg-accent transition-colors max-w-[180px]">
                  <File size={13} weight="bold" /> <span className="truncate">{a.filename || "file"}</span>
                </a>
        );
        return (
          <>
            {refs.length > 0 && (
              <div className="nm-inset mt-3 p-3" data-testid={`reference-block-${t.id}`}>
                <p className="label-mono text-brand-blue flex items-center gap-1.5 mb-2">
                  <Paperclip size={13} weight="bold" /> Reference material · {refs.length}
                </p>
                <div className="flex flex-wrap gap-2 items-center">{refs.map(renderAtt)}</div>
                {insights.length > 0 && (
                  <div className="mt-2 flex items-start gap-1.5" data-testid={`reference-insight-${t.id}`}>
                    <Lightbulb size={13} weight="fill" className="text-brand-yellow shrink-0 mt-0.5" />
                    <p className="text-xs text-muted-foreground line-clamp-2">{insights[insights.length - 1].summary}</p>
                  </div>
                )}
              </div>
            )}
            {proof.length > 0 && (
              <div className="mt-3 nm-inset p-3" data-testid={`proof-block-${t.id}`}>
                <p className="label-mono text-muted-foreground flex items-center gap-1.5 mb-2">
                  <Paperclip size={13} weight="bold" /> Proof of work · {proof.length}
                </p>
                <div className="flex flex-wrap gap-2 items-center">{proof.map(renderAtt)}</div>
              </div>
            )}
          </>
        );
      })()}

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="rounded-cardlg border border-nm-edge/40 max-w-3xl p-2" data-testid={`photo-lightbox-${t.id}`}>
          <DialogHeader>
            <DialogTitle className="sr-only">Proof photo</DialogTitle>
          </DialogHeader>
          {lightbox && <img src={lightbox} alt="proof full" className="w-full h-auto max-h-[80vh] object-contain" />}
        </DialogContent>
      </Dialog>

      {canApprove && awaitingApproval && (
        <div className="flex flex-wrap gap-2 mt-4 nm-tile bg-caution-50/40 p-3" data-testid={`approval-actions-${t.id}`}>
          <span className="w-full label-mono text-muted-foreground">This task needs your approval before {t.assignee_name || "the assignee"} can start work.</span>
          {t.approval_status === "rejected" && t.rejection_reason && <span className="w-full text-xs text-muted-foreground">Previously requested: {t.rejection_reason}</span>}
          <button onClick={approveTask} data-testid={`approve-${t.id}`} className="kr-lift flex items-center gap-2 rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-medium text-white transition-all">
            <CheckCircle size={16} weight="bold" /> Approve
          </button>
          <button onClick={rejectTask} data-testid={`reject-${t.id}`} className="flex items-center gap-2 rounded-pill border border-kr-accent px-4 py-2.5 text-sm font-medium text-kr-accent transition-colors hover:bg-kr-accent/10">
            <WarningCircle size={16} weight="bold" /> Request changes
          </button>
          <button onClick={clarifyTask} data-testid={`clarify-${t.id}`} className="nm-btn flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all">
            <ChatText size={16} weight="bold" /> Ask clarification
          </button>
        </div>
      )}

      {lockedForAssignee && (
        <div className="flex items-start gap-2 mt-4 nm-tile bg-nm-sunken p-3" data-testid={`approval-locked-${t.id}`}>
          <LockKey size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold uppercase tracking-tight">{t.approval_status === "rejected" ? "Changes requested" : "Awaiting approval"}</p>
            <p className="text-xs text-muted-foreground">You can start once {t.approver_name || "the approver"} approves this task. Status, progress and the execution plan are locked until then.</p>
            {t.approval_status === "rejected" && t.rejection_reason && <p className="mt-1 text-xs text-muted-foreground">Note: {t.rejection_reason}</p>}
          </div>
        </div>
      )}

      {t.evidence_required && !isTerminal(t) && !awaitingApproval && (
        <div className={`mt-3 flex items-start gap-2 nm-tile p-2.5 ${hasEvidence ? "bg-nm-sunken" : "bg-kr-accent/8"}`} data-testid={`evidence-required-${t.id}`}>
          {hasEvidence ? <CheckCircle size={16} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0" /> : <Info size={16} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-kr-accent" />}
          <p className="text-xs">{hasEvidence
            ? "Proof attached — you can mark this task complete."
            : "This task requires proof before it can be completed. Add a photo, voice note, or file below."}</p>
        </div>
      )}

      {!isTerminal(t) && !awaitingApproval && !noteOnly && (
        <div className="flex items-center gap-4">
          {/* FUP-49: don't disable -- always click-through, handler shows
              a clear toast if evidence is missing. Silent-disabled
              buttons were the original bug. */}
          <button onClick={complete} data-testid={`complete-${t.id}`}
            title={t.evidence_required && !hasEvidence ? "Add a voice note or file first" : "Mark as complete"}
            className={`flex h-14 shrink-0 items-center gap-2.5 rounded-pill px-7 text-base font-medium ${t.evidence_required && !hasEvidence ? `${GLASS_PILL} text-slate-500` : INK_PILL}`}>
            <CheckCircle size={22} weight="fill" aria-hidden="true" /> Complete
          </button>

          <span aria-hidden="true" className="h-8 w-px shrink-0 bg-slate-900/10" />
          <span className="text-[15px] text-slate-500">Attach:</span>
          {/* ASK-27 — no camera button on desktop (the founder: a desktop is
              not where anyone attaches with a camera). Its input stays: the
              phone body's camera button opens it. */}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <input ref={evidenceRef} type="file" className="hidden" onChange={onEvidence} />
          {/* ASK-28 — the two circles become two labelled pills, Document and
              Voice, sharing the rest of the row equally (flex-1 basis-0). */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => evidenceRef.current?.click()}
              disabled={uploading}
              data-testid={`upload-file-${t.id}`}
              title="Upload a document"
              className={`flex h-12 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-pill text-[15px] font-medium text-slate-700 transition-colors hover:bg-white disabled:opacity-40 ${GLASS_PILL}`}
            >
              <File size={19} weight="regular" aria-hidden="true" /> Document
            </button>
            <button
              onClick={toggleVoice}
              data-testid={`voice-${t.id}`}
              title={recording ? "Stop and send voice reply" : "Record a voice reply"}
              aria-label={recording ? "Stop recording and send" : undefined}
              className={`flex h-12 min-w-0 flex-1 basis-0 items-center justify-center gap-2 rounded-pill text-[15px] font-medium transition-colors ${
                recording ? "bg-kr-accent text-white" : `text-slate-700 hover:bg-white ${GLASS_PILL}`
              }`}
            >
              {recording
                ? <><Stop size={17} weight="fill" aria-hidden="true" /> Stop</>
                : <><Microphone size={19} weight="regular" aria-hidden="true" /> Voice</>}
            </button>
          </div>
          {recording && (
            <button
              onClick={cancelVoice}
              data-testid={`voice-cancel-${t.id}`}
              title="Discard recording"
              aria-label="Discard recording"
              className={GLASS_ICON_BTN}
            >
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {isTerminal(t) && !awaitingApproval && !noteOnly && (
        <div className="flex flex-wrap gap-2 mt-4" data-testid={`reopen-actions-${t.id}`}>
          <button onClick={reopen} data-testid={`reopen-${t.id}`} className="flex items-center gap-2 bg-nm px-4 py-2 text-sm font-medium nm-btn hover:bg-accent transition-colors">
            <ArrowClockwise size={16} weight="bold" /> Reopen
          </button>
          <span className="flex items-center text-xs text-muted-foreground">Completed by mistake? Reopen brings it back to your active work.</span>
        </div>
      )}

      </div>

      {/* MW-16 — the plan and the trail live OUTSIDE both breakpoint bodies,
          because there is only ever one of each and the mobile layout needs
          them too. They used to sit inside the desktop body, which is
          `hidden lg:block`: the phone's 'Log update or hand off' bumped
          trailOpenTrigger, TaskTrail dutifully opened its form, and the form
          rendered inside a display:none subtree — MW-09 all over again, the
          one control that records what happened inert on phones. Shared here,
          both triggers open the same visible form. */}
      <div className="space-y-6 px-4 pb-6 lg:px-7 lg:pb-8">
        {!awaitingApproval && !noteOnly && (
          <ExecutionPlan t={t} onChange={onChange} onPatched={applyPatched} members={members} roleOptions={roleOptions} />
        )}
        {/* ASK-28 TK-01 — the person who asked for this task isn't on it: the
            status, plan and completion controls belong to whoever does it
            (the server refuses a plan from anyone else), so say what they CAN
            do here instead of showing controls. */}
        {noteOnly && (
          <p className="text-sm text-slate-500" data-testid={`requester-hint-${t.id}`}>
            You asked for this task, so {t.assignee_name || "the team"} does the work. Leave a note below to follow up.
          </p>
        )}
        <TaskTrail t={t} onChange={onChange} members={members} roleOptions={roleOptions} noteOnly={noteOnly} />

        {/* ASK-28 — Delete sits under "Log update or hand off", full width like
            it, and asks first in the drawer's own glass. ASK-29: the same
            gradient pill as the navy one, in maroon with white type. */}
        {canDelete && (
          <>
            <button type="button" onClick={() => setConfirmDelete(true)}
              data-testid={`drawer-delete-task-${t.id}`}
              className={`-mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-pill text-[15px] font-medium ${MAROON_PILL}`}>
              <Trash size={17} weight="bold" aria-hidden="true" /> Delete task
            </button>
            <AlertDialog open={confirmDelete} onOpenChange={(o) => { if (!deleting) setConfirmDelete(o); }}>
              <AlertDialogContent data-testid={`drawer-delete-dialog-${t.id}`}
                className="max-w-md gap-5 rounded-[1.75rem] border-0 bg-[linear-gradient(165deg,hsl(0_0%_96%),hsl(0_0%_91%))] p-6 shadow-[0_30px_80px_-20px_hsl(0_0%_0%/0.45)] sm:rounded-[1.75rem]">
                <div className="flex items-start gap-4">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-inset ring-red-100">
                    <Trash size={22} weight="duotone" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <AlertDialogTitle className="text-lg font-semibold text-slate-900">Delete this task?</AlertDialogTitle>
                    <AlertDialogDescription className="mt-1.5 text-sm leading-relaxed text-slate-600">
                      “{t.title}” will be deleted permanently. It can no longer be opened or accessed by anyone, and this cannot be undone.
                    </AlertDialogDescription>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <AlertDialogCancel disabled={deleting} data-testid={`drawer-delete-cancel-${t.id}`}
                    className={`mt-0 h-11 rounded-pill border-0 px-5 text-sm font-medium text-slate-700 hover:bg-white ${GLASS_PILL}`}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction disabled={deleting} data-testid={`drawer-delete-confirm-${t.id}`}
                    /* preventDefault keeps the dialog open while the request
                       runs; deleteTask closes it once the server agrees. */
                    onClick={(e) => { e.preventDefault(); deleteTask(); }}
                    className={`h-11 rounded-pill px-5 text-sm font-medium disabled:opacity-60 ${MAROON_PILL}`}>
                    {deleting ? "Deleting…" : "Yes, delete task"}
                  </AlertDialogAction>
                </div>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* U7-05 dialog: reject / clarify reason (replaced window.prompt). */}
      <Dialog open={!!reasonDialog} onOpenChange={(o) => !o && !reasonBusy && setReasonDialog(null)}>
        <DialogContent className="rounded-cardlg border border-nm-edge/40 max-w-md" data-testid={`reason-dialog-${t.id}`}>
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">
              {reasonDialog?.kind === "reject" ? "Request changes" : "Ask for clarification"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            {reasonDialog?.kind === "reject"
              ? "Tell the assignee what needs to change before you can approve (optional)."
              : "What do you need clarified before starting?"}
          </p>
          <textarea
            rows={4}
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            placeholder={reasonDialog?.kind === "reject" ? "e.g. Please add unit prices per line item." : "e.g. Which supplier's rate card do I use?"}
            className="w-full nm-tile px-3 py-2 text-sm focus:outline-none"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setReasonDialog(null)}
              disabled={reasonBusy}
              className="nm-tile px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
            >Cancel</button>
            <button
              type="button"
              onClick={submitReason}
              disabled={reasonBusy || (reasonDialog?.kind === "clarify" && !reasonText.trim())}
              className="kr-lift rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {reasonBusy ? "Sending..." : reasonDialog?.kind === "reject" ? "Request changes" : "Send question"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <TaskDetailDialog t={t} open={detailOpen} onOpenChange={setDetailOpen} onChange={onChange} />
        </div>
      </div>
    </div>
  );
}

/* ═══ KR-11.2 · the two layouts ════════════════════════════════════════════
   The founder asked for the LIST to become a bento, and for the AI-priority
   toggle to re-form it into a three-way split. The data and the ordering are
   untouched — only the arrangement changes.

   TIER = t.priority. Size is earned from the field the tenant actually sets,
   not from the AI score: with the ranker off, the ordering is still "most
   recent", and a big tile has to mean something the founder chose.

   SPANS. A 6-column grid, not 4, because 4 cannot make a rectangle out of a
   third. Every tile is wider than it is tall at every breakpoint, which was
   an explicit ask ("more rectangular, not a pure square… grow lengthwise").
     high    4 of 6  ≈ 2/3 width, 210px tall  → ~3.4 : 1
     medium  2 of 6  ≈ 1/3 width, 182px tall  → ~1.9 : 1
     low     2 of 6  ≈ 1/3 width, 156px tall  → ~2.2 : 1
   4 + 2 fills a row; 2 + 2 + 2 fills the next. That alternation is what
   produces the "big box with small ones around it" rhythm without anyone
   hand-placing a tile. auto-flow dense lets a small tile backfill a hole a
   wide one could not use.

   EXPANDED TAKES THE WHOLE ROW. col-span-full, so nothing can sit beside it
   — the founder's "no boxes at the left or right once it expands". Grid
   auto-placement then pushes every later tile below it for free. This is the
   reason `expanded` had to be lifted out of TaskCard. */
const TIER_OF = (t) => (t?.priority === "high" || t?.priority === "low") ? t.priority : "medium";

/* ASK-13 (2026-09-13): one dropdown shape for Department / Priority / Status.
   Reads a value + options list + optional counts fn and renders a labelled
   pill trigger + menu. counts.optional: if provided, each row gets a count. */
/* ASK-24 (2026-09-13): a filter that is NOT on its first option ("All …")
   renders pressed, so a narrowed list is visible from the row itself.
   Options may carry `group` (a section label is drawn where it changes) and
   `sub` (a second line, e.g. the person's role). `searchable` adds a
   type-to-search box — the Person list outgrows a scan past ~8 names. */
function FilterDropdown({ testid, label, value, options, counts, onSelect, loading, searchable = false }) {
  const [query, setQuery] = useState("");
  const active = options.find((o) => o.key === value) || options[0];
  const narrowed = value !== options[0].key;
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => !o.key || `${o.label} ${o.sub || ""}`.toLowerCase().includes(q))
    : options;
  return (
    <DropdownMenu onOpenChange={(o) => { if (!o) setQuery(""); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid={testid} aria-pressed={narrowed}
          className={`${narrowed ? "kr-pressed" : "kr-pop"} flex h-9 items-center gap-2 rounded-pill pl-3.5 pr-3 text-xs font-medium text-foreground`}>
          <span className="text-muted-foreground">{label}:</span>
          <span className={`max-w-[140px] truncate ${narrowed ? "font-semibold" : ""}`}>{active.label}</span>
          {counts && (
            <span className="tabular-nums opacity-55">
              {loading ? "—" : counts(active.key)}
            </span>
          )}
          <CaretDown size={11} weight="bold" aria-hidden="true" className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={`max-h-[60vh] overflow-y-auto ${searchable ? "w-64" : "w-56"}`}>
        {searchable && (
          <div className="sticky top-0 z-10 bg-popover p-1">
            {/* stopPropagation: Radix menus run typeahead on keydown, which
                would steal every letter typed here to jump between items. */}
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`}
              data-testid={`${testid}-search`}
              className="w-full nm-field px-2.5 py-1.5 text-xs" />
          </div>
        )}
        {shown.map((o, i) => (
          <Fragment key={o.key || "__all__"}>
            {o.group && o.group !== shown[i - 1]?.group && (
              <DropdownMenuLabel className="pt-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {o.group}
              </DropdownMenuLabel>
            )}
            <DropdownMenuItem onSelect={() => onSelect(o.key)}
              data-testid={`${testid}-${o.key || "all"}`}
              className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className={`block truncate ${value === o.key ? "font-semibold" : ""}`}>{o.label}</span>
                {o.sub && <span className="block truncate text-[11px] text-muted-foreground">{o.sub}</span>}
              </span>
              {counts && (
                <span className="shrink-0 tabular-nums text-xs opacity-55">
                  {loading ? "—" : counts(o.key)}
                </span>
              )}
            </DropdownMenuItem>
          </Fragment>
        ))}
        {q && shown.length <= 1 && (
          <p className="px-2 py-3 text-center text-xs text-muted-foreground">No match for “{query.trim()}”</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ASK-24 — the phone's version of FilterDropdown: the same options as a
   labelled wrap of chips, for the bottom filter sheet. */
function FilterChipGroup({ testid, label, value, options, counts, onSelect, loading, searchable = false }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q
    ? options.filter((o) => !o.key || `${o.label} ${o.sub || ""}`.toLowerCase().includes(q))
    : options;
  return (
    <section className="flex flex-col gap-2" data-testid={testid}>
      <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">{label}</p>
      {searchable && (
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`}
          data-testid={`${testid}-search`}
          className="w-full nm-field px-3 py-2 text-sm" />
      )}
      <div className="flex flex-wrap gap-2">
        {shown.map((o) => {
          const on = value === o.key;
          return (
            <button key={o.key || "__all__"} type="button" aria-pressed={on}
              onClick={() => onSelect(o.key)} data-testid={`${testid}-${o.key || "all"}`}
              className={`flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-[12px] ${on ? "kr-pressed font-semibold text-foreground" : "kr-pop text-foreground/75"}`}>
              <span className="max-w-[270px] truncate">{o.label}</span>
              {counts && <span className="tabular-nums opacity-55">{loading ? "—" : counts(o.key)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ASK-13/15 (2026-09-13): uniform 4-column grid at xl, 3 at lg, 2 at sm, 1
   below. Opened cards no longer expand inline — details live in a right-side
   drawer (see the Sheet inside TaskCard), so every cell stays the same size. */
function TaskGrid({ list, openId, setOpenId, cardProps }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="mywork-grid">
      {list.map((t) => {
        const isOpen = openId === t.id;
        return (
          <div key={t.id} className="min-h-[112px]">
            <TaskCard
              t={t}
              open={isOpen}
              onToggleOpen={() => setOpenId(isOpen ? null : t.id)}
              {...cardProps(t)}
            />
          </div>
        );
      })}
    </div>
  );
}

/* AI PRIORITY ON → three columns, high | medium | low.
   The ranker sorts the whole list by score; splitting it by the priority band
   turns "a long sorted list" into "how much is on fire, how much is next, how
   much can wait". Within a column the ranker's order is preserved. */
const BANDS = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

function TaskPriorityColumns({ list, openId, setOpenId, cardProps, band = "high" }) {
  const grouped = BANDS.map((b) => ({ ...b, items: list.filter((t) => TIER_OF(t) === b.key) }));
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="mywork-priority-columns">
      {grouped.map((col) => (
        <section key={col.key} data-testid={`priority-col-${col.key}`}
                 className={`min-w-0 lg:block ${band === col.key ? "block" : "hidden"}`}>
          <div className="mb-3 hidden items-baseline gap-2 lg:flex">
            <h3 className="text-sm font-semibold">{col.label}</h3>
            <span className="font-mono text-xs tabular-nums opacity-55">{col.items.length}</span>
          </div>
          <div className="flex flex-col gap-3">
            {col.items.length === 0 && (
              <div className="rounded-tile border border-dashed border-foreground/15 p-5">
                <p className="text-center text-xs text-muted-foreground">Nothing here</p>
              </div>
            )}
            {col.items.map((t) => {
              const isOpen = openId === t.id;
              return (
                <TaskCard
                  key={t.id}
                  t={t}
                  open={isOpen}
                  onToggleOpen={() => setOpenId(isOpen ? null : t.id)}
                  {...cardProps(t)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* MW-19 — Completed lives HERE, not in Department. It is a state, and the
   Department dropdown beside it lists departments; "Completed" sitting among
   Sales and Logistics asked the reader to hold two meanings in one control. */
const STATUS_FILTER_OPTIONS = [
  { key: "", label: "All statuses" },
  { key: "todo", label: "Not Started" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  // ASK-24 — the two chips on nearly every card, neither filterable before.
  { key: "blocked", label: "Pending Approval" },
  { key: "review", label: "Under Review" },
  { key: "overdue", label: "Overdue" },
  // ASK-25 F4 — the Desk's "Due today" card needs somewhere to land.
  { key: "due_today", label: "Due today" },
  { key: "completed", label: "Completed" },
];
// Overdue, Due today and Completed are LENSES, not t.status values.
const STATUS_LENSES = new Set(["overdue", "due_today", "completed"]);
// ASK-28 TK-01 — My Work task lenses you reach by link (?view=…) and never
// save as the default. Approvals is its own view (ASK-25), not a lens here.
const URL_SCOPES = ["asked"];
// ASK-24 — a Priority filter shipped briefly and was removed on a founder
// call (2026-09-13): the AI-priority view already splits by High/Medium/Low.

/* ASK-24 — ONE predicate for every filter, so the list and every count in
   every menu agree. A menu's counts are this with that menu's own dimension
   swapped for the option being counted, and the others held as they are.
   person: "" | a user id | "unassigned" | "role:<key>" (a team queue — a task
   given to a role with no named person). */
function matchesFilters(t, { tab, person, status }) {
  const completedLens = tab === "completed" || status === "completed";
  if (completedLens !== isTerminal(t)) return false;
  if (tab !== "all" && tab !== "completed" && t.task_type !== tab) return false;
  if (status === "overdue" && !isOverdue(t)) return false;
  if (status === "due_today" && !isDueToday(t)) return false;
  if (status && !STATUS_LENSES.has(status) && t.status !== status) return false;
  if (person === "unassigned") return !t.assignee_id && !t.assignee_role;
  if (person && person.startsWith("role:")) return !t.assignee_id && t.assignee_role === person.slice(5);
  // ASK-26 — a person's filter holds every task they are on, lead or not.
  if (person) return t.assignee_id === person || (t.co_assignee_ids || []).includes(person);
  return true;
}

export default function MyWork() {
  useUiScale();
  // MPWA-08: rebuilt below lg (§8). Above lg the original tree renders
  // unchanged, keeping §9.2's desktop diff empty by construction.
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { tenant, user } = useAuth();
  const om = opModel(tenant);
  const WORK_TABS = [
    { key: "all", label: "All" },
    ...om.task_categories.map((c) => ({ key: c.key, label: c.label })),
    { key: "completed", label: "Completed" },
  ];
  const [params, setParams] = useSearchParams();
  const isOwner = user?.role === "owner";
  const focusTaskId = params.get("task");
  const rawView = params.get("view");
  // "board" is no longer a top-level view — it now lives as a sub-tab inside Workflows.
  // ASK-6: rawView === "leave" also collapses to "mywork" (the sub-view was
  // retired; Leave lives on /team now). Deep links to ?view=leave land the
  // reader on their task list rather than a 404; the App.js redirect for the
  // standalone /leave route sends them onward to /team.
  const initialView = rawView === "board" ? "workflows"
    : rawView === "workflows" ? "workflows"
    // ASK-25 — ?view=approvals is where the Desk's Approvals pill and leave chip land.
    : rawView === "approvals" ? "approvals"
    : "mywork";
  // ASK-28 TK-02 — ?view=approvals&task=<id> (the approval-requested
  // notification) opens the task INSIDE Approvals, where it is guaranteed to
  // be; any other ?task= link still lands on the task list.
  const [view, setView] = useState(focusTaskId && initialView !== "approvals" ? "mywork" : initialView);
  // KR-11.2 — which tile is expanded. Lifted out of TaskCard so the grid can
  // give it the whole row; see TaskBento. Seeded from ?task= so a deep link
  // still lands on an opened card.
  const [openId, setOpenId] = useState(focusTaskId || null);
  // WE-14 (2026-08-16): wfTab state retired -- Board sub-tab is gone,
  // only the pipelines view remains. Retained a no-op reference to
  // rawView so eslint's no-unused-vars doesn't fire on line above.
  void rawView;
  const canSeeWorkflows = isOwner || userPerms(user).includes("workflows");
  // ASK-25 — Approvals shows for anyone who can sign something off: tasks
  // (the "approvals" access) or leave ("leave_approve"). Owners always.
  const canApprove = isOwner || userPerms(user).includes("approvals") || userPerms(user).includes("leave_approve");
  const canApproveLeave = isOwner || userPerms(user).includes("leave_approve");
  // ASK-25 — the Approvals view's own state and feeds. Sub-tab Tasks | Leave
  // (?sub=leave is where the Desk's leave chip lands), the All/My lens on
  // tasks, and the two feeds.
  // ASK-28 TK-02 — tasks come from GET /tasks?view=approvals, which the
  // SERVER limits to what this person may approve (owner: all; named
  // approver: theirs; Approve Tasks access: theirs + unnamed). The old feed,
  // /tasks?mine=false, is only the owner's everything or a non-owner's own
  // lane, so a named approver outside that lane never saw the task. Fetched
  // on every view: the switcher carries its count. The key is shared with the
  // Desk's Task approvals card so the two never disagree.
  const [apprSub, setApprSub] = useState(params.get("sub") === "leave" ? "leave" : "tasks");
  const [apprScope, setApprScope] = useState("all");
  const apprTasksQ = useQuery({
    queryKey: ["tasks", "approvals"],
    queryFn: () => api.get("/tasks?view=approvals").then((r) => r.data),
    refetchInterval: 60000,
  });
  const leavesQ = useQuery({
    queryKey: ["leaves", "approvals"],
    queryFn: () => api.get("/leaves?scope=approvals").then((r) => r.data),
    enabled: view === "approvals" && canApproveLeave,
  });
  // U7-05.5: filter chips persist per-user in localStorage. Reload the page
  // and the scope + tab + aiPriority toggle come back where you left them.
  // Founder ask 2026-08-17: 'remove the uneasy UX' -- resetting to All every
  // navigation was frustrating for anyone who works in a single category.
  const prefsKey = tenant?.id && user?.id ? `mywork-prefs-${tenant.id}-${user.id}` : null;
  const loadedPrefs = (() => {
    if (!prefsKey) return {};
    try { return JSON.parse(localStorage.getItem(prefsKey) || "{}"); }
    catch { return {}; }
  })();
  /* ASK-28 TK-01 — scope "asked" is "Asked by me": tasks I created for other
     people. It comes from the URL (?view=asked), never from saved prefs, so a
     reload of plain /my-work still opens where the person normally works. */
  // URL_SCOPES (module level) lists the lenses that behave this way.
  const savedScope = loadedPrefs.scope && !URL_SCOPES.includes(loadedPrefs.scope) ? loadedPrefs.scope : "mine";
  const [scope, setScope] = useState(URL_SCOPES.includes(rawView) ? rawView : savedScope);
  const [tab, setTab] = useState(loadedPrefs.tab || "all");
  const [aiPriority, setAiPriority] = useState(Boolean(loadedPrefs.aiPriority));
  /* KM-30 — ONE progress lens, and no priority lens at all.
     KM-29 added a High/Medium/Low bar; the founder pointed out the priority
     band bar inside TaskPriorityColumns already does exactly that, so mine was
     a second control for a job that was taken. Gone.
     "All" is gone from this one too: the four states ARE the filter, and a
     fifth segment meaning "no filter" is a control whose only job is to undo
     the other four. Tapping the live segment clears it instead, which is the
     same gesture with nothing extra on screen. "" means unfiltered.
     It lives in component state rather than the URL because it is a reading
     posture, not a destination — you flick through it while scanning and you
     do not want twenty history entries for it. */
  /* ASK-24 (2026-09-13): Status and Person now live in the URL
     (?status=&person=) so a refresh keeps them and a link can open
     one person's tasks. `replace` keeps the reading-posture point above: no
     history entry per tap. Department stays in the saved prefs, where it
     already persisted. Unknown values from a hand-typed URL read as "All". */
  const setFilterParams = (changes) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    Object.entries(changes).forEach(([k, v]) => { if (v) next.set(k, v); else next.delete(k); });
    return next;
  }, { replace: true });
  const rawStatus = params.get("status") || "";
  const statusFilter = STATUS_FILTER_OPTIONS.some((o) => o.key === rawStatus) ? rawStatus : "";
  const setStatusFilter = (v) => setFilterParams({ status: typeof v === "function" ? v(statusFilter) : v });
  // Person only means something on All Tasks and Asked by me — on My Tasks
  // every card is yours.
  const personFilter = (isOwner && scope === "all") || scope === "asked" ? (params.get("person") || "") : "";
  const setPersonFilter = (v) => setFilterParams({ person: v });
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  /* Priority band picker for the AI-priority kanban view. Owned by the page so
     the mobile band bar can sit in the fixed header while the columns render
     in the body; desktop shows all three columns and ignores it. */
  const [band, setBand] = useState("high");
  // Dismissing AI priority resets the band. It no longer clears Status: that
  // was so the list could never stay filtered by a control no longer on
  // screen, and since ASK-24 Status is always on screen — the desktop row and
  // the phone's filter sheet both carry it.
  useEffect(() => {
    if (!aiPriority) setBand("high");
  }, [aiPriority]);
  // MW-19 / ASK-24 — "Completed" is a Status now. A tab of "completed" can
  // only arrive from saved prefs written before that; move it across once.
  useEffect(() => {
    if (tab !== "completed") return;
    setTab("all");
    setStatusFilter("completed");
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist on any change. Guard on prefsKey so pre-login / test envs stay
  // no-op.
  useEffect(() => {
    if (!prefsKey) return;
    try {
      // "asked" is a URL view, not a default to come back to (ASK-28 TK-01).
      localStorage.setItem(prefsKey, JSON.stringify({ scope: URL_SCOPES.includes(scope) ? savedScope : scope, tab, aiPriority }));
    } catch { /* quota; ignore */ }
  }, [prefsKey, scope, tab, aiPriority, savedScope]);

  // U7-05.3: bulk selection. Set of task ids across the currently-visible
  // list. Cleared when the tab / scope / view changes so a stale selection
  // can't apply to a different filter's tasks.
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => { setSelected(new Set()); }, [scope, tab, view, personFilter, statusFilter]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false);
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [bulkAssigneeRole, setBulkAssigneeRole] = useState("");
  const toggleSelected = (id) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const clearSelection = () => setSelected(new Set());
  const asked = scope === "asked";
  const mine = !(isOwner && scope === "all");
  // AI priority ranks the work YOU have to do; Asked by me is other people's
  // work, so the ranking and its columns are off there.
  const aiOn = aiPriority && !asked;
  // ASK-24 — with Person set, every card would repeat the same name.
  const showAssignee = isOwner && scope === "all" && !personFilter;
  const tasksQ = useQuery({
    queryKey: ["tasks", asked ? "asked" : mine],
    queryFn: () => api.get(asked ? "/tasks?view=asked" : `/tasks?mine=${mine}`).then((r) => r.data),
  });
  // ASK-28 TK-02 — how many task approvals wait on me (the server already
  // limits the feed to what I may approve), for the switcher's count. A named
  // approver who holds no approval access still gets the view.
  const waitingOnMe = (apprTasksQ.data || []).filter(isPendingApproval).length;
  const showApprovalsView = canApprove || waitingOnMe > 0;
  const focusQ = useQuery({
    queryKey: ["task", focusTaskId],
    queryFn: () => api.get(`/tasks/${focusTaskId}`).then((r) => r.data),
    enabled: !!focusTaskId, retry: false,
  });
  const focusDenied = !!focusTaskId && focusQ.isError && [403, 404].includes(focusQ.error?.response?.status);
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const prioritiesQ = useQuery({ queryKey: ["priorities"], queryFn: () => api.post("/tasks/prioritize").then((r) => r.data), enabled: aiOn });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  useEffect(() => {
    if (!focusTaskId || !focusQ.data) return;
    const ft = focusQ.data;
    // ASK-28 TK-02 — opened from Approvals: stay there, just bring it into view.
    if (view === "approvals") {
      const t0 = setTimeout(() => {
        document.getElementById(`task-card-${focusTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 400);
      return () => clearTimeout(t0);
    }
    setView("mywork");
    // ASK-28 TK-01/02 — a task opened from Asked by me or Approvals is in that
    // list already; only My Tasks needs to widen to All Tasks for the owner.
    if (isOwner && !URL_SCOPES.includes(scope) && ft.assignee_id !== user?.id && !(ft.co_assignee_ids || []).includes(user?.id) && scope !== "all") { setScope("all"); return; }
    // ASK-24 — a deep-linked task must be visible, so drop any filter that
    // could hide it; a finished task opens under Status: Completed.
    setTab("all");
    setFilterParams({ person: "", status: isTerminal(ft) ? "completed" : "" });
    const timer = setTimeout(() => {
      document.getElementById(`task-card-${focusTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
  }, [focusTaskId, focusQ.data, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  // Epic 2 Sprint 6.5 (E2-51): When Desk Trends deep-links here with
  // ?filter=overdue|completed, an owner should see ALL tenant tasks
  // (the Desk counter is tenant-wide). Auto-flip scope=all so the list
  // isn't empty just because none of them are the owner's own todos.
  useEffect(() => {
    const f = params.get("filter");
    if (f && isOwner && scope !== "all") setScope("all");
    // ASK-24 — the Desk's ?filter= link becomes the visible Status filter, so
    // the reader can see why the list is narrowed and clear it.
    if (f === "completed" || f === "overdue" || f === "due_today") {
      setTab("all");
      setFilterParams({ filter: "", status: f });
    }
  }, [params, isOwner]); // eslint-disable-line react-hooks/exhaustive-deps

  // U7-05.9: if the currently-selected tab has no items, snap back to
  // 'all' so the user doesn't see a "tab selected but no chip visible"
  // dead state after tasks are cleared.
  useEffect(() => {
    if (tab === "all" || !tasksQ.data) return;
    const all = tasksQ.data || [];
    const count = tab === "completed"
      ? all.filter(isTerminal).length
      : all.filter((t) => !isTerminal(t) && t.task_type === tab).length;
    if (count === 0) setTab("all");
  }, [tab, tasksQ.data]);

  const scoreMap = {};
  (prioritiesQ.data?.tasks || []).forEach((pt) => { if (pt.ai_scores) scoreMap[pt.id] = pt.ai_scores; });
  const scoring = aiOn && prioritiesQ.isFetching && !prioritiesQ.data;

  const all = tasksQ.data || [];
  const countFor = (key) => {
    if (key === "completed") return all.filter(isTerminal).length;
    if (key === "all") return all.filter((t) => !isTerminal(t)).length;
    return all.filter((t) => !isTerminal(t) && t.task_type === key).length;
  };

  // Epic 2 Sprint 6.5 (E2-51): `?filter=overdue|completed` URL param
  // deep-link from Desk Trends card. Overdue narrows the All-tab list
  // to just isOverdue rows; completed forces the Completed tab.
  const urlFilter = params.get("filter");

  // MW-19 — "completed" reaches this either from the Status dropdown (desktop)
  // or from the tab (mobile chip strip / deep link); both mean the same lens.
  const showingCompleted = urlFilter === "completed" || tab === "completed" || statusFilter === "completed";

  // ASK-24 — Department x Person x Status, all through one
  // predicate. countWith() swaps one dimension for the option being counted,
  // so every menu's numbers reflect the filters set in the others.
  const filters = {
    tab: urlFilter === "completed" ? "completed" : tab,
    person: personFilter,
    status: statusFilter || (STATUS_LENSES.has(urlFilter) && urlFilter !== "completed" ? urlFilter : ""),
  };
  const countWith = (over) => all.filter((tk) => matchesFilters(tk, { ...filters, ...over })).length;
  let list = all.filter((tk) => matchesFilters(tk, filters));
  if (aiOn && !showingCompleted) {
    list = [...list].sort((a, b) => (scoreMap[b.id]?.priority_score || 0) - (scoreMap[a.id]?.priority_score || 0));
  }

  // KR-14.6 · MOBILE HEADER — reference-driven layout for MyWork on phones:
  //   Row 1 (segment views only): h1 title left, [+ New Task] and the
  //          star-priority circle right.
  //   Row 2: [My Tasks | All Tasks] as a single segmented pill, plus
  //          [Workflows] and [Leave] as their own pills, and the sliders
  //          filter circle on the right. The filter opens a dropdown listing
  //          the sub-filters (All, Finance, Logistics… + Completed) — the
  //          old category chip strip is gone, its selection moves in here.
  // Reuses the same state (view/scope/tab/aiPriority) so the desktop tree can
  // stay untouched via `lg:hidden` / `hidden lg:*`.
  // KM-2 · MOBILE HEADER — the founder's arrangement, and it now uses the
  // DESKTOP MATERIAL. The phone was still painting selection as a solid ink
  // fill (MSEG_ON = bg-kr-ink text-white) while the desktop had long since
  // moved to depth: .kr-pressed for "you are in this", .kr-pop for "you are
  // not". One app, one grammar.
  //
  //   Row 1: h1 left · [Leave] right-aligned
  //   Row 2: the LENS GROUP — [My Tasks | All Tasks] joined by geometry with
  //          a circular [+] sitting inside the same group — then [Workflows];
  //          [AI priority] and [filter] as a pair of circles on the right
  //   Row 3: the active sub-filter caption
  //
  // NO `transition-colors` ANYWHERE IN HERE, and it is load-bearing rather
  // than an oversight: every control below swaps .kr-pop <-> .kr-pressed,
  // whose box-shadows are an OUTSET list and an INSET list. Shadow lists only
  // interpolate when their lengths and `inset` keywords agree, so the browser
  // falls back to a discrete transition and the button sits visually unchanged
  // for half the duration — and a transition-colors utility (which @layer
  // utilities puts after @layer components, replacing transition-property
  // wholesale) drags the LABEL COLOUR into that same dead zone. Selection
  // should snap anyway. See the note at the top of this file.
  const MPILL = "flex h-9 shrink-0 items-center gap-1.5 rounded-pill px-2.5 text-[12px]";
  const MPILL_ON = "kr-pressed font-semibold text-foreground";
  const MPILL_OFF = "kr-pop text-foreground/75";
  const MSEG = "flex h-9 shrink-0 items-center justify-center px-2.5 text-[12px]";
  const MSEG_ON = "kr-pressed font-semibold text-foreground";
  const MSEG_OFF = "kr-pop text-foreground/70";
  // The two circles on the right of Row 2, and the [+] in the lens group.
  const MCIRCLE = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-foreground";
  const mobileView = (() => {
    if (view === "workflows") return "workflows";
    // ASK-25 — in the Approvals view neither lens pill is pressed; the list
    // controls (AI priority, filters) hide because there is no task list.
    if (view === "approvals") return "approvals";
    // ASK-6: leave sub-view retired; the branch that returned "leave" here
    // was mapping to a case that no longer renders.
    if (isOwner && scope === "all") return "all";
    // ASK-28 TK-01 — Asked by me reached by link on a phone: its own view, so
    // the My Tasks pill doesn't claim a list that isn't yours. The phone's
    // own switcher for it comes with the mobile pass.
    if (scope === "asked") return "asked";
    return "mine";
  })();
  const inSegmentView = mobileView === "mine" || mobileView === "all" || mobileView === "asked";
  // The filter dropdown lists only tabs that have items — same rule the old
  // chip strip used. "Completed" appears when any completed task exists.
  /* KM-49 — EVERY category, not just the ones with work in them. The `> 0`
     test is right for the desktop CHIP STRIP, where an empty chip spends a slot
     of a fixed-width row; it is wrong for a dropdown, where the list is the
     menu and a category vanishing because its count hit zero makes the menu a
     different shape every time you open it. Founder: "where is the all 8
     options in that new pill, only all and completed option is there?" — that
     is this filter, doing exactly what it was told against a dataset where the
     other categories were empty. The counts still show, so an empty category
     reads as empty rather than missing. */
  // MW-19 — Department = departments that actually hold work. "All" always
  // shows (it is the baseline and the destination the snap-back effect uses);
  // "completed" is excluded because it is a state, and it now lives in Status.
  const departmentOptions = WORK_TABS.filter(
    (tb) => tb.key !== "completed" && (tb.key === "all" || countFor(tb.key) > 0)
  );
  // KM-49 still holds for the phone sheet: every category, counts showing.
  // Completed is a Status there too (MW-19).
  const mobileFilterTabs = WORK_TABS.filter((tb) => tb.key !== "completed");

  /* ASK-24 — PERSON options, built from the tasks on All Tasks:
       All people · Me · everyone holding work, busiest first, role underneath
       · Unassigned · then Teams — tasks given to a role with no named person
       (the cards' "Sales team" line).
     Names come from /users (members) with the task's own assignee_name as the
     fallback for someone no longer in the list. */
  const roleLabel = (key) => roleOptions.find((r) => r.key === key)?.label
    || String(key || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const personOptions = (() => {
    if (!((isOwner && scope === "all") || asked)) return [];
    const openBy = new Map();
    const teams = new Set();
    let unassigned = 0;
    all.forEach((tk) => {
      if (tk.assignee_id) openBy.set(tk.assignee_id, (openBy.get(tk.assignee_id) || 0) + (isTerminal(tk) ? 0 : 1));
      else if (tk.assignee_role) teams.add(tk.assignee_role);
      else unassigned += 1;
      // ASK-26 — a co-assignee is holding that work too: listed, and counted.
      (tk.co_assignee_ids || []).forEach((id) => {
        if (id && id !== tk.assignee_id) openBy.set(id, (openBy.get(id) || 0) + (isTerminal(tk) ? 0 : 1));
      });
    });
    const memberOf = (id) => members.find((m) => m.id === id);
    const nameOf = (id) => memberOf(id)?.name || all.find((tk) => tk.assignee_id === id)?.assignee_name || "Unknown";
    const special = personFilter === "unassigned" || personFilter.startsWith("role:");
    if (personFilter && !special && !openBy.has(personFilter) && memberOf(personFilter)) openBy.set(personFilter, 0);
    if (personFilter.startsWith("role:")) teams.add(personFilter.slice(5));
    // Two accounts can share a display name; the menu and the phone chips
    // must still tell them apart, so a repeated name carries its email handle.
    const nameCount = {};
    openBy.forEach((_, id) => { nameCount[nameOf(id)] = (nameCount[nameOf(id)] || 0) + 1; });
    const people = [...openBy.entries()]
      .filter(([id]) => id !== user?.id)
      .sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])))
      .map(([id]) => {
        const m = memberOf(id);
        const handle = (m?.email || "").split("@")[0] || id.slice(0, 6);
        return {
          key: id, group: "People",
          label: nameCount[nameOf(id)] > 1 ? `${nameOf(id)} (${handle})` : nameOf(id),
          sub: m?.role ? roleLabel(m.role) : "",
        };
      });
    return [
      { key: "", label: "All people" },
      // Asked by me never holds my own tasks, so "Me" would always read 0.
      ...(user?.id && !asked ? [{ key: user.id, label: "Me", group: "People" }] : []),
      ...people,
      ...(unassigned > 0 || personFilter === "unassigned" ? [{ key: "unassigned", label: "Unassigned", group: "People" }] : []),
      ...[...teams].sort().map((r) => ({ key: `role:${r}`, label: `${roleLabel(r)} team`, group: "Teams" })),
    ];
  })();
  const peopleSearchable = personOptions.filter((o) => o.group === "People").length > 8;

  // What is narrowing the list, in words — the phone caption and the
  // no-match empty state both say it.
  const labelIn = (opts, key) => opts.find((o) => o.key === key)?.label;
  const filterParts = [
    tab !== "all" && tab !== "completed" ? labelIn(WORK_TABS, tab) : null,
    personFilter ? (labelIn(personOptions, personFilter) || "One person") : null,
    filters.status ? labelIn(STATUS_FILTER_OPTIONS, filters.status) : null,
  ].filter(Boolean);
  const filtersActive = filterParts.length > 0;
  const filterSummary = filterParts.join(" · ");
  const clearFilters = () => {
    setTab("all");
    // `priority` is gone as a filter, but links made while it existed can still
    // carry it; it is ignored on read and stripped here so Clear leaves a clean URL.
    setFilterParams({ person: "", status: "", filter: "", priority: "" });
  };
  const tasksLoading = tasksQ.isLoading && !tasksQ.data;

  return (
    /* ASK-20 (2026-09-13): on desktop the page owns its own height and only
       the CARD GRID scrolls. Header and filter row are plain block children
       that never move, so they need no sticky offset and no backdrop blur —
       nothing passes behind them. */
    /* UI-SCALE — `ui-scale`: the page zooms with the viewport (hooks/useUiScale),
       so a 27" monitor shows the 1440 composition bigger, not smaller in a sea
       of margin. Only this page for now; see the hook for the one-line move
       to the whole app. The task sheet is portalled outside this root, so it
       stays at 1× until that move. */
    <div className="ui-scale lg:h-full lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden">
      {/* ─── MOBILE HEADER (below lg) ───────────────────────────────────── */}
      {/* KM-48 — gap-2 and mb-2: one 8px rhythm for every gap in this header,
          where it used to be 10px between rows and then whatever the body's
          own margin happened to be under it. */}
      <StickyHeader className="mb-2 flex flex-col gap-2 lg:hidden" data-testid="mywork-mobile-header">
        {/* Row 1 — title left, the two DESTINATIONS right.
            Workflows and Leave are the only two controls in this header that
            are not lenses on the task list — they replace the list with a
            different subject. Putting them on the title's line says that, and
            leaves Row 2 holding exactly the things that act on the list.
            MEASURED, not chosen: with Workflows still in Row 2 that row needed
            378px of a 343px column — 194 (lens group) + 78 (Workflows) + 94
            (the two circles) + gaps — and the filter circle's right edge landed
            at 394px against a 375px viewport, where overflow-x:clip on <main>
            cropped it away with no way to reach it. The circles are 44px wide,
            not the 36px `w-9` declares, because index.css puts a 44px
            min-width touch floor on every button below lg. Tightening padding
            and gaps recovers ~16px of the 35px gap, so the row genuinely
            cannot hold six controls; a destination pair moving up is the only
            fix that keeps every control reachable. */}
        <div className="flex items-center gap-1.5">
          <h1 className="min-w-0 flex-1 font-display text-3xl leading-none">{t("mywork.title")}</h1>
          {/* KM-31 — the Workflows and Leave pills are gone from this row.
              They were destinations wearing the costume of lenses: tapping
              either replaced the whole task list with a different product,
              from a control sitting beside "My Tasks / All Tasks" as though it
              were a third way of looking at the same thing. Both are pages now,
              reached from the More menu, so this row holds only things that act
              on THIS list. The `view` state and its embedded branches are
              untouched — desktop still uses them. */}
        </div>

        {/* Row 2 — everything that ACTS ON THE LIST, and nothing else:
            the lens group on the left, the two action circles on the right. */}
        <div className="flex items-center gap-1.5" data-testid="mywork-mobile-tabs">
          {/* THE LENS GROUP. My Tasks and All Tasks are joined by geometry —
              touching, outer corners round, inner corners square, a hairline
              seam — and the [+] rides with them as a circle: it acts on the
              same list, so it belongs in the same group, and being round is
              what stops it reading as a third tab. Same anatomy the desktop
              cluster uses for AI priority. */}
          {isOwner && (
            <div className="flex shrink-0 items-center gap-1.5"
                 role="group" aria-label={t("mywork.title", "My Work")} data-testid="work-mobile-segment">
              <div className="flex items-center">
                <button type="button" onClick={() => { setScope("mine"); setView("mywork"); }}
                  aria-pressed={mobileView === "mine"} data-testid="work-mobile-mine"
                  className={`${MSEG} rounded-l-pill ${mobileView === "mine" ? MSEG_ON : MSEG_OFF}`}>
                  {t("mywork.my_tasks")}
                </button>
                <span aria-hidden="true" className="h-5 w-px shrink-0 bg-kr-ink/15" />
                <button type="button" onClick={() => { setScope("all"); setView("mywork"); }}
                  aria-pressed={mobileView === "all"} data-testid="work-mobile-all"
                  className={`${MSEG} rounded-r-pill ${mobileView === "all" ? MSEG_ON : MSEG_OFF}`}>
                  {t("mywork.all_tasks")}
                </button>
              </div>
              {/* ASK-3: the mobile [+] circle used to sit here on Row 2 of
                  the sticky header. Moved out to a right-aligned bar just
                  above the task list (below MOBILE HEADER, above the
                  first card) so New Task reads as an action for the list
                  rather than a fifth control in an already busy header
                  row. */}
            </div>
          )}


          {/* The two circles, as a pair, hard right. AI priority moved up here
              from its own row so that both controls that act on the LIST
              — reorder it, filter it — sit together, in the same shape, in
              the same place. */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {inSegmentView && (
              <button type="button" onClick={() => { setAiPriority((v) => !v); setView("mywork"); }}
                aria-pressed={aiPriority} data-testid="work-mobile-priority"
                aria-label={aiPriority ? t("mywork.ai_priority_on", "AI priority on") : t("mywork.ai_priority", "AI priority")}
                title={scoring ? t("mywork.scoring", "Scoring…") : (aiPriority ? t("mywork.ai_priority_on", "AI priority on") : t("mywork.ai_priority", "AI priority"))}
                className={`${MCIRCLE} ${aiPriority ? "kr-pressed" : "kr-pop"}`}>
                <Sparkle size={15} weight={aiPriority ? "fill" : "bold"} aria-hidden="true"
                  className={scoring ? "animate-pulse" : ""} />
              </button>
            )}

            {/* KM-48 — THE CATEGORY FILTER COMES BACK, and this time it says
                what it is doing. KM-29 removed it as an unlabelled sliders
                circle on the grounds that two filter affordances a thumb apart
                were confusing, and left the categories reachable only from the
                desktop header — which silently took the feature away from the
                phone entirely. Founder: "the filter option in the my-work page
                which was there in old versions was removed silently."

                The confusion was never that there were two filters; it was that
                one of them was a mystery icon. As a pill carrying the current
                selection — "All", "Finance", "Completed" — it names itself, and
                it also absorbs the caption row that used to sit underneath
                doing the same job with none of the control. */}
            {/* ASK-24 — the pill now opens a bottom sheet holding all four
                filters (Department, Person, Priority, Status); what is set is
                named in the caption row underneath, not squeezed into this
                pill, which Row 2 has no width for. */}
            {inSegmentView && (
              <button type="button" data-testid="work-mobile-category"
                onClick={() => setFilterSheetOpen(true)}
                aria-label={filtersActive ? `Filters: ${filterSummary}` : "Filters"}
                aria-haspopup="dialog"
                className={`${filtersActive ? "kr-pressed" : "kr-pop"} flex h-11 min-w-0 shrink items-center gap-1.5 rounded-pill pl-3 pr-3 text-[12px] font-medium`}>
                <SlidersHorizontal size={14} weight="bold" aria-hidden="true" />
                <span>Filter</span>
                <span className="tabular-nums opacity-55">{tasksLoading ? "—" : list.length}</span>
              </button>
            )}
            {/* ASK-6: leave spacer retired -- the view branch is gone. */}
          </div>
        </div>

        {/* KM-48 · ROW 3 — THE TWO LENSES, LABELLED, AS ONE BLOCK.
            Founder: the spacing between the status bar, the priority bar and
            the My/All row was uneven, and neither bar said what it filtered.

            The unevenness had a cause worth naming: the status bar lived in
            this fixed header while the priority bar lived in the scrolling
            body (inside TaskPriorityColumns), so no margin could hold them at
            a constant distance — one of them slid. Both are here now, in one
            column with one gap, and the page owns `band` so the body can still
            render the chosen column.

            Each gets a caption because "High / Medium / Low" and "Not Started /
            In Progress / Waiting / Review" are not self-evidently two
            DIFFERENT axes when stacked — without the labels they read as one
            long filter that wrapped. */}
        {/* ASK-24 · the active filters, in words, with a one-tap Clear. */}
        {inSegmentView && filtersActive && (
          <div className="flex items-center gap-2 px-1" data-testid="work-mobile-filter-caption">
            <p className="min-w-0 flex-1 truncate text-[12px] text-foreground/75">
              <span className="text-muted-foreground">Showing </span>
              <span className="font-semibold text-foreground">{filterSummary}</span>
            </p>
            <button type="button" onClick={clearFilters} data-testid="work-mobile-filter-clear"
              className="shrink-0 text-[12px] font-medium text-foreground/70 underline underline-offset-4">
              Clear
            </button>
          </div>
        )}

        <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
          <SheetContent side="bottom" hideClose data-testid="work-mobile-filter-sheet"
            className="flex max-h-[85vh] flex-col gap-0 rounded-t-cardlg p-0 lg:hidden">
            <SheetHeader className="flex-row items-center justify-between space-y-0 px-5 pb-3 pt-5 text-left">
              <SheetTitle className="text-base">Filter tasks</SheetTitle>
              <SheetClose asChild>
                <button type="button" aria-label="Close filters" data-testid="work-mobile-filter-close"
                  className="kr-pop grid h-9 w-9 place-items-center rounded-full">
                  <X size={14} weight="bold" aria-hidden="true" />
                </button>
              </SheetClose>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 pb-4">
              <FilterChipGroup testid="work-sheet-department" label="Department"
                value={tab === "completed" ? "all" : tab} options={mobileFilterTabs}
                counts={(k) => countWith({ tab: k })} onSelect={setTab} loading={tasksLoading} />
              {personOptions.length > 0 && (
                <FilterChipGroup testid="work-sheet-person" label="Person"
                  value={personFilter} options={personOptions}
                  counts={(k) => countWith({ person: k })} onSelect={setPersonFilter}
                  loading={tasksLoading} searchable={peopleSearchable} />
              )}
              <FilterChipGroup testid="work-sheet-status" label="Status"
                value={filters.status} options={STATUS_FILTER_OPTIONS}
                counts={(k) => countWith({ status: k })} onSelect={setStatusFilter} loading={tasksLoading} />
            </div>
            <div className="flex items-center gap-2 border-t border-nm-edge/40 px-5 pb-6 pt-3">
              <button type="button" onClick={clearFilters} disabled={!filtersActive}
                data-testid="work-sheet-clear"
                className="kr-pop h-11 flex-1 rounded-pill text-[13px] font-medium disabled:opacity-40">
                Clear filters
              </button>
              <SheetClose asChild>
                <button type="button" data-testid="work-sheet-done"
                  className="kr-lift h-11 flex-1 rounded-pill bg-kr-ink text-[13px] font-medium text-white">
                  Show {tasksLoading ? "" : list.length} {list.length === 1 ? "task" : "tasks"}
                </button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>

        {inSegmentView && aiPriority && (
          <div className="flex flex-col gap-2" data-testid="work-mobile-lenses">
            <div>
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
                {t("mywork.filter_priority", "Priority")}
              </p>
              {/* NO transition utility: the segments swap .kr-pop's outset
                  shadows against .kr-pressed's inset ones, which do not
                  interpolate. */}
              <div className="kr-pressed flex items-center gap-1 rounded-pill p-1"
                   role="group" aria-label="Filter by priority" data-testid="mywork-priority-bands">
                {BANDS.map((b) => {
                  const n = list.filter((tk) => TIER_OF(tk) === b.key).length;
                  return (
                    <button key={b.key} type="button" onClick={() => setBand(b.key)}
                      aria-pressed={band === b.key} data-testid={`priority-band-${b.key}`}
                      className={`kr-seg-compact flex h-9 flex-1 items-center justify-center gap-1.5 rounded-pill px-2 text-[12px] ${
                        band === b.key ? "kr-pop font-semibold text-foreground" : "text-foreground/60"}`}>
                      {b.label}
                      <span className="tabular-nums opacity-55">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/70">
                {t("mywork.filter_status", "Status")}
              </p>
              {/* Scrolls rather than wraps: four status segments do not fit
                  343px, and a control row that reflows to two lines as you tap
                  through it is worse than one that slides. */}
              <div className="kr-pressed flex items-center gap-1 overflow-x-auto rounded-pill p-1 [scrollbar-width:none]"
                   role="group" aria-label="Filter by progress" data-testid="work-mobile-status-lens">
                {M_STATUS_PILLS.map((sp) => (
                  <button key={sp.key} type="button"
                    onClick={() => setStatusFilter((cur) => (cur === sp.key ? "" : sp.key))}
                    aria-pressed={statusFilter === sp.key} data-testid={`work-status-${sp.key}`}
                    className={`kr-seg-compact flex h-9 shrink-0 items-center rounded-pill px-3.5 text-[12px] ${
                      statusFilter === sp.key ? "kr-pop font-semibold text-foreground" : "text-foreground/60"}`}>
                    {sp.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

      </StickyHeader>

      {/* ─── DESKTOP HEADER (lg and up) ─────────────────────────────────── */}
      <header className="mb-7 hidden shrink-0 gap-4 lg:flex lg:flex-row lg:items-end lg:justify-between">
        <div>
          {/* MW-14 fix: eyebrow + title track the active view instead of
              staying pinned to "MY WORK / Your day, simplified" while
              the body is entirely leave requests or delivery pipelines.
              The toggle pill below is small; the page header needs to
              say what you are looking at above the fold. */}
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {view === "workflows" ? t("mywork.view_workflows") : view === "approvals" ? t("mywork.view_approvals") : t("mywork.eyebrow")}
          </p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">
            {view === "workflows" ? t("mywork.view_workflows") : view === "approvals" ? t("mywork.view_approvals") : t("mywork.title")}
          </h1>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center" data-testid="mywork-controls">
          {/* ASK-14 (2026-09-13): My Tasks / All Tasks / Workflows collapse
              into ONE segmented slider — same SEG/SEG_ON/SEG_OFF grammar the
              mobile row already uses, so all three top-level places sit on
              one control. AI Priority is a lens on the task list only, so it
              rides to the LEFT of the slider and hides in Workflows view. */}
          {(() => {
            const segments = [];
            // ASK-28 TK-01 — Asked by me is a place you can link to, so it
            // lives in the URL; every other segment clears it.
            const go = (nextScope, nextView = "mywork") => {
              if (nextScope) setScope(nextScope);
              setView(nextView);
              // ASK-28 TK-02 — Approvals is linkable too (?view=approvals).
              setFilterParams({ view: URL_SCOPES.includes(nextScope) ? nextScope : nextView === "approvals" ? "approvals" : "" });
            };
            const askedSegment = {
              key: "asked", label: t("mywork.asked_by_me", "Asked by me"), testid: "work-scope-asked",
              active: view === "mywork" && scope === "asked",
              onClick: () => go("asked"),
            };
            if (isOwner) {
              segments.push({
                key: "mine", label: t("mywork.my_tasks"), testid: "work-scope-mine",
                active: view === "mywork" && scope === "mine",
                onClick: () => go("mine"),
              });
              segments.push(askedSegment);
              segments.push({
                key: "all", label: t("mywork.all_tasks"), testid: "work-scope-all",
                active: view === "mywork" && scope === "all",
                onClick: () => go("all"),
              });
            } else {
              segments.push({
                key: "tasks", label: t("mywork.view_mywork"), testid: "work-view-mywork",
                active: view === "mywork" && !URL_SCOPES.includes(scope),
                onClick: () => go("mine"),
              });
              segments.push(askedSegment);
            }
            // ASK-25 — Approvals sits between the task lenses and Workflows:
            // it is about tasks (and leave), not pipelines.
            // ASK-28 TK-02 — also for a named approver without approval
            // access, and it carries how many task approvals wait on you.
            if (showApprovalsView) {
              segments.push({
                key: "approvals", label: t("mywork.view_approvals"), testid: "work-view-approvals",
                count: waitingOnMe,
                active: view === "approvals",
                onClick: () => go(null, "approvals"),
              });
            }
            if (canSeeWorkflows) {
              segments.push({
                key: "workflows", label: t("mywork.view_workflows"), testid: "work-view-workflows",
                active: view === "workflows",
                onClick: () => go(null, "workflows"),
              });
            }
            return (
              <div className="flex flex-wrap items-center gap-2.5" data-testid="mywork-lens-group">
                {view === "mywork" && !asked && (
                  <button onClick={() => setAiPriority((v) => !v)} data-testid="ai-priority-toggle"
                    aria-pressed={aiPriority}
                    aria-label={aiPriority ? t("mywork.ai_priority_on") : t("mywork.ai_priority")}
                    title={scoring ? t("mywork.scoring") : aiPriority ? t("mywork.ai_priority_on") : t("mywork.ai_priority")}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground ${aiPriority ? "kr-pressed" : "kr-pop"}`}>
                    <Sparkle size={16} weight={aiPriority ? "fill" : "bold"} aria-hidden="true"
                      className={scoring ? "animate-pulse" : ""} />
                  </button>
                )}
                {segments.length > 0 && (
                  <div className="flex items-center" role="group" aria-label="View" data-testid="work-view-segment">
                    {segments.map((seg, i) => {
                      const first = i === 0;
                      const last = i === segments.length - 1;
                      return (
                        <Fragment key={seg.key}>
                          {!first && <span aria-hidden="true" className="h-6 w-px shrink-0 bg-kr-ink/15" />}
                          <button type="button" onClick={seg.onClick} data-testid={seg.testid}
                            aria-pressed={seg.active}
                            className={`${SEG} ${first ? "rounded-l-pill" : ""} ${last ? "rounded-r-pill" : ""} ${seg.active ? SEG_ON : SEG_OFF}`}>
                            {seg.label}
                            {/* ASK-28 TK-02 — how many are waiting on you. */}
                            {seg.count > 0 && (
                              <span data-testid={`${seg.testid}-count`}
                                className="ml-1.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-kr-ink px-1.5 text-[11px] font-semibold tabular-nums leading-none text-white">
                                {seg.count}
                              </span>
                            )}
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </header>

      {focusDenied && (
        <div data-testid="access-restricted-banner" className="mb-6 flex items-center gap-3 rounded-control border-l-[3px] border-kr-accent bg-kr-accent/10 p-4">
          <LockKey size={20} weight="bold" aria-hidden="true" className="shrink-0 text-kr-accent" />
          <div>
            <p className="text-sm font-semibold">{t("mywork.access_restricted")}</p>
            <p className="text-sm text-muted-foreground">{t("mywork.access_restricted_desc")}</p>
          </div>
        </div>
      )}

      {view === "approvals" && showApprovalsView ? (
        // ASK-25 — the approvals that are not decisions. Two sub-tabs: Tasks
        // (the All/My lens, cards in the task grid) and Leave (the register's
        // cards). Decisions stay on the Desk and /decisions/:id.
        <div data-testid="approvals-hub" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          {(() => {
            // The same rule as tasks.py's _can_approve_task, mirrored so the
            // Desk's count, this list and the card's buttons all agree.
            const canApproveTask = (t) =>
              isOwner || (t.approver_id ? user?.id === t.approver_id : userPerms(user).includes("approvals"));
            // ASK-28 TK-02 — oldest request first: whoever has waited longest
            // to start is the one to unblock next.
            const apprAll = (Array.isArray(apprTasksQ.data) ? apprTasksQ.data : [])
              .filter((t) => isPendingApproval(t) && canApproveTask(t))
              .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
            const apprList = apprScope === "mine" ? apprAll.filter((t) => t.approver_id === user?.id) : apprAll;
            const pendingLeaves = (leavesQ.data || []).filter((l) => l.status === "pending" || l.status === "info_requested");
            const subs = [
              { key: "tasks", label: "Tasks", icon: Check, n: apprTasksQ.data ? apprAll.length : null },
              ...(canApproveLeave ? [{ key: "leave", label: "Leave", icon: CalendarBlank, n: leavesQ.data ? pendingLeaves.length : null }] : []),
            ];
            const sub = subs.some((s) => s.key === apprSub) ? apprSub : "tasks";
            return (
              <>
                {/* ASK-25 — UNDERLINE tabs on a full-width rule (the founder's
                    reference): icon + label + count, the chosen one in ink
                    with a 2px ink underline that sits ON the rule (-mb-px),
                    the rest quiet. The lens slider rides the same row on the
                    right, above the rule. */}
                {/* min-h pins the rule: the slider's track (44px + its 4px lift)
                    is taller than the 44px tabs, so without it the whole row
                    jumped when Leave (no slider) was chosen. 48 < the pinned
                    49px content box, so the slider never sets the height. */}
                <div className="mb-4 flex min-h-[50px] items-end gap-3 border-b border-kr-ink/[.12]" data-testid="approvals-controls">
                  <div role="tablist" aria-label="Approvals" className="-mb-px flex items-end gap-1" data-testid="approvals-sub">
                    {subs.map((s) => {
                      const on = sub === s.key;
                      const Icon = s.icon;
                      return (
                        <button key={s.key} type="button" role="tab" aria-selected={on}
                          onClick={() => setApprSub(s.key)} data-testid={`approvals-sub-${s.key}`}
                          className={`flex h-11 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-ink/60 ${
                            on ? "border-kr-ink font-semibold text-foreground" : "border-transparent font-medium text-foreground/60 hover:text-foreground/85"
                          }`}>
                          <Icon size={16} weight={on ? "bold" : "regular"} aria-hidden="true" />
                          {s.label}
                          <span className={`font-mono text-xs tabular-nums ${on ? "opacity-70" : "opacity-55"}`}>{s.n ?? "–"}</span>
                        </button>
                      );
                    })}
                  </div>
                  {sub === "tasks" && (
                    <ScopeSlider options={APPR_SCOPES} value={apprScope} onChange={setApprScope}
                      segWidth={128} label="Which approvals" testid="approvals-scope" className="mb-1 ml-auto" />
                  )}
                </div>

                <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                  {sub === "tasks" ? (
                    apprTasksQ.isLoading ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
                        {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-36 rounded-tile" />)}
                      </div>
                    ) : apprList.length === 0 ? (
                      <div className="kr-frost-min p-6 text-sm text-muted-foreground" data-testid="approvals-tasks-empty">
                        {apprScope === "mine" && apprAll.length > 0
                          ? "Nothing is routed to you by name — switch to All approvals to see what you can still sign off."
                          : "Tasks that need your sign-off will appear here."}
                      </div>
                    ) : (
                      <TaskGrid
                        list={apprList}
                        openId={openId}
                        setOpenId={setOpenId}
                        cardProps={(t) => ({
                          onChange: refresh,
                          members,
                          roleOptions,
                          showAssignee: true,
                          highlight: t.id === focusTaskId,
                        })}
                      />
                    )
                  ) : (
                    leavesQ.isLoading ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
                        {[0, 1, 2].map((i) => <div key={i} className="ds-skeleton h-44 rounded-tile" />)}
                      </div>
                    ) : pendingLeaves.length === 0 ? (
                      <div className="kr-frost-min p-6 text-sm text-muted-foreground" data-testid="approvals-leave-empty">
                        Leave requests routed to you will appear here.
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="approvals-leave">
                        {pendingLeaves.map((lv) => (
                          <LeaveCard key={lv.id} lv={lv} canAct
                            onRefresh={() => qc.invalidateQueries({ queryKey: ["leaves"] })}
                            highlight={lv.id === params.get("leave")} />
                        ))}
                      </div>
                    )
                  )}
                </div>
              </>
            );
          })()}
        </div>
      ) : view === "workflows" && canSeeWorkflows ? (
        // WE-14 (2026-08-16): "Board" sub-tab retired. The pipelines
        // view now carries inline task lists per card (WE-12), so a
        // separate role-lane kanban was a redundant lens on the same
        // data. Any /my-work?view=workflows&wf_tab=board deep link
        // now silently lands on the pipelines view -- the wf_tab
        // param is intentionally ignored below.
        // ASK-25 — the hub no longer scrolls as a whole: it hands its height
        // down so each STAGE COLUMN scrolls on its own (Workflows.js).
        <div data-testid="workflows-hub" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          <Workflows embedded />
        </div>
      ) : (
      <div data-testid="mywork-list" className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          {/* U7-05.9 (2026-08-17): only render tabs with something in them.
              Founder ask: 'why are we showing all the chips here, only
              open we can show that right'. Rule: 'All' always visible
              (baseline nav + destination for currently-selected empty
              tab); category tabs shown only when count > 0; Completed
              only when there is at least one completed task. If the
              currently-active tab is now empty (user finished the last
              task in that category), snap back to 'all' so users don't
              see a "selected but hidden" state. New categories can still
              be reached via the New Task dialog. */}
          {/* RD-2 (2026-08-17): category tabs match the Desk chip strip —
              borderless pills, sentence case, indigo tint on the active one.
              The bordered-uppercase version stacked a frame on every tab and
              the count badge carried a second frame inside it. */}
          {/* ASK-3: mobile-only New Task row. Sits directly above the task
              list, right-aligned, once the sticky header lets go. Absent
              on desktop -- the tab strip below carries the desktop
              instance on its right side. This row is naturally scoped
              to `view === "mywork"` because it sits inside the mywork-
              list branch of the view guard above. */}
          <div className="mb-3 flex justify-end lg:hidden">
            <NewTaskDialog onCreated={refresh} roleOptions={roleOptions} members={members} defaultType={tab}
              onOpenChange={(o) => { if (o) setOpenId(null); }}
              triggerClassName="kr-lift inline-flex items-center gap-1.5 rounded-pill bg-kr-ink px-3.5 py-2 text-xs font-medium text-white" />
          </div>

          {/* MW-06 fix: while the tasks query is loading, tabs render a
              dash instead of a hard 0. The card skeleton below is
              already loading-shaped; the tab strip should match. Only
              the "all" tab renders during load because every other
              tab's filter is `countFor(k) > 0` and would filter itself
              out at 0.

              ASK-3: this row is now flex-justify-between so New Task
              sits at the right end of the tab strip on desktop -- one
              place for filtering, one place for adding, on the same
              rule. */}
          {/* ASK-13 (2026-09-13): the desktop chip strip is now three dropdowns
              — Department (was the chip strip), Priority (new, was only reachable
              through the AI-priority view switch), and Status (new, was mobile-only
              inside the AI-priority row). All three read the same state the
              filters already used; New Task keeps its right-end position. */}
          <div className="mb-5 hidden shrink-0 items-end justify-between gap-4 border-b border-nm-edge/40 pb-4 lg:flex">
            <div className="flex flex-wrap items-center gap-2.5" data-testid="work-filters">
              {/* MW-19 — departments only, and only ones with work in them.
                  Listing every category meant six of nine options read 0, and
                  picking one was silently undone: the U7-05.9 effect snaps an
                  empty tab back to 'all', so the trigger still said
                  'Department: All 26' with nothing explaining why. The old
                  chip strip already hid empty categories on a founder ask;
                  the dropdown just forgot to. 'Completed' moved to Status. */}
              <FilterDropdown
                testid="work-filter-department"
                label="Department"
                value={tab}
                options={departmentOptions}
                counts={(k) => countWith({ tab: k })}
                onSelect={setTab}
                loading={tasksLoading}
              />
              {/* ASK-24 — Person, on All Tasks only. */}
              {personOptions.length > 0 && (
                <FilterDropdown
                  testid="work-filter-person"
                  label="Person"
                  value={personFilter}
                  options={personOptions}
                  counts={(k) => countWith({ person: k })}
                  onSelect={setPersonFilter}
                  loading={tasksLoading}
                  searchable={peopleSearchable}
                />
              )}
              <FilterDropdown
                testid="work-filter-status"
                label="Status"
                value={filters.status}
                options={STATUS_FILTER_OPTIONS}
                counts={(k) => countWith({ status: k })}
                onSelect={setStatusFilter}
                loading={tasksLoading}
              />
              {filtersActive && (
                <button type="button" onClick={clearFilters} data-testid="work-filters-clear"
                  className="h-9 rounded-pill px-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Clear filters
                </button>
              )}
            </div>
            <NewTaskDialog onCreated={refresh} roleOptions={roleOptions} members={members} defaultType={tab}
              onOpenChange={(o) => { if (o) setOpenId(null); }}
              triggerClassName={`${SECTION_BTN} kr-lift bg-kr-ink text-white`} />
          </div>
          {/* ASK-20 (2026-09-13): THE ONLY SCROLLER on desktop. Everything
              above this — page header, lens slider, filter row — is a fixed
              block child of the flex column, so it cannot move at all and
              needs no sticky offset. */}
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
          {/* E2-14: skeleton on first load so the tab strip doesn't
              jump when tasks land. */}
          {tasksQ.isLoading && !tasksQ.data && (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} lines={3} />
              ))}
            </div>
          )}
          {/* E2-13: empty state with a CTA. Sends the founder to Desk
              (where decisions become tasks) rather than a dead screen. */}
          {/* ASK-24 — the filters emptied the list, not the workspace: say
              so, and offer the way back, instead of "tasks appear once
              decisions are approved". */}
          {!tasksQ.isLoading && list.length === 0 && filtersActive && all.length > 0 && (
            <EmptyState
              testid="mywork-empty-filtered"
              title="No tasks match these filters"
              hint={filterSummary}
              ctaLabel="Clear filters"
              onCta={clearFilters}
            />
          )}
          {!tasksQ.isLoading && list.length === 0 && !(filtersActive && all.length > 0) && (
            <EmptyState
              testid="mywork-empty"
              title={asked
                ? (showingCompleted ? "Nothing you asked for is finished yet" : "Nothing you've asked for is open")
                : (showingCompleted ? t("mywork.empty_completed_title") : t("mywork.empty_title"))}
              hint={asked
                ? "Tasks you create for other people show up here, with their live status."
                : (tab === "all" ? t("mywork.empty_all_hint") : t("mywork.empty_cat_hint"))}
              ctaLabel={showingCompleted || asked ? null : "+ Open Decision Desk"}
              ctaTo={showingCompleted || asked ? null : "/inbox"}
              secondary={showingCompleted || asked ? null : "Tasks appear here once decisions are approved"}
            />
          )}
          {/* U7-05.3: bulk-action bar. Sticky at top of the list so it
              stays visible when scrolling long task lists. Appears only
              when >=1 task is selected. Actions apply client-side one
              PATCH per task -- backend batch endpoint tracked as
              U7-05.SS (bulk endpoint) in the backend backlog wave. */}
          {selected.size > 0 && (
            <BulkActionBar
              selectedIds={Array.from(selected)}
              tasks={list.filter((tk) => selected.has(tk.id))}
              members={members}
              roleOptions={roleOptions}
              busy={bulkBusy}
              onClear={clearSelection}
              onComplete={async () => {
                setBulkBusy(true);
                try {
                  const targets = list.filter((tk) => selected.has(tk.id) && !isTerminal(tk));
                  await Promise.all(targets.map((tk) => api.patch(`/tasks/${tk.id}`, { status: "done" })));
                  toast.success(`Completed ${targets.length} ${targets.length === 1 ? "task" : "tasks"}`);
                  clearSelection();
                  refresh();
                } catch (e) {
                  toast.error(e.response?.data?.detail || "Bulk complete failed");
                } finally { setBulkBusy(false); }
              }}
              openReassign={() => { setBulkAssigneeId(""); setBulkAssigneeRole(""); setBulkReassignOpen(true); }}
            />
          )}
          {(() => {
            const cardProps = (t) => ({
              onChange: refresh,
              members,
              roleOptions,
              showAssignee,
              highlight: t.id === focusTaskId,
              scores: aiOn && !showingCompleted ? scoreMap[t.id] : undefined,
              // KM-30 — the card drops the status chip when the lens already
              // says it. Priority is handled by TaskPriorityColumns when AI
              // Priority is on (each column already names the band).
              // ASK-24: Overdue is not a status, so the chip still has news.
              // A LENS narrows by a reason, not a status, so the status chip
              // still carries information under it; a real status filter
              // makes the chip redundant on every card.
              hideStatus: Boolean(statusFilter) && !STATUS_LENSES.has(statusFilter),
              selected: selected.has(t.id),
              onToggleSelect: () => toggleSelected(t.id),
            });
            const shared = { list, openId, setOpenId, cardProps };
            return aiOn && !showingCompleted
              ? <TaskPriorityColumns {...shared} band={band} />
              : <TaskGrid {...shared} />;
          })()}
          </div>

          {/* U7-05.3 dialog: bulk-reassign target picker. */}
          <Dialog open={bulkReassignOpen} onOpenChange={(o) => !o && !bulkBusy && setBulkReassignOpen(false)}>
            <DialogContent className="rounded-cardlg border border-nm-edge/40 max-w-md" data-testid="bulk-reassign-dialog">
              <DialogHeader>
                <DialogTitle className="font-heading tracking-tight">
                  Reassign {selected.size} {selected.size === 1 ? "task" : "tasks"}
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground -mt-2">
                Pick a specific team member OR hand off to a whole team.
              </p>
              <select
                value={bulkAssigneeId}
                onChange={(e) => setBulkAssigneeId(e.target.value)}
                className="w-full nm-tile px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">— Reassign to a team member —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
              </select>
              <select
                value={bulkAssigneeRole}
                onChange={(e) => setBulkAssigneeRole(e.target.value)}
                disabled={!!bulkAssigneeId}
                className="w-full nm-tile px-3 py-2 text-sm focus:outline-none disabled:opacity-40"
              >
                <option value="">...or to a whole team {bulkAssigneeId ? "(member selected)" : ""}</option>
                {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setBulkReassignOpen(false)}
                  disabled={bulkBusy}
                  className="nm-tile px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-40"
                >Cancel</button>
                <button
                  type="button"
                  disabled={bulkBusy || (!bulkAssigneeId && !bulkAssigneeRole)}
                  onClick={async () => {
                    setBulkBusy(true);
                    try {
                      const patch = bulkAssigneeId
                        ? { assignee_id: bulkAssigneeId, assignee_role: null }
                        : { assignee_id: null, assignee_role: bulkAssigneeRole };
                      const ids = Array.from(selected);
                      await Promise.all(ids.map((id) => api.patch(`/tasks/${id}`, patch)));
                      const label = bulkAssigneeId
                        ? (members.find((m) => m.id === bulkAssigneeId)?.name || "member")
                        : `${bulkAssigneeRole} team`;
                      toast.success(`Reassigned ${ids.length} ${ids.length === 1 ? "task" : "tasks"} to ${label}`);
                      clearSelection();
                      setBulkReassignOpen(false);
                      refresh();
                    } catch (e) {
                      toast.error(e.response?.data?.detail || "Bulk reassign failed");
                    } finally { setBulkBusy(false); }
                  }}
                  className="kr-lift rounded-pill bg-kr-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                >{bulkBusy ? "Reassigning..." : "Reassign"}</button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      )}
    </div>
  );
}

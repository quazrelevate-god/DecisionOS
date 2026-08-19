import { useRef, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { timeAgo, fullTime } from "../lib/format";
import { PageHeader, Chip, EmptyState, SkeletonCard } from "../components/common";
import { useAuth } from "../context/AuthContext";
import { userPerms } from "../lib/perms";
import { opModel } from "../lib/operatingModel";
import { toast } from "sonner";
// WE-14 (2026-08-16): TaskBoard import retired -- the Board sub-tab
// under Workflows is gone. NewTaskDialog stays -- it is used by the
// New-task launcher.
import { NewTaskDialog } from "./Tasks";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import Workflows from "./Workflows";
import Leave from "./Leave";
import {
  CheckCircle, Camera, Microphone, Stop, ChatCircleText,
  Sparkle, Plus, Trash, ArrowUp, ArrowDown, Robot, PencilSimple, ListChecks, CaretDown, ArrowsOutSimple,
  ArrowBendUpRight, WarningCircle, ChatText, ArrowRight, Kanban, ListChecks as ListIcon,
  Paperclip, UserCircle, ShieldCheck, Tag, ClockCounterClockwise,
  ArrowClockwise, XCircle, LockKey, X, AirplaneTakeoff, MagnifyingGlassPlus, Eye,
  File, FileArrowUp, Lightbulb, Info,
  FlowArrow,  // WE-11 stage chip
} from "@phosphor-icons/react";

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
const SECTION_BTN = "flex h-10 items-center justify-center gap-1.5 rounded-pill px-4 text-xs font-medium leading-tight lg:text-sm";

const STATUS_OPTIONS = [
  { key: "todo", label: "Not Started" },
  { key: "in_progress", label: "In Progress" },
  { key: "waiting", label: "Waiting" },
  { key: "review", label: "Under Review" },
  { key: "done", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];
const STATUS_LABEL = {
  todo: "Not Started", in_progress: "In Progress", waiting: "Waiting",
  review: "Under Review", done: "Completed", cancelled: "Cancelled", blocked: "Pending Approval",
};
const PROGRESS_OPTIONS = [0, 25, 50, 75, 100];
const isTerminal = (t) => t.status === "done" || t.status === "cancelled";
const isOverdue = (t) => t.due_date && new Date(t.due_date) < new Date() && !isTerminal(t);

function UpdateForm({ taskId, stepId, members, roleOptions, onDone, onCancel }) {
  const [text, setText] = useState("");
  const [action, setAction] = useState("note");
  const [toId, setToId] = useState("");
  const [toRole, setToRole] = useState("");
  const [busy, setBusy] = useState(false);
  const inp = "w-full nm-field px-2.5 py-2 text-sm";

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

  const ACTIONS = [
    { key: "note", label: "Log note", icon: ChatText },
    { key: "handoff", label: "Hand off", icon: ArrowBendUpRight },
    { key: "escalate", label: "Escalate", icon: WarningCircle },
  ];

  return (
    <div className="nm-btn p-3 space-y-2 bg-nm-sunken/40" data-testid={`update-form-${taskId}`}>
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid={`update-text-${taskId}`}
        placeholder="What did you find? e.g. Logistics can't commit to a date — supplier issue" className={inp} />
      <div className="flex gap-1">
        {ACTIONS.map((a) => (
          <button key={a.key} onClick={() => setAction(a.key)} data-testid={`update-action-${a.key}-${taskId}`}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium nm-tile transition-colors ${action === a.key ? CTRL_ON : CTRL_OFF}`}>
            <a.icon size={13} weight="bold" /> {a.label}
          </button>
        ))}
      </div>
      {action === "handoff" && (
        <div className="space-y-2">
          <select className={inp} value={toId} onChange={(e) => setToId(e.target.value)} data-testid={`update-member-${taskId}`}>
            <option value="">— Hand off to a team member —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.role}</option>)}
          </select>
          <select className={inp} value={toRole} onChange={(e) => setToRole(e.target.value)} disabled={!!toId}>
            <option value="">…or to a whole team {toId ? "(member selected)" : ""}</option>
            {roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
      )}
      {action === "escalate" && <p className="text-xs text-muted-foreground">This will alert the owner and create a follow-up for them.</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} data-testid={`update-submit-${taskId}`}
          className="kr-lift flex-1 rounded-pill bg-kr-ink py-2 text-xs font-medium text-white transition-all disabled:opacity-50">
          {busy ? "Posting…" : "Post"}
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-xs font-medium nm-btn hover:bg-accent">Cancel</button>
      </div>
    </div>
  );
}

const UPDATE_ICON = { note: ChatText, handoff: ArrowBendUpRight, escalate: WarningCircle };

function TaskTrail({ t, members, roleOptions, onChange }) {
  const [open, setOpen] = useState(false);
  const updates = t.updates || [];
  const hasUpdates = updates.length > 0;
  // U7-05.EXP: when there is no activity, the heavy "ACTIVITY &
  // HANDOFFS" header + right-aligned button read as an empty section
  // to fill. Softer treatment when empty: single line with the action
  // inline. Full section header only when there's actual activity to
  // frame.
  return (
    <div className="mt-4 border-t border-nm-edge/40 pt-4" data-testid={`task-trail-${t.id}`}>
      {hasUpdates ? (
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm">
            <ChatCircleText size={16} weight="bold" aria-hidden="true" className="text-muted-foreground" /> Activity &amp; Handoffs
          </span>
          {!open && (
            <button onClick={() => setOpen(true)} data-testid={`add-update-${t.id}`}
              className="flex items-center gap-1 text-xs font-medium nm-btn px-2 py-1 hover:bg-accent transition-colors">
              <Plus size={12} weight="bold" /> Update / Escalate
            </button>
          )}
        </div>
      ) : (
        !open && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="label-mono text-muted-foreground flex items-center gap-1.5">
              <ChatCircleText size={12} weight="bold" /> No activity yet
            </span>
            <button onClick={() => setOpen(true)} data-testid={`add-update-${t.id}`}
              className="flex items-center gap-1 text-xs font-medium hover:underline">
              <Plus size={12} weight="bold" /> Log update or hand off
            </button>
          </div>
        )
      )}
      {updates.length > 0 && (
        <ul className="space-y-2 mb-2" data-testid={`trail-list-${t.id}`}>
          {updates.map((u) => {
            const Icon = UPDATE_ICON[u.kind] || ChatText;
            return (
              <li key={u.id} className="flex items-start gap-2 nm-tile p-2.5">
                <Icon size={15} weight="bold" className={`mt-0.5 shrink-0 ${u.kind === "escalate" ? "text-kr-accent" : "text-muted-foreground"}`} />
                <div className="min-w-0 flex-1">
                  {u.step_text && <p className="label-mono text-muted-foreground">On: {u.step_text}</p>}
                  <p className="text-sm">{u.text}</p>
                  <p className="label-mono text-muted-foreground mt-1">
                    {u.author_name}
                    {u.to_name && <> <ArrowRight size={10} weight="bold" className="inline" /> {u.to_name}</>}
                    {" · "}{new Date(u.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <UpdateForm taskId={t.id} stepId={null} members={members} roleOptions={roleOptions}
          onDone={() => { setOpen(false); onChange(); }} onCancel={() => setOpen(false)} />
      )}
    </div>
  );
}

function ExecutionPlan({ t, onChange, members = [], roleOptions = [] }) {
  const plan = t.execution_plan;
  const [steps, setSteps] = useState(plan?.steps || []);
  const [editing, setEditing] = useState(!plan || plan.status === "draft");
  const [busy, setBusy] = useState(false);
  const [newStep, setNewStep] = useState("");
  const [ask, setAsk] = useState({});
  const [updStep, setUpdStep] = useState(null);
  const [viewStep, setViewStep] = useState(null);

  useEffect(() => {
    setSteps(t.execution_plan?.steps || []);
    setEditing(!t.execution_plan || t.execution_plan.status === "draft");
  }, [t.execution_plan?.updated_at, t.execution_plan?.status]);

  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tasks/${t.id}/execution-plan/generate`);
      setSteps(data.execution_plan.steps);
      setEditing(true);
      toast.success("AI drafted an execution plan — review & customize");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not generate plan"); }
    finally { setBusy(false); }
  };

  const startManual = () => {
    setSteps([{ id: `new-${Date.now()}`, text: "", done: false }]);
    setEditing(true);
  };

  const cancelAIPlan = async () => {
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
  const moveStep = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const ns = [...steps];
    [ns[i], ns[j]] = [ns[j], ns[i]];
    setSteps(ns);
  };
  const addStep = () => {
    if (!newStep.trim()) return;
    setSteps([...steps, { id: `new-${Date.now()}`, text: newStep.trim(), done: false }]);
    setNewStep("");
  };

  const askAI = async (s) => {
    setAsk((a) => ({ ...a, [s.id]: { loading: true } }));
    try {
      const { data } = await api.post(`/tasks/${t.id}/steps/ask`, { step_text: s.text });
      setAsk((a) => ({ ...a, [s.id]: { data } }));
    } catch { setAsk((a) => ({ ...a, [s.id]: { error: true } })); }
  };

  const inp = "flex-1 nm-field px-2.5 py-2 text-sm";

  if (!plan && !steps.length) {
    // U7-05.EXP polish (2026-08-17): was two big dashed boxes taking
    // full-width equal weight. When there is no plan yet, most tasks
    // never need one -- so a whole visual band for the empty state was
    // noise. Now: single one-line prompt with two small pill buttons
    // ("Ask Dex" is the primary; manual is the escape hatch). Reads as
    // an offer, not an unfilled requirement.
    return (
      <div className="mt-4 flex items-center gap-2 flex-wrap" data-testid={`exec-plan-empty-${t.id}`}>
        <span className="label-mono text-muted-foreground">Break this into steps?</span>
        <button onClick={generate} disabled={busy} data-testid={`generate-plan-${t.id}`}
          className="nm-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium disabled:opacity-50">
          <Sparkle size={13} weight="bold" /> {busy ? "Thinking…" : "Ask Dex"}
        </button>
        <button onClick={startManual} disabled={busy} data-testid={`manual-plan-${t.id}`}
          className="inline-flex items-center gap-1.5 nm-btn px-3 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
          <PencilSimple size={13} weight="bold" /> Add manually
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-nm-edge/40 pt-4" data-testid={`exec-plan-${t.id}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-2 font-heading font-medium tracking-tight text-sm">
          <ListChecks size={16} weight="bold" aria-hidden="true" className="text-muted-foreground" /> AI Execution Guide
        </span>
        <span className="label-mono" data-testid={`exec-progress-${t.id}`}>{progress}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill nm-inset mb-3">
        <div className="h-full rounded-pill bg-foreground/70 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={s.id} data-testid={`exec-step-${t.id}-${i}`}>
            <div className={editing ? "flex flex-col sm:flex-row sm:items-start gap-2" : "flex items-start gap-2"}>
              {editing ? (
                <>
                  <textarea value={s.text} onChange={(e) => editStep(i, e.target.value)} rows={2}
                    className={`${inp} w-full resize-y leading-snug`} />
                  <div className="flex gap-1 shrink-0 self-end sm:self-start">
                    <button onClick={() => setViewStep(s)} data-testid={`exec-expand-${t.id}-${i}`} className="p-2 sm:p-1 nm-btn hover:bg-accent" title="View full"><ArrowsOutSimple size={14} weight="bold" /></button>
                    <button onClick={() => moveStep(i, -1)} className="p-2 sm:p-1 nm-btn hover:bg-accent" title="Up"><ArrowUp size={14} weight="bold" /></button>
                    <button onClick={() => moveStep(i, 1)} className="p-2 sm:p-1 nm-btn hover:bg-accent" title="Down"><ArrowDown size={14} weight="bold" /></button>
                    <button onClick={() => removeStep(i)} data-testid={`exec-remove-${t.id}-${i}`} className="p-2 sm:p-1 nm-tile hover:bg-kr-accent hover:text-white" title="Remove"><Trash size={14} weight="bold" /></button>
                  </div>
                </>
              ) : (
                <>
                  <button onClick={() => toggle(i)} data-testid={`exec-toggle-${t.id}-${i}`}
                    className={`w-5 h-5 shrink-0 mt-0.5 nm-tile flex items-center justify-center ${s.done ? "bg-kr-ink text-white" : "bg-nm"}`}>
                    {s.done && <CheckCircle size={13} weight="bold" />}
                  </button>
                  <button onClick={() => setViewStep(s)} data-testid={`exec-view-${t.id}-${i}`}
                    className={`text-sm flex-1 min-w-0 text-left break-words hover:underline decoration-dotted ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.text}</button>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => askAI(s)} data-testid={`exec-ask-${t.id}-${i}`}
                      className="flex items-center gap-1 text-xs font-medium nm-btn px-2 py-1 hover:bg-accent transition-colors">
                      <Sparkle size={12} weight="bold" /> Ask AI
                    </button>
                    <button onClick={() => setUpdStep(updStep === s.id ? null : s.id)} data-testid={`exec-update-${t.id}-${i}`}
                      className="flex items-center gap-1 text-xs font-medium nm-btn px-2 py-1 hover:bg-accent transition-colors">
                      <ArrowBendUpRight size={12} weight="bold" /> Update
                    </button>
                  </div>
                </>
              )}
            </div>
            {updStep === s.id && (
              <div className="ml-7 mt-1.5 mb-2" data-testid={`exec-update-form-${t.id}-${i}`}>
                <UpdateForm taskId={t.id} stepId={s.id} members={members} roleOptions={roleOptions}
                  onDone={() => { setUpdStep(null); onChange(); }} onCancel={() => setUpdStep(null)} />
              </div>
            )}
            {ask[s.id] && (
              <div className="ml-7 mt-1.5 mb-2 nm-tile bg-nm-sunken p-2.5 text-xs" data-testid={`exec-ask-result-${t.id}-${i}`}>
                {ask[s.id].loading ? <p className="font-mono">AI is thinking…</p>
                  : ask[s.id].error ? <p className="text-kr-accent">Couldn't fetch a suggestion.</p>
                  : (
                    <>
                      <p className="flex items-start gap-1.5"><Robot size={13} weight="bold" className="text-brand-blue mt-0.5 shrink-0" /><span>{ask[s.id].data.suggestion}</span></p>
                      {(ask[s.id].data.objections || []).length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          <p className="label-mono text-muted-foreground">If they push back:</p>
                          {ask[s.id].data.objections.map((o, k) => (
                            <p key={`${o.objection}-${k}`}><span className="font-semibold">“{o.objection}”</span> — {o.response}</p>
                          ))}
                        </div>
                      )}
                      <button onClick={() => setAsk((a) => ({ ...a, [s.id]: undefined }))} className="mt-2 label-mono underline">dismiss</button>
                    </>
                  )}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="flex gap-2 mt-3">
          <input value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addStep()}
            placeholder="Add your own step…" data-testid={`exec-newstep-${t.id}`} className={inp} />
          <button onClick={addStep} data-testid={`exec-add-${t.id}`} className="px-3 nm-tile hover:bg-accent"><Plus size={14} weight="bold" /></button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-4">
        {editing ? (
          <>
            <button onClick={() => save("accepted")} disabled={busy} data-testid={`exec-accept-${t.id}`}
              className="kr-lift flex min-w-[140px] flex-1 items-center justify-center gap-2 rounded-pill bg-kr-ink py-2.5 text-sm font-medium text-white transition-all disabled:opacity-50">
              <CheckCircle size={16} weight="bold" /> Accept plan
            </button>
            <button onClick={generate} disabled={busy} data-testid={`exec-regenerate-${t.id}`}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium nm-btn hover:bg-accent transition-colors disabled:opacity-50">
              <ArrowClockwise size={15} weight="bold" /> Regenerate
            </button>
            <button onClick={cancelAIPlan} disabled={busy} data-testid={`exec-cancel-plan-${t.id}`}
              className="nm-btn flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50">
              <XCircle size={15} weight="bold" /> Cancel plan
            </button>
          </>
        ) : (
          t.status !== "done" && (
            <button onClick={() => setEditing(true)} data-testid={`exec-edit-${t.id}`}
              className="flex items-center gap-2 text-sm font-medium nm-btn px-4 py-2 hover:bg-accent transition-colors">
              <PencilSimple size={15} weight="bold" /> Customize steps
            </button>
          )
        )}
      </div>

      <Dialog open={!!viewStep} onOpenChange={(o) => !o && setViewStep(null)}>
        <DialogContent className="rounded-cardlg border border-nm-edge/40">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight text-base flex items-center gap-2"><ListChecks size={18} weight="bold" aria-hidden="true" className="text-muted-foreground" /> Execution Step</DialogTitle>
          </DialogHeader>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words" data-testid={`exec-step-detail-${t.id}`}>{viewStep?.text}</p>
          <p className="label-mono text-muted-foreground mt-1">Tap outside to close</p>
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
      <button
        type="button"
        onClick={openReassign}
        disabled={busy}
        className="inline-flex items-center gap-1.5 bg-nm px-3 py-1.5 text-xs font-medium nm-btn hover:bg-accent disabled:opacity-40"
        data-testid="bulk-reassign"
      >
        <ArrowBendUpRight size={13} weight="bold" />
        Reassign
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
        data-testid="bulk-clear"
      >
        <X size={12} weight="bold" /> Clear
      </button>
    </div>
  );
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
 * `tier` ("high" | "medium" | "low") scales the title only. The founder's
 * rule: bigger for high, smaller after, but "don't reduce too much" — so the
 * floor is 14px, not 12.
 */
function TaskCard({ t, onChange, members = [], roleOptions = [], scores, showAssignee = false, highlight = false, selected = false, onToggleSelect, open, onToggleOpen, tier }) {
  const { user } = useAuth();
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
  const controlled = open !== undefined;
  const expanded = controlled ? open : selfExpanded;
  const setExpanded = controlled ? () => onToggleOpen?.() : setSelfExpanded;
  // U7-05 polish: replaced window.prompt() for reject + clarify with real
  // dialogs -- prompt is anti-pattern that blocks browser thread and
  // returns null in embed contexts (FUP-49 hit this pattern for confirm).
  const [reasonDialog, setReasonDialog] = useState(null); // {kind: 'reject'|'clarify'}
  const [reasonText, setReasonText] = useState("");
  const [reasonBusy, setReasonBusy] = useState(false);
  const fileRef = useRef(null);
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
      await api.patch(`/tasks/${t.id}`, { status: "done" });
      toast.success("Task completed — reopen from the card if needed.");
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not complete task"); }
  };

  const reopen = async () => {
    await api.patch(`/tasks/${t.id}`, { status: "in_progress", progress: 0 });
    toast.success("Task reopened — back in your work");
    onChange();
  };

  const setStatus = async (status) => {
    try {
      await api.patch(`/tasks/${t.id}`, { status });
      toast.success(`Status: ${STATUS_LABEL[status] || status}`);
      onChange();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not update status"); }
  };
  const setProgress = async (progress) => {
    await api.patch(`/tasks/${t.id}`, { progress: Number(progress) });
    onChange();
  };

  const isOp = t.task_type === "operational" || !!t.op_category;
  const selCls = "nm-field px-2 py-1 text-xs font-mono";

  return (
    /* KR-11.2 — the red left stripe is GONE on the founder's call ("don't
       copy the old red strip… just use the overdue pill, that's it"). The
       pill in the summary row below already says Overdue, and a full-height
       colour bar on every late card turned a grid of them into a barcode. */
    <div id={`task-card-${t.id}`} data-testid={`mywork-task-${t.id}`}
      data-open={expanded ? "true" : "false"}
      data-tier={tier || "medium"}
      className={`kr-bento flex h-full min-w-0 flex-col overflow-hidden ${highlight ? "ring-2 ring-kr-ink ring-offset-2 ring-offset-background" : ""}`}>
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">

      {/* U7-05.2: SUMMARY ROW -- the only thing shown when card is collapsed.
          Click-target on the whole row toggles expand. Right-side quick actions
          stopPropagation so they don't collapse when clicked. */}
      <div className={`group flex w-full flex-1 items-stretch transition-colors ${selected ? "bg-kr-ink/[0.05]" : ""}`}>
        {/* U7-05.3: bulk-select checkbox. Sits outside the expand button
            so clicking it doesn't toggle the card. Only rendered when
            onToggleSelect is passed (skip in TaskDetailDialog and other
            contexts where bulk doesn't apply). */}
        {onToggleSelect && (
          <label
            className="flex items-center px-3 pl-4 cursor-pointer shrink-0"
            onClick={(e) => e.stopPropagation()}
            title={selected ? "Deselect" : "Select for bulk action"}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              data-testid={`bulk-select-${t.id}`}
              className="w-4 h-4 rounded border-nm-edge/40 accent-kr-ink cursor-pointer"
              aria-label={`Select task ${t.title}`}
            />
          </label>
        )}
      <button
        type="button"
        onClick={() => (controlled ? onToggleOpen?.() : setSelfExpanded((v) => !v))}
        className="w-full flex-1 min-w-0 p-4 text-left"
        aria-expanded={expanded}
        aria-controls={`task-card-body-${t.id}`}
        data-testid={`task-summary-${t.id}`}
      >
        <div className="flex items-start gap-3">
          <CaretDown
            size={14}
            weight="bold"
            className={`text-muted-foreground shrink-0 mt-1 transition-transform ${expanded ? "" : "-rotate-90"}`}
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2 flex-wrap">
              <p className={`min-w-[180px] flex-1 font-heading font-bold leading-snug ${
                tier === "high" ? "text-lg xl:text-xl" : tier === "low" ? "text-sm" : "text-base"
              }`}>
                {t.title}
              </p>
              {/* KR-11.2 — the priority chip goes monochrome. The tile's
                  SIZE now says high/medium/low, so a red "High" beside it was
                  the same signal twice, and the louder of the two. It stays
                  as a word because size is a relative cue and a lone card in
                  a filtered view has nothing to be relative to. */}
              <span data-testid={`priority-chip-${t.id}`}
                className="shrink-0 rounded-pill border-[0.5px] border-kr-ink/55 px-2 py-0.5 text-[11px] font-medium capitalize text-foreground/70">
                {t.priority || "medium"}
              </span>
            </div>
            <div className="flex items-center flex-wrap gap-2 mt-1.5 text-xs">
              {/* Status pill -- muted when normal, red when overdue/rejected */}
              <span data-testid={`status-chip-${t.id}`}
                className={`px-2 py-0.5 font-medium border ${
                  terminal ? "bg-kr-ink text-white border-transparent"
                  : awaitingApproval ? "border-[0.5px] border-kr-ink text-foreground"
                  : "bg-nm-sunken text-muted-foreground border-nm-edge/40"
                }`}>{STATUS_LABEL[t.status] || t.status}</span>
              {overdue && !terminal && (
                <span data-testid={`overdue-${t.id}`}
                  className="rounded-pill bg-kr-accent px-2 py-0.5 font-medium text-white">
                  Overdue
                </span>
              )}
              {t.due_date && !overdue && (
                <span className="text-muted-foreground">
                  due {new Date(t.due_date).toLocaleString(undefined, { day: "numeric", month: "short" })}
                </span>
              )}
              {/* U7-05.1: stage chip becomes tiny inline pill in summary row.
                  Icon-first, no bg fight with the title. Click still works. */}
              {t.workflow_summary?.id && (
                <a
                  href={`/my-work?view=workflows&type=${encodeURIComponent(t.workflow_summary.type || "")}&focus=${encodeURIComponent(t.workflow_summary.id)}`}
                  onClick={(e) => e.stopPropagation()}
                  data-testid={`wf-chip-${t.id}`}
                  className="inline-flex items-center gap-1 hover:underline"
                  title={`Open workflow: ${t.workflow_summary.title}`}
                >
                  <FlowArrow size={11} weight="bold" />
                  <span className=" text-[10px]">
                    {(t.workflow_summary.stage || "").replace(/_/g, " ")}
                  </span>
                </a>
              )}
              {showAssignee && t.assignee_name && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <UserCircle size={11} weight="bold" /> {t.assignee_name}
                </span>
              )}
              {(t.attachment_count || 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Paperclip size={11} weight="bold" /> {t.attachment_count}
                </span>
              )}
              {t.source === "escalation" && <span className="rounded-pill bg-kr-accent px-1.5 py-0.5 text-[10px] font-medium text-white">Escalation</span>}
              {t.source === "handoff" && <span className="rounded-pill border-[0.5px] border-kr-ink/55 px-1.5 py-0.5 text-[10px] font-medium">Handoff</span>}
            </div>
          </div>
        </div>
      </button>
      </div>

      {/* EXPANDED BODY -- everything else lives here. Rendered only when open. */}
      {expanded && (
      <div id={`task-card-body-${t.id}`} className="px-4 pb-4 space-y-3 border-t border-nm-edge/40 pt-3">
      {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
      {showAssignee && !isOp && (
        <p className="label-mono text-muted-foreground flex items-center gap-1" data-testid={`assignee-line-${t.id}`}>
          <UserCircle size={13} weight="bold" />
          {t.assignee_name ? t.assignee_name : (t.assignee_role ? `${t.assignee_role} team` : "Unassigned")}
        </p>
      )}
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

      {/* U7-05.EXP polish (2026-08-17): one combined meta line
          replacing separate "Due X" and "Updated Y" rows. Also killed
          the "Full details" button -- opened a Dialog that duplicated
          this expanded body (dialog was needed BEFORE the collapse
          existed; not now). Owner delete moves to a small more-menu
          in the actions row below. */}
      {(t.due_date || t.updated_at) && (
        <p className="label-mono text-muted-foreground flex items-center gap-2 flex-wrap" data-testid={`task-meta-${t.id}`}>
          {t.due_date && (
            <span className="flex items-center gap-1">
              <ClockCounterClockwise size={12} weight="bold" />
              Due {new Date(t.due_date).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", ...(t.due_date.includes("T") ? { hour: "2-digit", minute: "2-digit" } : {}) })}
            </span>
          )}
          {t.due_date && t.updated_at && <span className="text-muted-foreground/50">·</span>}
          {t.updated_at && (
            <span
              className="flex items-center gap-1"
              data-testid={`task-updated-${t.id}`}
              title={fullTime(t.updated_at)}
            >
              {t.last_action || "Updated"} {timeAgo(t.updated_at)}
            </span>
          )}
        </p>
      )}

      {/* U7-05.EXP: progress bar without the redundant "0%" label +
          "Progress" caption. Bar visually conveys the value; a numeric
          label was pure noise. Status change drives progress, so the
          separate "Set progress" dropdown is gone too. */}
      {!terminal && !awaitingApproval && (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-pill nm-inset" title={`${t.progress || 0}% complete`} aria-label={`Progress: ${t.progress || 0}%`}>
            <div className="h-full rounded-pill bg-foreground/70 transition-all" style={{ width: `${t.progress || 0}%` }} data-testid={`progress-bar-${t.id}`} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="label-mono text-muted-foreground">Status</label>
            <select data-testid={`status-select-${t.id}`} value={t.status === "blocked" ? "todo" : t.status} onChange={(e) => setStatus(e.target.value)} className={selCls}>
              {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {/* U7-05.EXP: "Set progress" tucked behind a small toggle for
                the rare team that manages progress separately from status.
                Default hidden -- one less dropdown for the 95% of users. */}
            <details className="ml-1">
              <summary className="label-mono text-muted-foreground cursor-pointer hover:text-foreground">
                Set % manually
              </summary>
              <select data-testid={`progress-select-${t.id}`} value={PROGRESS_OPTIONS.includes(t.progress) ? t.progress : 0} onChange={(e) => setProgress(e.target.value)} className={`${selCls} mt-1`}>
                {PROGRESS_OPTIONS.map((p) => <option key={p} value={p}>{p}%</option>)}
              </select>
            </details>
          </div>
        </div>
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

      {!isTerminal(t) && !awaitingApproval && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {/* FUP-49: don't disable -- always click-through, handler shows
              a clear toast if evidence is missing. Silent-disabled
              buttons were the original bug. */}
          <button onClick={complete} data-testid={`complete-${t.id}`}
            title={t.evidence_required && !hasEvidence ? "Add a photo, voice note, or file first" : "Mark as complete"}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium nm-btn transition-all ${t.evidence_required && !hasEvidence ? "bg-nm-sunken text-muted-foreground" : "bg-kr-ink text-white"}`}>
            <CheckCircle size={16} weight="bold" /> Complete
          </button>

          {/* U7-05.EXP: attach affordances grouped into one compact strip.
              Was 3 separate chunky buttons ("PHOTO / UPLOAD FILE / VOICE
              REPLY") each equal-weight to Complete -- density noise. Now
              they share a single caption + icon-only compact buttons so
              Complete stays visually primary and the attach set reads as
              one concept. */}
          <div className="flex items-center gap-1 border-l border-nm-edge/40 pl-3 ml-1">
            <span className="label-mono text-muted-foreground mr-1 hidden sm:inline">Attach:</span>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              data-testid={`photo-${t.id}`}
              title="Attach a photo"
              className="w-9 h-9 flex items-center justify-center nm-tile hover:bg-accent disabled:opacity-40"
              aria-label="Attach a photo"
            >
              <Camera size={16} weight="bold" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
            <button
              onClick={() => evidenceRef.current?.click()}
              disabled={uploading}
              data-testid={`upload-file-${t.id}`}
              title="Upload a file"
              className="w-9 h-9 flex items-center justify-center nm-tile hover:bg-accent disabled:opacity-40"
              aria-label="Upload a file"
            >
              <FileArrowUp size={16} weight="bold" />
            </button>
            <input ref={evidenceRef} type="file" className="hidden" onChange={onEvidence} />
            <button
              onClick={toggleVoice}
              data-testid={`voice-${t.id}`}
              title={recording ? "Stop and send voice reply" : "Record a voice reply"}
              className={`w-9 h-9 flex items-center justify-center nm-tile transition-colors ${recording ? "bg-kr-accent text-white" : "hover:bg-accent"}`}
              aria-label={recording ? "Stop recording" : "Record voice reply"}
            >
              {recording ? <Stop size={16} weight="fill" /> : <Microphone size={16} weight="bold" />}
            </button>
            {recording && (
              <button
                onClick={cancelVoice}
                data-testid={`voice-cancel-${t.id}`}
                title="Discard recording"
                className="w-9 h-9 flex items-center justify-center nm-tile hover:bg-accent"
                aria-label="Discard recording"
              >
                <X size={16} weight="bold" />
              </button>
            )}
          </div>
        </div>
      )}

      {isTerminal(t) && !awaitingApproval && (
        <div className="flex flex-wrap gap-2 mt-4" data-testid={`reopen-actions-${t.id}`}>
          <button onClick={reopen} data-testid={`reopen-${t.id}`} className="flex items-center gap-2 bg-nm px-4 py-2 text-sm font-medium nm-btn hover:bg-accent transition-colors">
            <ArrowClockwise size={16} weight="bold" /> Reopen
          </button>
          <span className="flex items-center text-xs text-muted-foreground">Completed by mistake? Reopen brings it back to your active work.</span>
        </div>
      )}

      {!awaitingApproval && <ExecutionPlan t={t} onChange={onChange} members={members} roleOptions={roleOptions} />}
      <TaskTrail t={t} onChange={onChange} members={members} roleOptions={roleOptions} />
      </div>
      )}

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

const TIER_SPAN = {
  high:   "col-span-6 lg:col-span-4",
  medium: "col-span-6 sm:col-span-3 lg:col-span-2",
  low:    "col-span-6 sm:col-span-3 lg:col-span-2",
};
/* KR-14.2 — 210/182/156 → 148/128/112. The tiles were sized for a card that
   does not exist: a task's summary is a title, a status chip and a meta row,
   which lands around 80px, so a third of every box was empty. The founder
   asked for spacious and got hollow.
   Measured on the way down: at 148 the ink sat with 46px of air above AND
   below it — the content is vertically centred, so every pixel of excess
   floor is paid twice. 128 leaves ~16px each side of a one-line card and
   still clears the tallest real content (a two-line title measures 94px)
   without clipping, because these are FLOORS — a tile grows if its card
   needs it.
   Ratios stay rectangular, the original ask: at 1280 a high tile is
   799 × 128 and a medium 391 × 128. */
const TIER_MINH = { high: "min-h-[128px]", medium: "min-h-[112px]", low: "min-h-[100px]" };

function TaskBento({ list, openId, setOpenId, cardProps }) {
  return (
    <div className="grid grid-flow-row-dense grid-cols-6 gap-4" data-testid="mywork-bento">
      {list.map((t) => {
        const tier = TIER_OF(t);
        const isOpen = openId === t.id;
        return (
          <div
            key={t.id}
            data-tier={tier}
            className={isOpen ? "col-span-6" : `${TIER_SPAN[tier]} ${TIER_MINH[tier]}`}
          >
            <TaskCard
              t={t}
              tier={tier}
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
   The ranker already sorts the whole list by score; splitting it by the
   priority band turns "a long sorted list" into "how much is on fire, how
   much is next, how much can wait" — which is the question the toggle is
   asked. Within a column the ranker's order is preserved.
   A tile opened here still takes its column's full width, so the same
   nothing-beside-it rule holds. */
const BANDS = [
  { key: "high", label: "High priority" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

function TaskPriorityColumns({ list, openId, setOpenId, cardProps }) {
  const grouped = BANDS.map((b) => ({ ...b, items: list.filter((t) => TIER_OF(t) === b.key) }));
  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="mywork-priority-columns">
      {grouped.map((col) => (
        <section key={col.key} data-testid={`priority-col-${col.key}`} className="min-w-0">
          <div className="mb-3 flex items-baseline gap-2">
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
                  tier={col.key}
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

export default function MyWork() {
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
  const [params] = useSearchParams();
  const isOwner = user?.role === "owner";
  const focusTaskId = params.get("task");
  const rawView = params.get("view");
  // "board" is no longer a top-level view — it now lives as a sub-tab inside Workflows.
  const initialView = rawView === "board" ? "workflows"
    : (rawView === "workflows" ? "workflows" : rawView === "leave" ? "leave" : "mywork");
  const [view, setView] = useState(focusTaskId ? "mywork" : initialView);
  // KR-11.2 — which tile is expanded. Lifted out of TaskCard so the grid can
  // give it the whole row; see TaskBento. Seeded from ?task= so a deep link
  // still lands on an opened card.
  const [openId, setOpenId] = useState(focusTaskId || null);
  // WE-14 (2026-08-16): wfTab state retired -- Board sub-tab is gone,
  // only the pipelines view remains. Retained a no-op reference to
  // rawView so eslint's no-unused-vars doesn't fire on line above.
  void rawView;
  const canSeeWorkflows = isOwner || userPerms(user).includes("workflows");
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
  const [scope, setScope] = useState(loadedPrefs.scope || "mine");
  const [tab, setTab] = useState(loadedPrefs.tab || "all");
  const [aiPriority, setAiPriority] = useState(Boolean(loadedPrefs.aiPriority));

  // Persist on any change. Guard on prefsKey so pre-login / test envs stay
  // no-op.
  useEffect(() => {
    if (!prefsKey) return;
    try {
      localStorage.setItem(prefsKey, JSON.stringify({ scope, tab, aiPriority }));
    } catch { /* quota; ignore */ }
  }, [prefsKey, scope, tab, aiPriority]);

  // U7-05.3: bulk selection. Set of task ids across the currently-visible
  // list. Cleared when the tab / scope / view changes so a stale selection
  // can't apply to a different filter's tasks.
  const [selected, setSelected] = useState(() => new Set());
  useEffect(() => { setSelected(new Set()); }, [scope, tab, view]);
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
  const mine = !(isOwner && scope === "all");
  const showAssignee = isOwner && scope === "all";
  const tasksQ = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data) });
  const focusQ = useQuery({
    queryKey: ["task", focusTaskId],
    queryFn: () => api.get(`/tasks/${focusTaskId}`).then((r) => r.data),
    enabled: !!focusTaskId, retry: false,
  });
  const focusDenied = !!focusTaskId && focusQ.isError && [403, 404].includes(focusQ.error?.response?.status);
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const prioritiesQ = useQuery({ queryKey: ["priorities"], queryFn: () => api.post("/tasks/prioritize").then((r) => r.data), enabled: aiPriority });
  const members = usersQ.data || [];
  const roleOptions = [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  useEffect(() => {
    if (!focusTaskId || !focusQ.data) return;
    const ft = focusQ.data;
    setView("mywork");
    if (isOwner && ft.assignee_id !== user?.id && scope !== "all") { setScope("all"); return; }
    setTab(isTerminal(ft) ? "completed" : "all");
    const timer = setTimeout(() => {
      document.getElementById(`task-card-${focusTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 400);
    return () => clearTimeout(timer);
  }, [focusTaskId, focusQ.data, scope]);

  // Epic 2 Sprint 6.5 (E2-51): When Desk Trends deep-links here with
  // ?filter=overdue|completed, an owner should see ALL tenant tasks
  // (the Desk counter is tenant-wide). Auto-flip scope=all so the list
  // isn't empty just because none of them are the owner's own todos.
  useEffect(() => {
    const f = params.get("filter");
    if (f && isOwner && scope !== "all") setScope("all");
    if (f === "completed") setTab("completed");
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
  const scoring = aiPriority && prioritiesQ.isFetching && !prioritiesQ.data;

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

  let list;
  if (urlFilter === "overdue") {
    list = all.filter((t) => !isTerminal(t) && isOverdue(t));
  } else if (urlFilter === "completed" || tab === "completed") {
    list = all.filter(isTerminal);
  } else if (tab === "all") {
    list = all.filter((t) => !isTerminal(t));
  } else {
    list = all.filter((t) => !isTerminal(t) && t.task_type === tab);
  }
  if (aiPriority && tab !== "completed") {
    list = [...list].sort((a, b) => (scoreMap[b.id]?.priority_score || 0) - (scoreMap[a.id]?.priority_score || 0));
  }

  return (
    <div>
      <header className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("mywork.eyebrow")}</p>
          <h1 className="mt-1.5 font-display text-3xl sm:text-4xl">{t("mywork.title")}</h1>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-auto lg:flex-row lg:items-center" data-testid="mywork-controls">
          <div className="order-2 flex flex-wrap items-center gap-2.5 lg:order-1" data-testid="mywork-actions">
            <NewTaskDialog onCreated={refresh} roleOptions={roleOptions} members={members}
              triggerClassName={`${SECTION_BTN} kr-lift bg-kr-ink text-white`} />
            {/* THE CLUSTER. My Tasks and All Tasks are joined by GEOMETRY —
                touching, outer corners round, inner corners square, a
                hairline on the seam. No track, no fill, no tint, per the
                founder. AI Priority sits with them as a circle: a third lens
                on the same list, close enough to read as one group, round
                enough not to read as a third tab. */}
            {isOwner && (
                <div className="flex items-center gap-2" role="group" aria-label="Task view" data-testid="mywork-lens-group">
                  <div className="flex items-center">
                    <button onClick={() => { setScope("mine"); setView("mywork"); }} data-testid="work-scope-mine"
                      aria-pressed={view === "mywork" && scope === "mine" && !aiPriority}
                      className={`${SEG} rounded-l-pill ${view === "mywork" && scope === "mine" && !aiPriority ? SEG_ON : SEG_OFF}`}>
                      {t("mywork.my_tasks")}
                    </button>
                    <span aria-hidden="true" className="h-6 w-px shrink-0 bg-kr-ink/15" />
                    <button onClick={() => { setScope("all"); setView("mywork"); }} data-testid="work-scope-all"
                      aria-pressed={view === "mywork" && scope === "all" && !aiPriority}
                      className={`${SEG} rounded-r-pill ${view === "mywork" && scope === "all" && !aiPriority ? SEG_ON : SEG_OFF}`}>
                      {t("mywork.all_tasks")}
                    </button>
                  </div>

                  {/* KR-11.6 — AI Priority is a circle now, and it lives INSIDE
                      this cluster. It is a third lens on the same list, so it
                      belongs with the other two; the circle is what keeps it
                      from reading as a third tab. Icon-only, so it carries a
                      real label and a title for anything not looking at it.
                      Ink, not accent — the founder's call, and it also stops
                      the toolbar's only red from sitting next to the overdue
                      pills it has nothing to do with. */}
                  <button onClick={() => { setAiPriority((v) => !v); setView("mywork"); }} data-testid="ai-priority-toggle"
                    aria-pressed={view === "mywork" && aiPriority}
                    aria-label={aiPriority ? t("mywork.ai_priority_on") : t("mywork.ai_priority")}
                    title={scoring ? t("mywork.scoring") : aiPriority ? t("mywork.ai_priority_on") : t("mywork.ai_priority")}
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground ${
                      view === "mywork" && aiPriority ? "kr-pressed" : "kr-pop"
                    }`}>
                    <Sparkle size={16} weight={view === "mywork" && aiPriority ? "fill" : "bold"} aria-hidden="true"
                      className={scoring ? "animate-pulse" : ""} />
                  </button>
                </div>
            )}
          </div>
          <div className="order-1 flex flex-wrap items-center gap-2.5 lg:order-2" data-testid="work-view-toggle">
            {/* U7-05.11 (2026-08-17): 'Tasks' view toggle removed for
                owner. The MY TASKS / ALL TASKS / AI PRIORITY buttons
                already route back to view=mywork on click, so Tasks
                sat unused next to Workflows and Leave. Non-owners keep
                it because they don't have MY TASKS / ALL TASKS -- it's
                their only path back to the task list from Workflows
                or Leave. Founder ask: 'remove the Tasks got it .. lets
                have only the my tasks, all tasks, ai priority,
                workflow and leave'. */}
            {!isOwner && (
              <button onClick={() => setView("mywork")} data-testid="work-view-mywork"
                aria-pressed={view === "mywork"}
                className={`${SECTION_BTN} ${view === "mywork" ? "kr-pressed font-semibold" : "kr-pop text-foreground/75"}`}>
                <ListIcon size={15} weight="regular" aria-hidden="true" /> {t("mywork.view_mywork")}
              </button>
            )}
            {/* Workflows — the one control that NEVER changes depth. Held
                pressed in BOTH states on the founder's call, so colour alone
                carries selection: brown at rest, ink when you are in it.
                Everything else in this row moves between raised and sunken,
                which is what lets a permanently-sunken button read as a
                place rather than a toggle. */}
            {canSeeWorkflows && (
              <button onClick={() => setView("workflows")} data-testid="work-view-workflows"
                aria-pressed={view === "workflows"}
                className={`${SECTION_BTN} kr-pressed ${
                  view === "workflows" ? "font-semibold text-foreground" : "text-kr-brown"
                }`}>
                <FlowArrow size={16} weight="bold" aria-hidden="true" /> {t("mywork.view_workflows")}
              </button>
            )}
            <button onClick={() => setView("leave")} data-testid="work-view-leave"
              aria-pressed={view === "leave"}
              className={`${SECTION_BTN} ${view === "leave" ? "kr-pressed font-semibold" : "kr-pop text-foreground/75"}`}>
              <AirplaneTakeoff size={15} weight="regular" aria-hidden="true" /> {t("mywork.view_leave")}
            </button>
          </div>
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

      {view === "workflows" && canSeeWorkflows ? (
        // WE-14 (2026-08-16): "Board" sub-tab retired. The pipelines
        // view now carries inline task lists per card (WE-12), so a
        // separate role-lane kanban was a redundant lens on the same
        // data. Any /my-work?view=workflows&wf_tab=board deep link
        // now silently lands on the pipelines view -- the wf_tab
        // param is intentionally ignored below.
        <div data-testid="workflows-hub">
          <Workflows embedded />
        </div>
      ) : view === "leave" ? (
        <Leave embedded />
      ) : (
      <div data-testid="mywork-list">
        <div>
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
          <div className="mb-5 flex flex-wrap gap-2 border-b border-nm-edge/40 pb-4" data-testid="work-tabs">
            {WORK_TABS
              .filter((tb) => tb.key === "all" || countFor(tb.key) > 0)
              .map((tb) => (
                <button key={tb.key} onClick={() => setTab(tb.key)} data-testid={`work-tab-${tb.key}`}
                  aria-pressed={tab === tb.key}
                  className={`flex h-8 items-center gap-1.5 rounded-pill border-[0.5px] pl-3 pr-2 text-xs transition-colors ${tab === tb.key ? "border-kr-ink font-medium text-foreground" : "border-kr-ink/55 text-foreground/65 hover:text-foreground/85"}`}>
                  {tb.label}
                  <span className="min-w-[17px] rounded-pill px-1 py-0.5 text-center font-mono text-[10px] leading-none tabular-nums opacity-65">{countFor(tb.key)}</span>
                </button>
              ))}
          </div>
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
          {!tasksQ.isLoading && list.length === 0 && (
            <EmptyState
              testid="mywork-empty"
              title={tab === "completed" ? t("mywork.empty_completed_title") : t("mywork.empty_title")}
              hint={tab === "all" ? t("mywork.empty_all_hint") : t("mywork.empty_cat_hint")}
              ctaLabel={tab === "completed" ? null : "+ Open Decision Desk"}
              ctaTo={tab === "completed" ? null : "/inbox"}
              secondary={tab === "completed" ? null : "Tasks appear here once decisions are approved"}
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
              scores: aiPriority && tab !== "completed" ? scoreMap[t.id] : undefined,
              selected: selected.has(t.id),
              onToggleSelect: () => toggleSelected(t.id),
            });
            const shared = { list, openId, setOpenId, cardProps };
            return aiPriority && tab !== "completed"
              ? <TaskPriorityColumns {...shared} />
              : <TaskBento {...shared} />;
          })()}

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

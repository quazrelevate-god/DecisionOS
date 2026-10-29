/* DexReview — step 3 of a Dex capture on the phone: what Dex made, to approve.
 *
 * WHERE THIS COMES FROM. The founder, 2026-10-29, with four reference screens
 * (and "don't use any blue theme… these are our own design colour palettes"):
 * the review is three screens you walk, not one long scroll.
 *
 *   Review & approve   the decision on a card with its priority, four counts
 *                      (tasks, people, dates set, approvals), the execution
 *                      timeline, the key settings, and Approve / Save as draft
 *                      / Reject pinned at the foot.
 *   Tasks created      every task as a numbered step on one line: who does it
 *                      (face, name, team), its tags, its priority and its date
 *                      — "No date yet — set one" where Dex heard none — and
 *                      Add another task.
 *   One task           who, the priority, the details, tags, due date,
 *                      approval, proof, priority again as the segmented bar,
 *                      what it waits for, and what has happened to it.
 *
 * EVERYTHING IS SAVED ON THE PROPOSAL AS IT IS CHANGED — PATCH
 * /decisions/:id/proposal/tasks/:key, the same calls DecisionPanel makes — so
 * nothing exists until Approve, and whoever approves sees what was set. The
 * desktop keeps DecisionPanel's two-column review; this is the phone's.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft, CalendarBlank, Camera, CaretDown, CaretRight, Check, CheckCircle, Flag, LinkSimple,
  ListChecks, Plus, SealCheck, Tag, Trash, UserCircle, UserPlus, Users, WarningCircle, X,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { userPerms } from "../../lib/perms";
import { canAssignPerson } from "../../lib/taskAccess";
import { deptName } from "../../lib/departments";
import { timeAgo } from "../../lib/format";
import { readyLine } from "../../lib/dexOutcome";
import { isDraft as readDraft, subscribeDrafts, draftOverrides, settleDraft, saveAsDraft } from "../../lib/decisionDrafts";
import { GlassSelect } from "../../components/neuglass/GlassSelect";
import { ScopeSlider } from "../../components/neuglass/ScopeSlider";
import { PersonAvatar } from "../../components/neuglass/PersonAvatar";
import { LeftoverReview } from "../../components/workflow/LeftoverReview";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  CHIP, DRAWER_FIELD, GLASS_MENU, GLASS_MENU_ITEM, GLASS_MENU_LABEL, GLASS_PILL, INK_PILL, INK_PLATE,
  MAROON_PILL, QUIET_CHIP,
} from "../../components/neuglass/glass";
import { cn } from "../../lib/utils";

/* The priority's own hues — the same three the priority bar's thumb wears
   (index.css .ng-prio-thumb--*): green, amber, red. Never the app's blue. */
const PRIO = {
  high: { label: "High", chip: "bg-[hsl(4_85%_94%)] text-[hsl(4_62%_38%)] ring-[hsl(4_70%_80%/0.7)]" },
  medium: { label: "Medium", chip: "bg-[hsl(40_90%_91%)] text-[hsl(30_70%_30%)] ring-[hsl(40_80%_70%/0.6)]" },
  low: { label: "Low", chip: "bg-[hsl(150_45%_93%)] text-[hsl(152_45%_26%)] ring-[hsl(150_40%_70%/0.6)]" },
};
const PRIO_KEYS = ["low", "medium", "high"];
const prioOf = (r) => (PRIO[r?.priority] ? r.priority : "medium");

const CARD = "rounded-[1.5rem] bg-white/85 ring-1 ring-inset ring-white shadow-[0_12px_30px_-18px_hsl(0_0%_10%/0.32)]";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500";
const NEEDS = "bg-[hsl(40_90%_92%)] text-[hsl(30_70%_30%)] ring-[hsl(40_80%_70%/0.6)]";
const FOOT = "shrink-0 border-t border-slate-900/[0.06] px-5 pt-3 pb-[calc(0.75rem+var(--sa-bottom))]";
const footBtn = "flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30 disabled:opacity-60";

const shortDay = (iso) => (iso
  ? new Date(`${String(iso).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
  : "");
const apprOf = (r) => (r?.approval_required ? (r.approval_stage === "close" ? "close" : "start") : "none");
const APPR_COPY = { none: "Not needed", start: "Before work starts", close: "When it's done" };

function PrioChip({ p, className }) {
  return (
    <span className={cn(CHIP, "h-7 px-2.5 text-[12px] font-semibold", PRIO[p].chip, className)}>
      <Flag size={11} weight="fill" aria-hidden="true" /> {PRIO[p].label}
    </span>
  );
}

/* Priority as a chip that opens the app's glass list — never an OS picker. */
function PrioMenu({ value, onChange, disabled, testid, label = "Priority" }) {
  if (disabled) return <PrioChip p={value} />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" data-testid={testid} aria-label={`${label}: ${PRIO[value].label}`}
          className={cn(CHIP, "h-9 gap-1.5 px-3 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/30", PRIO[value].chip)}>
          <Flag size={12} weight="fill" aria-hidden="true" /> {PRIO[value].label}
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className={cn(GLASS_MENU, "min-w-[11rem] p-1.5")}>
        <DropdownMenuLabel className={GLASS_MENU_LABEL}>{label}</DropdownMenuLabel>
        {[...PRIO_KEYS].reverse().map((k) => (
          <DropdownMenuItem key={k} onSelect={() => k !== value && onChange(k)} className={GLASS_MENU_ITEM}
            data-testid={testid ? `${testid}-${k}` : undefined}>
            <span className={cn("h-2.5 w-2.5 rounded-full ring-1 ring-inset", PRIO[k].chip)} aria-hidden="true" />
            {PRIO[k].label}
            {k === value && <Check size={14} weight="bold" aria-hidden="true" className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* A setting that is on or off, the whole row being the control (a 32px switch
   alone would be under the touch floor once the phone's 0.8 lands). */
function SwitchRow({ icon: Icon, title, sub, checked, onChange, disabled, testid }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} data-testid={testid}
      onClick={() => onChange(!checked)}
      className="flex min-h-[4.25rem] w-full items-center gap-3.5 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/25 disabled:opacity-60">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900/[0.05] text-slate-700">
        <Icon size={18} weight="bold" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-slate-900">{title}</span>
        {sub && <span className="mt-0.5 block text-[13px] leading-snug text-slate-500">{sub}</span>}
      </span>
      <span aria-hidden="true"
        className={cn("relative h-8 w-[3.25rem] shrink-0 rounded-full transition-colors duration-200",
          checked ? INK_PLATE : "bg-slate-900/[0.12]")}>
        <span className={cn("absolute left-1 top-1 h-6 w-6 rounded-full bg-white shadow-[0_2px_6px_hsl(0_0%_0%/0.28)] transition-transform duration-200",
          checked && "translate-x-5")} />
      </span>
    </button>
  );
}

/* Who does a task: the face (or an empty dashed circle), the name, the team. */
function Who({ t, face, tenant, size = 44 }) {
  const team = t.assignee_role ? `${deptName(tenant, t.assignee_role)} team` : "";
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {t.assignee_id
        ? <PersonAvatar name={t.assignee_name} src={face(t.assignee_id)} size={size} ring={false} />
        : (
          <span style={{ width: size, height: size }}
            className="grid shrink-0 place-items-center rounded-full border-2 border-dashed border-[hsl(40_70%_60%)] text-[hsl(30_70%_34%)]">
            <UserPlus size={18} weight="bold" aria-hidden="true" />
          </span>
        )}
      <span className="min-w-0">
        <span className={cn("block truncate text-[15px] font-semibold", t.assignee_id ? "text-slate-900" : "text-[hsl(30_70%_30%)]")}>
          {t.assignee_name || "Pick who does this"}
        </span>
        <span className="block truncate text-[13px] text-slate-500">{team || (t.assignee_id ? "Doing this task" : "Nobody yet")}</span>
      </span>
    </span>
  );
}

/* A short line of text, saved when the field is left (or Enter, for one line). */
/* `wrap` — one line of meaning that may need two lines of room (a long title):
   a field that grows, where Enter still means "done" rather than a new line. */
function SavedField({ value, onSave, multiline = false, wrap = false, placeholder, className, testid, label, disabled }) {
  const [draft, setDraft] = useState(value || "");
  const focused = useRef(false);
  const ref = useRef(null);
  useEffect(() => { if (!focused.current) setDraft(value || ""); }, [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el || el.tagName !== "TEXTAREA") return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const commit = () => {
    focused.current = false;
    const next = multiline ? draft.trim() : draft.replace(/\s+/g, " ").trim();
    if (next === (value || "").trim()) return;
    if (!multiline && !next) { setDraft(value || ""); return; }
    onSave(next);
  };
  const Field = multiline || wrap ? "textarea" : "input";
  return (
    <Field ref={ref} value={draft} disabled={disabled} aria-label={label} data-testid={testid} placeholder={placeholder}
      rows={multiline ? 2 : wrap ? 1 : undefined}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      className={cn(DRAWER_FIELD, (multiline || wrap) && "resize-none overflow-hidden leading-snug", className)} />
  );
}

const DEPTH = { overview: 0, tasks: 1, task: 2 };

/**
 * @param {string}   decisionId
 * @param {boolean}  open
 * @param {Function} onClose       the pop-up goes away
 * @param {Function} onSaveDraft   PILOT-2 B — the capture's own Save as draft
 * @param {Function} onTitle       ({ title, hint }) — what the pop-up's header says
 */
export function DexReview({ decisionId, open = true, onClose, onSaveDraft = null, onTitle }) {
  const qc = useQueryClient();
  const { user, tenant } = useAuth();
  const reduced = useReducedMotion();
  const [view, setView] = useState({ name: "overview" });
  const [dir, setDir] = useState(1);
  const go = (next) => { setDir(DEPTH[next.name] >= DEPTH[view.name] ? 1 : -1); setView(next); };
  const [confirmReject, setConfirmReject] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [opt, setOpt] = useState({});           // a setting on its way to the server
  const [leftChoices, setLeftChoices] = useState({});
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saidOpen, setSaidOpen] = useState(false);
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo?.({ top: 0 }); }, [view]);

  const { data: d, isError, refetch } = useQuery({
    queryKey: ["decision", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}`).then((r) => r.data),
    enabled: !!decisionId && open,
    retry: false,
  });
  const membersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), enabled: !!open });
  const canDecide = d?.status === "pending" || d?.status === "pending_approval";
  const movesQ = useQuery({
    queryKey: ["decision-moves", decisionId],
    queryFn: () => api.get(`/decisions/${decisionId}/moves`).then((r) => r.data),
    enabled: !!decisionId && open && !!canDecide,
  });
  const [draftMarks, setDraftMarks] = useState(draftOverrides);
  useEffect(() => subscribeDrafts(setDraftMarks), []);

  const members = membersQ.data || [];
  const face = (id) => members.find((m) => m.id === id)?.avatar_url;
  const proposal = d?.proposal || null;
  const proposing = canDecide && !!proposal;
  const rows = useMemo(() => (proposing ? (proposal.tasks || []) : (d?.tasks || [])), [proposing, proposal, d]);
  const mayDecide = canDecide && userPerms(user).includes("decisions_approve")
    && (user?.role === "owner" || d?.approver_id === user?.id
      || (!!d?.approver_id && (user?._acting_for || []).includes(d.approver_id))
      || !d?.approver_id);
  const editable = proposing && mayDecide;
  const isDraft = canDecide && readDraft(d, draftMarks);
  const leftMoves = (Array.isArray(movesQ.data) ? movesQ.data : []).filter((m) => (m.tasks || []).length > 0);
  const extras = proposing ? [
    ...(proposal.workflows || []).map((w) => ({ key: w.key, kind: "workflows",
      label: w.mode === "existing" ? `${w.pipeline_label || "Workflow"}: ${w.title}` : `New ${w.pipeline_label || "workflow"}: ${w.title}` })),
    ...(proposal.meetings || []).map((m) => ({ key: m.key, kind: "meetings", label: `Meeting: ${m.title}` })),
    ...(proposal.reminders || []).map((r) => ({ key: r.key, kind: "reminders", label: `Reminder: ${r.title}` })),
    ...(proposal.memory_notes || []).map((n) => ({ key: n.key, kind: "memory_notes", label: `Company note: ${n.text}` })),
  ] : [];

  const people = members.filter((m) => canAssignPerson(user, m))
    .map((m) => ({ value: m.id, label: m.id === user?.id ? `${m.name} (you)` : m.name }));
  const doers = new Set(rows.map((r) => r.assignee_id).filter(Boolean));
  const approverChoices = members.filter((m) => m.role === "owner"
    || (userPerms(m).includes("approvals") && !doers.has(m.id)));

  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["decision", decisionId] }),
    qc.invalidateQueries({ queryKey: ["decisions"] }),
    qc.invalidateQueries({ queryKey: ["desk"] }),
    qc.invalidateQueries({ queryKey: ["desk-summary"] }),
  ]);
  const editTask = async (key, body) => {
    setEditBusy(true);
    try {
      await api.patch(`/decisions/${decisionId}/proposal/tasks/${key}`, body);
      await invalidate();
      return true;
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change it");
      return false;
    } finally { setEditBusy(false); }
  };
  /* A setting for every task at once (the overview's switches and priority). */
  const editAll = async (field, value, body) => {
    setOpt((o) => ({ ...o, [field]: value }));
    setEditBusy(true);
    try {
      for (const r of rows) {
        // eslint-disable-next-line no-await-in-loop
        await api.patch(`/decisions/${decisionId}/proposal/tasks/${r.key}`, body);
      }
      await invalidate();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not change it");
      await invalidate();
    } finally {
      setEditBusy(false);
      setOpt((o) => { const n = { ...o }; delete n[field]; return n; });
    }
  };
  const editWords = async (body) => {
    try { await api.patch(`/decisions/${decisionId}`, body); await invalidate(); }
    catch (e) { toast.error(e.response?.data?.detail || "Could not save those words"); }
  };
  const removeItem = async (kind, key) => {
    setEditBusy(true);
    try {
      await api.delete(`/decisions/${decisionId}/proposal/${kind}/${key}`);
      await invalidate();
      if (kind === "tasks") go({ name: "tasks" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove it");
    } finally { setEditBusy(false); }
  };
  const addTask = async () => {
    const title = newTitle.replace(/\s+/g, " ").trim();
    if (!title) return;
    setEditBusy(true);
    try {
      const { data } = await api.post(`/decisions/${decisionId}/proposal/tasks`, { title });
      qc.setQueryData(["decision", decisionId], data);
      await invalidate();
      setNewTitle("");
      setAdding(false);
      const added = (data?.proposal?.tasks || []).slice(-1)[0];
      if (added) go({ name: "task", key: added.key });   // straight in: who, and when
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not add it");
    } finally { setEditBusy(false); }
  };

  const draftM = useMutation({
    mutationFn: () => (onSaveDraft ? Promise.resolve(onSaveDraft(decisionId)) : saveAsDraft(decisionId)),
    onSuccess: () => { if (!onSaveDraft) { toast.success("Saved as a draft"); invalidate(); onClose?.(); } },
    onError: (e) => { if (!onSaveDraft) toast.error(e?.response?.data?.detail || "Couldn't save it as a draft"); },
  });
  const approveM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/approve`,
      Object.keys(leftChoices).length ? { resolutions: leftChoices } : undefined),
    onSuccess: (res) => {
      if (res?.data?.id === decisionId) qc.setQueryData(["decision", decisionId], (old) => ({ ...(old || {}), ...res.data }));
      const c = res?.data?.created_on_approval;
      const made = c ? [
        c.task_ids ? `${c.task_ids} task${c.task_ids === 1 ? "" : "s"}` : null,
        c.workflow_ids ? `${c.workflow_ids} workflow${c.workflow_ids === 1 ? "" : "s"}` : null,
      ].filter(Boolean) : [];
      toast.success(made.length ? `Approved — ${made.join(" and ")} created` : "Approved");
      settleDraft(decisionId);
      invalidate();
      qc.invalidateQueries({ queryKey: ["tasks"] });
      // The full-screen tick says it; the pop-up has done its job.
      onClose?.();
    },
    onError: (e) => { toast.error(e.response?.data?.detail || "Could not approve"); invalidate(); },
  });
  const rejectM = useMutation({
    mutationFn: () => api.post(`/decisions/${decisionId}/reject`),
    onSuccess: () => {
      toast.success(proposing ? "Rejected — nothing was created" : "Rejected");
      settleDraft(decisionId);
      invalidate();
      onClose?.();
    },
    onError: (e) => toast.error(e.response?.data?.detail || "Could not reject"),
  });
  const busy = approveM.isPending || rejectM.isPending || draftM.isPending;

  const task = view.name === "task" ? rows.find((r) => r.key === view.key) : null;
  const taskIndex = task ? rows.indexOf(task) : -1;
  useEffect(() => {
    // A task removed (here or by someone else) takes its screen with it.
    if (view.name === "task" && d && !task) setView({ name: "tasks" });
  }, [view, d, task]);

  const title = view.name === "tasks" ? "Tasks created by Dex"
    : view.name === "task" ? (taskIndex >= 0 ? `Task ${taskIndex + 1} of ${rows.length}` : "Task")
    : "Review & approve";
  const hint = view.name === "tasks" ? "Check who does each one and by when."
    : view.name === "task" ? "Every change is kept with the decision until you approve it."
    : "Nothing is created until you approve it.";
  useEffect(() => { onTitle?.({ title, hint }); }, [title, hint, onTitle]);

  if (isError) {
    return (
      <div className="min-h-0 flex-1 p-6" data-testid="decision-load-failed">
        <p className="text-lg font-semibold text-slate-900">Couldn&rsquo;t open this decision</p>
        <button type="button" onClick={() => refetch()} className={cn("mt-4 inline-flex h-11 items-center rounded-pill px-5 text-sm font-medium", INK_PILL)}>
          Try again
        </button>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="min-h-0 flex-1 animate-pulse space-y-4 p-5" aria-hidden="true" data-testid="decision-panel-loading">
        <div className="h-36 rounded-[1.5rem] bg-slate-200/70" />
        <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-slate-200/60" />)}</div>
        <div className="h-28 rounded-[1.5rem] bg-slate-200/60" />
      </div>
    );
  }

  /* ── the counts ───────────────────────────────────────────────────────── */
  const nPeople = new Set(rows.map((r) => r.assignee_id).filter(Boolean)).size;
  const nDated = rows.filter((r) => r.due_date).length;
  const nAppr = rows.filter((r) => r.approval_required).length;
  const nNeeds = rows.filter((r) => !r.assignee_id || !r.due_date).length;
  const allPrio = rows.length && new Set(rows.map(prioOf)).size === 1 ? prioOf(rows[0]) : "medium";
  const prio = opt.priority ?? allPrio;
  const allAppr = opt.approval ?? (rows.length > 0 && rows.every((r) => r.approval_required));
  const allProof = opt.proof ?? (rows.length > 0 && rows.every((r) => r.evidence_required));
  const lastDue = rows.map((r) => r.due_date).filter(Boolean).sort().slice(-1)[0];
  const raisedToday = d.created_at && new Date(d.created_at).toDateString() === new Date().toDateString();

  const kpis = [
    { key: "tasks", icon: ListChecks, n: rows.length, label: rows.length === 1 ? "Task" : "Tasks" },
    { key: "people", icon: Users, n: nPeople, label: nPeople === 1 ? "Person" : "People" },
    { key: "dates", icon: CalendarBlank, n: `${nDated}/${rows.length}`, label: "Dates set", warn: nDated < rows.length },
    { key: "approvals", icon: SealCheck, n: nAppr, label: nAppr === 1 ? "Approval" : "Approvals" },
  ];
  const timeline = [
    { top: raisedToday || !d.created_at ? "Today" : shortDay(d.created_at), bottom: "Create", state: "done" },
    { top: "Review", bottom: "Approval", state: canDecide ? "now" : "done" },
    { top: "Team", bottom: "Execution", state: canDecide ? "next" : "now" },
    { top: lastDue ? `By ${shortDay(lastDue)}` : "Completion", bottom: "Results", state: "next" },
  ];

  /* ── Review & approve ─────────────────────────────────────────────────── */
  const overview = (
    <div className="flex flex-col gap-4" data-testid="dex-review-overview">
      <p className="sr-only" data-testid="desk-dex-summary">{readyLine(d, user?.id)}</p>
      <section className={cn(CARD, "p-5")} data-testid="dex-review-decision">
        <div className="flex items-center justify-between gap-3">
          <span className={LABEL}>The decision</span>
          {rows.length > 0 && (
            <PrioMenu value={prio} disabled={!editable || editBusy} testid="dex-review-priority"
              label="Priority for every task"
              onChange={(v) => editAll("priority", v, { priority: v })} />
          )}
        </div>
        {editable
          ? <SavedField wrap value={d.title} label="The decision" testid="decision-title-edit"
              onSave={(v) => editWords({ title: v })}
              className="mt-3 bg-transparent px-0 py-0 text-[21px] font-semibold leading-snug tracking-tight text-slate-900 shadow-none ring-0 focus-visible:ring-0" />
          : <h3 className="mt-3 text-[21px] font-semibold leading-snug tracking-tight text-slate-900">{d.title}</h3>}
        {isDraft && <p className="mt-1 text-[13px] font-medium text-slate-500" data-testid="decision-draft-mark">Saved as a draft</p>}
        {editable
          ? <SavedField multiline value={d.summary || ""} label="What was decided" testid="decision-summary-edit"
              placeholder="Say what was decided" onSave={(v) => editWords({ summary: v })}
              className="mt-2 bg-transparent px-0 py-0 text-[15px] text-slate-600 shadow-none ring-0 focus-visible:ring-0" />
          : d.summary && <p className="mt-2 text-[15px] leading-relaxed text-slate-600">{d.summary}</p>}
        {canDecide && d.repeat_of && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-[hsl(40_90%_93%)] px-3.5 py-2.5 text-[13px] font-medium text-[hsl(30_70%_30%)]"
            data-testid="decision-repeat">
            <WarningCircle size={15} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
            Looks like a repeat of &ldquo;{d.repeat_of.title}&rdquo;, which is still waiting.
          </p>
        )}
      </section>

      <div className="grid grid-cols-4 gap-2" data-testid="dex-review-kpis">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <button key={k.key} type="button" onClick={() => rows.length && go({ name: "tasks" })}
              data-testid={`dex-review-kpi-${k.key}`}
              className={cn("flex min-w-0 flex-col items-start rounded-2xl px-2.5 pb-2.5 pt-2.5 text-left", GLASS_PILL)}>
              <Icon size={16} weight="bold" aria-hidden="true" className={k.warn ? "text-[hsl(30_75%_42%)]" : "text-slate-500"} />
              <span className="mt-2 font-display text-[22px] leading-none tabular-nums text-slate-900">{k.n}</span>
              <span className="mt-1 w-full truncate text-[11px] font-medium text-slate-500">{k.label}</span>
            </button>
          );
        })}
      </div>

      {rows.length > 0 && (
        <button type="button" onClick={() => go({ name: "tasks" })} data-testid="dex-review-open-tasks"
          className={cn(CARD, "flex w-full items-center gap-3.5 p-4 text-left")}>
          <span className="flex -space-x-2">
            {rows.slice(0, 3).map((r) => (r.assignee_id
              ? <PersonAvatar key={r.key || r.id} name={r.assignee_name} src={face(r.assignee_id)} size={34} />
              : <span key={r.key || r.id} className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white text-slate-400 ring-2 ring-white"><UserPlus size={15} weight="bold" aria-hidden="true" /></span>))}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-slate-900">Tasks created by Dex</span>
            <span className={cn("block text-[13px]", nNeeds ? "font-medium text-[hsl(30_70%_34%)]" : "text-slate-500")}>
              {nNeeds ? `${nNeeds} still need${nNeeds === 1 ? "s" : ""} a person or a date` : `${rows.length} ready — who and when are set`}
            </span>
          </span>
          <CaretRight size={16} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
        </button>
      )}

      <section className={cn(CARD, "p-5")} data-testid="dex-review-timeline">
        <p className={LABEL}>Execution timeline</p>
        <ol className="relative mt-5 grid grid-cols-4">
          <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-[0.9375rem] h-[2px] rounded-full bg-slate-900/10" />
          <span aria-hidden="true" className="absolute left-[12.5%] top-[0.9375rem] h-[2px] rounded-full bg-slate-900 transition-[width] duration-500"
            style={{ width: `${(canDecide ? 1 : 2) * 25}%` }} />
          {timeline.map((s, i) => (
            <li key={s.bottom} className="relative flex flex-col items-center text-center" data-state={s.state}>
              <span className={cn("relative grid h-[1.875rem] w-[1.875rem] place-items-center rounded-full",
                s.state === "done" ? cn(INK_PLATE, "text-white")
                  : s.state === "now" ? "bg-white ring-2 ring-slate-900"
                    : "bg-white ring-2 ring-slate-900/15")}>
                {s.state === "done" && <Check size={14} weight="bold" aria-hidden="true" />}
                {s.state === "now" && (
                  <>
                    {!reduced && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[hsl(var(--ng-gold)/0.45)]" />}
                    <span className="h-2.5 w-2.5 rounded-full bg-[hsl(var(--ng-gold))]" />
                  </>
                )}
                {s.state === "next" && <span className="text-[11px] font-semibold text-slate-400">{i + 1}</span>}
              </span>
              <span className="mt-2.5 max-w-full truncate px-0.5 text-[11px] text-slate-500">{s.top}</span>
              <span className={cn("text-[13px] font-semibold", s.state === "next" ? "text-slate-500" : "text-slate-900")}>{s.bottom}</span>
            </li>
          ))}
        </ol>
      </section>

      {rows.length > 0 && (
        <section className={cn(CARD, "overflow-hidden")} data-testid="dex-review-settings">
          <p className={cn(LABEL, "px-4 pb-1 pt-4")}>Key settings</p>
          <div className="divide-y divide-slate-900/[0.06]">
            <SwitchRow icon={SealCheck} title="Approval required" testid="dex-review-approval"
              sub={allAppr ? "Each task waits for a yes before work starts" : "Work starts as soon as this is approved"}
              checked={!!allAppr} disabled={!editable || editBusy}
              onChange={(v) => editAll("approval", v, v ? { approval_required: true, approval_stage: "start" } : { approval_required: false })} />
            <SwitchRow icon={Camera} title="Proof required" testid="dex-review-proof"
              sub="A photo, voice note or file before a task can be closed"
              checked={!!allProof} disabled={!editable || editBusy}
              onChange={(v) => editAll("proof", v, { evidence_required: v })} />
          </div>
        </section>
      )}

      {extras.length > 0 && (
        <section className={cn(CARD, "p-4")} data-testid="dex-review-extras">
          <p className={LABEL}>Also on approval</p>
          <ul className="mt-2 divide-y divide-slate-900/[0.06]">
            {extras.map((x) => (
              <li key={x.key} className="flex min-h-12 items-center gap-3 py-1.5" data-testid={`decision-timeline-extra-${x.key}`}>
                <LinkSimple size={15} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 text-[14px] text-slate-700">{x.label}</span>
                {editable && (
                  <button type="button" onClick={() => removeItem(x.kind, x.key)} disabled={editBusy}
                    aria-label={`Remove ${x.label}`} data-testid={`decision-extra-remove-${x.key}`}
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700">
                    <X size={14} weight="bold" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {mayDecide && leftMoves.length > 0 && (
        <section className={cn(CARD, "p-4")} data-testid="decision-leftover-card">
          <p className={LABEL}>Work these moves leave behind</p>
          <div className="mt-3 space-y-4">
            {leftMoves.map((m) => (
              <div key={m.workflow_id}>
                <p className="text-[14px] text-slate-700">
                  <span className="font-semibold">{m.title}</span> moves from {m.from_label} to {m.to_label}.
                </p>
                <div className="mt-2.5">
                  <LeftoverReview tasks={m.tasks} value={leftChoices} onChange={setLeftChoices}
                    toLabel={m.to_label} testid={`decision-leftover-review-${m.workflow_id}`} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {d.said?.text && (
        <button type="button" onClick={() => setSaidOpen((v) => !v)} aria-expanded={saidOpen}
          data-testid="decision-said-card" className={cn(CARD, "p-4 text-left")}>
          <span className="flex items-center justify-between">
            <span className={LABEL}>What you said</span>
            <CaretDown size={13} weight="bold" aria-hidden="true" className={cn("text-slate-400 transition-transform", saidOpen && "rotate-180")} />
          </span>
          <span className={cn("mt-2 block whitespace-pre-wrap text-[14px] leading-relaxed text-slate-600", !saidOpen && "line-clamp-2")}
            data-testid="decision-said">&ldquo;{d.said.text}&rdquo;</span>
        </button>
      )}
    </div>
  );

  /* ── Tasks created by Dex ─────────────────────────────────────────────── */
  const tasksList = (
    <div data-testid="dex-review-tasks">
      <ol className="flex flex-col">
        {rows.map((t, i) => {
          const p = prioOf(t);
          const after = (t.depends_on || []).map((k) => rows.findIndex((r) => r.key === k) + 1).filter(Boolean);
          return (
            <li key={t.key || t.id} className="flex gap-3" data-testid={`dex-review-task-row-${t.key || t.id}`}>
              <div className="flex w-8 shrink-0 flex-col items-center">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-semibold text-white", INK_PLATE)}>{i + 1}</span>
                {i < rows.length - 1 && <span aria-hidden="true" className="w-[2px] flex-1 rounded-full bg-slate-900/[0.12]" />}
              </div>
              <button type="button" onClick={() => go({ name: "task", key: t.key })} disabled={!t.key}
                className={cn(CARD, "mb-3 min-w-0 flex-1 p-4 text-left")}>
                <span className="flex items-center gap-2.5">
                  <Who t={t} face={face} tenant={tenant} size={40} />
                  <PrioChip p={p} />
                </span>
                <span className="mt-3 block text-[16px] font-semibold leading-snug text-slate-900">{t.title}</span>
                {(t.tags || []).length > 0 && (
                  <span className="mt-2 flex flex-wrap gap-1.5">
                    {t.tags.map((g) => <span key={g} className={cn(CHIP, QUIET_CHIP, "h-6 px-2.5 text-[12px]")}>{g}</span>)}
                  </span>
                )}
                <span className="mt-3 flex items-center gap-2 border-t border-slate-900/[0.06] pt-3">
                  <CalendarBlank size={15} weight="bold" aria-hidden="true" className={t.due_date ? "text-slate-500" : "text-[hsl(30_75%_42%)]"} />
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.due_date ? "text-slate-600" : "font-medium text-[hsl(30_70%_32%)]")}
                    data-testid={t.due_date ? undefined : `decision-task-no-date-${t.key}`}>
                    {t.due_date ? `Due ${shortDay(t.due_date)}` : "No date yet — set one"}
                    {after.length > 0 && <span className="text-slate-500"> · after {after.map((n) => `#${n}`).join(", ")}</span>}
                  </span>
                  <CaretRight size={15} weight="bold" aria-hidden="true" className="shrink-0 text-slate-400" />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {rows.length === 0 && (
        <p className={cn(CARD, "p-5 text-[14px] text-slate-600")}>No tasks in this decision yet.</p>
      )}
      {editable && (adding ? (
        <div className={cn(CARD, "ml-11 p-3")} data-testid="dex-review-add-task-form">
          <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={200}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } if (e.key === "Escape") setAdding(false); }}
            placeholder="What else needs doing?" aria-label="The new task" data-testid="dex-review-add-task-input"
            className={DRAWER_FIELD} />
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => { setAdding(false); setNewTitle(""); }}
              className={cn(footBtn, "h-12 text-slate-700", GLASS_PILL)}>Cancel</button>
            <button type="button" onClick={addTask} disabled={!newTitle.trim() || editBusy} data-testid="dex-review-add-task-save"
              className={cn(footBtn, "h-12", INK_PILL)}>Add task</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} data-testid="dex-review-add-task"
          className="ml-11 flex h-14 w-[calc(100%-2.75rem)] items-center justify-center gap-2 rounded-[1.25rem] border-2 border-dashed border-slate-900/15 text-[15px] font-medium text-slate-600 hover:bg-white/60">
          <Plus size={16} weight="bold" aria-hidden="true" /> Add another task
        </button>
      ))}
    </div>
  );

  /* ── One task ─────────────────────────────────────────────────────────── */
  const taskView = task ? (() => {
    const t = task;
    const ro = !editable || editBusy;
    const appr = apprOf(t);
    const others = rows.filter((r) => r.key !== t.key);
    const waits = (t.depends_on || []).map((k) => rows.find((r) => r.key === k)).filter(Boolean);
    const free = others.filter((r) => !(t.depends_on || []).includes(r.key));
    // Its own lines in the decision's history: "Changed before approval: <it> — …"
    // and "Added before approval: task “<it>”".
    const mentions = (label) => typeof label === "string"
      && (label.includes(`“${t.title}”`) || label.includes(`: ${t.title} —`));
    const words = (d.timeline || []).filter((e) => mentions(e.label));
    const tags = t.tags || [];
    return (
      <div className="flex flex-col gap-4" data-testid="dex-review-task">
        {/* Who does it, and its priority, on one line. The name IS the
            picker: one name on the card, with the caret saying it changes. */}
        <section className={cn(CARD, "p-4")} data-testid={`dex-review-task-who-${t.key}`}>
          {editable ? (
            <div className="flex items-center gap-3">
              {t.assignee_id
                ? <PersonAvatar name={t.assignee_name} src={face(t.assignee_id)} size={48} ring={false} />
                : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-dashed border-[hsl(40_70%_60%)] text-[hsl(30_70%_34%)]">
                    <UserPlus size={19} weight="bold" aria-hidden="true" />
                  </span>
                )}
              <div className="min-w-0 flex-1">
                <GlassSelect value={t.assignee_id || ""} disabled={ro} testid={`decision-task-person-${t.key}`}
                  ariaLabel={`Who does ${t.title}`} variant="field"
                  triggerClassName={cn("h-9 -ml-1 rounded-xl px-1 text-[16px] font-semibold hover:bg-slate-900/[0.04]",
                    t.assignee_id ? "text-slate-900" : "text-[hsl(30_70%_30%)]")}
                  placeholder="Pick who does this"
                  onChange={(v) => v && editTask(t.key, { assignee_id: v })}
                  options={people.some((p) => p.value === t.assignee_id) || !t.assignee_id
                    ? people : [{ value: t.assignee_id, label: t.assignee_name || "Current person" }, ...people]} />
                <p className="truncate text-[13px] text-slate-500">
                  {t.assignee_role ? `${deptName(tenant, t.assignee_role)} team` : t.assignee_id ? "Doing this task" : "Nobody yet"}
                </p>
              </div>
              <PrioMenu value={prioOf(t)} disabled={ro} testid={`dex-review-task-priority-${t.key}`}
                onChange={(v) => editTask(t.key, { priority: v })} />
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Who t={t} face={face} tenant={tenant} size={48} />
              <PrioChip p={prioOf(t)} />
            </div>
          )}
        </section>

        <section className={cn(CARD, "p-4")}>
          <p className={LABEL}>Task details</p>
          {editable ? (
            <>
              <SavedField wrap value={t.title} label="The task" testid={`decision-task-title-${t.key}`} disabled={ro}
                onSave={(v) => editTask(t.key, { title: v })} className="mt-2.5 font-semibold" />
              <SavedField multiline value={t.description || ""} label="Details" testid={`dex-review-task-details-${t.key}`}
                disabled={ro} placeholder={`What does ${t.assignee_name ? t.assignee_name.split(" ")[0] : "whoever does it"} need to know?`}
                onSave={(v) => editTask(t.key, { description: v })} className="mt-2.5" />
            </>
          ) : (
            <>
              <p className="mt-2.5 text-[16px] font-semibold text-slate-900">{t.title}</p>
              {t.description && <p className="mt-1.5 text-[14px] leading-relaxed text-slate-600">{t.description}</p>}
            </>
          )}

          <p className={cn(LABEL, "mt-5")}>Tags</p>
          <TagEditor tags={tags} disabled={ro} readOnly={!editable} testid={`dex-review-tags-${t.key}`}
            onChange={(next) => editTask(t.key, { tags: next })} />
        </section>

        <section className={cn(CARD, "overflow-hidden")}>
          <div className="divide-y divide-slate-900/[0.06]">
            <div className="flex min-h-[4.25rem] items-center gap-3.5 px-4 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900/[0.05] text-slate-700">
                <CalendarBlank size={18} weight="bold" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-medium text-slate-900">Due date</span>
              {editable ? (
                <span className={cn("relative flex h-10 items-center rounded-pill px-3.5 text-[14px] font-medium ring-1 ring-inset",
                  t.due_date ? cn("text-slate-800", GLASS_PILL) : NEEDS)}>
                  {t.due_date ? shortDay(t.due_date) : "Set a date"}
                  {/* The phone's own date wheel, over the pill: a date is not a dropdown. */}
                  <input type="date" value={(t.due_date || "").slice(0, 10)} disabled={ro}
                    onChange={(e) => editTask(t.key, { due_date: e.target.value })}
                    aria-label={`Due date for ${t.title}`} data-testid={`decision-task-due-${t.key}`}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                </span>
              ) : (
                <span className="text-[14px] text-slate-600">{t.due_date ? shortDay(t.due_date) : "No date"}</span>
              )}
            </div>
            <div className="flex min-h-[4.25rem] items-center gap-3.5 px-4 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900/[0.05] text-slate-700">
                <SealCheck size={18} weight="bold" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-medium text-slate-900">Approval</span>
              {editable ? (
                <div className="w-[11.5rem] shrink-0">
                  <GlassSelect value={appr} disabled={ro} testid={`dex-review-task-approval-${t.key}`} ariaLabel="When it needs approving"
                    align="end" triggerClassName="h-10 px-4 text-[14px]"
                    onChange={(k) => editTask(t.key, k === "none" ? { approval_required: false } : { approval_required: true, approval_stage: k })}
                    options={["none", "start", "close"].map((k) => ({ value: k, label: APPR_COPY[k] }))} />
                </div>
              ) : <span className="text-[14px] text-slate-600">{APPR_COPY[appr]}</span>}
            </div>
            {appr !== "none" && editable && (
              <div className="flex min-h-[4.25rem] items-center gap-3.5 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-slate-900/[0.05] text-slate-700">
                  <UserCircle size={18} weight="bold" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-medium text-slate-900">Approver</span>
                <div className="w-[11.5rem] shrink-0">
                  <GlassSelect value={t.approver_id || ""} disabled={ro} testid={`dex-review-task-approver-${t.key}`} ariaLabel="Who approves it"
                    align="end" triggerClassName="h-10 px-4 text-[14px]"
                    onChange={(v) => editTask(t.key, { approver_id: v })}
                    options={[{ value: "", label: "The usual approver" },
                      ...approverChoices.filter((m) => m.id !== t.assignee_id || m.role === "owner")
                        .map((m) => ({ value: m.id, label: `${m.name}${m.id === user?.id ? " (you)" : ""}` }))]} />
                </div>
              </div>
            )}
            <SwitchRow icon={Camera} title="Proof required" testid={`dex-review-task-proof-${t.key}`}
              sub="A photo, voice note or file before it can be closed"
              checked={!!t.evidence_required} disabled={ro}
              onChange={(v) => editTask(t.key, { evidence_required: v })} />
          </div>
        </section>

        <section className={cn(CARD, "p-4")}>
          <p className={cn(LABEL, "mb-2.5")}>Priority</p>
          <ScopeSlider fluid label="Priority" testid={`dex-review-task-prio-bar-${t.key}`}
            options={PRIO_KEYS.map((k) => ({ key: k, label: PRIO[k].label }))}
            value={prioOf(t)} thumbClassName={`ng-prio-thumb--${prioOf(t)}`}
            onChange={(v) => !ro && v !== prioOf(t) && editTask(t.key, { priority: v })} />
        </section>

        <section className={cn(CARD, "p-4")} data-testid={`dex-review-depends-${t.key}`}>
          <p className={LABEL}>Waits for</p>
          <p className="mt-1 text-[13px] text-slate-500">
            {waits.length ? "It starts when these are done." : "Nothing — it can start as soon as this is approved."}
          </p>
          {waits.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {waits.map((w) => (
                <li key={w.key} className="flex min-h-12 items-center gap-3 rounded-2xl bg-slate-900/[0.04] pl-3 pr-1">
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold text-white", INK_PLATE)}>
                    {rows.indexOf(w) + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-slate-800">{w.title}</span>
                  {editable && (
                    <button type="button" disabled={ro} aria-label={`Stop waiting for ${w.title}`}
                      onClick={() => editTask(t.key, { depends_on: (t.depends_on || []).filter((k) => k !== w.key) })}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700">
                      <X size={14} weight="bold" aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {editable && free.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={ro} data-testid={`dex-review-add-dependency-${t.key}`}
                  className={cn("mt-3 flex h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-medium text-slate-700", GLASS_PILL)}>
                  <Plus size={14} weight="bold" aria-hidden="true" /> Add dependency
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className={cn(GLASS_MENU, "w-[min(20rem,calc(100vw-3rem))] p-1.5")}>
                <DropdownMenuLabel className={GLASS_MENU_LABEL}>Starts after</DropdownMenuLabel>
                {free.map((r) => (
                  <DropdownMenuItem key={r.key} className={GLASS_MENU_ITEM}
                    onSelect={() => editTask(t.key, { depends_on: [...(t.depends_on || []), r.key] })}>
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-900/[0.07] text-[11px] font-semibold">{rows.indexOf(r) + 1}</span>
                    <span className="min-w-0 truncate">{r.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </section>

        {t.existing && (
          <section className={cn(CARD, "p-4")} data-testid={`decision-task-existing-${t.key}`}>
            <p className={LABEL}>Already on the board</p>
            <p className="mt-2 text-[14px] text-slate-700">&ldquo;{t.existing.title}&rdquo;
              {t.existing.assignee_name ? ` · ${t.existing.assignee_name}` : ""}</p>
            <p className="mt-1 text-[13px] text-slate-500">
              {t.use_existing ? "Approving gives that task this person and date — no second task." : "A second task will be added beside it."}
            </p>
            {editable && (
              <div className="mt-3 flex gap-2">
                {[[true, "Use that task", "use-existing"], [false, "Add as new", "add-new"]].map(([v, label, id]) => (
                  <button key={id} type="button" disabled={ro} aria-pressed={!!t.use_existing === v}
                    data-testid={`decision-task-${id}-${t.key}`}
                    onClick={() => !!t.use_existing !== v && editTask(t.key, { use_existing: v })}
                    className={cn("h-11 flex-1 rounded-pill px-3 text-[13px] font-semibold",
                      !!t.use_existing === v ? cn(INK_PILL) : cn("text-slate-700", GLASS_PILL))}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className={cn(CARD, "p-4")} data-testid={`dex-review-activity-${t.key}`}>
          <p className={LABEL}>Activity</p>
          <ol className="mt-3 space-y-3">
            <li className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--ng-gold))]" aria-hidden="true" />
              <span className="min-w-0 text-[14px] text-slate-700">
                {t.added_by_hand ? "Added by hand" : "Proposed by Dex"}
                <span className="block text-[12px] text-slate-500">{timeAgo(d.created_at)}</span>
              </span>
            </li>
            {words.slice(-5).map((e, i) => (
              <li key={`${e.ts}-${i}`} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-900/25" aria-hidden="true" />
                <span className="min-w-0 text-[14px] text-slate-700">
                  {String(e.label).replace(/^Changed before approval: [^—]+— /, "")}
                  <span className="block text-[12px] text-slate-500">{e.actor || "Someone"} · {timeAgo(e.ts)}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        {editable && (
          <RemoveTask title={t.title} disabled={ro} testid={`decision-task-remove-${t.key}`}
            onRemove={() => removeItem("tasks", t.key)} />
        )}
      </div>
    );
  })() : null;

  /* ── the foot, per screen ─────────────────────────────────────────────── */
  let foot;
  if (view.name === "overview") {
    foot = mayDecide ? (
      <div className={FOOT} data-testid="decision-panel-actions">
        {confirmReject && (
          <p className="mb-2.5 text-xs text-rose-700" data-testid="decision-reject-warning">
            {proposing ? "Nothing it proposes will be created." : "Tasks still waiting on it are cancelled; work already under way stays."}{" "}
            Press Confirm reject to go ahead, or Approve to change your mind.
          </p>
        )}
        {/* Approve is the one move forward, so it gets the row; the other two
            share the one under it — three across a 360px phone wrapped
            "Save as draft" onto two lines. */}
        <div className="flex flex-col gap-2" data-testid="decision-actions">
          <button type="button" onClick={() => approveM.mutate()} disabled={busy} data-testid="decision-approve"
            className={cn(footBtn, "w-full flex-none", INK_PILL)}>
            <CheckCircle size={17} weight="bold" aria-hidden="true" className="shrink-0" />
            {approveM.isPending ? "Approving…" : "Approve"}
          </button>
          <div className="flex gap-2">
            {!(isDraft && !onSaveDraft) && (
              <button type="button" onClick={() => draftM.mutate()} disabled={busy} data-testid="desk-dex-later"
                className={cn(footBtn, "h-12 whitespace-nowrap text-slate-800 hover:bg-white", GLASS_PILL)}>
                {draftM.isPending ? "Saving…" : "Save as draft"}
              </button>
            )}
            <button type="button" onClick={() => (confirmReject ? rejectM.mutate() : setConfirmReject(true))} disabled={busy}
              data-testid="decision-reject"
              className={cn(footBtn, "h-12 whitespace-nowrap", confirmReject ? MAROON_PILL : cn("text-slate-800 hover:bg-white", GLASS_PILL))}>
              {confirmReject ? (rejectM.isPending ? "Rejecting…" : "Confirm reject")
                : <><X size={15} weight="bold" aria-hidden="true" className="shrink-0" /> Reject</>}
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div className={cn(FOOT, "flex items-center justify-between gap-3")} data-testid="decision-panel-actions">
        <p className="min-w-0 text-sm text-slate-600" data-testid="decision-panel-status">
          {canDecide ? (d.approver_name ? `Waiting on ${d.approver_name}.` : "Waiting on an owner.")
            : d.status === "approved" ? "Approved." : d.status === "rejected" ? "Rejected." : "Decided."}
        </p>
        <button type="button" onClick={() => onClose?.()} data-testid="decision-panel-done"
          className={cn("flex h-12 shrink-0 items-center rounded-pill px-6 text-sm font-medium", INK_PILL)}>Done</button>
      </div>
    );
  } else if (view.name === "tasks") {
    foot = (
      <div className={cn(FOOT, "flex gap-2.5")}>
        <button type="button" onClick={() => go({ name: "overview" })} data-testid="dex-review-back"
          className={cn(footBtn, "text-slate-800 hover:bg-white", GLASS_PILL)}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" /> Back
        </button>
        <button type="button" onClick={() => go({ name: "overview" })} data-testid="dex-review-next"
          className={cn(footBtn, INK_PILL)}>
          Review &amp; approve <CaretRight size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    );
  } else {
    foot = (
      <div className={cn(FOOT, "flex gap-2.5")}>
        <button type="button" onClick={() => go({ name: "tasks" })} data-testid="dex-review-task-back"
          className={cn(footBtn, "text-slate-800 hover:bg-white", GLASS_PILL)}>
          <ArrowLeft size={16} weight="bold" aria-hidden="true" /> Back
        </button>
        <button type="button"
          /* Leaving the field is what saves it; the blur lands before this. */
          onClick={() => { document.activeElement?.blur?.(); go({ name: "tasks" }); }}
          data-testid="dex-review-task-done" className={cn(footBtn, INK_PILL)}>
          <Check size={16} weight="bold" aria-hidden="true" /> Done
        </button>
      </div>
    );
  }

  const screen = view.name === "tasks" ? tasksList : view.name === "task" ? taskView : overview;
  const viewKey = view.name === "task" ? `task-${view.key}` : view.name;
  return (
    <>
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4" data-testid="decision-panel-body">
        {/* One screen at a time: the old one slides out, then the new one in. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={viewKey}
            initial={reduced ? false : { opacity: 0, x: dir * 28 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: dir * -28, transition: { duration: 0.13, ease: [0.4, 0, 1, 1] } }}>
            {screen}
          </motion.div>
        </AnimatePresence>
      </div>
      {foot}
    </>
  );
}

function TagEditor({ tags, onChange, disabled, readOnly, testid }) {
  const [adding, setAdding] = useState(false);
  const [word, setWord] = useState("");
  const add = () => {
    const w = word.replace(/\s+/g, " ").trim().slice(0, 24);
    setWord("");
    setAdding(false);
    if (w && !tags.some((t) => t.toLowerCase() === w.toLowerCase())) onChange([...tags, w]);
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2" data-testid={testid}>
      {tags.map((g) => (
        <span key={g} className={cn(CHIP, QUIET_CHIP, "h-9 gap-1.5 pl-3 pr-1 text-[13px]")}>
          <Tag size={12} weight="bold" aria-hidden="true" /> {g}
          {!readOnly && (
            <button type="button" disabled={disabled} aria-label={`Remove the tag ${g}`}
              onClick={() => onChange(tags.filter((t) => t !== g))}
              className="grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700">
              <X size={11} weight="bold" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {tags.length === 0 && readOnly && <span className="text-[13px] text-slate-500">No tags</span>}
      {!readOnly && tags.length < 6 && (adding ? (
        <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} onBlur={add} maxLength={24}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { setWord(""); setAdding(false); } }}
          aria-label="New tag" placeholder="Tag" data-testid={`${testid}-input`}
          className="h-9 w-32 rounded-pill bg-white px-3.5 text-[13px] text-slate-800 ring-1 ring-inset ring-slate-900/15 focus:outline-none" />
      ) : (
        <button type="button" disabled={disabled} onClick={() => setAdding(true)} data-testid={`${testid}-add`}
          className="flex h-9 items-center gap-1.5 rounded-pill border border-dashed border-slate-900/20 px-3.5 text-[13px] font-medium text-slate-600 hover:bg-white">
          <Plus size={12} weight="bold" aria-hidden="true" /> Add tag
        </button>
      ))}
    </div>
  );
}

function RemoveTask({ title, onRemove, disabled, testid }) {
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" disabled={disabled} data-testid={testid}
      onClick={() => (armed ? onRemove() : setArmed(true))}
      aria-label={armed ? `Confirm: remove ${title}` : `Remove ${title}`}
      className={cn("flex h-12 items-center justify-center gap-2 rounded-pill text-[14px] font-medium",
        armed ? MAROON_PILL : "text-rose-700 hover:bg-white/70")}>
      <Trash size={15} weight="bold" aria-hidden="true" />
      {armed ? "Press again to remove it" : "Remove this task"}
    </button>
  );
}

export default DexReview;

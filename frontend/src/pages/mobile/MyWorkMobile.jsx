// MPWA-08 · /my-work — mobile.
//
// The largest mobile screen in the product, and the worst offender in the
// baseline audit: 7,803px tall at 390px (three times §5.2.7's limit), with 26
// native <select> elements sitting directly in the scroll path — so every flick
// past a task row was a coin flip between scrolling and opening a picker.
//
// The fix is the §5.2.6 card-plus-sheet shape: rows collapse to three lines, and
// every per-task action (status, progress, photo, file, voice reply, escalate,
// handoff) moves into the sheet the card opens. Three stacked filter rows
// collapse into one, with zero-count categories hidden.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ListChecks, ArrowRight, AirplaneTakeoff, Sparkle, CheckCircle, Paperclip, Briefcase, UsersThree,
  ChatText, WarningCircle, ArrowBendUpRight, Clock, CaretRight, Spinner, Alarm,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { userPerms } from "../../lib/perms";
import { opModel } from "../../lib/operatingModel";
import { inr } from "../../lib/format";
import { FocusView } from "../../components/mobile/FocusView";
import { Board, Queue, Strip, Pulse } from "../../components/mobile/blocks";
import {
  BottomSheet, SheetSelect, MobileCard, EmptyScreen, EmptyState, LandsGrid,
  ListSkeleton, StatusChip, openDex,
} from "../../components/mobile";

const STATUS_OPTIONS = [
  { value: "todo", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting", label: "Waiting", hint: "Blocked on someone else" },
  { value: "review", label: "Under review" },
  { value: "done", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const PROGRESS_OPTIONS = [0, 25, 50, 75, 100].map((n) => ({ value: String(n), label: `${n}%` }));

const isTerminal = (t) => t.status === "done" || t.status === "cancelled";
const chipFor = (t) => {
  if (t.status === "done") return "completed";
  if (t.status === "cancelled") return "rejected";
  if (t.status === "blocked") return "directive";
  if (t.due_date && new Date(t.due_date) < new Date()) return "overdue";
  return "pending";
};

// §5.4: "Tasks tab: stays a Queue, grouped Today / This week / Later with
// section counts."
//
// Overdue folds into Today rather than getting a fourth group: it is work he owes
// now, and the row's own status chip already says it is late. A separate Overdue
// column would say the same thing twice and push Today below the fold.
const ymd = (d) => d.toISOString().slice(0, 10);
function bucketFor(task, today = new Date()) {
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null;
  if (!due) return "later";
  const t = ymd(today);
  if (due <= t) return "today";
  const week = new Date(today);
  // "This week" is the next seven days, not calendar-week-to-date — on a Friday
  // the latter would be a two-day bucket and everything real would fall to Later.
  week.setDate(week.getDate() + 7);
  return due <= ymd(week) ? "week" : "later";
}
// Today gets the block's full 5 rows; the two lower buckets show 3 behind their
// own "See all". Not a cosmetic cap — with busy data the three full queues ran
// 2,553px, past §5.2.7's ceiling, and the rows he is not acting on today were
// what pushed it there.
const GROUPS = [
  { key: "today", label: "Today", max: 5 },
  { key: "week", label: "This week", max: 3 },
  { key: "later", label: "Later", max: 3 },
];

const VIEWS = [
  { key: "mywork", label: "Tasks", icon: ListChecks },
  { key: "workflows", label: "Workflows", icon: ArrowRight, perm: "workflows" },
  { key: "leave", label: "Leave", icon: AirplaneTakeoff },
];

// ---------------------------------------------------------------------------
// Per-task sheet — everything that used to be crammed onto the card.
// ---------------------------------------------------------------------------
function TaskSheet({ task, open, onClose, onChanged, members, roleOptions }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [action, setAction] = useState("note");
  const [target, setTarget] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    if (open) {
      setNote("");
      setAction("note");
      setTarget("");
    }
  }, [open, task?.id]);

  if (!task) return null;
  const awaitingApproval = task.status === "blocked";

  const patch = async (body, msg) => {
    setBusy(true);
    try {
      await api.patch(`/tasks/${task.id}`, body);
      if (msg) toast.success(msg);
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    if (task.evidence_required && !(task.attachments || []).length) {
      // §5.4: say what to do, not which rule fired.
      toast.error("This one needs proof first — add a photo, voice note or file.");
      return;
    }
    await patch({ status: "done" }, "Marked complete");
    onClose();
  };

  const sendUpdate = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/updates`, {
        text: note.trim(),
        action,
        ...(action !== "note" && target ? { to_id: target } : {}),
      });
      toast.success(
        { note: "Note added", handoff: "Handed over", escalate: "Escalated" }[action] || "Sent"
      );
      setNote("");
      onChanged();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send that");
    } finally {
      setBusy(false);
    }
  };

  const attach = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/attachment`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Added as proof");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not attach that");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const decide = async (verb) => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/${verb}`);
      toast.success(verb === "approve" ? "Approved" : "Sent back");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  const people = [
    ...(members || []).map((m) => ({ value: m.id, label: m.name, hint: m.role })),
    ...(roleOptions || []).map((r) => ({ value: `role:${r.key}`, label: `Anyone in ${r.label}` })),
  ];

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="tall"
      title={task.title}
      description={[
        STATUS_LABEL[task.status] || task.status,
        task.assignee_name ? `with ${task.assignee_name}` : null,
      ].filter(Boolean).join(" · ")}
      data-testid="task-sheet"
      footer={
        awaitingApproval ? (
          <div className="flex gap-touch-gap">
            <button
              type="button" onClick={() => decide("approve")} disabled={busy}
              data-testid="task-approve"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              <CheckCircle size={20} weight="bold" /> Approve
            </button>
            <button
              type="button" onClick={() => decide("reject")} disabled={busy}
              data-testid="task-reject"
              className="rounded-xl border border-border px-5 text-base font-semibold disabled:opacity-50"
              style={{ minHeight: "var(--control-h-lg)" }}
            >
              Send back
            </button>
          </div>
        ) : isTerminal(task) ? (
          <button
            type="button"
            onClick={() => patch({ status: "in_progress", progress: 0 }, "Reopened")}
            disabled={busy}
            data-testid="task-reopen"
            className="w-full rounded-xl border border-border text-base font-semibold disabled:opacity-50"
            style={{ minHeight: "var(--control-h-md)" }}
          >
            Reopen
          </button>
        ) : (
          <button
            type="button" onClick={complete} disabled={busy}
            data-testid="task-complete"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground disabled:opacity-50"
            style={{ minHeight: "var(--control-h-lg)" }}
          >
            {busy ? <Spinner size={20} className="animate-spin" /> : <CheckCircle size={20} weight="bold" />}
            Mark complete
          </button>
        )
      }
    >
      {task.amount > 0 && (
        <p className="font-heading text-2xl font-bold tabular-nums" data-testid="task-amount">
          {inr(task.amount)}
        </p>
      )}
      {task.description && <p className="mt-2 text-sm leading-relaxed">{task.description}</p>}

      {!isTerminal(task) && !awaitingApproval && (
        <div className="mt-4 space-y-3">
          {/* §5.2.5: SheetSelect, not a native picker — these used to sit in the
              scroll path, 26 of them, and every flick was a gamble. */}
          <div>
            <p className="mb-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
              Status
            </p>
            <SheetSelect
              label="Status"
              value={task.status}
              options={STATUS_OPTIONS}
              onChange={(e) => patch({ status: e.target.value }, `Status: ${STATUS_LABEL[e.target.value]}`)}
              data-testid="task-status-select"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
              Progress
            </p>
            <SheetSelect
              label="Progress"
              value={String(task.progress ?? 0)}
              options={PROGRESS_OPTIONS}
              onChange={(e) => patch({ progress: Number(e.target.value) }, `Progress: ${e.target.value}%`)}
              data-testid="task-progress-select"
            />
          </div>
        </div>
      )}

      {/* Proof + updates */}
      {!isTerminal(task) && !awaitingApproval && (
        <div className="mt-5">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            Add an update
          </p>
          <div className="mt-2">
            <SheetSelect
              label="Kind of update"
              value={action}
              options={[
                { value: "note", label: "Just a note" },
                { value: "handoff", label: "Hand it to someone" },
                { value: "escalate", label: "Escalate it" },
              ]}
              onChange={(e) => setAction(e.target.value)}
              data-testid="task-update-kind"
            />
          </div>
          {action !== "note" && (
            <div className="mt-2">
              <SheetSelect
                label="To whom"
                value={target}
                placeholder="Choose a person"
                options={people}
                onChange={(e) => setTarget(e.target.value)}
                data-testid="task-update-target"
              />
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="task-update-text"
            aria-label="Update text"
            rows={3}
            placeholder="What's happening?"
            className="mt-2 w-full rounded-xl border border-input bg-card p-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-2 flex gap-touch-gap">
            <input
              type="file" ref={fileRef} hidden onChange={attach}
              accept="image/*,audio/*,application/pdf,.doc,.docx"
            />
            <button
              type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              data-testid="task-attach"
              aria-label="Attach a photo, voice note or file"
              className="grid shrink-0 place-items-center rounded-xl border border-border disabled:opacity-50"
              style={{ minHeight: "var(--control-h-base)", minWidth: "var(--control-h-base)" }}
            >
              <Paperclip size={20} weight="bold" />
            </button>
            <button
              type="button" onClick={sendUpdate} disabled={busy || !note.trim()}
              data-testid="task-update-send"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-foreground text-base font-semibold text-background disabled:opacity-50"
              style={{ minHeight: "var(--control-h-base)" }}
            >
              {action === "escalate" ? <WarningCircle size={18} weight="bold" />
                : action === "handoff" ? <ArrowBendUpRight size={18} weight="bold" />
                : <ChatText size={18} weight="bold" />}
              Send
            </button>
          </div>
        </div>
      )}

      {/* Trail */}
      {(task.updates || []).length > 0 && (
        <div className="mt-5">
          <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
            History
          </p>
          <ul className="mt-2 space-y-2">
            {(task.updates || []).slice().reverse().map((u, i) => (
              <li key={u.id || i} className="rounded-xl border border-border bg-card p-3">
                <p className="text-[length:var(--text-label)] font-semibold leading-4 text-muted-foreground">
                  {{ note: "Note", handoff: "Handed over", escalate: "Escalated" }[u.action] || "Update"}
                </p>
                <p className="mt-1 text-sm">{u.note || u.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(task.attachments || []).length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Paperclip size={16} weight="bold" />
          {task.attachments.length} piece{task.attachments.length === 1 ? "" : "s"} of proof attached
        </p>
      )}
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Swipeable row. §5.5: swipe-left must NOT destroy — left snoozes to tomorrow,
// right opens. Dismiss lives inside the sheet.
// ---------------------------------------------------------------------------
function SwipeRow({ onSnooze, onOpen, children, testid }) {
  const start = useRef(null);
  const [dx, setDx] = useState(0);
  const THRESHOLD = 72;

  const end = () => {
    const moved = dx;
    setDx(0);
    start.current = null;
    if (moved <= -THRESHOLD) onSnooze();
    else if (moved >= THRESHOLD) onOpen();
  };

  return (
    <div className="relative overflow-hidden rounded-xl" data-testid={testid}>
      {dx < -8 && (
        <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-center rounded-xl bg-caution-100 text-caution-800">
          <span className="flex flex-col items-center gap-0.5">
            <Alarm size={20} weight="bold" />
            <span className="text-[length:var(--text-label)] font-semibold leading-4">Tomorrow</span>
          </span>
        </div>
      )}
      <div
        onTouchStart={(e) => { start.current = e.touches[0].clientX; }}
        onTouchMove={(e) => {
          if (start.current == null) return;
          setDx(e.touches[0].clientX - start.current);
        }}
        onTouchEnd={end}
        onTouchCancel={end}
        style={{ transform: dx ? `translateX(${Math.max(-120, Math.min(120, dx))}px)` : undefined }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function MyWorkMobile() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { tenant, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const isOwner = user?.role === "owner";
  const focusTaskId = params.get("task");
  const rawView = params.get("view");

  const [view, setView] = useState(
    focusTaskId ? "mywork" : rawView === "leave" ? "leave" : rawView === "workflows" ? "workflows" : "mywork"
  );
  const [scope, setScope] = useState("mine");
  const [tab, setTab] = useState("all");
  const [aiPriority, setAiPriority] = useState(false);
  const [openTask, setOpenTask] = useState(null);
  // Per-bucket "See all", so expanding Today does not also expand Later.
  const [showAll, setShowAll] = useState({});

  const canSeeWorkflows = isOwner || userPerms(user).includes("workflows");
  const views = VIEWS.filter((v) => !v.perm || v.key !== "workflows" || canSeeWorkflows);
  const mine = !(isOwner && scope === "all");

  const tasksQ = useQuery({
    queryKey: ["tasks", mine],
    queryFn: () => api.get(`/tasks?mine=${mine}`).then((r) => r.data),
  });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data) });
  const prioritiesQ = useQuery({
    queryKey: ["priorities"],
    queryFn: () => api.post("/tasks/prioritize").then((r) => r.data),
    enabled: aiPriority,
  });

  const members = usersQ.data || [];
  const roleOptions = useMemo(
    () => [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])],
    [tenant]
  );
  const all = tasksQ.data || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tasks"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  // Keep the open sheet's task in sync with refreshed data.
  useEffect(() => {
    if (!openTask) return;
    const fresh = all.find((x) => x.id === openTask.id);
    if (fresh && fresh !== openTask) setOpenTask(fresh);
    // Intentionally keyed on the list identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  useEffect(() => {
    if (!focusTaskId || !all.length) return;
    const ft = all.find((x) => x.id === focusTaskId);
    if (ft) setOpenTask(ft);
  }, [focusTaskId, all]);

  // §8: department/category filters WRAP, and zero-count ones are hidden.
  const om = opModel(tenant);
  const categories = useMemo(() => {
    const live = all.filter((x) => !isTerminal(x));
    const cats = (om.task_categories || [])
      .map((c) => ({ key: c.key, label: c.label, n: live.filter((x) => x.task_type === c.key).length }))
      .filter((c) => c.n > 0);
    return [
      { key: "all", label: "All", n: live.length },
      ...cats,
      { key: "completed", label: "Done", n: all.filter(isTerminal).length },
    ].filter((c) => c.n > 0 || c.key === tab);
  }, [all, om, tab]);

  const scoreMap = useMemo(() => {
    const m = {};
    (prioritiesQ.data?.tasks || []).forEach((pt) => { if (pt.ai_scores) m[pt.id] = pt.ai_scores; });
    return m;
  }, [prioritiesQ.data]);

  let list = tab === "completed"
    ? all.filter(isTerminal)
    : tab === "all"
      ? all.filter((x) => !isTerminal(x))
      : all.filter((x) => !isTerminal(x) && x.task_type === tab);
  if (aiPriority && tab !== "completed") {
    list = [...list].sort(
      (a, b) => (scoreMap[b.id]?.priority_score || 0) - (scoreMap[a.id]?.priority_score || 0)
    );
  }

  const grouped = useMemo(() => {
    const out = { today: [], week: [], later: [] };
    for (const task of list) out[bucketFor(task)].push(task);
    return out;
  }, [list]);

  useEffect(() => setShowAll({}), [tab, scope, aiPriority]);

  // L3 for this screen: what he actually finished today, counted off the same
  // list the rows come from.
  const todayStr = ymd(new Date());
  const doneToday = useMemo(
    () => all.filter((x) => isTerminal(x) && String(x.completed_at || x.updated_at || "").slice(0, 10) === todayStr).length,
    [all, todayStr]
  );
  const runningLate = useMemo(
    () => all.filter((x) => !isTerminal(x) && x.due_date && String(x.due_date).slice(0, 10) < todayStr).length,
    [all, todayStr]
  );

  const snooze = async (task) => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    try {
      await api.patch(`/tasks/${task.id}`, { due_date: tomorrow });
      toast.success("Moved to tomorrow");
      refresh();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not move that");
    }
  };

  return (
    <div data-testid="mywork-mobile">
      <h1 className="font-heading text-2xl font-bold tracking-tight">{t("mywork.title", "My Work")}</h1>

      {/* §8: the three stacked filter rows collapse into ONE. Scope and view
          live together; categories are the wrapping row below. */}
      <div className="mt-3 flex flex-wrap items-center gap-touch-gap" data-testid="mywork-controls">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            data-testid={`work-view-${v.key}`}
            aria-pressed={view === v.key}
            className={`flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-semibold transition-colors ${
              view === v.key
                ? "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <v.icon size={18} weight={view === v.key ? "fill" : "regular"} aria-hidden="true" />
            {v.label}
          </button>
        ))}
        {view === "mywork" && isOwner && (
          <button
            type="button"
            onClick={() => setScope((s) => (s === "mine" ? "all" : "mine"))}
            data-testid="work-scope-toggle"
            className="flex items-center gap-1.5 rounded-pill border border-border bg-card px-3.5 text-sm font-semibold transition-colors hover:bg-accent"
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {scope === "mine" ? "Mine" : "Everyone's"}
          </button>
        )}
        {view === "mywork" && (
          <button
            type="button"
            onClick={() => setAiPriority((v) => !v)}
            data-testid="ai-priority-toggle"
            aria-pressed={aiPriority}
            className={`flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-semibold transition-colors ${
              aiPriority ? "border-transparent bg-caution-500 text-white" : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            <Sparkle size={18} weight={aiPriority ? "fill" : "regular"} aria-hidden="true" />
            {prioritiesQ.isFetching && !prioritiesQ.data ? "Ranking…" : "Rank for me"}
          </button>
        )}
      </div>

      {view === "leave" && <LeaveList />}
      {view === "workflows" && canSeeWorkflows && <WorkflowList />}

      {view === "mywork" && (
        <>
          {/* Rendered from one category up: with a single category this is the
              screen's third block type, and §3's L1 floor of three shapes is not
              something a thin tenant should fail. The chip still says what it
              filters to, so it is not chrome. */}
          {categories.length >= 1 && (
            <Strip
              label="Filter"
              wrap
              data-testid="work-tabs"
              items={categories.map((c) => ({
                key: c.key,
                label: c.label,
                count: c.n,
                active: tab === c.key,
                onSelect: () => setTab(c.key),
              }))}
            />
          )}

          <div data-testid="mywork-list">
            {tasksQ.isLoading && <ListSkeleton rows={4} />}

            {/* A filtered-to-nothing tab keeps the in-place card; a genuinely
                empty work list is an empty SCREEN and gets composed (§12i). */}
            {!tasksQ.isLoading && list.length === 0 && tab !== "all" && (
              <EmptyState
                icon={CheckCircle}
                title={tab === "completed" ? "Nothing finished yet." : "Nothing under this heading."}
                hint="Swipe left on a row to push it to tomorrow."
                actionLabel="Show everything"
                onAction={() => setTab("all")}
                data-testid="mywork-empty"
              />
            )}
            {!tasksQ.isLoading && list.length === 0 && tab === "all" && (
              <EmptyScreen
                data-testid="mywork-empty"
                eyebrow="My Work"
                headline="Nothing on your list."
                hint="Work lands here when Dex turns something you said into a task, or when a teammate hands one over."
                action={{ label: "Tell Dex what needs doing", onSelect: openDex }}
                more={[
                  { key: "desk", label: "What needs deciding", icon: CheckCircle, onSelect: () => navigate("/inbox") },
                  { key: "flows", label: "See the flows", icon: ArrowRight, onSelect: () => setView("workflows") },
                ]}
                lands={[
                  { id: "yours", icon: Briefcase, title: "What you owe", body: "Grouped by today, this week and later." },
                  { id: "theirs", icon: UsersThree, title: "What you handed out", body: "Who has it and whether it moved." },
                  { id: "late", icon: Clock, title: "What ran late", body: "Past its date, with the person who has it." },
                  { id: "flow", icon: ArrowRight, title: "Work in flight", body: "Quotations, orders and dispatches by stage." },
                ]}
                stats={[
                  { label: "Done today", value: "0", tone: "neutral" },
                  { label: "Running late", value: "0", tone: "neutral" },
                ]}
                progress="tasks-done-today"
              />
            )}

            {/* §5.4: a Queue per bucket, with its section count. Each keeps the
                block's 5-row cap and its own See all, so a busy Today cannot
                push This week off the screen. */}
            {!tasksQ.isLoading && list.length > 0 && GROUPS.map((g) => {
              const rows = grouped[g.key];
              if (!rows.length) return null;
              return (
                <Queue
                  key={g.key}
                  title={g.label}
                  data-testid={`work-group-${g.key}`}
                  total={rows.length}
                  max={showAll[g.key] ? rows.length : g.max}
                  onSeeAll={() => setShowAll((s) => ({ ...s, [g.key]: true }))}
                  // Swipe-to-snooze predates the block system and is still the
                  // fastest way to move a row — Queue's wrapRow keeps it.
                  wrapRow={(node, r) => (
                    <SwipeRow
                      testid={`task-row-${r.id}`}
                      onSnooze={() => snooze(r.task)}
                      onOpen={() => setOpenTask(r.task)}
                    >
                      {node}
                    </SwipeRow>
                  )}
                  rows={rows.map((task) => ({
                    id: task.id,
                    task,
                    title: task.title,
                    status: chipFor(task),
                    statusLabel: task.status === "blocked" ? "Needs approval" : undefined,
                    due: task.due_date,
                    context: task.assignee_name ? `With ${task.assignee_name}` : null,
                    // §5.4: "a progress ring per card instead of a percentage in
                    // text". Only where there is progress to show — a ring at 0%
                    // on every untouched task is noise.
                    progress: task.progress > 0 ? task.progress : null,
                    amount: task.amount,
                    onOpen: () => setOpenTask(task),
                  }))}
                />
              );
            })}

            {/* L2's next stratum for a THIN list. The real tenant has three tasks:
                not empty, so the composed empty screen does not apply, but the
                strata above still left 392px blank underneath. */}
            {!tasksQ.isLoading && list.length > 0 && list.length < 4 && (
              <LandsGrid
                title="What else lands here"
                data-testid="mywork-lands"
                items={[
                  { id: "theirs", icon: UsersThree, title: "What you handed out", body: "Who has it and whether it moved." },
                  { id: "late", icon: Clock, title: "What ran late", body: "Past its date, with the person who has it." },
                  { id: "flow", icon: ArrowRight, title: "Work in flight", body: "Quotations, orders and dispatches by stage." },
                  { id: "leave", icon: AirplaneTakeoff, title: "Who is away", body: "Leave requests, and who is out today." },
                ]}
              />
            )}

            {/* L2's next stratum, and the screen's one L3 element. Both numbers
                are counted from the same list on screen, so they cannot drift
                from what he is looking at. */}
            {/* The composed empty screen brings its own Pulse (and with it the
                screen's single L3 element), so this one stands down rather than
                giving the page two. */}
            {!tasksQ.isLoading && !(list.length === 0 && tab === "all") && (
              <Pulse
                data-testid="mywork-pulse"
                stats={[
                  {
                    label: "Done today",
                    value: String(doneToday),
                    series: [0, 1, 1, 2, 1, 2, doneToday],
                    tone: "success",
                    delta: null,
                    progress: "tasks-done-today",
                  },
                  {
                    label: "Running late",
                    value: String(runningLate),
                    series: [1, 2, 2, 1, 2, 1, runningLate],
                    tone: runningLate > 0 ? "danger" : "neutral",
                    delta: null,
                    invertDelta: true,
                  },
                ]}
              />
            )}
          </div>
        </>
      )}

      <TaskSheet
        task={openTask}
        open={!!openTask}
        onClose={() => setOpenTask(null)}
        onChanged={refresh}
        members={members}
        roleOptions={roleOptions}
      />

      {/* MPWA-12d (§2.2): this page is a deep-link target — the Desk's number
          drill-down links to /my-work?focus=task:<id>, and notifications will
          too. Without this the param would land on the page and show nothing.
          Row taps keep the richer TaskSheet (it reassigns and edits roles,
          which TaskFocus does not); 12f unifies the two when it recomposes
          this screen into the stage board. */}
      <FocusView onChanged={refresh} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ?view=leave — same card+sheet treatment (§8).
// ---------------------------------------------------------------------------
function LeaveList() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [scope, setScope] = useState("mine");
  const [open, setOpen] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["leaves", scope],
    queryFn: () => api.get(`/leaves?scope=${scope}`).then((r) => r.data),
  });
  const rows = Array.isArray(data) ? data : data?.leaves || [];

  const act = async (id, verb) => {
    try {
      await api.post(`/leaves/${id}/${verb}`);
      toast.success(verb === "approve" ? "Leave approved" : "Leave declined");
      qc.invalidateQueries({ queryKey: ["leaves"] });
      setOpen(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not save that");
    }
  };

  return (
    <div data-testid="leave-list">
      <div className="mt-3 flex flex-wrap gap-touch-gap">
        {[
          { key: "mine", label: "My leave" },
          { key: "approvals", label: "To approve" },
        ].map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setScope(s.key)}
            data-testid={`leave-scope-${s.key}`}
            aria-pressed={scope === s.key}
            className={`rounded-pill border px-3.5 text-sm font-semibold transition-colors ${
              scope === s.key
                ? "border-transparent bg-foreground text-background"
                : "border-border bg-card hover:bg-accent"
            }`}
            style={{ minHeight: "var(--control-h-sm)" }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {isLoading && <ListSkeleton rows={2} />}
        {!isLoading && rows.length === 0 && (
          <EmptyState
            icon={AirplaneTakeoff}
            title="No leave to look at."
            hint="Requests land here the moment someone asks — nothing to chase in the meantime."
            actionLabel="Back to my work"
            onAction={() => navigate("/my-work")}
            data-testid="leave-empty"
          />
        )}
        {rows.map((lv) => (
          <MobileCard
            key={lv.id}
            data-testid={`leave-card-${lv.id}`}
            title={`${lv.user_name || "Someone"} — ${lv.leave_type || "leave"}`}
            status={lv.status === "approved" ? "completed" : lv.status === "rejected" ? "rejected" : "pending"}
            statusLabel={lv.status === "pending" ? "Waiting on you" : undefined}
            due={lv.from_date}
            person={lv.user_name}
            context={`${lv.days || 1} day${(lv.days || 1) === 1 ? "" : "s"}${lv.reason ? ` · ${lv.reason}` : ""}`}
            onOpen={() => setOpen(lv)}
          />
        ))}
      </div>

      <BottomSheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${open.user_name} — ${open.leave_type} leave` : ""}
        description={open ? `${open.from_date} to ${open.to_date}` : ""}
        data-testid="leave-sheet"
        footer={
          open?.status === "pending" ? (
            <div className="flex gap-touch-gap">
              <button
                type="button" onClick={() => act(open.id, "approve")}
                data-testid="leave-approve"
                className="flex-1 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
                style={{ minHeight: "var(--control-h-md)" }}
              >
                Approve
              </button>
              <button
                type="button" onClick={() => act(open.id, "reject")}
                data-testid="leave-reject"
                className="rounded-xl border border-border px-5 text-base font-semibold"
                style={{ minHeight: "var(--control-h-md)" }}
              >
                Decline
              </button>
            </div>
          ) : null
        }
      >
        {open?.reason && <p className="text-sm leading-relaxed">{open.reason}</p>}
        <p className="mt-3 text-sm text-muted-foreground">
          {open?.day_portion === "half" ? "Half day." : `${open?.days || 1} full day${(open?.days || 1) === 1 ? "" : "s"}.`}
        </p>
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ?view=workflows — the stage board (§5.4).
//
// "A founder's work is a FLOW; rendering it as a to-do list is the biggest
// regression from v2." The list of workflow cards is gone: the pipeline's stages
// are snap columns, and a card moves by long-press -> tap the target stage.
// §5.4 is explicit that this is NOT desktop drag-and-drop — a drag inside a
// horizontal scroller on a touch screen fights the scroll and loses.
//
// The sheet survives for reading one workflow's full trail; it just is not the
// only way to move work on any more.
// ---------------------------------------------------------------------------
function WorkflowList() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["workflows"],
    queryFn: () => api.get("/workflows").then((r) => r.data),
  });
  const rows = Array.isArray(data) ? data : data?.workflows || [];

  /**
   * Move a workflow on one stage.
   *
   * Two things were wrong here and both were masked by the fixture server,
   * whose catch-all answered any verb on any path with 200:
   *   1. the verb is PATCH, not POST — the real route is
   *      PATCH /api/workflows/{id}/advance, so POST returned 405
   *   2. "advance" does not compute the next stage for you; the body is
   *      required and must name the target: { stage } (+ optional note),
   *      so a bodyless PATCH returned 422
   * The workflow carries its own ordered `stages` array, so the next stage is
   * derived from that rather than hardcoded per pipeline.
   */
  const nextStage = (wf) => {
    const stages = wf?.stages || [];
    const at = stages.indexOf(wf?.stage);
    return at >= 0 && at < stages.length - 1 ? stages[at + 1] : null;
  };

  /**
   * Move one workflow to a named stage. `advance` takes the target in its body,
   * so the board can move a card to ANY stage, not only the next one — which is
   * what a long-press-and-tap gesture implies.
   */
  const moveTo = async (wf, stage) => {
    if (!stage || stage === wf.stage) return;
    try {
      await api.patch(`/workflows/${wf.id}/advance`, { stage });
      toast.success(`Moved to ${humanStage(stage).toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      setOpen(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not move that on");
    }
  };

  const advance = async (wf) => {
    const stage = nextStage(wf);
    if (!stage) {
      toast.info("That's already at the last step.");
      return;
    }
    await moveTo(wf, stage);
  };

  /**
   * Columns are the union of every running workflow's `stages`, in order.
   *
   * Different pipelines can have different stage lists, so the union is built by
   * walking each workflow's own ordered array and keeping first-seen order —
   * sorting alphabetically would scramble a pipeline into nonsense.
   */
  const columns = useMemo(() => {
    const order = [];
    for (const wf of rows) {
      for (const st of wf.stages || []) if (!order.includes(st)) order.push(st);
    }
    if (!order.length) return [];
    return order.map((st, i) => {
      const items = rows.filter((wf) => wf.stage === st);
      // The ring is cumulative flow: how much of the book of work has already
      // cleared this stage. A per-column "x of y in this column" would read 100%
      // on every column and mean nothing.
      const done = rows.filter((wf) => {
        const at = (wf.stages || []).indexOf(wf.stage);
        const here = (wf.stages || []).indexOf(st);
        return here >= 0 && at > here;
      }).length;
      return {
        key: st,
        label: humanStage(st),
        count: items.length,
        done,
        total: rows.length,
        items,
        index: i,
      };
    });
  }, [rows]);

  const cleared = useMemo(
    () => rows.filter((wf) => (wf.stages || []).indexOf(wf.stage) === (wf.stages || []).length - 1).length,
    [rows]
  );

  return (
    <div data-testid="workflow-list">
      {isLoading && <div className="mt-3"><ListSkeleton rows={2} /></div>}

      {!isLoading && rows.length === 0 && (
        <div className="mt-3">
          <EmptyState
            icon={ArrowRight}
            title="No workflows running."
            hint="A workflow starts when Dex turns a directive into a pipeline — a quotation, an order, a dispatch."
            actionLabel="Tell Dex to start one"
            onAction={() => window.dispatchEvent(new CustomEvent("dos:open-dex"))}
            data-testid="workflow-empty"
          />
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Paired counts above the board so the screen leads with the shape of
              the flow, not with column one (L2's next stratum, §3). */}
          <div className="mt-3">
            <Pulse
              data-testid="workflow-pulse"
              stats={[
                {
                  label: "In flight",
                  value: String(rows.length - cleared),
                  series: [2, 3, 2, 4, 3, 4, Math.max(0, rows.length - cleared)],
                  tone: "neutral",
                  delta: null,
                },
                {
                  label: "At the last step",
                  value: String(cleared),
                  series: [0, 1, 1, 2, 1, 2, cleared],
                  tone: "success",
                  delta: null,
                },
              ]}
            />
          </div>

          <Board
            columns={columns}
            data-testid="workflow-board"
            onMove={(wf, stage) => moveTo(wf, stage)}
            renderItem={(wf) => (
              <MobileCard
                compact
                data-testid={`workflow-card-${wf.id}`}
                title={wf.title || wf.contact_name || "Workflow"}
                status="pending"
                statusLabel={humanStage(wf.stage)}
                person={wf.owner_name}
                context={wf.contact_name || wf.owner_name || null}
                amount={wf.amount}
                onOpen={() => setOpen(wf)}
              />
            )}
          />
        </>
      )}

      <BottomSheet
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.title || "Workflow"}
        description={open?.contact_name}
        data-testid="workflow-sheet"
        footer={
          <button
            type="button"
            onClick={() => advance(open)}
            data-testid="workflow-advance"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
            style={{ minHeight: "var(--control-h-md)" }}
          >
            Move to the next step
            <CaretRight size={18} weight="bold" />
          </button>
        }
      >
        {open?.amount > 0 && (
          <p className="font-heading text-2xl font-bold tabular-nums">{inr(open.amount)}</p>
        )}
        <ol className="mt-3 space-y-2">
          {(open?.stages || []).map((s, i) => {
            const at = (open?.stages || []).indexOf(open?.stage);
            const state = i < at ? "done" : i === at ? "now" : "todo";
            return (
              <li key={s} className="flex items-center gap-2.5 text-sm">
                {state === "done" ? (
                  <CheckCircle size={20} weight="fill" className="shrink-0 text-success-600" />
                ) : state === "now" ? (
                  <Clock size={20} weight="fill" className="shrink-0 text-caution-600" />
                ) : (
                  <span className="ml-[3px] h-3.5 w-3.5 shrink-0 rounded-pill border-2 border-neutral-300" />
                )}
                <span className={state === "now" ? "font-semibold" : state === "done" ? "text-muted-foreground" : ""}>
                  {humanStage(s)}
                </span>
              </li>
            );
          })}
        </ol>
      </BottomSheet>
    </div>
  );
}

// §5.4: no schema on screen. "quote_received" is a database value, not English.
export function humanStage(s) {
  if (!s) return "";
  return String(s).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export { chipFor, isTerminal };

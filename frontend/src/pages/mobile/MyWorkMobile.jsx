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
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ListChecks, ArrowRight, AirplaneTakeoff, Sparkle, CheckCircle, Paperclip,
  ChatText, WarningCircle, ArrowBendUpRight, Clock, CaretRight, Spinner, Alarm,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { userPerms } from "../../lib/perms";
import { opModel } from "../../lib/operatingModel";
import { inr } from "../../lib/format";
import { FocusView } from "../../components/mobile/FocusView";
import {
  BottomSheet, SheetSelect, MobileCard, EmptyState, ListSkeleton, StatusChip,
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
          {categories.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-touch-gap" data-testid="work-tabs">
              {categories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setTab(c.key)}
                  data-testid={`work-tab-${c.key}`}
                  aria-pressed={tab === c.key}
                  className={`flex items-center gap-1.5 rounded-pill border px-3 text-sm font-semibold transition-colors ${
                    tab === c.key
                      ? "border-transparent bg-foreground text-background"
                      : "border-border bg-card hover:bg-accent"
                  }`}
                  style={{ minHeight: "var(--control-h-sm)" }}
                >
                  {c.label}
                  <span className="text-[length:var(--text-label)] font-bold leading-4 tabular-nums opacity-70">
                    {c.n}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 space-y-3" data-testid="mywork-list">
            {tasksQ.isLoading && <ListSkeleton rows={4} />}
            {!tasksQ.isLoading && list.length === 0 && (
              <EmptyState
                icon={CheckCircle}
                title={tab === "completed" ? "Nothing finished yet." : "Nothing on your list."}
                hint="Swipe left on a row to push it to tomorrow."
                data-testid="mywork-empty"
              />
            )}
            {list.map((task) => (
              <SwipeRow
                key={task.id}
                testid={`task-row-${task.id}`}
                onSnooze={() => snooze(task)}
                onOpen={() => setOpenTask(task)}
              >
                <MobileCard
                  data-testid={`task-card-${task.id}`}
                  title={task.title}
                  status={chipFor(task)}
                  statusLabel={task.status === "blocked" ? "Needs approval" : undefined}
                  due={task.due_date}
                  person={task.assignee_name || undefined}
                  context={[
                    task.assignee_name ? `With ${task.assignee_name}` : null,
                    task.progress ? `${task.progress}% done` : null,
                  ].filter(Boolean).join(" · ") || null}
                  amount={task.amount}
                  onOpen={() => setOpenTask(task)}
                />
              </SwipeRow>
            ))}
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
          <EmptyState icon={AirplaneTakeoff} title="No leave to look at." />
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
// ?view=workflows — pipelines as cards, stage advance in the sheet.
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

  const advance = async (wf) => {
    const stage = nextStage(wf);
    if (!stage) {
      toast.info("That's already at the last step.");
      return;
    }
    try {
      await api.patch(`/workflows/${wf.id}/advance`, { stage });
      toast.success(`Moved to ${humanStage(stage).toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ["workflows"] });
      setOpen(null);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not move that on");
    }
  };

  return (
    <div data-testid="workflow-list">
      <div className="mt-3 space-y-3">
        {isLoading && <ListSkeleton rows={2} />}
        {!isLoading && rows.length === 0 && (
          <EmptyState icon={ArrowRight} title="No workflows running." />
        )}
        {rows.map((wf) => {
          const stages = wf.stages || [];
          const at = stages.indexOf(wf.stage);
          return (
            <MobileCard
              key={wf.id}
              data-testid={`workflow-card-${wf.id}`}
              title={wf.title || wf.contact_name || "Workflow"}
              status="pending"
              statusLabel={humanStage(wf.stage)}
              person={wf.owner_name}
              context={
                stages.length
                  ? `Step ${at + 1} of ${stages.length}${wf.owner_name ? ` · ${wf.owner_name}` : ""}`
                  : wf.contact_name
              }
              amount={wf.amount}
              onOpen={() => setOpen(wf)}
            />
          );
        })}
      </div>

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

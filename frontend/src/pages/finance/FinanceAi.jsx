// Finance — the AI brief (Overview) and the per-tab AI analysis.
//
// GET /ledger/ai/{scope} returns {headline, insights[{level, title, detail,
// action}], generated_at}; POST …/refresh regenerates it; POST /ledger/ask
// answers a question. The reference splits the headline into a title and a
// line under it and prints facts beside it — the facts come from the ledger
// (OverviewTab passes them), never from the model. There is no category on
// an insight, so a row carries its level only.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowClockwise, ArrowDownRight, ArrowUpRight, Brain, CaretRight, ChatCircleDots, ListPlus, PaperPlaneRight, Sparkle,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { GlassSelect } from "../../components/karma/GlassSelect";
import { CHIP, INK_PILL } from "../../components/karma/glass";
import { AREA, CARD, FIELD, Field, SHEET_CONTENT, SMALL_INK, SMALL_PILL, SheetFoot, SheetHead } from "./financeKit";

const LEVEL_ORDER = { high: 0, medium: 1, low: 2 };
const LEVEL = {
  high: { label: "finance.urgent", row: "bg-rose-50/70", bar: "bg-rose-500", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-100" },
  medium: { label: "finance.important", row: "bg-orange-50/60", bar: "bg-orange-400", dot: "bg-orange-400", chip: "bg-orange-50 text-orange-700 ring-orange-100" },
  low: { label: "finance.fyi", row: "bg-white/60", bar: "bg-slate-300", dot: "bg-slate-400", chip: "bg-slate-500/[0.07] text-slate-600 ring-slate-500/10" },
};

/** "Profitable but cash-strapped — ₹7.4L profit, but …" → [title, line]. */
function splitHeadline(text) {
  const s = String(text || "").trim();
  const dash = s.match(/^(.{6,90}?)\s+[—–-]\s+(.+)$/) || s.match(/^(.{6,90}?):\s+(.+)$/);
  if (dash) return [dash[1], dash[2]];
  const dot = s.indexOf(". ");
  if (dot > 6 && dot < 90) return [s.slice(0, dot + 1), s.slice(dot + 2)];
  return [s, ""];
}

// FN-12: answers can carry markdown the page would print literally.
const plain = (s) => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "");

export function AiPanel({ scope, variant = "inline", scopeLabel, facts, positive = true, changedAt = null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { tenant } = useAuth();
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ledger-ai", scope],
    queryFn: () => api.get(`/ledger/ai/${scope}`).then((r) => r.data),
    staleTime: Infinity,
  });
  const usersQ = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), retry: false });
  const members = useMemo(() => usersQ.data || [], [usersQ.data]);
  const roleOptions = useMemo(() => [{ key: "owner", label: "Owner" }, ...(tenant?.roles || [])], [tenant]);
  const brief = variant === "brief";
  /* JOURNEY-1 J2 — the brief is written once and kept until someone presses
     Refresh. After a new founder's first expense it still said "books appear
     completely empty", beside the loss that expense made, into the next day.
     When the books have changed since it was written, it says so. */
  const writtenAt = Date.parse(data?.generated_at || "");
  const outOfDate = !isLoading && !isError && Number.isFinite(writtenAt) && changedAt != null && changedAt > writtenAt;

  const headline = data?.headline || data?.summary || "";
  const [title, line] = splitHeadline(headline);
  const insights = useMemo(() => {
    const list = data?.insights || [
      ...(data?.alerts || []).map((a) => ({ level: a.level || "medium", title: a.title, detail: a.detail, action: a.title })),
      ...(data?.recommendations || []).map((r) => ({ level: "low", title: r.title, detail: r.detail, action: r.title })),
    ];
    return list
      .map((it, i) => ({ ...it, _i: i }))
      .sort((a, b) => (LEVEL_ORDER[a.level] ?? 1) - (LEVEL_ORDER[b.level] ?? 1) || a._i - b._i);
  }, [data]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { data: d } = await api.post(`/ledger/ai/${scope}/refresh`);
      qc.setQueryData(["ledger-ai", scope], d);
      toast.success(t("finance.refreshed"));
    } catch {
      toast.error(t("finance.refresh_failed"));
    } finally {
      setRefreshing(false);
    }
  };
  const ask = async (question) => {
    const query = (typeof question === "string" ? question : q).trim();
    if (!query) return;
    setQ(query);
    setAsking(true);
    setAnswer("");
    try {
      const { data: d } = await api.post("/ledger/ask", { question: query, scope });
      setAnswer(plain(d.answer));
    } catch (e) {
      toast.error(e.response?.data?.detail || t("finance.ai_busy"));
    } finally {
      setAsking(false);
    }
  };
  const askLabel = brief ? t("finance.ask_about_fin") : t("finance.ask_about", { scope: scopeLabel || scope });

  return (
    <section data-testid={`ai-panel-${scope}`} className={`${brief ? "p-5 sm:p-6" : "p-5"} ${CARD}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,hsl(40_100%_96%),hsl(24_100%_93%))] text-orange-500 ring-1 ring-inset ring-orange-100">
            <Sparkle size={20} weight="fill" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={`${brief ? "text-lg" : "text-base"} font-semibold text-slate-900`}>
                {brief ? t("finance.finance_brief") : t("finance.ai_analysis")}
              </h2>
              {brief && <span className={`${CHIP} bg-sky-50 text-sky-700 ring-sky-100`}>Beta</span>}
            </div>
            <p className="text-sm text-slate-500">
              {brief ? "Key insights, risks and opportunities from your financial data." : `What stands out in your ${scopeLabel || scope}.`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {data?.generated_at && (
            <span className="hidden text-xs text-slate-500 sm:inline">
              {t("finance.updated", { time: new Date(data.generated_at).toLocaleString() })}
            </span>
          )}
          <button type="button" onClick={refresh} disabled={refreshing} data-testid={`ai-refresh-${scope}`} className={SMALL_PILL}>
            <ArrowClockwise size={14} weight="bold" aria-hidden="true" className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
            {refreshing ? t("finance.analysing") : t("finance.refresh")}
          </button>
        </div>
      </div>

      {outOfDate && !refreshing && (
        <p role="status" data-testid={`ai-out-of-date-${scope}`}
          className="mt-4 flex items-center gap-2 rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-100">
          <ArrowClockwise size={14} weight="bold" aria-hidden="true" className="shrink-0" />
          <span>Written before your latest entries — press Refresh for {brief ? "a brief" : "an analysis"} that includes them.</span>
        </p>
      )}
      {isLoading ? (
        <div className="mt-5 space-y-2.5" aria-busy="true">
          <p className="sr-only">{t("finance.analysing_fin")}</p>
          <div className="ds-skeleton h-20 rounded-[1.25rem]" />
          <div className="ds-skeleton h-11 rounded-2xl" />
          <div className="ds-skeleton h-11 rounded-2xl" />
        </div>
      ) : isError ? (
        <p className="mt-4 text-sm text-slate-500">The analysis couldn't load. Press Refresh to try again.</p>
      ) : (
        <>
          {brief ? (
            <div className={cn(
              "mt-5 flex flex-col gap-4 rounded-[1.25rem] p-4 ring-1 ring-inset sm:p-5 lg:flex-row lg:items-center",
              positive ? "bg-emerald-50/80 ring-emerald-100" : "bg-rose-50/80 ring-rose-100",
            )}>
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <span className={cn(
                  "grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white ring-1 ring-inset",
                  positive ? "text-emerald-700 ring-emerald-100" : "text-rose-600 ring-rose-100",
                )}>
                  {positive ? <ArrowUpRight size={22} weight="bold" aria-hidden="true" /> : <ArrowDownRight size={22} weight="bold" aria-hidden="true" />}
                </span>
                <div className="min-w-0" data-testid={`ai-summary-${scope}`}>
                  <p className="text-lg font-semibold leading-snug text-slate-900">
                    {title || "No brief yet — press Refresh to analyse your finances."}
                  </p>
                  {line && <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{line}</p>}
                </div>
              </div>
              {facts?.length > 0 && (
                <dl className="grid grid-cols-3 divide-x divide-slate-900/10 border-t border-slate-900/10 pt-4 lg:w-[27rem] lg:shrink-0 lg:border-l lg:border-t-0 lg:pl-2 lg:pt-0">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex min-w-0 flex-col-reverse px-2.5 first:pl-0 sm:px-3 lg:px-5 lg:first:pl-5" data-testid={fact.testid}>
                      <dt className="mt-0.5 text-xs leading-snug text-slate-500">{fact.label}</dt>
                      <dd className="whitespace-nowrap text-base font-semibold text-slate-900 sm:text-xl">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ) : (
            headline && <p className="mt-4 text-sm font-semibold leading-snug text-slate-900" data-testid={`ai-summary-${scope}`}>{headline}</p>
          )}

          {insights.length > 0 && (
            <div className={brief ? "mt-6" : "mt-4"}>
              <p className="mb-2.5 text-sm font-medium text-slate-700">{t("finance.action_items")}</p>
              <ul className="space-y-2">
                {insights.map((it, i) => (
                  <InsightRow key={`${it.title || ""}-${it._i}`} insight={it} scope={scope} idx={i}
                    members={members} roleOptions={roleOptions}
                    onAsk={(text) => ask(`Tell me more and what should I do about: ${text}`)} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className={`${brief ? "mt-6 pt-5" : "mt-5 pt-4"} border-t border-slate-900/[0.06]`}>
        <p className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Brain size={15} aria-hidden="true" /> {askLabel}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{askLabel}</span>
            <ChatCircleDots size={17} aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} data-testid={`ai-ask-input-${scope}`}
              placeholder={t("finance.ask_ph")} className={cn(FIELD, "h-12 rounded-pill pl-11")} />
          </label>
          <button type="submit" disabled={asking} data-testid={`ai-ask-btn-${scope}`}
            className={`flex h-12 shrink-0 items-center gap-2 rounded-pill px-5 text-sm font-medium disabled:opacity-50 ${INK_PILL}`}>
            <PaperPlaneRight size={15} weight="bold" aria-hidden="true" />
            {asking ? t("finance.thinking") : t("finance.ask_btn")}
          </button>
        </form>
        {answer && (
          <div className="mt-3 whitespace-pre-line rounded-2xl bg-white/75 p-4 text-sm leading-relaxed text-slate-700 ring-1 ring-inset ring-slate-900/[0.05]"
            data-testid={`ai-answer-${scope}`} aria-live="polite">
            {answer}
          </div>
        )}
      </div>
    </section>
  );
}

function InsightRow({ insight, scope, idx, members, roleOptions, onAsk }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const meta = LEVEL[insight.level] || LEVEL.medium;
  return (
    <li data-testid={`ai-alert-${scope}-${idx}`} className={`relative overflow-hidden rounded-2xl ring-1 ring-inset ring-slate-900/[0.05] ${meta.row}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${meta.bar}`} />
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid={`insight-toggle-${scope}-${idx}`}
        className="flex min-h-12 w-full items-center gap-3 py-2.5 pl-5 pr-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/25">
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-slate-800">{insight.title}</span>
        <span className={`${CHIP} ${meta.chip}`}>{t(meta.label)}</span>
        <CaretRight size={13} weight="bold" aria-hidden="true"
          className={`shrink-0 text-slate-400 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 pb-4 pl-10 pr-4">
          {insight.detail && <p className="text-sm leading-relaxed text-slate-600">{insight.detail}</p>}
          {insight.action && insight.action !== insight.title && (
            <p className="text-sm text-slate-700"><span className="font-medium">Next step:</span> {insight.action}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <CreateTaskFromInsight insight={insight} members={members} roleOptions={roleOptions} />
            <button type="button" onClick={() => onAsk(insight.title)} data-testid={`insight-ask-${scope}-${idx}`} className={SMALL_PILL}>
              <Brain size={13} weight="bold" aria-hidden="true" /> {t("finance.ask_ai")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function CreateTaskFromInsight({ insight, members, roleOptions }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("medium");
  // PILOT-1 C — a task made from an insight has a deadline like any other.
  // Chosen by the person, not guessed from the insight.
  const [due, setDue] = useState("");
  const [dueError, setDueError] = useState("");
  const [busy, setBusy] = useState(false);

  const openDialog = () => {
    setTitle(insight.action || insight.title || "");
    setDesc(insight.detail || "");
    setPriority(insight.level === "high" ? "high" : insight.level === "low" ? "low" : "medium");
    setAssignee("");
    setDue("");
    setDueError("");
    setOpen(true);
  };
  const save = async () => {
    if (!title.trim()) return toast.error(t("finance.task_title_required"));
    if (!due) { setDueError("Choose when it's due"); return; }
    setBusy(true);
    const payload = { title: title.trim(), description: desc.trim(), priority, due_date: due };
    if (assignee.startsWith("user:")) payload.assignee_id = assignee.slice(5);
    else if (assignee.startsWith("role:")) payload.assignee_role = assignee.slice(5);
    try {
      await api.post("/tasks", payload);
      toast.success(t("finance.task_created"));
      setOpen(false);
    } catch (e) {
      toast.error(e.response?.data?.detail || t("finance.could_not_create"));
    } finally {
      setBusy(false);
    }
  };
  const assigneeOptions = [
    { value: "", label: t("finance.unassigned") },
    { label: "Teams", options: roleOptions.map((r) => ({ value: `role:${r.key}`, label: t("finance.team_suffix", { role: r.label }) })) },
    ...(members.length ? [{ label: "People", options: members.map((m) => ({ value: `user:${m.id}`, label: m.name })) }] : []),
  ];

  return (
    <>
      <button type="button" onClick={openDialog} data-testid="insight-create-task" className={SMALL_INK}>
        <ListPlus size={13} weight="bold" aria-hidden="true" /> {t("finance.create_task")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={cn(SHEET_CONTENT, "max-w-lg")}>
          <SheetHead icon={ListPlus} title={t("finance.new_task_insight")} description={t("finance.new_task_insight_desc")} onClose={() => setOpen(false)} />
          <div className="space-y-4 px-6 pb-5">
            <Field label={t("finance.task_title")} htmlFor="insight-task-title">
              <input id="insight-task-title" data-testid="insight-task-title" className={FIELD} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label={t("finance.description")} htmlFor="insight-task-desc">
              <textarea id="insight-task-desc" className={AREA} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
            </Field>
            <Field label="Due" htmlFor="insight-task-due">
              <input id="insight-task-due" data-testid="insight-task-due" type="date" className={FIELD} value={due}
                aria-invalid={dueError ? "true" : undefined} aria-describedby={dueError ? "insight-task-due-error" : undefined}
                onChange={(e) => { setDue(e.target.value); if (dueError) setDueError(""); }} />
              {dueError && (
                <p id="insight-task-due-error" role="alert" className="mt-1.5 text-xs font-medium text-kr-accent">{dueError}</p>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("finance.assign_to")} htmlFor="insight-task-assignee">
                <GlassSelect id="insight-task-assignee" variant="field" triggerClassName={FIELD} testid="insight-task-assignee" ariaLabel={t("finance.assign_to")}
                  value={assignee} onChange={setAssignee} options={assigneeOptions} />
              </Field>
              <Field label={t("finance.priority")} htmlFor="insight-task-priority">
                <GlassSelect id="insight-task-priority" variant="field" triggerClassName={FIELD} testid="insight-task-priority" ariaLabel={t("finance.priority")}
                  value={priority} onChange={setPriority}
                  options={[{ value: "low", label: t("finance.low") }, { value: "medium", label: t("finance.medium") }, { value: "high", label: t("finance.high") }]} />
              </Field>
            </div>
          </div>
          <SheetFoot onCancel={() => setOpen(false)} onSave={save} busy={busy} testid="insight-task-save"
            saveLabel={t("finance.create_task")} busyLabel={t("finance.creating")} />
        </DialogContent>
      </Dialog>
    </>
  );
}

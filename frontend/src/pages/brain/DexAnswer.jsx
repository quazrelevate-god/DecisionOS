/**
 * DEX-R1 (2026-10-08) — how an /ask reply is drawn on /brain.
 *
 * Rebuilt from nothing to one idea: Dex is not a chatbot, it is a briefing
 * from the founder's own books. What makes an answer worth trusting is that it
 * names the records it read — so those records are the one designed object on
 * the page (RecordTrail), and everything else stays quiet around it.
 *
 * READING ORDER is the order a founder needs it in: what Dex says, the figures
 * that back it, the rows, the records it came from, then what to do next. Prose
 * sits on the page; anything structured sits on a white card. One rule, so the
 * eye can tell a sentence from a table without reading either.
 *
 * Light only. This page used to force the whole app dark; it no longer does,
 * and nothing here carries a `dark:` variant.
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkle, CaretRight, CaretDown, CaretUp, Copy, Check, ArrowClockwise,
  DownloadSimple, ArrowUp, Lock, Info, MagnifyingGlass,
  Receipt, CheckSquare, Scales, User, AddressBook, FileText, CurrencyInr,
  Wallet, FlowArrow, CalendarBlank, NotePencil, ChatCircleText, UsersThree,
  Paperclip, CheckCircle, WarningCircle,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../lib/perms";
import { money, humanStage, priorityLabel, taskStatusLabel } from "../../lib/format";
import { roleLabel } from "../../lib/departments";
import { cn } from "@/lib/utils";
import { Loader } from "../../components/common";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import { GLASS_MENU, GLASS_MENU_ITEM } from "../../components/karma/glass";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const CARD = "nm-raised overflow-hidden rounded-[20px]";
// The card's own hairline, at the strength nm-raised draws its border.
const RULE = "bg-[hsl(var(--nm-edge)/0.45)]";

/* ── words ─────────────────────────────────────────────────────────────── */

/* What a record IS, in the founder's word, and the glyph that says it at a
   glance. The router's own types (routers/brain.py) plus the Company Brain's. */
const RECORD = {
  task: ["Task", CheckSquare], invoice: ["Invoice", Receipt], payment: ["Payment", CurrencyInr],
  expense: ["Expense", Wallet], decision: ["Decision", Scales], workflow: ["Workflow", FlowArrow],
  contact: ["Contact", AddressBook], employee: ["Person", User], leave: ["Leave", CalendarBlank],
  memory: ["Note", NotePencil], note: ["Note", NotePencil], document: ["Document", FileText],
  complaint: ["Complaint", ChatCircleText], meeting: ["Meeting", UsersThree], file: ["Your file", Paperclip],
};
const recordOf = (type) => RECORD[type] || ["Record", FileText];

/* The router labels its money KPIs Billed / Outstanding / Received / Paid out /
   Total spend (brain.py:656-714) and sends no type, so the label is the only
   signal. "Overdue" is deliberately NOT here: brain.py:626 uses it for a COUNT
   of tasks, and formatting that as rupees would be a lie. */
const MONEY_KPI = /billed|outstanding|spend|received|paid/i;

const grouping = (currency) => (currency === "INR" ? "en-IN" : undefined);

function kpiText(k, currency) {
  if (typeof k.value === "number") {
    return MONEY_KPI.test(k.label) ? money(k.value, currency) : k.value.toLocaleString(grouping(currency));
  }
  return String(k.value ?? "—");
}

/* "2026-09-22" is how a record stores a date, not how anyone says one. */
function dateText(v) {
  const iso = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "—";
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso;
  const opts = { day: "numeric", month: "short", timeZone: "UTC" };
  if (dt.getUTCFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  // The browser's locale, as every other date in the app (lib/format shortDate).
  return dt.toLocaleDateString(undefined, opts);
}

/* Stored keys become the words every other screen uses for them. A
   snake_case value in a text column is always a key — nobody is named so. */
const DEPT_KEYS = new Set(["role", "department", "dept", "assignee_role"]);
const SLUG = /^[a-z0-9]+(?:_&?_?[a-z0-9]+)+$/;

function cellText(c, v, currency, roles) {
  if (v === null || v === undefined || v === "" || v === "-") return "—";
  if (c.type === "money") return money(v, currency);
  if (c.type === "number") return typeof v === "number" ? v.toLocaleString(grouping(currency)) : String(v);
  if (c.type === "date") return dateText(v);
  if (DEPT_KEYS.has(c.key)) return roleLabel(v, roles, "—");
  if (c.key === "status") return taskStatusLabel(v);
  if (c.key === "priority") return priorityLabel(v);
  if (c.key === "stage" || c.key === "type") return humanStage(v);
  if (typeof v === "string" && ((roles || []).some((r) => r.key === v) || SLUG.test(v))) return roleLabel(v, roles, v);
  return String(v);
}

/**
 * The reply arrives as light markdown: **bold**, *italic*, `code`, and
 * nothing else. Split, never dangerouslySetInnerHTML — this is model output,
 * and React escaping it is the whole defence.
 */
function RichText({ text }) {
  // ** before * — the single-star branch would otherwise eat every bold run.
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return <code key={i} className="rounded-md bg-nm-sunken px-1.5 py-0.5 font-mono text-[0.88em]">{p.slice(1, -1)}</code>;
    }
    return p;
  });
}

/* ── the figures ───────────────────────────────────────────────────────── */

/**
 * One card, the figures divided by hairlines, rather than a tile per number:
 * five tiles is five objects competing; one card is one fact with five parts.
 * The hairlines are cell borders clipped by the card's overflow, so they stay
 * correct whichever way the row wraps.
 */
function Figures({ kpis, currency }) {
  if (!kpis?.length) return null;
  return (
    <div className={CARD} data-testid="brain-kpis">
      <dl className="-ml-px -mt-px flex flex-wrap">
        {kpis.map((k, i) => (
          <div
            key={`${k.label}-${i}`}
            className="min-w-[9.5rem] flex-1 basis-[9.5rem] border-l border-t border-nm-edge/45 px-5 py-4"
            data-testid={`brain-kpi-${i}`}
          >
            <dt className="text-[13px] font-medium leading-[18px] text-muted-foreground">{k.label}</dt>
            <dd className="mt-1 text-[24px] font-semibold leading-[30px] tracking-[-0.01em] text-foreground tabular-nums">
              {kpiText(k, currency)}
            </dd>
            {k.comparison && <dd className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{k.comparison}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── the rows ──────────────────────────────────────────────────────────── */

const FIRST_ROWS = 8;
const MAX_ROWS = 100;

function OnTime({ value }) {
  // Colour never carries it alone: a glyph and a word, in ink.
  const yes = value === "Yes";
  const Icon = yes ? CheckCircle : WarningCircle;
  return (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <Icon size={16} weight="fill" className={yes ? "text-success-600" : "text-danger-600"} aria-hidden="true" />
      {yes ? "On time" : "Late"}
    </span>
  );
}

function Rows({ table, currency }) {
  const { tenant } = useAuth();
  const [all, setAll] = useState(false);
  if (!table?.rows?.length) return null;
  const cols = table.columns || [];
  const total = Math.min(table.rows.length, MAX_ROWS);
  const rows = table.rows.slice(0, all ? MAX_ROWS : FIRST_ROWS);
  const numeric = (c) => c.type === "money" || c.type === "number";

  return (
    <div className={CARD} data-testid="brain-table">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] leading-5">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-nm-edge/60 px-3 pb-2.5 pt-3.5 text-[12px] font-medium leading-4 text-muted-foreground first:pl-4 last:pr-4",
                    numeric(c) ? "text-right" : "text-left"
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={`${r[cols[0]?.key] ?? ""}-${ri}`} className="border-b border-nm-edge/35 last:border-0" data-testid={`brain-row-${ri}`}>
                {cols.map((c, ci) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-3 align-top first:pl-4 last:pr-4",
                      ci === 0 ? "min-w-[11rem] font-medium text-foreground" : "text-muted-foreground",
                      /* Only the row's name and a department may wrap. A
                         person, a date, an amount or a status broken across
                         two lines ("Anil / Kumar", "On / time") reads as two
                         values; the first column absorbs the width instead. */
                      ci > 0 && !DEPT_KEYS.has(c.key) && "whitespace-nowrap",
                      (c.type === "date" || numeric(c)) && "tabular-nums",
                      numeric(c) && "text-right",
                      c.type === "money" && "text-foreground"
                    )}
                  >
                    {c.key === "on_time" ? <OnTime value={r[c.key]} /> : cellText(c, r[c.key], currency, tenant?.roles)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > FIRST_ROWS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          data-testid="brain-table-more"
          className={cn("flex w-full items-center justify-center gap-1.5 border-t border-nm-edge/45 px-4 py-3 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.03] hover:text-foreground", FOCUS)}
        >
          {all ? <>Show fewer <CaretUp size={12} weight="bold" /></> : <>Show all {total} rows <CaretDown size={12} weight="bold" /></>}
        </button>
      )}
      {all && table.total_rows > MAX_ROWS && (
        <p className="border-t border-nm-edge/45 px-4 py-2.5 text-[12px] text-muted-foreground">
          Showing the first {MAX_ROWS} of {table.total_rows.toLocaleString(grouping(currency))} rows. Export for the full set.
        </p>
      )}
    </div>
  );
}

/* ── the signature: the records Dex read ───────────────────────────────── */

const FIRST_RECORDS = 4;

/**
 * Where the answer came from, as a list of the actual records — an invoice
 * number, a task, a person — each opening where it lives in the app. This is
 * the difference between Dex and a chatbot, so it is drawn as a thing you can
 * open, not as a row of tags: a glyph for what it is, its name, a chevron.
 * Four show; the rest are one click, so twenty sources never stand between an
 * answer and the question that follows it.
 */
function RecordTrail({ sources, onGo }) {
  const [all, setAll] = useState(false);
  if (!sources?.length) return null;
  const shown = all ? sources : sources.slice(0, FIRST_RECORDS);

  return (
    <section className={CARD} aria-label="Records this answer used" data-testid="brain-sources">
      <header className="flex items-baseline justify-between px-4 pb-1.5 pt-3.5">
        <h3 className="text-[13px] font-semibold leading-[18px] text-foreground">From your records</h3>
        <span className="text-[13px] leading-[18px] text-muted-foreground tabular-nums">{sources.length}</span>
      </header>
      <ul>
        {shown.map((s, i) => {
          const [label, Icon] = recordOf(s.type);
          const inner = (
            <>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-nm-sunken text-foreground" aria-hidden="true">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] leading-5 text-foreground">{s.title || label}</span>
                <span className="block text-[12px] leading-4 text-muted-foreground">{label}</span>
              </span>
              {s.deep_link && <CaretRight size={14} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden="true" />}
            </>
          );
          const row = "flex w-full items-center gap-3 px-4 py-2.5 text-left";
          return (
            <li key={`${s.id}-${i}`} className="relative">
              {/* Inset to the text, the way a list separates its own rows. */}
              {i > 0 && <span aria-hidden="true" className={cn("absolute left-[64px] right-0 top-0 h-px", RULE)} />}
              {s.deep_link ? (
                <button
                  type="button"
                  onClick={() => onGo?.(s.deep_link)}
                  data-testid={`brain-source-${i}`}
                  aria-label={`Open ${label.toLowerCase()}: ${s.title}`}
                  className={cn(row, "transition-colors hover:bg-foreground/[0.03]", FOCUS)}
                >
                  {inner}
                </button>
              ) : (
                <div className={row} data-testid={`brain-source-${i}`}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
      {sources.length > FIRST_RECORDS && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          data-testid="brain-sources-more"
          className={cn("flex w-full items-center justify-center gap-1.5 border-t border-nm-edge/45 px-4 py-3 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.03] hover:text-foreground", FOCUS)}
        >
          {all ? <>Show fewer <CaretUp size={12} weight="bold" /></> : <>Show all {sources.length} records <CaretDown size={12} weight="bold" /></>}
        </button>
      )}
    </section>
  );
}

/* ── what to do with it ────────────────────────────────────────────────── */

const QUIET = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40",
  FOCUS
);

const EXPORTS = { csv: "CSV", excel: "Excel", pdf: "PDF" };

/**
 * Copy, ask again, export — the "refine or revert" HIG asks to keep beside
 * generated content (generative-ai › Outputs). Quiet on purpose: none of them
 * should compete with the next question.
 */
function AnswerActions({ answer, question, onAsk, exports, contextId }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  // Exporting an answer needs "Export Company Brain"; the server refuses it otherwise.
  const canExport = exports?.length > 0 && hasPerm(user, "brain_export");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(answer || "").replace(/\*\*|`/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy — your browser blocked the clipboard.");
    }
  };

  const run = async (fmt) => {
    setBusy(fmt);
    try {
      const res = await api.post("/brain/export", { context_id: contextId, format: fmt }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `dex-answer.${fmt === "excel" ? "xlsx" : fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "That export didn't go through. Try again in a moment.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="-ml-3 flex flex-wrap items-center gap-0.5" data-testid="brain-answer-actions">
      {answer && (
        <button type="button" onClick={copy} className={QUIET} data-testid="brain-copy">
          {copied ? <Check size={15} weight="bold" /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      {question && (
        <button type="button" onClick={() => onAsk?.(question)} className={QUIET} data-testid="brain-retry">
          <ArrowClockwise size={15} /> Ask again
        </button>
      )}
      {canExport && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={QUIET} disabled={!!busy} data-testid="brain-export-bar">
              {busy ? <Loader size={15} /> : <DownloadSimple size={15} />}
              {busy ? "Exporting…" : "Export"}
              <CaretDown size={11} weight="bold" className="opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={6} className={cn(GLASS_MENU, "w-44 p-1.5")}>
            {exports.map((o) => (
              <DropdownMenuItem key={o} onSelect={() => run(o)} className={GLASS_MENU_ITEM} data-testid={`brain-export-${o}`}>
                {EXPORTS[o] || o.toUpperCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * The questions Dex suggests next. A different shape from the records on
 * purpose — a record is a thing you open (card row, chevron), a follow-up is a
 * question you send (capsule, the composer's own send arrow). Same look would
 * mean the same thing, and these are not the same thing.
 */
function AskNext({ items, onAsk, label = "Ask next" }) {
  if (!items?.length) return null;
  return (
    <div data-testid="brain-followups">
      <p className="mb-2 text-[13px] font-medium leading-[18px] text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((s, i) => (
          <button
            key={`${s}-${i}`}
            type="button"
            onClick={() => onAsk?.(s)}
            data-testid={`brain-followup-${i}`}
            className={cn(
              "group inline-flex min-h-9 items-center gap-2 rounded-full border border-nm-edge bg-white/70 py-1.5 pl-3.5 pr-1.5 text-left text-[14px] leading-5 text-foreground transition-colors hover:border-foreground/25 hover:bg-white",
              FOCUS
            )}
          >
            {s}
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-foreground transition-colors group-hover:bg-foreground group-hover:text-background" aria-hidden="true">
              <ArrowUp size={12} weight="bold" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── when Dex can't answer ─────────────────────────────────────────────── */

/**
 * A refusal is not an error and is not drawn as one: no red, no alarm. It says
 * what happened and, wherever the router gives us one, what to ask instead
 * (generative-ai › Outputs: help people improve requests when blocked).
 */
function Refusal({ icon: Icon, title, children, testid }) {
  return (
    <div className="flex gap-3.5 rounded-[20px] border border-nm-edge/60 bg-white/75 px-4 py-4" data-testid={testid}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-nm-sunken text-foreground" aria-hidden="true">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        {title && <p className="text-[15px] font-semibold leading-[22px] text-foreground">{title}</p>}
        <div className={cn("text-[15px] leading-[22px] text-foreground/85", title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

function AnswerBody({ m, onGo, onAsk, currency }) {
  const r = m.resp || {};

  if (r.type === "NOTICE") {
    return <Refusal icon={Info} testid="brain-notice">{r.answer}</Refusal>;
  }
  if (r.type === "PERMISSION_DENIED") {
    return <Refusal icon={Lock} title="That's outside your access" testid="brain-permission-denied">{r.message}</Refusal>;
  }
  if (r.type === "INSUFFICIENT_DATA") {
    return (
      <div className="space-y-4">
        <Refusal icon={MagnifyingGlass} title="Nothing in your records answers that yet" testid="brain-insufficient">
          <p>{r.answer}</p>
          {(r.missing_information || []).length > 0 && (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[14px] text-muted-foreground">
              {r.missing_information.map((x) => <li key={x}>{x}</li>)}
            </ul>
          )}
        </Refusal>
        <AskNext items={r.suggested_questions} onAsk={onAsk} label="Try one of these" />
      </div>
    );
  }

  const cur = r.currency || currency;
  return (
    <div className="space-y-4" data-testid="brain-answer">
      {r.answer && (
        <div className="max-w-[68ch] whitespace-pre-wrap text-[16px] leading-[26px] text-foreground" data-testid="brain-answer-text">
          <RichText text={r.answer} />
        </div>
      )}
      <Figures kpis={r.kpis} currency={cur} />
      <Rows table={r.table} currency={cur} />
      <RecordTrail sources={r.sources} onGo={onGo} />
      <AnswerActions
        answer={r.answer}
        question={m.question}
        onAsk={onAsk}
        exports={r.export_options}
        contextId={r.query_context_id}
      />
      <AskNext items={r.suggested_questions} onAsk={onAsk} />
    </div>
  );
}

/* ── the turn ──────────────────────────────────────────────────────────── */

/**
 * Who is speaking, said once and small. The mark is also the disclosure HIG
 * asks for (generative-ai › Transparency): this text was written by AI.
 */
function DexMark({ children }) {
  return (
    <p className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold leading-[18px] text-foreground">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-kr-ink text-white" aria-hidden="true">
        <Sparkle size={12} weight="fill" />
      </span>
      {children}
    </p>
  );
}

export function DexAnswer({ m, onGo, onAsk, currency }) {
  return (
    <article className="dex-rise" aria-label="Dex's answer">
      <DexMark>Dex</DexMark>
      <AnswerBody m={m} onGo={onGo} onAsk={onAsk} currency={currency} />
    </article>
  );
}

/**
 * Waiting, said specifically (generative-ai › Outputs: "say what's actually
 * happening" rather than "Processing…"). The app's one loading animation.
 */
export function DexThinking() {
  return (
    <div data-testid="brain-loading" aria-live="polite">
      <DexMark>Dex</DexMark>
      <p className="flex items-center gap-2.5 text-[15px] leading-[22px] text-muted-foreground">
        <Loader size={18} />
        Reading your records…
      </p>
    </div>
  );
}

export default DexAnswer;

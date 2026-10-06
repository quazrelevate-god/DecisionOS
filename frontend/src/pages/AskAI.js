// NM-13 — this file is now the ANSWER RENDERER, not a panel.
//
// It used to export AskPanel: a scroll region plus its own input + mic + Ask
// button. /brain mounted that directly beneath the Dex stage, which already
// had an input + mic + send, so the page showed the founder two identical
// composers stacked. The conversation state and the one composer moved up to
// Brain.js; what is genuinely reusable — how an /ask response is drawn — stays
// here and is exported.
import { useState } from "react";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { money, humanStage, priorityLabel, taskStatusLabel } from "../lib/format";
import { roleLabel } from "../lib/departments";
import { toast } from "sonner";
import {
  Lock, FileCsv, FileXls, FilePdf,
  ArrowRight, WarningCircle, LinkSimple, Sparkle, CaretDown,
} from "@phosphor-icons/react";
import { Loader } from "../components/common";

/** Openers for a thread with nothing in it yet. */
/* 2026-10-05 — these answers only render in the Dex room (/brain), which is
   always dark. card-brutal is the LIGHT glass card: white at 70% under the
   room's light-grey text, so every "Restricted" and "Not enough information"
   message (and the KPI tiles) was near-invisible. A card that follows the room. */
const ROOM_CARD = "rounded-[1.4rem] bg-white/70 ring-1 ring-inset ring-white/80 backdrop-blur-xl dark:bg-white/[0.06] dark:ring-white/10";

export const ASK_SUGGESTIONS = [
  "What needs my attention today?",
  "Show all tasks completed on time this month",
  "Which employees have the most overdue tasks?",
  "Show outstanding customer invoices",
];

const DEEP_TYPES = {
  task: "Task", employee: "Employee", invoice: "Invoice", payment: "Payment",
  expense: "Expense", decision: "Decision", workflow: "Workflow", contact: "Contact",
  leave: "Leave", memory: "Note",
  // 2026-10-05 — the Company Brain's own sources (documents and the records its
  // memory describes) arrived with no label and no link.
  document: "Document", complaint: "Complaint", meeting: "Meeting", note: "Note",
  file: "Attached",
};

function KpiGrid({ kpis, currency }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4" data-testid="brain-kpis">
      {kpis.map((k, i) => {
        const isMoney = typeof k.value === "number" && /billed|outstanding|spend|received|paid|total spend|amount/i.test(k.label);
        return (
          <div key={`${k.label}-${i}`} className={`${ROOM_CARD} p-4`} data-testid={`brain-kpi-${i}`}>
            <p className="label-mono text-muted-foreground text-xs">{k.label}</p>
            <p className="font-display text-2xl mt-1">
              {isMoney ? money(k.value, currency) : k.value}
            </p>
            {k.comparison && <p className="text-xs text-muted-foreground mt-0.5">{k.comparison}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* 2026-10-06 (Dex desktop pass) — CELLS IN WORDS. The tables printed stored
   values: "sales_&_order_management", "in_progress", "todo", "2026-09-22" —
   and the date wrapped onto two lines at the hyphen. Each column already says
   what it holds (`type`, and its key); the words come from the same helpers
   every other screen uses, so Dex says "Doing" where My Work says "Doing". */
const DEPT_KEYS = new Set(["role", "department", "dept", "assignee_role"]);
const SLUG = /^[a-z0-9]+(?:_&?_?[a-z0-9]+)+$/;

function dexDate(v) {
  const iso = String(v || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "—";
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso;
  const opts = { day: "numeric", month: "short", timeZone: "UTC" };
  if (dt.getUTCFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return dt.toLocaleDateString(undefined, opts);
}

function cellText(c, v, currency, roles) {
  if (v === null || v === undefined || v === "" || v === "-") return "—";
  if (c.type === "money") return money(v, currency);
  if (c.type === "number") return typeof v === "number" ? v.toLocaleString() : String(v);
  if (c.type === "date") return dexDate(v);
  if (DEPT_KEYS.has(c.key)) return roleLabel(v, roles, "—");
  if (c.key === "status") return taskStatusLabel(v);
  if (c.key === "priority") return priorityLabel(v);
  if (c.key === "stage" || c.key === "type") return humanStage(v);
  // A team's row carries its department KEY where a person's carries a name
  // ("export_&_logistics" under Employee / Team). A snake_case value in a text
  // column is always a stored key — no person, task or company is named so.
  if (typeof v === "string" && ((roles || []).some((r) => r.key === v) || SLUG.test(v))) return roleLabel(v, roles, v);
  return String(v);
}

const FIRST_ROWS = 8;

function DataTable({ table, currency }) {
  const { tenant } = useAuth();
  const [all, setAll] = useState(false);
  if (!table?.rows?.length) return null;
  const cols = table.columns || [];
  const rows = table.rows.slice(0, all ? 100 : FIRST_ROWS);
  const more = Math.min(table.rows.length, 100) - rows.length;
  const right = (c) => c.type === "money" || c.type === "number";
  return (
    /* NM-13: the head was a solid indigo bar — §0 reserves the brand fill for
       the one action on a screen, and a table header is furniture. It reads as
       a sunken well now, which is also what a fixed header IS: the surface the
       rows scroll under. */
    <div className="nm-raised overflow-x-auto mb-3" data-testid="brain-table">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-nm-sunken">
            {cols.map((c) => (
              <th key={c.key} className={`font-medium text-xs px-3 py-2 whitespace-nowrap text-muted-foreground ${right(c) ? "text-right" : "text-left"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={`${r[cols[0]?.key] ?? ""}-${ri}`} className={ri % 2 ? "bg-nm-sunken/50" : ""} data-testid={`brain-row-${ri}`}>
              {cols.map((c, ci) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 align-top border-t border-nm-edge/30 ${
                    c.type === "date" || right(c) ? "whitespace-nowrap tabular-nums" : ""
                  } ${right(c) ? "text-right" : ""} ${ci === 0 ? "min-w-[12rem] text-foreground" : "text-muted-foreground"}`}
                >
                  {c.key === "on_time"
                    ? <span className={r[c.key] === "Yes" ? "text-success-600 font-semibold" : "text-danger-600 font-semibold"}>{r[c.key]}</span>
                    : cellText(c, r[c.key], currency, tenant?.roles)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          data-testid="brain-table-more"
          className="flex w-full items-center justify-center gap-1.5 border-t border-nm-edge/30 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Show all {Math.min(table.rows.length, 100)} rows <CaretDown size={12} weight="bold" />
        </button>
      )}
      {all && table.total_rows > 100 && (
        <p className="text-xs text-muted-foreground px-3 py-2 border-t border-nm-edge/30">Showing first 100 of {table.total_rows} rows — export for the full set.</p>
      )}
    </div>
  );
}

/* 2026-10-06 — twenty sources drew twenty chips: a wall between the answer
   and the questions that follow it. The first few show; the rest are a click. */
const FIRST_SOURCES = 6;

function Sources({ sources, onGo }) {
  const [all, setAll] = useState(false);
  if (!sources?.length) return null;
  const shown = all ? sources : sources.slice(0, FIRST_SOURCES);
  const rest = sources.length - shown.length;
  return (
    <div className="mb-3" data-testid="brain-sources">
      <p className="label-mono text-muted-foreground text-xs mb-1.5 flex items-center gap-1"><LinkSimple size={13} weight="bold" /> Sources · {sources.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((s, i) => {
          const label = <span className="text-brand-600 uppercase font-semibold">{DEEP_TYPES[s.type] || s.type || "Note"}</span>;
          const title = <span className="truncate max-w-[220px]">{s.title}</span>;
          return s.deep_link ? (
            <button key={`${s.id}-${i}`} onClick={() => onGo(s.deep_link)} data-testid={`brain-source-${i}`}
              title={s.confidence ? `${s.confidence}` : ""}
              className="inline-flex items-center gap-1 nm-tile px-2 py-1 text-xs hover:bg-accent transition-colors">
              {label}{title}
            </button>
          ) : (
            <span key={`${s.id}-${i}`} data-testid={`brain-source-${i}`}
              className="inline-flex items-center gap-1 nm-tile px-2 py-1 text-xs opacity-80">
              {label}{title}
            </span>
          );
        })}
        {rest > 0 && (
          <button
            type="button"
            onClick={() => setAll(true)}
            data-testid="brain-sources-more"
            className="inline-flex items-center nm-tile px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            +{rest} more
          </button>
        )}
      </div>
    </div>
  );
}

function ExportBar({ options, contextId }) {
  const [busy, setBusy] = useState("");
  const { user } = useAuth();
  /* 2026-10-03 RBAC audit — exporting an answer needs "Export Company Brain";
     the buttons showed to everyone who could ask and the server refused them. */
  if (!options?.length || !hasPerm(user, "brain_export")) return null;
  const run = async (fmt) => {
    setBusy(fmt);
    try {
      const res = await api.post("/brain/export", { context_id: contextId, format: fmt }, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `company-brain.${fmt === "excel" ? "xlsx" : fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Export failed");
    } finally { setBusy(""); }
  };
  const ICON = { csv: FileCsv, excel: FileXls, pdf: FilePdf };
  return (
    <div className="flex flex-wrap gap-2" data-testid="brain-export-bar">
      {options.map((o) => {
        const Icon = ICON[o] || FileCsv;
        return (
          <button key={o} onClick={() => run(o)} disabled={!!busy} data-testid={`brain-export-${o}`}
            className="inline-flex items-center gap-1.5 nm-tile px-3 py-1.5 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">
            <Icon size={15} weight="bold" /> {busy === o ? "…" : o === "excel" ? "Excel" : o.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

function FollowUps({ items, onAsk }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="brain-followups">
      {items.map((s, i) => (
        <button key={`${s}-${i}`} onClick={() => onAsk(s)} data-testid={`brain-followup-${i}`}
          className="inline-flex items-center gap-1 rounded-pill nm-tile px-3 py-1.5 text-xs transition-shadow hover:shadow-nm-sm active:shadow-nm-press">
          {s} <ArrowRight size={12} weight="bold" />
        </button>
      ))}
    </div>
  );
}

/**
 * NM-15 — the /ask answer arrives as light markdown and was being printed raw,
 * so the founder read literal asterisks: "**File TDS return for Q2** assigned
 * to Sunita Rao". Every emphasis the model added — which is exactly the task
 * names, people and amounts — landed as punctuation noise.
 *
 * Deliberately NOT a markdown library. The backend emits `**bold**` and
 * `` `code` `` and nothing else; pulling in a parser (and a sanitiser, since
 * this is model output) to handle two constructs would be a dependency and an
 * XSS surface for no gain. Split, never dangerouslySetInnerHTML — the text
 * stays text and React escapes it.
 */
function RichText({ text }) {
  // ** before * — otherwise the single-asterisk alternative eats the opening
  // pair of every bold run and everything after it renders inside-out.
  const parts = String(text ?? "").split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
          return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
        }
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
          return <em key={i}>{p.slice(1, -1)}</em>;
        }
        if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
          return (
            <code key={i} className="rounded bg-nm-sunken px-1 py-0.5 font-mono text-[0.9em]">
              {p.slice(1, -1)}
            </code>
          );
        }
        return p;
      })}
    </>
  );
}

/* 2026-10-06 (Dex desktop pass) — WHO IS SPEAKING. Every answer opened with
   "DEX →" in 10px indigo, glued to the first word of the sentence. A chat says
   who is talking with a mark beside the message; the text is then only text. */
export function DexAvatar({ thinking = false }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full nm-raised text-primary"
      aria-hidden="true"
      data-testid="dex-avatar"
    >
      {thinking ? <Loader size={16} className="text-primary" /> : <Sparkle size={15} weight="fill" />}
    </span>
  );
}

function DexTurn({ children }) {
  return (
    <div className="flex items-start gap-3">
      <DexAvatar />
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Dex</p>
        {children}
      </div>
    </div>
  );
}

export function AiAnswer(props) {
  return <DexTurn><AnswerBody {...props} /></DexTurn>;
}

function AnswerBody({ m, onGo, onAsk, currency }) {
  /* A refusal or a failure (no access, AI switched off, the month's allowance
     used up) is a notice about Dex, not something Dex found in the records. */
  if (m.resp?.type === "NOTICE") {
    return (
      <div className={`${ROOM_CARD} p-4`} data-testid="brain-notice">
        <p className="flex items-start gap-2 text-sm">
          <WarningCircle size={16} weight="bold" className="mt-0.5 shrink-0 text-caution-600" />
          <span>{m.resp.answer}</span>
        </p>
      </div>
    );
  }
  if (m.resp?.type === "PERMISSION_DENIED") {
    return (
      <div className={`${ROOM_CARD} p-4 border-l-4 border-l-brand-600`} data-testid="brain-permission-denied">
        <p className="flex items-center gap-2 font-semibold text-sm"><Lock size={16} weight="bold" className="text-brand-600" /> Restricted</p>
        <p className="text-sm text-muted-foreground mt-1">{m.resp.message}</p>
      </div>
    );
  }
  if (m.resp?.type === "INSUFFICIENT_DATA") {
    return (
      <div className={`${ROOM_CARD} p-4 border-l-4 border-l-caution-500`} data-testid="brain-insufficient">
        <p className="flex items-center gap-2 font-semibold text-sm"><WarningCircle size={16} weight="bold" className="text-caution-600" /> Not enough information</p>
        <p className="text-sm text-muted-foreground mt-1">{m.resp.answer}</p>
        {(m.resp.missing_information || []).length > 0 && (
          <ul className="mt-2 text-xs text-muted-foreground list-disc pl-5">
            {m.resp.missing_information.map((x) => <li key={x}>{x}</li>)}
          </ul>
        )}
        <FollowUps items={m.resp.suggested_questions} onAsk={onAsk} />
      </div>
    );
  }
  const r = m.resp || {};
  return (
    <div className="space-y-1" data-testid="brain-answer">
      {r.answer && (
        <div className="text-[15px] leading-relaxed whitespace-pre-wrap mb-4">
          <RichText text={r.answer} />
        </div>
      )}
      <KpiGrid kpis={r.kpis} currency={r.currency || currency} />
      <DataTable table={r.table} currency={r.currency || currency} />
      <Sources sources={r.sources} onGo={onGo} />
      <ExportBar options={r.export_options} contextId={r.query_context_id} />
      <FollowUps items={r.suggested_questions} onAsk={onAsk} />
    </div>
  );
}


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
import { money } from "../lib/format";
import { toast } from "sonner";
import {
  Lock, FileCsv, FileXls, FilePdf,
  ArrowRight, WarningCircle, LinkSimple,
} from "@phosphor-icons/react";
// Epic 2 Sprint 5 (E2-40): persona voice marker on every AI response.
import { DexBadge } from "../components/common";

/** Openers for a thread with nothing in it yet. */
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
};

function KpiGrid({ kpis, currency }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4" data-testid="brain-kpis">
      {kpis.map((k, i) => {
        const isMoney = typeof k.value === "number" && /billed|outstanding|spend|received|paid|total spend|amount/i.test(k.label);
        return (
          <div key={`${k.label}-${i}`} className="card-brutal p-4" data-testid={`brain-kpi-${i}`}>
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

function DataTable({ table, currency }) {
  if (!table?.rows?.length) return null;
  const cols = table.columns || [];
  return (
    /* NM-13: the head was a solid indigo bar — §0 reserves the brand fill for
       the one action on a screen, and a table header is furniture. It reads as
       a sunken well now, which is also what a fixed header IS: the surface the
       rows scroll under. */
    <div className="nm-raised overflow-x-auto mb-3" data-testid="brain-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-nm-sunken">
            {cols.map((c) => (
              <th key={c.key} className="text-left font-medium text-xs px-3 py-2 whitespace-nowrap text-muted-foreground">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, 100).map((r, ri) => (
            <tr key={`${r[cols[0]?.key] ?? ""}-${ri}`} className={ri % 2 ? "bg-nm-sunken/50" : ""} data-testid={`brain-row-${ri}`}>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top border-t border-nm-edge/30">
                  {c.type === "money" ? money(r[c.key], currency)
                    : c.key === "on_time"
                      ? <span className={r[c.key] === "Yes" ? "text-success-600 font-semibold" : "text-danger-600 font-semibold"}>{r[c.key]}</span>
                      : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.total_rows > 100 && (
        <p className="text-xs text-muted-foreground px-3 py-2 border-t border-nm-edge/30">Showing first 100 of {table.total_rows} rows — export for the full set.</p>
      )}
    </div>
  );
}

function Sources({ sources, onGo }) {
  if (!sources?.length) return null;
  return (
    <div className="mb-3" data-testid="brain-sources">
      <p className="label-mono text-muted-foreground text-xs mb-1.5 flex items-center gap-1"><LinkSimple size={13} weight="bold" /> Sources · {sources.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <button key={`${s.id}-${i}`} onClick={() => onGo(s.deep_link)} data-testid={`brain-source-${i}`}
            title={s.confidence ? `${s.confidence}` : ""}
            className="inline-flex items-center gap-1 nm-tile px-2 py-1 text-xs hover:bg-accent transition-colors">
            <span className="text-brand-600 uppercase font-semibold">{DEEP_TYPES[s.type] || s.type}</span>
            <span className="truncate max-w-[220px]">{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportBar({ options, contextId }) {
  const [busy, setBusy] = useState("");
  if (!options?.length) return null;
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

export function AiAnswer({ m, onGo, onAsk, currency }) {
  if (m.resp?.type === "PERMISSION_DENIED") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-brand-600" data-testid="brain-permission-denied">
        <p className="flex items-center gap-2 font-semibold text-sm"><Lock size={16} weight="bold" className="text-brand-600" /> Restricted</p>
        <p className="text-sm text-muted-foreground mt-1">{m.resp.message}</p>
      </div>
    );
  }
  if (m.resp?.type === "INSUFFICIENT_DATA") {
    return (
      <div className="card-brutal p-4 border-l-4 border-l-caution-500" data-testid="brain-insufficient">
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
        <div className="text-sm leading-relaxed whitespace-pre-wrap mb-3">
          <DexBadge inline /><RichText text={r.answer} />
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


/*
 * Shared result-rendering components used by AskAI.js and Chatbot.js.
 * Extracted from AskAI.js so both surfaces render identically without
 * duplicating the JSX (approved by product: "extract shared components").
 * AskAI.js now imports these instead of defining them locally.
 * NO behaviour change vs the original AskAI implementations.
 */
import { LinkSimple } from "@phosphor-icons/react";
import { money } from "../lib/format";

export const DEEP_TYPES = {
  task: "Task", employee: "Employee", invoice: "Invoice", payment: "Payment",
  expense: "Expense", decision: "Decision", workflow: "Workflow", contact: "Contact",
  leave: "Leave", memory: "Note",
};

export function KpiGrid({ kpis, currency }) {
  if (!kpis?.length) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4" data-testid="brain-kpis">
      {kpis.map((k, i) => {
        const isMoney = typeof k.value === "number" && /billed|outstanding|spend|received|paid|total spend|amount/i.test(k.label);
        return (
          <div key={`${k.label}-${i}`} className="card-brutal p-4" data-testid={`brain-kpi-${i}`}>
            <p className="label-mono text-muted-foreground text-xs">{k.label}</p>
            <p className="font-heading text-2xl font-black tracking-tighter mt-1">
              {isMoney ? money(k.value, currency) : k.value}
            </p>
            {k.comparison && <p className="text-xs text-muted-foreground mt-0.5">{k.comparison}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function DataTable({ table, currency }) {
  if (!table?.rows?.length) return null;
  const cols = table.columns || [];
  return (
    <div className="border border-black overflow-x-auto mb-3" data-testid="brain-table">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-ink text-white">
            {cols.map((c) => (
              <th key={c.key} className="text-left font-semibold uppercase tracking-wider text-xs px-3 py-2 whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.slice(0, 100).map((r, ri) => (
            <tr key={`${r[cols[0]?.key] ?? ""}-${ri}`} className={ri % 2 ? "bg-black/[0.03]" : ""} data-testid={`brain-row-${ri}`}>
              {cols.map((c) => (
                <td key={c.key} className="px-3 py-2 align-top border-t border-black/10">
                  {c.type === "money" ? money(r[c.key], currency)
                    : c.key === "on_time"
                      ? <span className={r[c.key] === "Yes" ? "text-green-600 font-semibold" : "text-brand-red font-semibold"}>{r[c.key]}</span>
                      : String(r[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.total_rows > 100 && (
        <p className="text-xs text-muted-foreground px-3 py-2 border-t border-black/10">Showing first 100 of {table.total_rows} rows — export for the full set.</p>
      )}
    </div>
  );
}

export function Sources({ sources, onGo }) {
  if (!sources?.length) return null;
  return (
    <div className="mb-3" data-testid="brain-sources">
      <p className="label-mono text-muted-foreground text-xs mb-1.5 flex items-center gap-1"><LinkSimple size={13} weight="bold" /> Sources · {sources.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <button key={`${s.id}-${i}`} onClick={() => onGo?.(s.deep_link)} data-testid={`brain-source-${i}`}
            title={s.confidence ? `${s.confidence}` : ""}
            className="inline-flex items-center gap-1 border border-black bg-white px-2 py-1 text-xs hover:bg-brand-ink hover:text-white transition-colors">
            <span className="text-brand-red uppercase font-semibold">{DEEP_TYPES[s.type] || s.type}</span>
            <span className="truncate max-w-[220px]">{s.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { money } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  PaperPlaneTilt, Lock, Sparkle, FileCsv, FileXls, FilePdf,
  ArrowRight, WarningCircle, LinkSimple, Broom,
} from "@phosphor-icons/react";
import { MicDictateButton } from "../components/MicDictateButton";
// Epic 2 Sprint 5 (E2-40): persona voice marker on every AI response.
import { DexBadge } from "../components/common";

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

function DataTable({ table, currency }) {
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
                      ? <span className={r[c.key] === "Yes" ? "text-green-600 font-semibold" : "text-brand-600 font-semibold"}>{r[c.key]}</span>
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

function Sources({ sources, onGo }) {
  if (!sources?.length) return null;
  return (
    <div className="mb-3" data-testid="brain-sources">
      <p className="label-mono text-muted-foreground text-xs mb-1.5 flex items-center gap-1"><LinkSimple size={13} weight="bold" /> Sources · {sources.length}</p>
      <div className="flex flex-wrap gap-1.5">
        {sources.map((s, i) => (
          <button key={`${s.id}-${i}`} onClick={() => onGo(s.deep_link)} data-testid={`brain-source-${i}`}
            title={s.confidence ? `${s.confidence}` : ""}
            className="inline-flex items-center gap-1 border border-black bg-white px-2 py-1 text-xs hover:bg-brand-ink hover:text-white transition-colors">
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
            className="inline-flex items-center gap-1.5 border border-black bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-brand-ink hover:text-white transition-colors disabled:opacity-50">
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
          className="inline-flex items-center gap-1 text-xs border border-black/40 px-2.5 py-1 rounded-full hover:bg-brand-ink hover:text-white transition-colors">
          {s} <ArrowRight size={12} weight="bold" />
        </button>
      ))}
    </div>
  );
}

function AiAnswer({ m, onGo, onAsk, currency }) {
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
      <div className="card-brutal p-4 border-l-4 border-l-amber-500" data-testid="brain-insufficient">
        <p className="flex items-center gap-2 font-semibold text-sm"><WarningCircle size={16} weight="bold" className="text-amber-500" /> Not enough information</p>
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
          <DexBadge inline />{r.answer}
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

export function AskPanel() {
  const { t } = useTranslation();
  const { tenant } = useAuth();
  const navigate = useNavigate();
  const currency = tenant?.currency || "INR";
  const SUGGESTIONS = [
    "What needs my attention today?",
    "Show all tasks completed on time this month",
    "Which employees have the most overdue tasks?",
    "Show outstanding customer invoices",
  ];
  const [log, setLog] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctxId, setCtxId] = useState(null);
  const endRef = useRef(null);
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  const go = (link) => { if (link) navigate(link); };

  const ask = async (question) => {
    const text = question ?? q;
    if (!text.trim() || busy) return;
    setLog((l) => [...l, { id: uid(), role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      setLog((l) => [...l, { id: uid(), role: "ai", resp: data }]);
    } catch {
      setLog((l) => [...l, { id: uid(), role: "ai", resp: { type: "ANSWER", answer: t("ask.error") } }]);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => { setLog([]); setCtxId(null); };

  return (
    <div className="flex flex-col h-[calc(100vh-15rem)] lg:h-[calc(100vh-12rem)]">
      <div className="flex-1 overflow-y-auto pr-1 space-y-5" data-testid="brain-conversation">
        {log.length === 0 && (
          <div className="card-brutal p-6" data-testid="brain-empty">
            <p className="flex items-center gap-2 font-heading text-lg font-black uppercase tracking-tight">
              <Sparkle size={20} weight="fill" className="text-brand-600" /> Ask your company anything
            </p>
            <p className="text-sm text-muted-foreground mt-1">Every answer is computed from your authorised workspace data — with clickable sources you can open.</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} data-testid="ask-suggestion"
                  className="text-xs border border-black px-3 py-1.5 hover:bg-brand-ink hover:text-white transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {log.map((m, i) => (
          <div key={m.id} data-testid={`chat-msg-${m.role}-${i}`}>
            {m.role === "user" ? (
              <div className="flex justify-end">
                <p className="inline-block bg-brand-ink text-white px-4 py-2 text-sm max-w-[85%]">{m.text}</p>
              </div>
            ) : (
              <AiAnswer m={m} onGo={go} onAsk={ask} currency={currency} />
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse" data-testid="brain-loading">
            <Sparkle size={16} weight="fill" className="text-brand-600" /> Understanding your question, checking access & searching your records…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2 mt-3">
        <div className="flex-1 min-w-0 flex items-center border border-black bg-white px-4">
          <span className="text-brand-600 font-bold">{">"}</span>
          <input
            data-testid="ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask your company anything…"
            className="flex-1 min-w-0 py-3 px-3 text-sm focus:outline-none"
          />
        </div>
        {log.length > 0 && (
          <button type="button" onClick={clear} data-testid="brain-clear" title="New conversation"
            className="px-3 border border-black bg-white hover:bg-black/5 transition-colors">
            <Broom size={16} weight="bold" />
          </button>
        )}
        <MicDictateButton className="px-4" title={t("ask.speak_q")} onText={(txt) => setQ((v) => (v ? `${v} ${txt}` : txt))} />
        <button data-testid="ask-submit" disabled={busy} className="shrink-0 bg-brand-600 text-white px-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50">
          <PaperPlaneTilt size={16} weight="bold" /> {t("ask.btn")}
        </button>
      </form>
    </div>
  );
}

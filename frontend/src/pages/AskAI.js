import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import api from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  PaperPlaneTilt, Lock, Sparkle, FileCsv, FileXls, FilePdf,
  ArrowRight, WarningCircle, Broom,
} from "@phosphor-icons/react";
import { MicDictateButton } from "../components/MicDictateButton";
// KpiGrid, DataTable, Sources moved to a shared component so Chatbot.js and
// AskAI render identically. Behaviour is IDENTICAL to the previous local
// definitions — this is imports-only.
import { KpiGrid, DataTable, Sources } from "../components/BrainResults";

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
      <div className="card-brutal p-4 border-l-4 border-l-brand-red" data-testid="brain-permission-denied">
        <p className="flex items-center gap-2 font-semibold text-sm"><Lock size={16} weight="bold" className="text-brand-red" /> Restricted</p>
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
      {r.answer && <div className="text-sm leading-relaxed whitespace-pre-wrap mb-3">{r.answer}</div>}
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
              <Sparkle size={20} weight="fill" className="text-brand-red" /> Ask your company anything
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
            <Sparkle size={16} weight="fill" className="text-brand-red" /> Understanding your question, checking access & searching your records…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2 mt-3">
        <div className="flex-1 flex items-center border border-black bg-white px-4">
          <span className="text-brand-red font-bold">{">"}</span>
          <input
            data-testid="ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask your company anything…"
            className="flex-1 py-3 px-3 text-sm focus:outline-none"
          />
        </div>
        {log.length > 0 && (
          <button type="button" onClick={clear} data-testid="brain-clear" title="New conversation"
            className="px-3 border border-black bg-white hover:bg-black/5 transition-colors">
            <Broom size={16} weight="bold" />
          </button>
        )}
        <MicDictateButton className="px-4" title={t("ask.speak_q")} onText={(txt) => setQ((v) => (v ? `${v} ${txt}` : txt))} />
        <button data-testid="ask-submit" disabled={busy} className="bg-brand-red text-white px-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50">
          <PaperPlaneTilt size={16} weight="bold" /> {t("ask.btn")}
        </button>
      </form>
    </div>
  );
}

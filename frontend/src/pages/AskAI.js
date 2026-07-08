import { useState, useRef, useEffect } from "react";
import api from "../lib/api";
import { PageHeader } from "../components/common";
import { PaperPlaneTilt } from "@phosphor-icons/react";

const SUGGESTIONS = [
  "What purchases need my approval?",
  "Which tasks are overdue?",
  "Summarise open sales orders",
  "What did I decide about festive stock?",
];

export default function AskAI() {
  const [log, setLog] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log, busy]);

  const ask = async (question) => {
    const text = question ?? q;
    if (!text.trim() || busy) return;
    setLog((l) => [...l, { id: uid(), role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text });
      setLog((l) => [...l, { id: uid(), role: "ai", text: data.answer, citations: data.citations || [] }]);
    } catch {
      setLog((l) => [...l, { id: uid(), role: "ai", text: "AI service error. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-13rem)] lg:h-[calc(100vh-8rem)]">
      <PageHeader eyebrow="Query your company context" title="Ask AI" />

      <div className="flex-1 border border-black bg-brand-ink text-white font-mono text-sm overflow-y-auto p-6 space-y-4">
        {log.length === 0 && (
          <div className="text-white/50">
            <p>{"> DecisionOS Ask AI — grounded in your company data."}</p>
            <p className="mt-2">{"> Try one of the queries below to begin."}</p>
          </div>
        )}
        {log.map((m, i) => (
          <div key={m.id} data-testid={`chat-msg-${m.role}-${i}`}>
            {m.role === "user" ? (
              <p className="text-brand-yellow">{"> "}{m.text}</p>
            ) : (
              <div>
                <p className="text-white whitespace-pre-wrap leading-relaxed">{m.text}</p>
                {(m.citations || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2" data-testid={`citations-${i}`}>
                    <span className="text-white/40 text-xs uppercase tracking-wider mr-1">Sources:</span>
                    {m.citations.map((c, ci) => (
                      <span key={`${c.type}-${c.title}-${ci}`} data-testid="citation-chip" className="inline-flex items-center gap-1 border border-white/40 text-white/80 px-2 py-0.5 text-[11px]">
                        <span className="text-brand-red uppercase">{c.type}</span> {c.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-white/50 animate-pulse">{"> thinking…"}</p>}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 flex-wrap my-3">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => ask(s)} data-testid="ask-suggestion"
            className="text-xs border border-black px-3 py-1.5 hover:bg-brand-ink hover:text-white transition-colors">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <div className="flex-1 flex items-center border border-black bg-white px-4 font-mono">
          <span className="text-brand-red font-bold">{">"}</span>
          <input
            data-testid="ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask anything about your operations…"
            className="flex-1 py-3 px-3 text-sm focus:outline-none"
          />
        </div>
        <button data-testid="ask-submit" disabled={busy} className="relative z-[10000] bg-brand-red text-white px-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-black hover:shadow-brutal transition-all disabled:opacity-50">
          <PaperPlaneTilt size={16} weight="bold" /> Ask
        </button>
      </form>
    </div>
  );
}

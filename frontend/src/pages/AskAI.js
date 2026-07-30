import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import api from "../lib/api";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import { MicDictateButton } from "../components/MicDictateButton";

export function AskPanel() {
  const { t } = useTranslation();
  const SUGGESTIONS = [t("ask.s1"), t("ask.s2"), t("ask.s3"), t("ask.s4")];
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
      setLog((l) => [...l, { id: uid(), role: "ai", text: t("ask.error") }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-16rem)] lg:h-[calc(100vh-13rem)]">
      <div className="flex-1 border border-hairline bg-primary text-primary-foreground text-label uppercase text-sm overflow-y-auto p-6 space-y-4">
        {log.length === 0 && (
          <div className="text-white/50">
            <p>{t("ask.intro1")}</p>
            <p className="mt-2">{t("ask.intro2")}</p>
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
                    <span className="text-white/40 text-xs uppercase tracking-wider mr-1">{t("ask.sources")}</span>
                    {m.citations.map((c, ci) => (
                      <span key={`${c.type}-${c.title}-${ci}`} data-testid="citation-chip" className="inline-flex items-center gap-1 border border-white/40 text-white/80 px-2 py-0.5 text-[11px]">
                        <span className="text-primary-text uppercase">{c.type}</span> {c.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-white/50 animate-pulse">{t("ask.thinking")}</p>}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 flex-wrap my-3">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => ask(s)} data-testid="ask-suggestion"
            className="text-xs border border-hairline px-3 py-1.5 hover:bg-surface-hover transition-colors">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
        <div className="flex-1 flex items-center border border-hairline bg-surface px-4 text-label uppercase">
          <span className="text-primary-text font-bold">{">"}</span>
          <input
            data-testid="ask-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("ask.placeholder")}
            className="flex-1 py-3 px-3 text-sm focus:outline-none"
          />
        </div>
        <MicDictateButton className="px-4" title={t("ask.speak_q")} onText={(t) => setQ((v) => (v ? `${v} ${t}` : t))} />
        <button data-testid="ask-submit" disabled={busy} className="relative z-[10000] bg-primary text-primary-foreground px-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider border border-hairline hover:shadow-sm transition-all disabled:opacity-50">
          <PaperPlaneTilt size={16} weight="bold" /> {t("ask.btn")}
        </button>
      </form>
    </div>
  );
}

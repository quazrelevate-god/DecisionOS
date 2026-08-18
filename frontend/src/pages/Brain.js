// /brain — Dex.
//
// NM-13 (2026-08-18). This page was three things stacked: the Dex stage (orb +
// composer), a three-way segmented strip (Ask · Search · Documents), and
// whichever panel the strip selected — and the Ask panel brought its own
// composer, so the founder saw the same input/mic/send row twice, ~200px
// apart. It read as a settings screen wrapped around a chatbot.
//
// It is now a conversation. One composer, one thread, no strip:
//
//   ASK went away as a *tab* because it is the page. Nothing to switch to.
//   SEARCH went away entirely. /brain/search returned four columns of raw
//     matches; /ask searches the same records and answers in a sentence with
//     the matches attached as clickable sources. Keeping both meant offering a
//     worse version of the page's own job. This also FIXES the global header
//     search, which has been navigating to /brain?q=… since RD-1 while nothing
//     on this page read the parameter — the query was silently dropped. It is
//     now asked on arrival.
//   DOCUMENTS stayed, as a quiet link rather than a third of a segmented bar.
//     It is a file library, not a way of talking to Dex.
//
// The composer is above the thread, not below it. With the orb as the page's
// anchor, a bottom-docked composer would push the orb off-screen the moment a
// conversation started; this way the input never moves and answers open
// beneath it.
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../lib/api";
import { Books, ArrowLeft, Broom, Sparkle, Spinner } from "@phosphor-icons/react";
import { AiAnswer, ASK_SUGGESTIONS } from "./AskAI";
import { DocumentsPanel } from "./BrainDocuments";
import { useDexCapture } from "../hooks/useDexCapture";
import { DexStage } from "./brain/DexStage";
import { useAuth } from "../context/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function Brain() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tenant } = useAuth();
  const currency = tenant?.currency || "INR";

  // NM-13: one implementation for both viewports. The mobile branch here was a
  // heading + a wrapping pill strip + DexCaptureBar size="lg" — i.e. the same
  // duplicate-composer problem in a thumb-sized costume. The stage is already
  // a centred column with 44px controls, which is what the phone needed.
  const [searchParams] = useSearchParams();
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ctxId, setCtxId] = useState(null);
  const [showDocs, setShowDocs] = useState(false);
  const endRef = useRef(null);

  const capture = useDexCapture({
    onCaptured: () => {
      qc.invalidateQueries({ queryKey: ["voice-notes"] });
      qc.invalidateQueries({ queryKey: ["dex-inflight-count"] });
    },
  });

  const ask = useCallback(async (question) => {
    const text = String(question || "").trim();
    if (!text) return;
    setShowDocs(false);
    setLog((l) => [...l, { id: uid(), role: "user", text }]);
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
  }, [ctxId, t]);

  // The header's global search lands here as ?q=…. Ask it once, on arrival.
  const seededRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !seededRef.current) {
      seededRef.current = true;
      ask(q);
    }
  }, [searchParams, ask]);

  // Answers open BELOW the composer, so the newest one is what we scroll to.
  useEffect(() => {
    if (log.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log, busy]);

  // E2-35: poll for captures Dex is still structuring, so "did my capture go
  // through?" is answered with "Dex is structuring N right now".
  const { data: inflight } = useQuery({
    queryKey: ["dex-inflight-count"],
    queryFn: () => api.get("/dex/inflight-count").then((r) => r.data),
    refetchInterval: 8000,
  });
  const inflightN = inflight?.count || 0;

  const hasThread = log.length > 0 || busy;
  const clear = () => { setLog([]); setCtxId(null); };

  return (
    <div className="mx-auto max-w-3xl" data-testid="brain-page">
      <DexStage
        capture={capture}
        onAsk={ask}
        thinking={busy}
        compact={hasThread || showDocs}
        trailing={
          /* Quiet page actions. Text-weight on purpose — these are ways OUT of
             the conversation, and nothing here should compete with the send
             button two rows above. */
          <div className="flex items-center gap-1.5" data-testid="brain-actions">
            <button
              type="button"
              onClick={() => setShowDocs((v) => !v)}
              data-testid="brain-documents-toggle"
              aria-pressed={showDocs}
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium text-muted-foreground transition-shadow hover:text-foreground hover:shadow-nm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {showDocs ? <ArrowLeft size={14} weight="bold" /> : <Books size={14} weight="bold" />}
              {showDocs ? "Back to Dex" : "Documents"}
            </button>
            {log.length > 0 && !showDocs && (
              <button
                type="button"
                onClick={clear}
                data-testid="brain-clear"
                className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium text-muted-foreground transition-shadow hover:text-foreground hover:shadow-nm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Broom size={14} weight="bold" /> New conversation
              </button>
            )}
          </div>
        }
      />

      {/* E2-35 in-flight badge. NM-13: a soft inset note, not a bordered
          amber slab — it is a status whisper, not a warning. */}
      {inflightN > 0 && (
        <div
          data-testid="dex-inflight-badge"
          className="mt-4 inline-flex items-center gap-2 rounded-pill nm-inset px-3 py-1.5"
        >
          <Spinner size={14} weight="bold" className="animate-spin text-primary" />
          <span className="text-xs font-medium text-muted-foreground">
            Dex is structuring {inflightN} capture{inflightN === 1 ? "" : "s"} right now
          </span>
        </div>
      )}

      {showDocs ? (
        <div className="mt-6" data-testid="brain-documents">
          <DocumentsPanel />
        </div>
      ) : (
        <div className="mt-6 space-y-5" data-testid="brain-conversation">
          {log.length === 0 && !busy && (
            /* The opener. Four real questions rather than a paragraph about
               what Dex can do — the fastest way to learn a chat surface is to
               watch it answer once. */
            <div className="flex flex-wrap justify-center gap-2" data-testid="brain-empty">
              {ASK_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  data-testid="ask-suggestion"
                  className="rounded-pill nm-tile px-3.5 py-2 text-xs text-muted-foreground transition-shadow hover:text-foreground hover:shadow-nm-sm active:shadow-nm-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {log.map((m, i) => (
            <div key={m.id} data-testid={`chat-msg-${m.role}-${i}`}>
              {m.role === "user" ? (
                <div className="flex justify-end">
                  {/* The founder's own line: a raised bubble, not the indigo
                      fill. §0 keeps the brand colour for the one action on the
                      screen — a transcript entry is not an action. */}
                  <p className="inline-block max-w-[85%] rounded-cardlg nm-raised px-4 py-2.5 text-sm">
                    {m.text}
                  </p>
                </div>
              ) : (
                <AiAnswer m={m} onGo={(link) => link && navigate(link)} onAsk={ask} currency={currency} />
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse" data-testid="brain-loading">
              <Sparkle size={16} weight="fill" className="text-primary" />
              Understanding your question, checking access &amp; searching your records…
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

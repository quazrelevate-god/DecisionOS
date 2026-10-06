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
import { isAiConsentError, aiConsentMessage } from "../lib/aiConsent";
import { isAiLimitError, aiLimitMessage } from "../lib/aiLimit";
import { ArrowUpRight, Books, Broom } from "@phosphor-icons/react";
import { AiAnswer, ASK_SUGGESTIONS, DexAvatar } from "./AskAI";
import { useDexCapture } from "../hooks/useDexCapture";
import { DexStage } from "./brain/DexStage";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { useQuery, useQueryClient } from "@tanstack/react-query";
// ASK-36 5 — the app's one loading animation.
import { Loader } from "../components/common";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export default function Brain() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();
  /* 2026-10-03 RBAC audit — this page opens with Company Brain access, but
     asking takes Ask AI (/ask is require_perm("ask")). Someone with the one
     and not the other typed a question and read "AI service error", which no
     retry could fix. Say what it is instead, and don't offer the chips. */
  const canAsk = hasPerm(user, "ask");
  const NO_ASK = "Asking Dex needs Ask AI access. Your owner can switch it on for you in Team.";
  const currency = tenant?.currency || "INR";

  // NM-13: one implementation for both viewports. The mobile branch here was a
  // heading + a wrapping pill strip + DexCaptureBar size="lg" — i.e. the same
  // duplicate-composer problem in a thumb-sized costume. The stage is already
  // a centred column with 44px controls, which is what the phone needed.
  const [searchParams] = useSearchParams();
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [ctxId, setCtxId] = useState(null);
  const endRef = useRef(null);

  const capture = useDexCapture({
    onCaptured: () => {
      qc.invalidateQueries({ queryKey: ["voice-notes"] });
      qc.invalidateQueries({ queryKey: ["dex-inflight-count"] });
    },
  });

  const ask = useCallback(async (question) => {
    if (!canAsk) {
      setLog((l) => [...l, { id: uid(), role: "ai", resp: { type: "NOTICE", answer: NO_ASK } }]);
      return;
    }
    const text = String(question || "").trim();
    if (!text) return;
    setLog((l) => [...l, { id: uid(), role: "user", text }]);
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      setLog((l) => [...l, { id: uid(), role: "ai", resp: data }]);
    } catch (e) {
      /* 2026-09-26 — "AI service error. Please try again." was what a company
         with AI switched off was told, however many times they tried. When it
         is the consent gate, say that instead; the toast beside it carries the
         way to the screen that turns it on (lib/aiConsent). */
      const answer = isAiConsentError(e) ? aiConsentMessage()
        : isAiLimitError(e) ? aiLimitMessage(e)
        : e?.response?.status === 403 ? NO_ASK : t("ask.error");
      setLog((l) => [...l, { id: uid(), role: "ai", resp: { type: "NOTICE", answer } }]);
    } finally {
      setBusy(false);
    }
  }, [ctxId, t, canAsk]);

  // 2026-10-06 — documents live in the Company Brain now; an older link that
  // asked Dex to show them (?docs=1&doc=<id>) goes there.
  const focusDoc = searchParams.get("doc");
  useEffect(() => {
    if (searchParams.get("docs")) navigate(`/company-brain${focusDoc ? `?doc=${focusDoc}` : ""}`, { replace: true });
  }, [searchParams, focusDoc, navigate]);

  // The header's global search lands here as ?q=…. Ask it once, on arrival.
  const seededRef = useRef(false);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && !seededRef.current) {
      seededRef.current = true;
      ask(q);
    }
  }, [searchParams, ask]);

  /* 2026-10-06 (Dex desktop pass) — WHERE THE PAGE LANDS. It scrolled to the
     END of every answer, so a long one (a 25-row table and 20 sources) opened
     on its last chip and the founder scrolled back up to find what Dex said.
     A question still goes to the floor, where the composer is; when the answer
     arrives, its question comes to the top and the answer reads down from it. */
  const lastQRef = useRef(null);
  useEffect(() => {
    const last = log[log.length - 1];
    if (!last && !busy) return;
    if (last?.role === "ai") lastQRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log, busy]);
  const lastQIndex = log.map((m) => m.role).lastIndexOf("user");

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
    /* KM-50 — THE THREAD SITS ABOVE THE COMPOSER on desktop now.
       The note further up this file argued the other way: with the orb as the
       page's anchor, a bottom-docked composer would be pushed off-screen the
       moment a conversation started, so answers opened BELOW the input. That
       reasoning held while this page was its own thing; it stopped holding once
       the phone shipped Dex as a chat, where the transcript is above and the
       composer is the floor. Founder: "the chat is loading below instead of
       above the text field... load the chat above as usual just like how we use
       in this mobile view dex page."
       Done with flex order rather than by moving the JSX: DexStage owns the
       capture wiring and the trailing actions, and reordering source around it
       is how you lose a prop. `order` moves boxes and touches nothing else. */
    /* 2026-10-06 (Dex desktop pass) — A CHAT, LAID OUT AS ONE.
       • w-full: the column is a flex child of a centring parent, so without it
         the page was as wide as its content — the composer halved the moment
         the opener's chips left the screen.
       • From md up the page is at least the screen tall and the thread takes
         the slack, so the composer sits on the floor and stays there (DexStage
         `docked`): a follow-up is always one click away, however long the
         answer above it. Phones do not dock it: their floating dock is the
         floor there.
       • The opener questions moved under the composer: they were pinned to the
         top of an empty page, as far from the input as the screen allowed. */
    <div
      className="mx-auto flex w-full max-w-3xl flex-col md:min-h-[calc(100dvh/var(--ui-scale,1)-7.5rem)]"
      data-testid="brain-page"
    >
      <DexStage
        className="order-2"
        capture={capture}
        onAsk={ask}
        thinking={busy}
        compact={hasThread}
        docked={hasThread}
        suggestions={!hasThread && canAsk ? (
          /* The opener. Four real questions rather than a paragraph about what
             Dex can do — the fastest way to learn a chat surface is to watch it
             answer once. */
          <div className="grid w-full max-w-2xl gap-2 sm:grid-cols-2" data-testid="brain-empty">
            {ASK_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                data-testid="ask-suggestion"
                className="group flex items-center justify-between gap-3 rounded-2xl bg-white/60 px-4 py-3 text-left text-[13px] text-muted-foreground ring-1 ring-inset ring-black/5 transition-colors hover:text-foreground dark:bg-white/[0.04] dark:ring-white/10 dark:hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span>{s}</span>
                <ArrowUpRight size={14} weight="bold" className="shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        ) : null}
        trailing={
          /* Quiet page actions. Text-weight on purpose — these are ways OUT of
             the conversation, and nothing here should compete with the send
             button above them. */
          <div className="flex items-center gap-1.5" data-testid="brain-actions">
            {/* 2026-10-06 — the Company Brain is its own page (documents + notes). */}
            <button
              type="button"
              onClick={() => navigate("/company-brain")}
              data-testid="brain-documents-toggle"
              className="inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-xs font-medium text-muted-foreground transition-shadow hover:text-foreground hover:shadow-nm-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Books size={14} weight="bold" /> Company Brain
            </button>
            {log.length > 0 && (
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
          className="order-1 mt-4 inline-flex items-center gap-2 self-center rounded-pill nm-inset px-3 py-1.5"
        >
          <Loader size={18} className="text-primary" />
          <span className="text-xs font-medium text-muted-foreground">
            Dex is structuring {inflightN} capture{inflightN === 1 ? "" : "s"} right now
          </span>
        </div>
      )}

      {hasThread && (
        <div className="order-1 space-y-7 pb-4 pt-2 md:flex-1" data-testid="brain-conversation">
          {log.map((m, i) => (
            <div
              key={m.id}
              ref={i === lastQIndex ? lastQRef : undefined}
              className="scroll-mt-24"
              data-testid={`chat-msg-${m.role}-${i}`}
            >
              {m.role === "user" ? (
                <div className="flex justify-end">
                  {/* The founder's own line: a raised bubble, not the indigo
                      fill. §0 keeps the brand colour for the one action on the
                      screen — a transcript entry is not an action. */}
                  <p className="inline-block max-w-[85%] whitespace-pre-wrap rounded-cardlg nm-raised px-4 py-2.5 text-sm">
                    {m.text}
                  </p>
                </div>
              ) : (
                <AiAnswer m={m} onGo={(link) => link && navigate(link)} onAsk={ask} currency={currency} />
              )}
            </div>
          ))}

          {busy && (
            <div className="flex items-start gap-3" data-testid="brain-loading">
              <DexAvatar thinking />
              <p className="pt-1 text-sm text-muted-foreground animate-pulse">
                Understanding your question, checking access &amp; searching your records…
              </p>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

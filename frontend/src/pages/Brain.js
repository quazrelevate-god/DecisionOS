// /brain — Dex, on the desktop. (The phone never comes here: it asks Dex from
// the dock.)
//
// DEX-R1 (2026-10-08) — rebuilt from nothing. The page was a dark room — it
// forced the whole app into `.dark` on arrival and cross-faded every node in
// the document to get there — around a 312px orb, with the answer's records
// drawn as a wall of identical pills. It is now a light page in the app's own
// two-zone grammar:
//
//   READING is light. The conversation sits on the page's ground; prose is
//     set straight on it, and anything structured (figures, rows, the records
//     an answer came from) sits on a white card.
//   ACTING is ink. The one place you do something — the composer — is the
//     same black as the Desk's sheet and the dock, docked to the floor, and it
//     never moves. The page's own actions (Company Brain, a new conversation)
//     live beside it for the same reason.
//
// What it still does, unchanged in behaviour:
//   · Enter and Send ask (/ask); the mic and "Save as note" capture instead.
//   · A file on the paperclip goes WITH the question (AB-15).
//   · The header's search lands here as ?q=… and is asked once on arrival.
//   · An old ?docs link goes to the Company Brain, where documents live now.
//   · When an answer arrives its question comes to the top, so a long answer
//     reads down from what was asked instead of opening on its last line.
//   · "Dex is filing N notes" while captures are still being structured.
//   · Someone with the page but not Ask AI is told so, not shown an error.
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Books, PencilSimpleLine, Paperclip } from "@phosphor-icons/react";
import api from "../lib/api";
import { isAiConsentError, aiConsentMessage } from "../lib/aiConsent";
import { isAiLimitError, aiLimitMessage } from "../lib/aiLimit";
import { useDexCapture } from "../hooks/useDexCapture";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { cn } from "@/lib/utils";
import { Loader } from "../components/common";
import { DexAnswer, DexThinking } from "./brain/DexAnswer";
import { DexComposer } from "./brain/DexComposer";
import { DexWelcome } from "./brain/DexWelcome";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/* 2026-10-03 RBAC audit — this page opens with Company Brain access, but
   asking takes Ask AI (/ask is require_perm("ask")). Say so plainly. */
const NO_ASK = "Asking Dex needs Ask AI access. Your workspace owner can switch it on for you in Team.";

const PAGE_ACTION = cn(
  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
);

/** What the founder said, in ink: it is the one thing in the thread they did. */
function YourTurn({ m }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[20px] rounded-br-[6px] bg-kr-ink px-4 py-2.5 text-white">
        {m.text && <p className="whitespace-pre-wrap text-[15px] leading-[22px]">{m.text}</p>}
        {m.files?.length > 0 && (
          <ul className={cn("flex flex-wrap gap-1.5", m.text && "mt-2")} aria-label="Files sent with this question">
            {m.files.map((f) => (
              <li key={f} className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[12px] text-white/85">
                <Paperclip size={11} aria-hidden="true" />
                <span className="truncate">{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Brain() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { tenant, user } = useAuth();
  const canAsk = hasPerm(user, "ask");
  const currency = tenant?.currency || "INR";
  const firstName = String(user?.name || "").trim().split(/\s+/)[0] || "";

  const [searchParams, setSearchParams] = useSearchParams();
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
    const files = capture.attachments || [];
    const text = String(question || "").trim() || (files.length ? "What does this say?" : "");
    if (!text) return;
    const names = files.map((a) => a.name);
    setLog((l) => [...l, { id: uid(), role: "user", text, files: names }]);
    files.forEach((a) => capture.removeAttachment(a.id));

    if (!canAsk) {
      setLog((l) => [...l, { id: uid(), role: "ai", question: text, resp: { type: "NOTICE", answer: NO_ASK } }]);
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text, context_id: ctxId, file_ids: files.map((a) => a.id) });
      if (data.query_context_id) setCtxId(data.query_context_id);
      setLog((l) => [...l, { id: uid(), role: "ai", question: text, resp: data }]);
    } catch (e) {
      /* AI switched off, the month's allowance spent, or no access: each is
         said for what it is, never as "AI service error". */
      const answer = isAiConsentError(e) ? aiConsentMessage()
        : isAiLimitError(e) ? aiLimitMessage(e)
        : e?.response?.status === 403 ? NO_ASK : t("ask.error");
      setLog((l) => [...l, { id: uid(), role: "ai", question: text, resp: { type: "NOTICE", answer } }]);
    } finally {
      setBusy(false);
    }
  }, [ctxId, t, canAsk, capture]);

  // Documents live in the Company Brain now; an older ?docs=1&doc=<id> link goes there.
  const focusDoc = searchParams.get("doc");
  useEffect(() => {
    if (searchParams.get("docs")) navigate(`/company-brain${focusDoc ? `?doc=${focusDoc}` : ""}`, { replace: true });
  }, [searchParams, focusDoc, navigate]);

  /* The header's global search lands here as ?q=…, asked once per question.
     Keyed on the question rather than a one-shot flag: a flag also swallowed
     a SECOND search made from the header while already on this page. */
  const seededRef = useRef(null);
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && seededRef.current !== q) {
      seededRef.current = q;
      ask(q);
    }
  }, [searchParams, ask]);

  /* Where the page lands: a question goes to the floor, where the composer
     is; when its answer arrives, the question comes to the top and the answer
     reads down from it. */
  const lastQRef = useRef(null);
  useEffect(() => {
    const last = log[log.length - 1];
    if (!last && !busy) return;
    if (last?.role === "ai") lastQRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, busy]);
  const lastQIndex = log.map((m) => m.role).lastIndexOf("user");

  // Captures Dex is still structuring, so "did my note go through?" has an answer.
  const { data: inflight } = useQuery({
    queryKey: ["dex-inflight-count"],
    queryFn: () => api.get("/dex/inflight-count").then((r) => r.data),
    refetchInterval: 8000,
  });
  const inflightN = inflight?.count || 0;

  const hasThread = log.length > 0 || busy;
  /* A new conversation also drops the ?q= that seeded the old one — left in
     the URL, a reload would quietly ask the previous question again — and
     hands the cursor back to the box. */
  const [convo, setConvo] = useState(0);
  const clear = () => {
    setLog([]);
    setCtxId(null);
    if (searchParams.get("q")) setSearchParams({}, { replace: true });
    setConvo((c) => c + 1);
  };

  return (
    <div
      className="mx-auto flex w-full max-w-[808px] flex-col min-h-[calc(100dvh/var(--ui-scale,1)-7.5rem)]"
      data-testid="brain-page"
    >
      {/* ── reading ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col px-6 pt-8">
        {hasThread ? (
          <div className="space-y-10 pb-10" data-testid="brain-conversation">
            {log.map((m, i) => (
              <div
                key={m.id}
                ref={i === lastQIndex ? lastQRef : undefined}
                className="scroll-mt-28"
                data-testid={`chat-msg-${m.role}-${i}`}
              >
                {m.role === "user"
                  ? <YourTurn m={m} />
                  : <DexAnswer m={m} onGo={(link) => link && navigate(link)} onAsk={ask} currency={currency} />}
              </div>
            ))}
            {busy && <DexThinking />}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="flex flex-1 items-center pb-12 pt-4">
            <DexWelcome name={firstName} canAsk={canAsk} noAsk={NO_ASK} onAsk={ask} />
          </div>
        )}
      </div>

      {/* ── acting ──────────────────────────────────────────────────────
          The floor of the page. The fade is the page's own ground, so the
          thread dissolves into it as it scrolls under rather than meeting a
          hard edge (layout › Differentiate controls from content). */}
      <div
        className="sticky bottom-0 z-20 px-6 pb-5 pt-10 [background:linear-gradient(to_top,hsl(var(--background))_58%,hsl(var(--background)/0))]"
        data-testid="dex-floor"
      >
        <DexComposer capture={capture} onAsk={ask} thinking={busy} focusKey={convo} />
        <div className="mt-2 flex min-h-8 items-center justify-between gap-4 pl-3">
          {inflightN > 0 ? (
            <p className="flex items-center gap-2 text-[12px] leading-4 text-muted-foreground" data-testid="dex-inflight-badge">
              <Loader size={14} />
              Dex is filing {inflightN} note{inflightN === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="text-[12px] leading-4 text-muted-foreground" data-testid="dex-disclosure">
              Dex answers from your records and can make mistakes.
            </p>
          )}
          <div className="flex shrink-0 items-center gap-0.5" data-testid="brain-actions">
            <button type="button" onClick={() => navigate("/company-brain")} className={PAGE_ACTION} data-testid="brain-documents-toggle">
              <Books size={15} /> Company Brain
            </button>
            {log.length > 0 && (
              <button type="button" onClick={clear} className={PAGE_ACTION} data-testid="brain-clear">
                <PencilSimpleLine size={15} /> New conversation
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

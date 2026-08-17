/**
 * Dex — /brain on a phone. A conversation, and nothing else.
 *
 * WHAT THIS REPLACES. The screen was four surfaces stacked on one another: a
 * three-way Ask / Search / Documents tab strip, a capture bar with its own mic,
 * text field, attach and Send, and then — below that — whichever panel the tab
 * selected, each with a SECOND input and a second submit. Two text fields and
 * two send buttons on one screen, and the answer appeared under the lower one
 * while the upper one kept the cursor. That is the "broken" being fixed.
 *
 * One thread, one composer. Attach · type · speak · send, in that order,
 * because that is left-to-right reach order on a thumb.
 *
 * WHERE THE THREE TABS WENT. Nothing is lost — /ask already answers questions
 * about documents and already returns sources, so "Search" and "Documents" were
 * two narrower doors into the endpoint the chat talks to. The documents library
 * is still reachable on desktop, which is where a founder actually reads them.
 *
 * MOTION. An entry that settles once — the orb blooms, the thread fades up —
 * and a line of rotating verbs under the greeting that stops the moment the
 * conversation starts. Everything is off under prefers-reduced-motion, which is
 * checked in JS rather than only in CSS because the rotator is a timer, and a
 * paused animation is not the same as a timer that never runs.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Paperclip, PaperPlaneTilt, Microphone, Stop, Sparkle, ArrowLeft, Spinner, LinkSimple,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { cn } from "@/lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const ROTATING = ["Speak", "Type", "Ask", "Search"];

const PROMPTS = [
  "What needs my decision today?",
  "Which employees have the most overdue tasks?",
  "Show outstanding customer invoices",
];

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The listening orb. Idle it breathes; recording it pulses harder. */
function Orb({ recording, thinking }) {
  return (
    <div className="relative grid place-items-center" aria-hidden="true">
      <span
        className={cn(
          "absolute rounded-full bg-primary/20 blur-2xl",
          "h-32 w-32",
          !prefersReducedMotion() && (recording || thinking) && "animate-pulse"
        )}
      />
      <span
        className={cn(
          "absolute rounded-full border border-primary/25",
          "h-24 w-24",
          !prefersReducedMotion() && "dex-orb-ring"
        )}
      />
      <span className="relative grid h-16 w-16 place-items-center rounded-full bg-primary/10 border border-primary/30">
        <Sparkle size={26} weight="fill" className="text-primary" />
      </span>
    </div>
  );
}

/** The rotating verb under the greeting. Stops once there is a conversation. */
function Rotator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const id = setInterval(() => setI((n) => (n + 1) % ROTATING.length), 1900);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-baseline" data-testid="dex-rotator">
      <span key={i} className="dex-rotate-in font-semibold text-primary">
        {ROTATING[i]}
      </span>
      <span className="text-muted-foreground">&nbsp;— Dex remembers everything.</span>
    </span>
  );
}

function Bubble({ turn, onGo }) {
  if (turn.role === "user") {
    return (
      <li className="flex justify-end" data-testid="dex-turn-user">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground">
          {turn.text}
        </div>
      </li>
    );
  }
  return (
    <li className="flex justify-start" data-testid="dex-turn-dex">
      <div className="max-w-[92%]">
        <div className="rounded-2xl rounded-bl-md border border-hairline bg-card px-4 py-3">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{turn.answer}</p>
        </div>
        {turn.sources?.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="dex-sources">
            {turn.sources.map((s, i) => (
              <li key={`${turn.id}-s${i}`}>
                <button
                  type="button"
                  onClick={() => onGo(s.link)}
                  disabled={!s.link}
                  className="inline-flex items-center gap-1 rounded-full border border-hairline bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground disabled:opacity-60"
                >
                  <LinkSimple size={12} weight="bold" />
                  {s.label || s.title || "Source"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function DexMobile() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [log, setLog] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctxId, setCtxId] = useState(null);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // The recorder, the uploads and the endpoints, reused rather than rebuilt
  // (§7). A finished recording drops its transcript into the composer instead
  // of sending itself — the founder gets to read what was heard before it goes.
  const onCaptured = useCallback(
    (note) => {
      qc.invalidateQueries({ queryKey: ["captures-pending"] });
      const heard = note?.transcript?.trim();
      if (heard) {
        setQ(heard);
        inputRef.current?.focus();
      }
    },
    [qc]
  );
  const {
    sending, recording, recordSecs, startRecording, stopRecording, uploadFile, fileRef,
  } = useDexCapture({ onCaptured });

  useEffect(() => {
    document.title = "Dex · DecisionOS";
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [log, busy]);

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setLog((l) => [...l, { id: uid(), role: "user", text }]);
    setQ("");
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      setLog((l) => [
        ...l,
        { id: uid(), role: "dex", answer: data.answer || "I could not find an answer for that.", sources: data.sources },
      ]);
    } catch (e) {
      // Deliberately not "please try again". On this workspace /ask fails the
      // AI-consent gate — the router raises 451 ai_consent_required — but the
      // handler above it flattens that to 502 {"detail":"AI planning error"},
      // so the browser cannot tell a consent gate from an outage and retrying
      // never succeeds. Until that detail survives the wire, the copy names the
      // one cause the founder can actually act on and stops promising a retry.
      const detail = e?.response?.data?.detail;
      setLog((l) => [
        ...l,
        {
          id: uid(),
          role: "dex",
          answer:
            typeof detail === "string" && detail !== "AI planning error"
              ? detail
              : "I couldn't answer that. If this keeps happening, ask the workspace owner to turn on AI data processing in Settings — Dex stays blocked until that consent is given.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const empty = log.length === 0;

  return (
    // z-30 puts this over Layout's app bar (z-20) rather than under it. At z-0
    // the bar's logo and bell sat on top of this screen's own header, so the
    // back button was there but invisible. Dex owns the screen while it is
    // open; the dock stays above at z-[10000], which is how you leave.
    <div className="lg:hidden fixed inset-0 z-30 flex flex-col bg-background" data-testid="dex-mobile">
      {/* Header — back and a name, nothing else. No tab strip. */}
      <header className="flex items-center gap-3 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          data-testid="dex-back"
          aria-label="Back"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-hairline bg-card active:bg-foreground/[0.06]"
        >
          <ArrowLeft size={18} weight="bold" />
        </button>
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-extrabold tracking-tight leading-none">Dex</h1>
          <p className="label-mono text-muted-foreground mt-1">
            {recording ? `Listening · ${recordSecs}s` : busy ? "Thinking…" : "Ready"}
          </p>
        </div>
      </header>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto overscroll-contain scrollbar-none px-4" data-testid="dex-thread">
        {empty ? (
          <div className="dex-enter flex h-full flex-col items-center justify-center pb-8 text-center">
            <Orb recording={recording} thinking={busy} />
            <p className="mt-6 font-heading text-xl font-extrabold tracking-tight">
              Ask your company anything
            </p>
            <p className="mt-2 text-[15px] leading-relaxed">
              <Rotator />
            </p>
            <ul className="mt-7 w-full space-y-2">
              {PROMPTS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => ask(p)}
                    data-testid="dex-prompt"
                    className="w-full rounded-2xl border border-hairline bg-card px-4 py-3 text-left text-sm active:bg-foreground/[0.04]"
                  >
                    {p}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ul className="space-y-3 py-2" data-testid="dex-turns">
            {log.map((turn) => (
              <Bubble key={turn.id} turn={turn} onGo={(l) => l && navigate(l)} />
            ))}
            {busy && (
              <li className="flex justify-start" data-testid="dex-thinking">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-hairline bg-card px-4 py-3">
                  <Spinner size={16} className="animate-spin text-primary" />
                  <span className="text-sm text-muted-foreground">Dex is thinking…</span>
                </div>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer — the only input on the screen.
          pb clears the dock; the dock stays put and is not this screen's to move. */}
      <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] pt-2">
        <div
          className={cn(
            "flex items-end gap-2 rounded-[26px] border border-hairline bg-card/80 p-2 backdrop-blur-xl",
            "shadow-[0_8px_28px_rgba(0,0,0,0.10)]"
          )}
          data-testid="dex-composer"
        >
          <input type="file" ref={fileRef} hidden onChange={uploadFile}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || recording}
            data-testid="dex-attach"
            aria-label="Attach a file"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-foreground/[0.06] disabled:opacity-40"
          >
            <Paperclip size={20} weight="bold" />
          </button>

          <textarea
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); }
            }}
            rows={1}
            disabled={recording}
            placeholder={recording ? "Listening…" : "Ask Dex anything"}
            data-testid="dex-input"
            // 16px: below it, iOS Safari zooms the viewport on focus.
            className="min-h-11 max-h-32 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-60"
          />

          {/* Mic while there is nothing to send; Send the moment there is. One
              slot, never both — two primary buttons on a composer is the thing
              the old screen did wrong. */}
          {q.trim() ? (
            <button
              type="button"
              onClick={() => ask()}
              disabled={busy}
              data-testid="dex-send"
              aria-label="Send"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <PaperPlaneTilt size={19} weight="fill" />
            </button>
          ) : recording ? (
            <button
              type="button"
              onClick={stopRecording}
              data-testid="dex-mic-stop"
              aria-label={`Stop recording, ${recordSecs} seconds`}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-danger-600 px-3.5 text-white"
            >
              <Stop size={17} weight="fill" />
              <span className="tabular-nums text-sm font-semibold">{recordSecs}s</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={startRecording}
              disabled={sending}
              data-testid="dex-mic-record"
              aria-label="Record a voice note"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            >
              <Microphone size={19} weight="fill" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

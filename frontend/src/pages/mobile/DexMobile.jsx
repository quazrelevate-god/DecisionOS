/**
 * Dex — /brain on a phone. A conversation, and nothing else.
 *
 * WHAT THIS REPLACED. The screen was four surfaces stacked on one another: an
 * Ask / Search / Documents tab strip, a capture bar with its own mic, text
 * field, attach and Send, and then — below that — whichever panel the tab
 * selected, each with a SECOND input and a second submit. Two text fields and
 * two send buttons on one screen, and the answer appeared under the lower one
 * while the upper one kept the cursor.
 *
 * One thread, one composer. Attach · type · speak · send, in that order,
 * because that is left-to-right reach order on a thumb.
 *
 * WHERE THE THREE TABS WENT. Nothing is lost — /ask already answers questions
 * about documents and already returns sources, so "Search" and "Documents" were
 * two narrower doors into the endpoint the chat talks to. Desktop keeps all
 * three.
 *
 * THE ORB IS THE SCREEN. It is audio-reactive, not decorative: see DexOrb for
 * the particle engine and lib/dexAudio for the analyser. The state machine
 * below decides WHICH profile the orb eases toward; the orb decides what a
 * frame looks like. React never renders a frame — `orbState` is a ref the loop
 * polls, deliberately not useState.
 *
 * DARK, ALWAYS. This one screen ignores the theme. The visual is a luminous
 * object in a dark room; on a white background it is a grey smudge.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Paperclip, PaperPlaneTilt, Microphone, Stop, ArrowLeft, Spinner, LinkSimple,
} from "@phosphor-icons/react";
import api from "../../lib/api";
import { cn } from "@/lib/utils";
import { useDexCapture } from "../../hooks/useDexCapture";
import { DexAudioEngine } from "../../lib/dexAudio";
import { DexOrb } from "../../components/dex/DexOrb";

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const ROTATING = ["Speak", "Type", "Ask", "Search"];

const PROMPTS = [
  "What needs my decision today?",
  "Which employees have the most overdue tasks?",
  "Show outstanding customer invoices",
];

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const greetingFor = (h) => (h < 12 ? "Good morning," : h < 17 ? "Good afternoon," : "Good evening,");

// One glass recipe, so the composer, its mic and the dock's Dex button are
// visibly the same material rather than three near-misses.
const GLASS_FIELD = "border border-white/15 bg-white/[0.07] backdrop-blur-xl";

/** The rotating verb under the greeting. Stops once there is a conversation. */
function Rotator() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const id = setInterval(() => setI((n) => (n + 1) % ROTATING.length), 1900);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-flex items-baseline" data-testid="dex-rotator">
      <span key={i} className="dex-rotate-in font-semibold text-violet-300">
        {ROTATING[i]}
      </span>
      <span className="text-white/45">&nbsp;— Dex remembers everything.</span>
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
        <div className="rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-3 backdrop-blur-md">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-white/90">{turn.answer}</p>
        </div>
        {turn.sources?.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="dex-sources">
            {turn.sources.map((s, i) => (
              <li key={`${turn.id}-s${i}`}>
                <button
                  type="button"
                  onClick={() => onGo(s.link)}
                  disabled={!s.link}
                  className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-white/60 disabled:opacity-60"
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
  // Coarse state for the copy under the header. The ORB does not read this —
  // it reads orbState, a ref — so a status word never costs a re-render mid-frame.
  const [phase, setPhase] = useState("idle");
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const engineRef = useRef(null);
  const orbState = useRef("idle");
  const setOrb = useCallback((s) => { orbState.current = s; }, []);

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
    sending, recording, recordSecs, startRecording, stopRecording, uploadFile, fileRef, streamRef,
  } = useDexCapture({ onCaptured });

  /* ── the audio engine ──
     Built once and torn down on unmount. Demo mode ONLY when there is no
     microphone to attach: production drives the orb from the real signal, and
     the synthetic one exists so the visual can be judged without a permission
     grant, never as a substitute for it. */
  useEffect(() => {
    const engine = new DexAudioEngine({ demoMode: false });
    engineRef.current = engine;
    // Dev-only handle. The orb's whole claim is that it moves because of the
    // audio and not because of a timer, and that is unfalsifiable from the
    // outside: a screenshot of a moving orb looks the same either way. This
    // lets the verification suite attach a synthetic stream and assert the
    // metrics actually track it. Stripped from production builds.
    if (process.env.NODE_ENV !== "production") window.__dexEngine = engine;
    return () => {
      engine.stop();
      engineRef.current = null;
      if (process.env.NODE_ENV !== "production") delete window.__dexEngine;
    };
  }, []);

  /* ── attach the recorder's stream, rather than opening a second mic ──
     useDexCapture already holds a live MediaStream while recording. Two
     concurrent getUserMedia calls on one device is a real source of trouble on
     iOS, so the orb hangs its analyser on the stream that already exists. */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return undefined;
    if (!recording) {
      engine.detachSource();
      return undefined;
    }
    let cancelled = false;
    // The stream is assigned inside startRecording's await, so it can be a tick
    // behind `recording` flipping true.
    const tryAttach = (attempt = 0) => {
      if (cancelled) return;
      const s = streamRef?.current;
      if (s) {
        const ok = engine.attachStream(s);
        // Permission was granted (we are recording) but the AudioContext
        // refused — fall back to the synthetic signal so the orb is not frozen
        // while the user is plainly talking.
        if (!ok) engine.demoMode = true;
        return;
      }
      if (attempt < 40) setTimeout(() => tryAttach(attempt + 1), 25);
    };
    tryAttach();
    return () => { cancelled = true; };
  }, [recording, streamRef]);

  /* ── the state machine ──
     idle -> listening the moment the mic is live; listening <-> speaking is
     driven by the engine's hysteresis gate, polled on a timer rather than per
     frame because it only feeds React copy. The orb itself transitions on its
     own eased curves, so nothing here snaps. */
  useEffect(() => {
    if (busy) { setOrb("thinking"); setPhase("thinking"); return undefined; }
    if (!recording) { setOrb("idle"); setPhase("idle"); return undefined; }
    setOrb("listening");
    setPhase("listening");
    const id = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      const talking = e.speaking;
      setOrb(talking ? "speaking" : "listening");
      setPhase((p) => {
        const next = talking ? "speaking" : "listening";
        return p === next ? p : next;
      });
    }, 120);
    return () => clearInterval(id);
  }, [recording, busy, setOrb]);

  useEffect(() => { document.title = "Dex · DecisionOS"; }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
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
      // one cause the founder can act on and stops promising a retry.
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
  const greeting = greetingFor(new Date().getHours());
  const status =
    phase === "speaking" ? "Listening to you…"
    : phase === "listening" ? `Listening · ${recordSecs}s`
    : phase === "thinking" ? "Thinking…"
    : "Ready";

  return (
    <div
      className="lg:hidden fixed inset-0 z-30 flex flex-col overflow-hidden bg-neutral-950 text-white"
      data-testid="dex-mobile"
    >
      {/* Atmosphere. Two off-centre blooms so the dark is a room, not a slab. */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(90% 60% at 78% 2%, rgba(109,74,214,0.30), transparent 60%)," +
            "radial-gradient(80% 55% at 12% 100%, rgba(58,72,190,0.22), transparent 62%)",
        }}
      />

      {/* Back and nothing else. The name and the live status moved out: the orb
          already says which state it is in, more legibly than a word does, and
          "Dex / READY" was a label on a screen that is unmistakably Dex. The
          status string is still computed — it is the aria-live announcement for
          anyone not watching the orb. */}
      <header className="relative flex items-center px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          data-testid="dex-back"
          aria-label="Back"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.06] text-white/80 backdrop-blur-md active:bg-white/[0.12]"
        >
          <ArrowLeft size={18} weight="bold" />
        </button>
        <p className="sr-only" aria-live="polite" data-testid="dex-status">{status}</p>
      </header>

      {/* ── the orb ──
          Its own layer, sized in vh/vw so it scales with the viewport rather
          than to a fixed pixel box. Shrinks once a conversation exists so the
          thread gets the room, and keeps reacting either way. */}
      <div
        className={cn(
          "relative mx-auto w-full shrink-0 transition-[height] duration-500 ease-out",
          empty ? "h-[38svh]" : "h-[16svh]"
        )}
        data-testid="dex-orb"
      >
        <DexOrb
          engineRef={engineRef}
          stateRef={orbState}
          density={empty ? 1 : 0.55}
          className="h-full w-full"
        />
      </div>

      {/* Thread / greeting */}
      <div className="relative flex-1 overflow-y-auto overscroll-contain scrollbar-none px-4" data-testid="dex-thread">
        {empty ? (
          <div className="dex-enter flex flex-col items-center pb-6 text-center">
            {/* PLACEHOLDER NAME — not wired. The time of day is real because it
                costs nothing and a greeting that says "morning" at 9pm is worse
                than no greeting; the name is hardcoded until this reads the
                signed-in user. */}
            <p className="font-heading text-xl font-extrabold tracking-tight" data-testid="dex-greeting">
              {greeting} Mr. Vel Raj
            </p>
            <p className="mt-2 text-[15px] leading-relaxed"><Rotator /></p>
            <ul className="mt-6 w-full space-y-2">
              {PROMPTS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => ask(p)}
                    data-testid="dex-prompt"
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm text-white/80 backdrop-blur-md active:bg-white/[0.10]"
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
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-4 py-3">
                  <Spinner size={16} className="animate-spin text-violet-300" />
                  <span className="text-sm text-white/60">Dex is thinking…</span>
                </div>
              </li>
            )}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer — the only input on the screen.
          pb clears the dock; the dock stays put and is not this screen's to move. */}
      <div className="relative px-4 pb-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] pt-2">
        <div
          className={cn(
            "relative flex items-end gap-2 overflow-hidden rounded-[26px] p-2",
            GLASS_FIELD,
            // The two things that stop a translucent panel reading as flat
            // grey: a lit top edge, and a shadow that separates it from what
            // is behind it.
            "shadow-[0_10px_34px_rgba(0,0,0,0.40)]"
          )}
          data-testid="dex-composer"
        >
          {/* Specular highlight along the top edge. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent"
          />
          <input type="file" ref={fileRef} hidden onChange={uploadFile}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx" />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || recording}
            data-testid="dex-attach"
            aria-label="Attach a file"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white/55 active:bg-white/10 disabled:opacity-40"
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
            className="min-h-11 max-h-32 flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-snug text-white placeholder:text-white/35 focus:outline-none disabled:opacity-60"
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
              // Same slot as the mic, so the same material — a solid button
              // appearing where a glass one just was reads as a different
              // control. Carried a step brighter because it commits.
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                "border border-white/30 bg-white/[0.22] text-white backdrop-blur-xl",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_4px_14px_rgba(0,0,0,0.35)]",
                "active:bg-white/[0.30] disabled:opacity-40"
              )}
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
              // Glass, not a solid indigo disc: a filled primary button inside
              // a translucent panel reads as a sticker on a window. The violet
              // stays in the icon and a faint tint, so it is still the warmest
              // thing in the composer without being opaque.
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                "border border-white/25 bg-white/[0.14] text-violet-200 backdrop-blur-xl",
                "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_14px_rgba(0,0,0,0.35)]",
                "active:bg-white/[0.22] disabled:opacity-40"
              )}
            >
              <Microphone size={19} weight="fill" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

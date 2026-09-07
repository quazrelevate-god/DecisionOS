import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, X, Microphone, Stop, PaperPlaneRight, Paperclip, Camera,
  Keyboard, CircleNotch, Sparkle,
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { DexWave } from "./DexWave";
import { cn } from "@/lib/utils";

// KM-23 · DexChat — Dex as a conversation, over the page you were on.
//
// WHAT THIS REPLACED. DexSheet: one black card that appeared when a capture
// finished, showed what Dex understood, and had to be dismissed. It was a
// receipt, not a conversation — there was nowhere to reply, nowhere to ask a
// follow-up, and the whole /brain page's abilities (ask a question, attach a
// document, type instead of speak) lived on a different screen entirely.
//
// THE SURFACE. Glass over the live page, not a wall: the page behind is dimmed
// and blurred so it stays legible as context. Messages stack upward with the
// newest at the bottom, Dex on the left in ink and you on the right in light
// glass, each arriving with a short spring so a reply reads as landing rather
// than appearing.
//
// VOICE FIRST, EVERYTHING ELSE BEHIND THE PLUS. The composer is a microphone,
// because that is what Dex is for. The three things you might want instead —
// type it, attach a document, take a photo — are one tap away behind a single
// plus, which stays a 40px circle at the composer's left edge and never sits
// over the transcript. Opening it lifts the actions vertically ABOVE the
// composer, so the thing you are reading is never what gets covered.
//
// WIRING, all of it already on the backend:
//   POST /ask                -> question + answer, with a context id so
//                               follow-ups stay in the same thread
//   POST /voice-notes        -> audio; the hook then polls the note and hands
//                               back the structured "understanding"
//   POST /voice-notes/text   -> the same pipeline for typed capture
//   POST /files              -> attachments and photos
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 };

/* Dex answers in light markdown — "**33 overdue tasks**" comes back from /ask
   exactly like that. Rendering the raw string printed the asterisks, so bold
   spans are split out here. Deliberately just bold: a full markdown renderer
   is a dependency and an XSS surface for one emphasis mark, and the endpoint
   does not send links, tables or images. */
function richText(text) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{part}</React.Fragment>
  );
}

/** One turn in the transcript. */
function Bubble({ m, index }) {
  const mine = m.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...SPRING, delay: Math.min(index * 0.02, 0.1) }}
      className={cn("flex w-full", mine ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-relaxed",
          mine
            ? "kr-frost-min rounded-br-lg text-foreground"
            : "rounded-bl-lg bg-kr-ink text-white shadow-[0_8px_24px_-12px_hsl(216_28%_18%/.6)]"
        )}
      >
        {!mine && (
          <span className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-white/45">
            <Sparkle size={10} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Dex
          </span>
        )}
        {m.pending ? (
          <span className="flex items-center gap-2 text-white/70">
            <CircleNotch size={14} className="animate-spin" /> {m.text}
          </span>
        ) : (
          <span className="whitespace-pre-wrap">{richText(m.text)}</span>
        )}
        {/* The real /ask payload is {type, answer, missing_information,
            suggested_questions} — verified against the endpoint, not guessed.
            The follow-ups it hands back are the most useful part of a thin
            answer, so they are tappable rather than decorative. */}
        {m.followups?.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {m.followups.slice(0, 3).map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => m.onAsk?.(q)}
                className="rounded-pill bg-white/10 px-2.5 py-1 text-left text-[11px] text-white/75 hover:bg-white/20"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        {m.missing?.length > 0 && (
          <p className="mt-2 text-[11px] text-white/45">
            Missing: {m.missing.slice(0, 3).join(" · ")}
          </p>
        )}
      </div>
    </motion.div>
  );
}

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {object}   dex     the shared useDexCapture instance from Layout
 */
export function DexChat({ open, onClose, dex }) {
  const [log, setLog] = React.useState([]);
  const [ctxId, setCtxId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [plusOpen, setPlusOpen] = React.useState(false);
  const [typing, setTyping] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const endRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const photoRef = React.useRef(null);
  const seenRef = React.useRef(null);

  const push = React.useCallback((m) => setLog((l) => [...l, { id: uid(), ...m }]), []);

  React.useEffect(() => {
    if (log.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, busy]);

  React.useEffect(() => {
    if (typing) setTimeout(() => inputRef.current?.focus(), 220);
  }, [typing]);

  // A finished capture becomes a Dex turn instead of its own card. Keyed on
  // noteId so a poll that updates the same note in place does not stack up.
  React.useEffect(() => {
    const u = dex?.understanding;
    if (!u || u.status !== "done") return;
    if (seenRef.current === u.noteId) return;
    seenRef.current = u.noteId;
    const title = u.decision?.title || u.summary || u.transcript;
    push({
      role: "dex",
      text: title
        ? `Got it — ${title}${u.tasks?.length ? `\n${u.tasks.length} task${u.tasks.length > 1 ? "s" : ""} created.` : ""}`
        : "Captured.",
    });
    dex.clearUnderstanding?.();
  }, [dex, dex?.understanding, push]);

  const ask = React.useCallback(async (question) => {
    const text = String(question || "").trim();
    if (!text || busy) return;
    push({ role: "user", text });
    setDraft("");
    setBusy(true);
    try {
      const { data } = await api.post("/ask", { question: text, context_id: ctxId });
      if (data.query_context_id) setCtxId(data.query_context_id);
      push({
        role: "dex",
        text: data.answer || "I don't have an answer for that yet.",
        followups: data.suggested_questions,
        missing: data.missing_information,
      });
    } catch (e) {
      push({ role: "dex", text: e.response?.data?.detail || "I couldn't reach the brain just now." });
    } finally {
      setBusy(false);
    }
  }, [busy, ctxId, push]);

  const attach = async (e, label) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    push({ role: "user", text: `${label}: ${file.name}` });
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post("/files", fd, { headers: { "Content-Type": "multipart/form-data" } });
      push({ role: "dex", text: "Filed. I'll pull what matters out of it." });
    } catch (err) {
      push({ role: "dex", text: err.response?.data?.detail || "That upload didn't go through." });
    } finally {
      setBusy(false);
    }
  };

  const ACTIONS = [
    { key: "type", icon: Keyboard, label: "Type", onClick: () => { setTyping(true); setPlusOpen(false); } },
    { key: "file", icon: Paperclip, label: "Attach", onClick: () => { dex?.fileRef?.current?.click(); setPlusOpen(false); } },
    { key: "photo", icon: Camera, label: "Photo", onClick: () => { photoRef.current?.click(); setPlusOpen(false); } },
  ];

  const recording = !!dex?.recording;
  const waveState = recording ? "listening" : busy ? "thinking" : "idle";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="dex-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          /* z above FloatingDock (10000) — the dock must not float over the
             conversation the way it once floated over the welcome overlay. */
          className="lg:hidden fixed inset-0 z-[10002] flex flex-col bg-black/25 backdrop-blur-xl"
        >
          {/* Tapping the dimmed page behind closes — the standard way out of a
              sheet, kept because the X is at the top and thumbs are at the
              bottom. */}
          <button
            type="button"
            aria-label="Close Dex"
            onClick={onClose}
            className="absolute inset-0 h-full w-full cursor-default"
            tabIndex={-1}
          />

          <div className="relative flex min-h-0 flex-1 flex-col pt-safe">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-semibold text-white drop-shadow">
                <Sparkle size={14} weight="fill" className="text-[hsl(var(--kr-gold))]" /> Dex
              </span>
              <button
                type="button"
                onClick={onClose}
                data-testid="dex-chat-close"
                aria-label="Close"
                className="kr-pop grid h-10 w-10 place-items-center rounded-full"
              >
                <X size={18} weight="bold" />
              </button>
            </div>

            {/* Transcript. Bottom-anchored so the newest turn sits just above
                the composer and older ones stack away upward. */}
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-y-auto px-4 pb-3">
              {log.length === 0 && (
                <div className="pb-6 text-center">
                  <p className="text-sm text-white/70 drop-shadow">Hold the mic and say it plainly.</p>
                  <p className="mt-1 text-xs text-white/45">Or use + to type, attach a file, or take a photo.</p>
                </div>
              )}
              {log.map((m, i) => <Bubble key={m.id} m={{ ...m, onAsk: ask }} index={i} />)}
              {busy && <Bubble m={{ role: "dex", text: "Thinking…", pending: true }} index={log.length} />}
              <div ref={endRef} />
            </div>

            {/* Composer */}
            <div className="relative px-4 pb-safe-4">
              {/* The plus actions lift ABOVE the bar so they never cover the
                  transcript's newest line. */}
              <AnimatePresence>
                {plusOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute bottom-full left-4 mb-3 flex flex-col gap-2"
                  >
                    {ACTIONS.map((a, i) => {
                      const Icon = a.icon;
                      return (
                        <motion.button
                          key={a.key}
                          type="button"
                          data-testid={`dex-action-${a.key}`}
                          onClick={a.onClick}
                          initial={{ opacity: 0, y: 14, scale: 0.8 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.85 }}
                          transition={{ ...SPRING, delay: (ACTIONS.length - 1 - i) * 0.045 }}
                          className="kr-frost flex h-11 items-center gap-2.5 rounded-pill pl-3 pr-4 text-sm font-medium"
                        >
                          <Icon size={17} weight="bold" aria-hidden="true" />
                          {a.label}
                        </motion.button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="kr-frost flex items-center gap-2 rounded-pill p-1.5">
                <button
                  type="button"
                  data-testid="dex-plus"
                  aria-label={plusOpen ? "Hide options" : "More ways to talk to Dex"}
                  aria-expanded={plusOpen}
                  onClick={() => setPlusOpen((v) => !v)}
                  className="kr-pop grid h-10 w-10 shrink-0 place-items-center rounded-full"
                >
                  <motion.span animate={{ rotate: plusOpen ? 45 : 0 }} transition={SPRING} className="grid place-items-center">
                    <Plus size={18} weight="bold" />
                  </motion.span>
                </button>

                {typing ? (
                  <input
                    ref={inputRef}
                    data-testid="dex-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); ask(draft); } }}
                    placeholder="Ask Dex, or state a decision…"
                    className="min-w-0 flex-1 bg-transparent px-2 text-sm placeholder:text-foreground/35 focus:outline-none"
                  />
                ) : (
                  /* The wave IS the affordance while not typing: it says the
                     surface is listening-capable without spending a label. */
                  <div className="h-9 min-w-0 flex-1 overflow-hidden rounded-pill bg-kr-ink/90">
                    <DexWave state={waveState} levels={dex?.levels} />
                  </div>
                )}

                {typing && draft.trim() ? (
                  <button
                    type="button"
                    data-testid="dex-send"
                    aria-label="Send"
                    onClick={() => ask(draft)}
                    disabled={busy}
                    className="kr-pop grid h-11 w-11 shrink-0 place-items-center rounded-full bg-kr-ink text-white disabled:opacity-50"
                  >
                    <PaperPlaneRight size={17} weight="bold" />
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="dex-mic"
                    aria-label={recording ? "Stop recording" : "Hold to speak"}
                    onClick={() => (recording ? dex?.stopRecording?.() : dex?.startRecording?.())}
                    className={cn(
                      "grid h-11 w-11 shrink-0 place-items-center rounded-full",
                      recording ? "bg-danger-600 text-white" : "kr-pop bg-kr-ink text-white"
                    )}
                  >
                    {recording ? <Stop size={17} weight="fill" /> : <Microphone size={18} weight="bold" />}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Photo goes through the same /files endpoint as an attachment; only
              the picker differs (`capture` asks the OS for the camera). */}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => attach(e, "Photo")}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default DexChat;

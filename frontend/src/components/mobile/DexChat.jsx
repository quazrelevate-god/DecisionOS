import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Plus, X, Paperclip, Camera, Keyboard, CircleNotch, Sparkle,
} from "@phosphor-icons/react";
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
// KM-26 — NO COMPOSER HERE ANY MORE. The first cut drew its own rounded bar
// with a plus, a wave and a mic inside it, floating just above the app's
// existing dock. The founder's correction: the app already has a bar in
// exactly that place with exactly that material, and it should BECOME Dex —
// the four destinations step aside, the bar draws the wave or turns into a
// text field, and the FAB beside it switches between microphone and send.
// Drawing a second bar over the first was solving a problem that did not exist.
//
// So this component is now only the transcript and the plus. The plus sits
// clear of both the dock and the newest line — bottom-left, on the dock's
// baseline — and its three actions (type, attach, photo) lift upward from it.
//
// WIRING, all of it already on the backend:
// The conversation itself (log, ask, attach, mode) lives in
// hooks/useDexConversation so the bar, the FAB and this transcript all read the
// same state — see the note there.
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
export function DexChat({ open, onClose, dex, chat }) {
  const { log, busy, mode, setMode, ask, attach } = chat;
  const [plusOpen, setPlusOpen] = React.useState(false);
  const endRef = React.useRef(null);
  const photoRef = React.useRef(null);

  React.useEffect(() => {
    if (log.length) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [log, busy]);

  /* The three ways in that are not the microphone. "Type" flips the DOCK into
     a text field rather than opening a field here — same bar, different mode. */
  const ACTIONS = [
    { key: "type", icon: Keyboard, label: "Type", onClick: () => { setMode(mode === "type" ? "voice" : "type"); setPlusOpen(false); } },
    { key: "file", icon: Paperclip, label: "Attach", onClick: () => { dex?.fileRef?.current?.click(); setPlusOpen(false); } },
    { key: "photo", icon: Camera, label: "Photo", onClick: () => { photoRef.current?.click(); setPlusOpen(false); } },
  ];


  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="dex-chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          /* z BELOW the dock (10000) and the FAB, deliberately. The founder's
             words were "behind that app bar we should dim the background" —
             the bar and the button are the composer now, so dimming over them
             would grey out the very controls the screen is for. Above the page
             it is dimming, below the controls it serves. */
          className="lg:hidden fixed inset-0 z-[9990] flex flex-col bg-black/25 backdrop-blur-xl"
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

            {/* KM-26 · the plus, and only the plus.
                It sits on the DOCK's baseline at the left edge, so it is clear
                of the bar (which is now the composer) and clear of the newest
                line of the transcript above it. Its actions lift upward, never
                over what you are reading.
                The bottom padding clears the DOCK, which is 64px tall sitting
                on its own safe-area offset — measured, because `pb-safe-4` put
                the plus straight on top of the bar (plus 768-812 against a dock
                at 732-796) and half of it off the bottom of the screen. */}
            <div className="relative px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))]">
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

              <button
                type="button"
                data-testid="dex-plus"
                aria-label={plusOpen ? "Hide options" : "More ways to talk to Dex"}
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((v) => !v)}
                className="kr-frost grid h-11 w-11 place-items-center rounded-full"
              >
                <motion.span animate={{ rotate: plusOpen ? 45 : 0 }} transition={SPRING} className="grid place-items-center">
                  <Plus size={19} weight="bold" />
                </motion.span>
              </button>
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
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; attach(f, "Photo"); }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default DexChat;

// MPWA-03 · DexFab — the 64px mic circle, bottom-right, on the dock's baseline.
//
// §8 is emphatic that this IS Dex, not a second capture surface: it opens
// DexSheet (which hosts the existing DexCaptureBar), and Dex therefore gets no
// All Apps tile. Nothing appears in two places.
//
// The glyph is a microphone — the action he wants — not an abstract persona
// mark. The name is carried by aria-label="Dex" so it is announced and learned
// without spending a visible label on it.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkle, Stop, Microphone, PaperPlaneRight, Keyboard, ChatCircleDots, Scales } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";

/**
 * @param {Function} onOpen
 * @param {boolean}  [recording]   true while DexCaptureBar is recording
 * @param {number}   [seconds]
 * @param {Function} [onStop]      tap again to stop (§5.6)
 */
/* KM-26 — the FAB now carries the MODE, not just "is Dex on".
   The founder's ask: the Dex icon becomes the microphone while the bar draws
   the wave, and becomes SEND the moment that bar is a text field — flipping
   back when you switch modes, so the glyph always names the next action rather
   than the feature.
     closed         sparkle  — "this is Dex"
     open + voice   mic      — "speak"
     open + typing  send     — or a keyboard glyph while the field is still
                               empty, so it never promises to send nothing
     recording      stop     — with the running seconds
   `intent` is computed once in useDexConversation, so the bar, the FAB and the
   transcript can never disagree about which mode they are in. */
/* KM-54 — the two doors. `dictate` is the ask side (POST /transcribe or /ask,
   nothing persisted); `capture` is the decision side (POST /voice-notes or
   /voice-notes/text, which produces a decision, its tasks and an inbox item).
   Order is bottom-up, so Ask sits nearest the thumb. */
const PICKS = [
  { kind: "ask", icon: ChatCircleDots, label: "Ask", aria: "Ask Dex a question" },
  { kind: "decide", icon: Scales, label: "Decide", aria: "Record a decision" },
];

export function DexFab({ onOpen, recording = false, seconds = 0, onStop, intent = "sparkle", picker = false, onPick }) {
  const { user } = useAuth();
  // Same check DexCaptureBar makes — hidden entirely, not disabled (§8).
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  if (!canCapture) return null;

  return (
    <>
      {/* KM-54 — TWO DOORS, NOT ONE GUESS.
          Founder: "I want two separate buttons for two separate
          functionalities of Dex. When I click the Dex icon it should pop up
          two more small circular icons — one for asking and another for
          decision making — each routing to their own respective
          functionality."

          This is the right call and it is worth saying why: typing into Dex
          used to mean one thing (a question, POST /ask, read-only) while
          speaking meant another (a capture, POST /voice-notes, which creates a
          decision and tasks). Same field, same button, two different
          consequences, and nothing on screen said which you were about to get.
          Picking the door first makes the consequence visible BEFORE the
          sentence is written, which is the only moment it can still be
          changed. */}
      <AnimatePresence>
        {picker && !recording && (
          <>
            {/* A tap anywhere else puts the doors away. Transparent and below
                them, above everything else. */}
            <motion.button
              type="button"
              aria-label="Close"
              tabIndex={-1}
              onClick={() => onPick?.(null)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="lg:hidden fixed inset-0 z-[9999] cursor-default"
            />
            {PICKS.map((p, i) => (
              <motion.button
                key={p.kind}
                type="button"
                data-testid={`dex-pick-${p.kind}`}
                aria-label={p.aria}
                onClick={() => onPick?.(p.kind)}
                initial={{ opacity: 0, scale: 0.5, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.5, y: 12 }}
                transition={{ type: "spring", stiffness: 420, damping: 28, delay: i * 0.05 }}
                /* Stacked straight up the FAB's own axis so the three read as
                   one column rather than a scatter.

                   The offsets are arithmetic, not taste, and the first attempt
                   was wrong by 22px — measured, the Ask circle sat ON the FAB.
                   The FAB is bottom:1rem and 4rem tall, so its top edge is 5rem
                   up; a 3.5rem circle clearing it by the same 12px the FAB
                   keeps from the dock must start at 5rem + 0.75rem = 5.75rem,
                   and each further one adds its own height plus that gap
                   (3.5 + 0.75 = 4.25rem). */
                style={{ bottom: `calc(${5.75 + i * 4.25}rem + env(safe-area-inset-bottom, 0px))` }}
                className={cn(
                  "lg:hidden fixed app-fab-right z-[10000] grid h-14 w-14 place-items-center",
                  "rounded-pill bg-kr-ink text-white ring-1 ring-[hsl(40_30%_92%/.30)]",
                  "shadow-[0_8px_28px_rgba(0,0,0,.40),0_0_22px_-4px_hsl(40_35%_92%/.45)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  /* The FAB is 4rem and these are 3.5rem, so their right edges
                     do not line up on their own — 0.25rem puts the centres on
                     one line. */
                  "mr-1"
                )}
              >
                <p.icon size={24} weight="fill" aria-hidden="true" />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-full mr-3 whitespace-nowrap rounded-pill bg-kr-ink/85 px-2.5 py-1 text-xs font-semibold text-white"
                >
                  {p.label}
                </span>
              </motion.button>
            ))}
          </>
        )}
      </AnimatePresence>

    <button
      type="button"
      data-testid="dex-fab"
      aria-label={
        recording ? `Stop recording, ${seconds} seconds`
        : intent === "send" ? "Send to Dex"
        : intent === "keyboard" ? "Type to Dex"
        : intent === "mic" ? "Speak to Dex"
        : "Dex"
      }
      onClick={recording ? onStop : onOpen}
      className={cn(
        // 12px gap from the pill, same baseline, safe-area aware.
        // MPWA-14: `app-fab-right` anchors to the centred shell's right edge so
        // it stays paired with the dock on a wide display; collapses to the
        // original 1rem on a phone.
        "lg:hidden fixed app-fab-right z-[10000] bottom-safe-4",
        "grid place-items-center rounded-pill shadow-brutal-lg transition-colors",
        "h-16 w-16 max-[359px]:h-[3.75rem] max-[359px]:w-[3.75rem]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        /* KM-32 — the FAB carries the same warm-white glow as the bar it sits
           beside: a lit rim and a soft halo, so the pair reads as one object
           rather than a black circle parked next to a lit pill. */
        recording
          ? "bg-danger-600 text-white recording-pulse"
          : "bg-kr-ink text-white hover:opacity-95 ring-1 ring-[hsl(40_30%_92%/.30)] shadow-[0_8px_28px_rgba(0,0,0,.40),0_0_22px_-4px_hsl(40_35%_92%/.45),inset_0_1px_0_hsl(40_40%_96%/.20)]"
      )}
    >
      {recording || intent === "stop" ? (
        <span className="flex flex-col items-center leading-none">
          <Stop size={22} weight="fill" aria-hidden="true" />
          <span className="mt-0.5 text-[length:var(--text-label)] font-bold tabular-nums">
            {seconds}s
          </span>
        </span>
      ) : intent === "send" ? (
        <PaperPlaneRight size={26} weight="fill" aria-hidden="true" />
      ) : intent === "keyboard" ? (
        <Keyboard size={26} weight="bold" aria-hidden="true" />
      ) : intent === "mic" ? (
        <Microphone size={27} weight="fill" aria-hidden="true" />
      ) : (
        /* KM-5 — the AI sparkle, not a microphone. The sheet behind this
           button is no longer a recorder with extras: it is Dex, and voice is
           simply how you talk to it. A mic advertised the input method rather
           than the thing, and it is the same glyph the sheet itself
           deliberately stopped showing. Sparkle is already the app's Dex/AI
           mark (AI priority, Ask Dex, the wordmark). */
        <Sparkle size={28} weight="fill" aria-hidden="true" />
      )}
    </button>
    </>
  );
}

export default DexFab;

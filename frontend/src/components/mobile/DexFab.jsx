// MPWA-03 · DexFab — the 64px mic circle, bottom-right, on the dock's baseline.
//
// §8 is emphatic that this IS Dex, not a second capture surface: it opens the
// Dex sheet, and Dex therefore gets no All Apps tile. Nothing appears in two
// places. (This used to say it opens DexSheet. DexSheet was removed from Layout
// in 97c2bfc (KM-23) and is not mounted; the live sheet is DexChat.)
//
// The glyph is a microphone — the action he wants — not an abstract persona
// mark. The name is carried by aria-label="Dex" so it is announced and learned
// without spending a visible label on it.
import * as React from "react";
import { Sparkle, Stop, Microphone, PaperPlaneRight, Keyboard } from "@phosphor-icons/react";
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
/* ASK-33 Phase 4 — ONE DOOR: the FAB opens Dex in ASK.

   KM-54 gave this button two doors, on the founder's instruction: "I want two
   separate buttons for two separate functionalities of Dex. When I click the
   Dex icon it should pop up two more small circular icons — one for asking and
   another for decision making — each routing to their own respective
   functionality." The reasoning behind that was right, and still is. Typing
   into Dex used to mean one thing (a question — POST /ask, read-only) while
   speaking meant another (a capture — POST /voice-notes, which creates a
   decision and its tasks): same field, same button, two consequences, and
   nothing on screen said which you were about to get. Picking the door first
   made the consequence visible BEFORE the sentence was written, the only moment
   it could still be changed.

   ASK-33 keeps that separation and gives it a place instead of a picker. The
   doors collapsed because Decide now has a permanent home: Decide lives in the
   Dex well on the Desk (/inbox), at every width; Ask lives in the Dex icon —
   /brain on desktop, this FAB on the phone. You no longer choose a door; you
   are standing in one. The channels are untouched (useDexCapture's dictate /
   capture, useDexConversation's ask / decide), and the sheet still says which
   Dex it is (DexChat's header).

   THE CONSEQUENCE, ACCEPTED KNOWINGLY: capturing a decision on the phone now
   requires being on /inbox. The founder took that trade on purpose (ASK-33,
   2026-09-15) — one rule for both surfaces rather than a second door on every
   screen. Weigh it before bringing the picker back. (The picker's Escape
   handler, MW-04, went with it: there is no picker left to dismiss.) */
export function DexFab({ onOpen, recording = false, seconds = 0, onStop, intent = "sparkle" }) {
  // Set when pointerdown already stopped the recording, so the click that
  // follows it is swallowed instead of being read as "start a new one".
  const stoppedRef = React.useRef(false);
  const { user } = useAuth();
  // Same check DexCaptureBar makes — hidden entirely, not disabled (§8).
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  if (!canCapture) return null;

  return (
    <button
      type="button"
      data-testid="dex-fab"
      data-mobile-chrome=""
      aria-label={
        recording ? `Stop recording, ${seconds} seconds`
        : intent === "send" ? "Send to Dex"
        : intent === "keyboard" ? "Type to Dex"
        : intent === "mic" ? "Speak to Dex"
        : "Dex"
      }
      /* KM-60 — STOP FIRES ON POINTERDOWN, not on click.
         Founder: "I can't stop the recording, and I found that once no speech
         is detected I can stop it." Both halves of that are explained by main-
         thread pressure rather than by any speech detection — there is none in
         this codebase, checked. A `click` only arrives after the browser has
         seen pointerdown, pointerup and decided it was not a scroll or a
         double-tap, and every one of those checks is queued behind whatever
         the main thread is doing. While the meter was re-rendering Layout 18
         times a second the queue was long enough to lose taps; while silent
         the work per frame was smaller and the tap survived.

         KM-60 removes that pressure at the source, but stop should not DEPEND
         on the main thread being free. pointerdown is the earliest signal that
         a finger has landed and it is dispatched before any of that
         adjudication, so the recording ends the moment you touch the button.
         Only stop is moved: starting on pointerdown would fire while scrolling
         past, and starting a recording by accident is worse than a tap that
         needs a full press. */
      /* ASK-32 1.6 — the swallow flag ends with the finger. The click that
         belongs to this pointerdown is dispatched right after pointerup, before
         any timer, so clearing the flag on a zero-delay timer after pointerup
         swallows exactly that click and never the NEXT tap. When the click
         never comes (the button re-renders from Stop to Send under the
         finger), the flag used to stay set and eat the Send after a recording;
         a short fallback covers a pointerup that lands elsewhere. */
      onPointerDown={recording ? (e) => {
        e.preventDefault();
        stoppedRef.current = true;
        setTimeout(() => { stoppedRef.current = false; }, 600);
        onStop?.();
      } : undefined}
      onPointerUp={() => { if (stoppedRef.current) setTimeout(() => { stoppedRef.current = false; }, 0); }}
      onClick={(e) => {
        // The click that follows the pointerdown we already acted on.
        if (stoppedRef.current) { stoppedRef.current = false; e.preventDefault(); return; }
        if (recording) { onStop?.(); return; }
        onOpen?.();
      }}
      className={cn(
        // 12px gap from the pill, same baseline, safe-area aware.
        // MPWA-14: `app-fab-right` anchors to the centred shell's right edge so
        // it stays paired with the dock on a wide display; collapses to the
        // original 1rem on a phone.
        "lg:hidden fixed app-fab-right z-[10000] bottom-safe-4",
        "grid place-items-center rounded-pill shadow-brutal-lg transition-colors",
        // No double-tap-to-zoom wait on this button — it is a control, and the
        // delay is time the browser spends deciding whether the tap was a
        // gesture before it will deliver the click.
        "touch-manipulation select-none",
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
  );
}

export default DexFab;

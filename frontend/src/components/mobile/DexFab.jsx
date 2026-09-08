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
export function DexFab({ onOpen, recording = false, seconds = 0, onStop, intent = "sparkle" }) {
  const { user } = useAuth();
  // Same check DexCaptureBar makes — hidden entirely, not disabled (§8).
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  if (!canCapture) return null;

  return (
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
  );
}

export default DexFab;

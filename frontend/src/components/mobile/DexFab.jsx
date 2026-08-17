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
import { Microphone, Stop } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { hasPerm } from "@/lib/perms";
import { cn } from "@/lib/utils";

/**
 * @param {Function} onOpen
 * @param {boolean}  [recording]   true while DexCaptureBar is recording
 * @param {number}   [seconds]
 * @param {Function} [onStop]      tap again to stop (§5.6)
 */
export function DexFab({ onOpen, recording = false, seconds = 0, onStop }) {
  const { user } = useAuth();
  // Same check DexCaptureBar makes — hidden entirely, not disabled (§8).
  const canCapture = user?.role === "owner" || hasPerm(user, "voice_capture");
  if (!canCapture) return null;

  return (
    <button
      type="button"
      data-testid="dex-fab"
      aria-label={recording ? `Stop recording, ${seconds} seconds` : "Dex"}
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
        recording
          ? "bg-danger-600 text-white recording-pulse"
          : "bg-primary text-primary-foreground hover:opacity-95"
      )}
    >
      {recording ? (
        <span className="flex flex-col items-center leading-none">
          <Stop size={22} weight="fill" aria-hidden="true" />
          <span className="mt-0.5 text-[length:var(--text-label)] font-bold tabular-nums">
            {seconds}s
          </span>
        </span>
      ) : (
        <Microphone size={28} weight="regular" aria-hidden="true" />
      )}
    </button>
  );
}

export default DexFab;

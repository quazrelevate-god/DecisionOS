// MPWA-04 · UndoSnackbar — 5-second reversal for money actions (§5.5, §7).
//
// §5.5: an action committing money at or above the tenant's high-value
// threshold fires a 5-second undo rather than a confirm dialog. "Faster than a
// modal and safer than a bare tap" — the modal costs a tap on every single
// approval, including the ones he is sure about; the undo costs nothing unless
// he was wrong.
//
// Bottom-anchored ABOVE the dock and safe-area aware, so it never sits under
// the home indicator or behind the floating pill.
import * as React from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

const DURATION_MS = 5000;

/**
 * @param {boolean}  open
 * @param {string}   message   plain sentence — "Approved ₹4,80,000 for Surat Spinners"
 * @param {Function} onUndo    called if he taps Undo before the timer runs out
 * @param {Function} onExpire  called when the window closes without an undo —
 *                             this is where the real commit belongs if you are
 *                             deferring it
 * @param {number}   [duration]
 */
export function UndoSnackbar({
  open,
  message,
  onUndo,
  onExpire,
  duration = DURATION_MS,
  className,
  "data-testid": testId = "undo-snackbar",
}) {
  const [remaining, setRemaining] = React.useState(Math.ceil(duration / 1000));
  // Keep the latest callbacks without restarting the timer on every render.
  const expireRef = React.useRef(onExpire);
  expireRef.current = onExpire;

  React.useEffect(() => {
    if (!open) return undefined;
    setRemaining(Math.ceil(duration / 1000));
    const tick = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    const done = setTimeout(() => expireRef.current?.(), duration);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [open, duration]);

  if (!open) return null;

  return (
    <div
      // polite, not assertive: this is a confirmation, not an alarm, and
      // assertive would interrupt the next thing he does.
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={cn(
        // 96px clears the 64px dock plus its 16px offset; bottom-safe-4 adds
        // the home indicator on top.
        "fixed inset-x-3 z-[10070] mx-auto max-w-md",
        "flex items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-800 px-3.5 py-3 text-white shadow-brutal-lg",
        className
      )}
      style={{ bottom: "calc(6rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <p className="min-w-0 flex-1 text-sm leading-snug">{message}</p>
      <button
        type="button"
        onClick={onUndo}
        data-testid={`${testId}-undo`}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/25 px-3 text-sm font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        style={{ minHeight: "var(--control-h-sm)" }}
      >
        <ArrowCounterClockwise size={18} weight="bold" />
        Undo
        {/* The count is the honest part — he can see exactly how long he has. */}
        <span className="tabular-nums opacity-70">{remaining}s</span>
      </button>
    </div>
  );
}

export default UndoSnackbar;

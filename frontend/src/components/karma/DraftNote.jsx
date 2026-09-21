/* PILOT-1 A — the line a form shows when it opens with words kept from before
 * (lib/drafts.js). It says the words are not sent yet, so nobody assumes they
 * were, and it offers the one way to throw them away on purpose. The button
 * keeps the 44px touch floor even though it reads as a quiet text link.
 */
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { cn } from "../../lib/utils";

export function DraftNote({ onDiscard, label = "Kept from before — not sent yet", testid = "draft-note", className }) {
  return (
    <div role="status" data-testid={testid}
      className={cn("flex min-w-0 items-center justify-between gap-2 text-xs text-slate-500", className)}>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <ClockCounterClockwise size={13} weight="bold" aria-hidden="true" className="shrink-0" />
        <span className="truncate">{label}</span>
      </span>
      <button type="button" onClick={onDiscard} data-testid={`${testid}-discard`}
        className="inline-flex min-h-11 shrink-0 items-center rounded-pill px-3 font-medium text-slate-700 transition-colors hover:bg-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline">
        Discard
      </button>
    </div>
  );
}

export default DraftNote;

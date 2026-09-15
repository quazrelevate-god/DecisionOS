// ASK-33 Phase 4 — a Decide ending with nowhere on screen to show it.
//
// The phone's Dex sheet shows an ending as a message in its transcript. When the
// sheet has been closed by the time the note ends — or the Desk well kept the
// capture because the sheet could not take it — the ending comes here instead.
// Re-opening the sheet on its own is not an option: a sheet that lets itself
// back in when a poll lands is KM-23's ghost card.
//
// READY and NOTHING TO DECIDE are toasts that go away on their own. A ready
// decision is not lost with the toast — it waits in the Decisions column,
// /inbox?decision=<id> opens it, and ASK-32 2.3 notifies whoever decides — and
// nothing-to-decide has nothing at stake.
//
// FAILED STAYS until the founder dismisses it. A failed capture creates no
// decision: nothing in the Decisions column records it and there is nothing to
// deep-link to, so a message that timed out while the phone was in a pocket
// would lose the failure silently — the exact problem plan 5.2 exists to fix,
// and 14 of the 15 real failures. Its proper home is plan 5.3 ("My captures").
// Phase 5: it is no longer a toast. A toast with no auto-dismiss sat over the
// score row and the bell at 360px indefinitely; it is now a notice that never
// covers a control (lib/dexFailureNotices, components/mobile/DexFailureNotice).
import { toast } from "sonner";
import { OUTCOME_COPY } from "./dexOutcome";
import { addFailureNotice } from "./dexFailureNotices";

/**
 * @param {{text: string, outcome?: object}} message  an ending, as useDexConversation writes it
 * @param {{onReview?: Function, onRetry?: Function, canRetry?: Function}} handlers
 *        onReview(decisionId) · onRetry(outcome) · canRetry() — false while Dex is
 *        still reading another capture, when a Retry would orphan that one
 */
export function toastDexOutcome(message, { onReview, onRetry, canRetry } = {}) {
  const o = message?.outcome;
  if (!o) {
    if (message?.text) toast.error(message.text);
    return;
  }
  if (o.kind === "ready") {
    toast(o.headline, {
      description: o.title || undefined,
      action: o.decisionId && onReview ? { label: "Review", onClick: () => onReview(o.decisionId) } : undefined,
    });
    return;
  }
  if (o.kind === "nothing") {
    toast(OUTCOME_COPY.nothing, { description: o.answer || undefined });
    return;
  }
  if (o.kind === "failed") {
    addFailureNotice({
      message: o.message,
      retry: o.retry || null,
      onRetry: onRetry ? () => onRetry(o) : null,
      canRetry,
    });
    return;
  }
  toast(OUTCOME_COPY.slow);
}

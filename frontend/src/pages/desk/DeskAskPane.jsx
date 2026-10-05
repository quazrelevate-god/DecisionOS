/* ASK-INLINE · THE DESK'S BLACK SHEET, SPEAKING.
 *
 * 2026-10-05. The founder's redesign of Ask: it stops being a sheet that
 * arrives over the Desk and becomes the Desk's own sheet, cleared out.
 *
 *   "we will utilize the existing black sheet as a chat screen, so once we
 *    start the ask section the entire black sheet will become clean by
 *    removing all the components inside... the KPI grid will become removed
 *    and the black sheet will increase its height until the entire KPI grid
 *    area, so it will touch the greeting and score section."
 *
 * So this draws ONLY the transcript. It owns no conversation, no capture and
 * no composer:
 *   · the words are Layout's `chat` — the same object the dock and the FAB
 *     have always used, handed down through DexDoors. Two conversations would
 *     mean a founder's question landing in a transcript they are not looking
 *     at, which is the one failure this whole screen cannot have;
 *   · the composer is the slider below it (DexSlider's `composer` mode), which
 *     is the point of the redesign — one control, not a dock and a sheet;
 *   · the turns are DexChat's own Bubble and Outcome, imported rather than
 *     re-written, so the inline screen and the overlay cannot drift apart.
 *
 * WHAT IT ADDS is the one thing a transcript in a fixed box needs and a sheet
 * did not: it is bottom-anchored and it scrolls itself, so the newest turn sits
 * just above the control and older ones stack away upward.
 */
import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { X } from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";
import { Bubble, Outcome } from "../../components/mobile/DexChat";
import { cn } from "@/lib/utils";

export function DeskAskPane({ chat, onClose, onOpenDecision }) {
  const { log = [], busy, attaching = false, retry, canRetry, clear } = chat || {};
  const navigate = useNavigate();
  const endRef = React.useRef(null);
  const [lightbox, setLightbox] = React.useState(null);
  const openFile = React.useCallback((src, name) => setLightbox({ src, name }), []);

  /* The newest turn, every time one lands. `block: "end"` rather than a scroll
     to the bottom of the page: the pane is its own scroller and the page
     behind it must not move. */
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: log.length > 1 ? "smooth" : "auto" });
  }, [log.length, busy]);

  const onReview = (id) => {
    if (onOpenDecision) return onOpenDecision(id);
    navigate(`/inbox?decision=${encodeURIComponent(id)}`, { replace: true });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="desk-ask-pane">
      {/* The way out, and the only chrome in here. The slider's own knob
          returns to the middle when the conversation ends; this is for leaving
          it standing. Clear sits beside it, as it does in the sheet. */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1.5">
        <span className="text-[13px] font-medium text-white/60">
          {log.length ? "Dex" : "Ask Dex"}
        </span>
        <span className="flex items-center gap-2">
          {log.length > 0 && (
            <button
              type="button"
              onClick={() => clear?.()}
              data-testid="desk-ask-clear"
              aria-label="Clear this conversation"
              className="grid h-11 place-items-center rounded-pill bg-white/10 px-4 text-sm font-medium text-white hover:bg-white/20"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="desk-ask-close"
            aria-label="Close Ask and go back to the Desk"
            className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* THE TRANSCRIPT. Bottom-anchored (mt-auto on the stack) so a short
          conversation sits on the floor by the control rather than floating at
          the top of a tall empty sheet. */}
      <div className="kr-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        <div className="flex min-h-full flex-col justify-end gap-2.5 pb-1">
          <AnimatePresence initial={false}>
            {log.map((m, i) => (
              m.outcome
                ? <Outcome key={m.id || i} o={m.outcome} onReview={onReview}
                    onRetry={() => retry?.()} retryDisabled={!canRetry} />
                : <Bubble key={m.id || i} m={m} index={i} onOpenFile={openFile} />
            ))}
          </AnimatePresence>
          {/* Dex is reading. Not shown while a file is still going up: that has
              its own preview above the control and saying both at once reads as
              two things happening. */}
          {busy && !attaching && (
            <Bubble m={{ role: "dex", text: "Thinking…" }} index={log.length} onOpenFile={openFile} />
          )}
          <div ref={endRef} aria-hidden="true" />
        </div>
      </div>

      {/* A sent image opens full size — an 80px thumbnail is enough to
          recognise a delivery note and not enough to read one. */}
      {lightbox && (
        <div
          data-testid="desk-ask-lightbox"
          role="dialog"
          aria-label={lightbox.name || "Attachment"}
          onClick={() => setLightbox(null)}
          className={cn("fixed inset-0 z-[9600] grid place-items-center bg-black/80 p-6")}
        >
          <img src={lightbox.src} alt={lightbox.name || ""} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}

export default DeskAskPane;

/* THE DOCK IS THE SLIDER, on every page except the Desk.
 *
 * 2026-10-06. The founder's complaint was consistency: the Desk had grown a
 * slider while every other room still carried the old Dex circle in the corner,
 * "and we use the same ask desk functionality with different UI, right?"
 *
 *   "Take the same slider container and implement it in the navbar. Increase
 *    the navbar height to the same height of the slider container and place the
 *    centre slider icon button in the centre of the dock navbar. Rearrange the
 *    navbar items evenly to both sides."
 *
 * So this is the dock drawn as DexSlider's well, with the four destinations
 * living inside it — two to the left of the handle, two to the right. There is
 * no Dex circle anywhere any more.
 *
 * THE GESTURE IS ONE MOVEMENT, THREE THINGS. As the handle travels the founder
 * asked that the ends appear and the destinations disappear together, "both
 * have to be made simultaneously", with the handle's glyph turning to match.
 * All three are driven off the SAME number — DexSlider's own travel, reported
 * through `onDrag` — rather than off three animations that would drift.
 *
 * LEFT IS ASK, and the bar becomes the conversation: it grows with the chat to
 * half the screen and then scrolls inside itself (the founder's call), with a
 * close button to put it back. RIGHT IS DECIDE, unchanged from the Desk — the
 * capture and its review card, and this bar does not move.
 *
 * NOT ON THE DESK. The Desk has its own slider on its own sheet and is
 * explicitly out of scope: "this UI change shouldn't be affecting the home
 * screen, it should only show in other screens except the desk screen."
 */
import * as React from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X } from "@phosphor-icons/react";
import { AnimatePresence } from "framer-motion";
import { DexSlider } from "../karma/DexSlider";
import { dockSlots, DockItem } from "./FloatingDock";
import { Bubble, Outcome } from "./DexChat";
import { cn } from "@/lib/utils";

export function DockSlider({
  user, chat, askOpen, onAsk, onDecide, onCloseAsk,
  capturing = false, recording = false, levelsRef = null, onStop,
  onOpenDecision,
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const slots = React.useMemo(() => dockSlots(user, t), [user, t]);
  const [pct, setPct] = React.useState(0);
  const onDrag = React.useCallback((p) => setPct(p), []);

  /* The destinations fade exactly as the ends arrive: 1 - pct * 1.25 is the
     curve DexSlider's own labels use, so the two halves of the swap are the
     same movement rather than two that look alike. `pointer-events` goes with
     the opacity — a destination you cannot see must not be tappable either,
     or a committed swipe can end on a navigation. */
  const fade = Math.max(0, 1 - pct * 1.25);
  const left = slots.slice(0, 2);
  const right = slots.slice(2, 4);

  const items = (side) => (
    <div className="flex min-w-0 flex-1 items-stretch justify-around gap-0.5">
      {side.map((s) => (
        <DockItem key={s.to} {...s} active={location.pathname.startsWith(s.to)} />
      ))}
    </div>
  );

  /* THE BAR'S CONTENTS WHILE IT IS A BAR: two destinations, the handle's own
     width of air in the middle, two more. The gap is not a spacer element —
     it is the handle's footprint, so the items never sit under it. */
  const behind = (
    <div
      aria-hidden={pct > 0.4 ? "true" : undefined}
      style={{ opacity: fade, pointerEvents: fade < 0.6 ? "none" : undefined }}
      className="absolute inset-0 flex items-stretch px-2 transition-opacity duration-75"
      data-testid="dock-slider-items"
    >
      {items(left)}
      <span className="w-[6.25rem] shrink-0" aria-hidden="true" />
      {items(right)}
    </div>
  );

  return (
    <nav
      className="lg:hidden fixed app-dock-left app-dock-right-wide z-[10000] bottom-safe-4"
      data-testid="dock-slider"
      data-mobile-chrome=""
      aria-label={t("nav.primary", "Primary")}
    >
      {askOpen ? (
        <DockAskPanel chat={chat} onClose={onCloseAsk} onOpenDecision={onOpenDecision}>
          <DexSlider
            tone="ink"
            composer
            capturing={capturing}
            recording={recording}
            levelsRef={levelsRef}
            onStop={onStop}
            onAsk={onAsk}
            onDecide={onDecide}
          />
        </DockAskPanel>
      ) : (
        <DexSlider
          tone="ink"
          behind={behind}
          onDrag={onDrag}
          onAsk={onAsk}
          onDecide={onDecide}
          capturing={capturing}
          recording={recording}
          levelsRef={levelsRef}
          onStop={onStop}
        />
      )}
    </nav>
  );
}

/* THE BAR, GROWN INTO A CONVERSATION.
 * Half the screen is the ceiling the founder chose — beyond that the transcript
 * scrolls inside itself and the page behind stays visible, which is the whole
 * point of it being the dock that grew rather than a screen that arrived. */
function DockAskPanel({ chat, onClose, onOpenDecision, children }) {
  const { log = [], busy, attaching = false, retry, canRetry, clear, ask } = chat || {};
  const endRef = React.useRef(null);
  const [lightbox, setLightbox] = React.useState(null);
  const openFile = React.useCallback((src, name) => setLightbox({ src, name }), []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: log.length > 1 ? "smooth" : "auto" });
  }, [log.length, busy]);

  return (
    <div
      className="kr-dock-chat flex flex-col overflow-hidden rounded-[var(--radius-card)]"
      data-testid="dock-ask-panel"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pt-2.5">
        <span className="text-[13px] font-medium text-white/60">{log.length ? "Dex" : "Ask Dex"}</span>
        <span className="flex items-center gap-2">
          {log.length > 0 && (
            <button
              type="button"
              onClick={() => clear?.()}
              data-testid="dock-ask-clear"
              aria-label="Clear this conversation"
              className="grid h-10 place-items-center rounded-pill bg-white/10 px-3.5 text-[13px] font-medium text-white hover:bg-white/20"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            data-testid="dock-ask-close"
            aria-label="Close Ask and go back to the menu"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </div>

      {/* The transcript. Bottom-anchored, so a short conversation sits on the
          control rather than floating at the top of a tall empty panel. */}
      <div className="kr-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <div className="flex min-h-full flex-col justify-end gap-2.5">
          <AnimatePresence initial={false}>
            {log.map((m, i) => (
              m.outcome
                ? <Outcome key={m.id || i} o={m.outcome} onReview={onOpenDecision}
                    onRetry={() => retry?.()} retryDisabled={!canRetry} />
                : <Bubble key={m.id || i} m={m} index={i} onOpenFile={openFile} onAsk={(q) => ask?.(q)} />
            ))}
          </AnimatePresence>
          {busy && !attaching && (
            <Bubble m={{ role: "dex", text: "Thinking…" }} index={log.length} onOpenFile={openFile} />
          )}
          <div ref={endRef} aria-hidden="true" />
        </div>
      </div>

      {/* The control, at the foot, where it was before the bar grew. */}
      <div className="shrink-0 px-1 pb-1">{children}</div>

      {lightbox && (
        <div
          data-testid="dock-ask-lightbox"
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

export default DockSlider;

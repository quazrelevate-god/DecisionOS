// MPWA-04 · BottomSheet — the backbone of every later mobile slice (§7).
//
// Contract, from §7 and §5.5:
//   * locks background scroll and restores the position on close
//   * traps focus, returns focus to the trigger
//   * closes on Escape
//   * neutral scrim, never tinted (a red scrim reads as danger on every sheet)
//   * a drag handle AND a visible close button — a handle alone is not
//     discoverable for this user
//   * env(safe-area-inset-bottom) padding so actions clear the home indicator
//
// Built on Radix Dialog rather than hand-rolled: focus trap, Escape, aria
// wiring and the iOS-safe scroll lock (react-remove-scroll) are the parts
// that are easy to get subtly wrong, and Radix is already a dependency.
// Scroll *position* restore is handled explicitly below, because that is the
// one part Radix does not promise.
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Scroll lock.
//
// Radix (via react-remove-scroll) sets `body { overflow: hidden }`. That does
// NOT lock this app: the scroller is the document element, so hiding body
// overflow collapses its scrollable height and the browser *clamps* scrollY —
// measured jumping 900 -> 38 the moment a sheet opened, and staying there
// after close. §7 requires the opposite: lock, and restore on close.
//
// So pin the body instead. `position: fixed; top: -Y` keeps the page visually
// exactly where it was, makes scrolling impossible, and survives iOS Safari,
// where overflow:hidden is not honoured on the body at all.
//
// Depth-counted because sheets nest — a SheetSelect opened from inside a
// decision sheet must not capture scrollY 0 (the pinned value) and reset the
// outer sheet's position when it closes.
// ---------------------------------------------------------------------------
const lockState = { depth: 0, y: 0, prev: null, lastY: 0, tracking: false };

// Why we track scroll ourselves instead of reading window.scrollY at lock time:
// React runs child effects before parent effects, so Radix's RemoveScroll (a
// child of this component) sets `body { overflow: hidden }` *first*. That
// collapses the document's scrollable height and the browser synchronously
// clamps window.scrollY — measured as 900 -> 38 — so by the time this
// component's effect runs, the real position is already gone. The clamp's
// scroll *event* is async, so a passive listener still holds the true value.
function startTrackingScroll() {
  if (lockState.tracking || typeof window === "undefined") return;
  lockState.tracking = true;
  lockState.lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      // Ignore the clamp, and any scrolling that happens while pinned.
      if (lockState.depth === 0) lockState.lastY = window.scrollY;
    },
    { passive: true }
  );
}

function lockBodyScroll() {
  if (lockState.depth++ > 0) return;
  const body = document.body;
  lockState.y = lockState.lastY;
  lockState.prev = {
    position: body.style.getPropertyValue("position"),
    top: body.style.getPropertyValue("top"),
    left: body.style.getPropertyValue("left"),
    right: body.style.getPropertyValue("right"),
    width: body.style.getPropertyValue("width"),
  };
  // !important because react-remove-scroll applies its own body class; without
  // it, `position` loses and the pin silently degrades to overflow:hidden.
  body.style.setProperty("position", "fixed", "important");
  body.style.setProperty("top", `-${lockState.y}px`, "important");
  body.style.setProperty("left", "0", "important");
  body.style.setProperty("right", "0", "important");
  body.style.setProperty("width", "100%", "important");
}

function unlockBodyScroll() {
  if (--lockState.depth > 0) return;
  lockState.depth = 0;
  const body = document.body;
  const prev = lockState.prev || {};
  for (const p of ["position", "top", "left", "right", "width"]) {
    body.style.removeProperty(p);
    if (prev[p]) body.style.setProperty(p, prev[p]);
  }

  // Radix keeps its own `body { overflow: hidden }` until the sheet's exit
  // animation finishes, and while that is set the document's max scroll is
  // clamped — a single scrollTo lands at ~38px instead of 900. Re-apply for a
  // few frames until it takes, then stop. Bounded, so a page that genuinely
  // cannot reach `y` (content got shorter) settles instead of spinning.
  const y = lockState.y;
  let tries = 0;
  const settle = () => {
    window.scrollTo(0, y);
    if (Math.abs(window.scrollY - y) <= 2 || tries++ > 40) return;
    requestAnimationFrame(settle);
  };
  settle();
}

/**
 * Shared by every modal mobile surface (BottomSheet, AllAppsPanel) so they all
 * get the same pinned-body lock and the same restore-on-close.
 */
export function useBodyScrollLock(open) {
  React.useEffect(startTrackingScroll, []);
  React.useEffect(() => {
    if (!open) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);
}

/**
 * @param {boolean}  open
 * @param {Function} onClose
 * @param {string}   title        required — announced, and the sheet's heading
 * @param {string}   [description] optional sub-line under the title
 * @param {ReactNode} [footer]    pinned action row; gets the safe-area padding
 * @param {'auto'|'tall'|'full'} [size]
 * @param {boolean}  [dismissible] false pins the sheet open except via its own
 *                                 actions (used for money-committing flows)
 */
export function BottomSheet({
  open,
  onClose,
  title,
  description,
  footer,
  size = "auto",
  dismissible = true,
  className,
  children,
  "data-testid": testId = "bottom-sheet",
}) {
  useBodyScrollLock(open);

  const handleOpenChange = (next) => {
    if (!next) onClose?.();
  };

  const heights = {
    auto: "max-h-[85vh]",
    tall: "h-[85vh]",
    full: "h-[100dvh] rounded-t-none",
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* Neutral scrim — §7 is explicit that it is never tinted. */}
        <DialogPrimitive.Overlay
          data-testid={`${testId}-scrim`}
          className="fixed inset-0 z-[10050] bg-neutral-900/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-testid={testId}
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onPointerDownOutside={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[10060] flex flex-col",
            "rounded-t-2xl border-t border-border bg-card shadow-brutal-lg",
            "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
            // A sheet is thumb-reachable; on a tablet it should not span the
            // whole width, so cap it and centre.
            "mx-auto sm:max-w-lg sm:rounded-b-2xl sm:bottom-4",
            heights[size] || heights.auto,
            className
          )}
        >
          {/* Grab handle — decorative; the close button below is the real
              affordance, so keep the handle out of the tab order. */}
          <div className="flex justify-center pt-2.5 pb-1 shrink-0" aria-hidden="true">
            <span className="h-1.5 w-10 rounded-pill bg-neutral-300 dark:bg-neutral-600" />
          </div>

          <div className="flex items-start gap-3 px-4 pb-3 shrink-0">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title
                data-testid={`${testId}-title`}
                className="font-heading text-lg font-semibold leading-snug tracking-tight line-clamp-2"
              >
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                // Radix warns without a description; keep it for screen
                // readers without occupying layout.
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              data-testid={`${testId}-close`}
              aria-label="Close"
              className="shrink-0 grid place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ minHeight: "var(--control-h-sm)", minWidth: "var(--control-h-sm)" }}
            >
              <X size={22} weight="bold" />
            </DialogPrimitive.Close>
          </div>

          {/* The only scrolling region. overscroll-contain stops a flick at the
              end of the list from scrolling the page behind the sheet. */}
          <div
            data-testid={`${testId}-body`}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
          >
            {children}
          </div>

          {footer ? (
            <div
              data-testid={`${testId}-footer`}
              className="shrink-0 border-t border-border bg-card px-4 pt-3 pb-safe"
            >
              <div className="pb-3">{footer}</div>
            </div>
          ) : (
            <div className="shrink-0 pb-safe" />
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default BottomSheet;

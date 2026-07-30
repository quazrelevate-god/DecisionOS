import * as React from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { IconButton } from "./Button";

/**
 * Mobile navigation drawer.
 *
 * The product is used on phones, so this is the primary navigation for most
 * sessions rather than a fallback for the sidebar.
 *
 * Behaviour that is easy to skip and expensive to retrofit:
 *
 * - Body scroll is locked while open, otherwise the page behind scrolls under
 *   your thumb and the drawer feels detached from the app.
 * - Escape closes it, and focus moves into the panel on open and back to the
 *   trigger on close — a drawer you cannot leave by keyboard is a trap.
 * - Focus is contained while open, so Tab cannot walk into the page behind.
 * - The scrim is neutral at low opacity, never tinted: a coloured overlay makes
 *   the app underneath look like it is in an error state.
 *
 * @typedef {'left'|'right'} DrawerSide
 * @typedef {object} MobileDrawerProps
 * @property {boolean} open
 * @property {() => void} onClose
 * @property {string} title Accessible name for the dialog.
 * @property {boolean} [hideTitle=false] Visually hide the title but keep it for screen readers.
 * @property {DrawerSide} [side='left']
 * @property {React.ReactNode} [footer]
 * @property {React.ReactNode} children
 *
 * @example
 * <MobileDrawer open={open} onClose={() => setOpen(false)} title="Navigation">
 *   <SidebarNav items={items} activeKey={active} onSelect={go} />
 * </MobileDrawer>
 */
export const MobileDrawer = React.forwardRef(
  ({ className, open, onClose, title, hideTitle = false, side = "left", footer, children, ...props }, ref) => {
    const panelRef = React.useRef(null);
    const returnFocusRef = React.useRef(null);

    // onClose is almost always an inline arrow, so a new identity every render.
    // Depending on it would tear down and re-run the whole effect on each render
    // — re-locking scroll and yanking focus back to the trigger mid-interaction,
    // which is how the drawer ended up opening with focus still on the page.
    // The handler reads the latest one through a ref instead.
    const onCloseRef = React.useRef(onClose);
    React.useEffect(() => {
      onCloseRef.current = onClose;
    });

    React.useEffect(() => {
      if (!open) return undefined;

      returnFocusRef.current = document.activeElement;
      const { overflow } = document.body.style;
      document.body.style.overflow = "hidden";

      const focusable = () =>
        Array.from(
          panelRef.current?.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ) || []
        );

      // Deferred a frame: focusing synchronously inside the effect races the
      // browser's own focus handling for the click that opened the drawer, and
      // the click can win — leaving focus on the trigger behind the scrim.
      const focusFrame = requestAnimationFrame(() => focusable()[0]?.focus());

      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCloseRef.current?.();
          return;
        }
        if (e.key !== "Tab") return;
        const items = focusable();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      };

      document.addEventListener("keydown", onKeyDown);
      return () => {
        cancelAnimationFrame(focusFrame);
        document.removeEventListener("keydown", onKeyDown);
        document.body.style.overflow = overflow;
        returnFocusRef.current?.focus?.();
      };
    }, [open]);

    if (!open) return null;

    return (
      <div className={cn("fixed inset-0 z-50 lg:hidden", className)} {...props}>
        {/* Neutral scrim — a tinted overlay makes the app look like it errored. */}
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          className="absolute inset-0 bg-neutral-900/50"
        />

        <div
          ref={(node) => {
            panelRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className={cn(
            "absolute inset-y-0 flex w-72 max-w-[85vw] flex-col bg-surface shadow-lg",
            side === "left" ? "left-0 border-r border-hairline" : "right-0 border-l border-hairline"
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3">
            <p className={cn("text-body-strong text-text", hideTitle && "sr-only")}>{title}</p>
            <IconButton size="sm" label={`Close ${title}`} icon={<X />} onClick={onClose} className="ml-auto" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer && <div className="border-t border-hairline p-4">{footer}</div>}
        </div>
      </div>
    );
  }
);
MobileDrawer.displayName = "MobileDrawer";

import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { useIsMobile } from "../../hooks/useIsMobile";
import { GLASS_ICON_BTN, GLASS_SHEET } from "../neuglass/glass";

/* Epic 11 S12 polish — the one window every customer/supplier question opens
   in: the party dialog, "check these first", the details prompt and the old-work
   review. On a desktop it is the app's glass card in the middle of the screen;
   on a phone it is a sheet along the bottom edge, like the app's other phone
   sheets, its last row clear of the home indicator (--sa-bottom).

   A bottom sheet with a text field has one more job: iOS does not shrink the
   page for the keyboard, so the sheet would sit under it. It rides on the
   visual viewport instead (the height the keyboard leaves), divided by the UI
   scale because the panel is drawn at the app's CSS zoom (hooks/useUiScale). */
function useKeyboardLift(active) {
  const [lift, setLift] = useState(null);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!active || !vv) { setLift(null); return undefined; }
    const read = () => {
      const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale")) || 1;
      const under = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const next = { bottom: Math.round(under / k), h: Math.round(vv.height / k) };
      setLift((l) => (l && l.bottom === next.bottom && l.h === next.h ? l : next));
    };
    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, [active]);
  return lift;
}

export function PartySheet({ open, onOpenChange, title, description, testid, children, footer,
  wide = false, contentProps = {} }) {
  const phone = useIsMobile();
  const lift = useKeyboardLift(open && phone);
  const keyboard = phone && lift && lift.bottom > 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={testid} {...contentProps}
        style={keyboard ? { bottom: lift.bottom, maxHeight: lift.h - 12 } : undefined}
        className={cn(
          GLASS_SHEET,
          "flex flex-col gap-0 overflow-hidden rounded-[1.75rem] p-0 [&>button.absolute]:hidden",
          "max-h-[calc(85dvh/var(--ui-scale,1))]",
          wide ? "lg:max-w-lg" : "lg:max-w-md",
          // Phone: anchored to the bottom edge, full width, square at the foot.
          "max-lg:bottom-0 max-lg:left-0 max-lg:top-auto max-lg:w-full max-lg:max-w-none",
          "max-lg:translate-x-0 max-lg:translate-y-0 max-lg:rounded-b-none",
          "max-lg:max-h-[calc(100dvh/var(--ui-scale,1)-var(--sa-top,0px)-1rem)]",
        )}>
        <span aria-hidden="true" className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-pill bg-slate-900/15 lg:hidden" />
        <div className="flex shrink-0 items-start gap-3 px-5 pt-3 lg:px-6 lg:pt-6">
          <DialogHeader className="min-w-0 flex-1 space-y-1 pt-1 text-left">
            <DialogTitle className="text-[17px] font-semibold leading-snug tracking-tight text-slate-900 [text-wrap:balance]">
              {title}
            </DialogTitle>
            {description
              ? <DialogDescription className="text-[13px] leading-relaxed text-slate-600">{description}</DialogDescription>
              : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          <DialogClose asChild>
            <button type="button" aria-label="Close" data-testid={testid ? `${testid}-close` : undefined} className={GLASS_ICON_BTN}>
              <X size={16} weight="bold" aria-hidden="true" />
            </button>
          </DialogClose>
        </div>
        <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 lg:px-6",
          footer ? "pb-4" : "pb-[max(1.25rem,var(--sa-bottom))] lg:pb-6")}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-900/[0.06] px-5 pb-[max(1rem,var(--sa-bottom))] pt-3 lg:px-6 lg:pb-5">
            {footer}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* The two button looks every party window uses: a quiet glass pill and the ink pill. */
export const SHEET_BTN = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-pill px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-white disabled:opacity-40 lg:min-h-10";

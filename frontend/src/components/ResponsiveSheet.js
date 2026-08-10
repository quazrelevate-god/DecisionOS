import { useIsMobile } from "../lib/gestures";
import { cn } from "../lib/utils";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "./ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

/**
 * One focused overlay for detail views.
 *
 * On mobile it is a bottom sheet (vaul): slides up over a dimmed page,
 * drag-down or scrim-tap dismisses — the exact muscle memory of native
 * system sheets. On desktop it is a centred dialog. Either way the content
 * is isolated from the page, which is the decluttering contract: when
 * something expands, it expands ALONE, over a dimmed background, instead of
 * pushing the rest of the layout around inline.
 *
 * API mirrors what pages already passed to Dialog, so adoption is a swap.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  icon,
  children,
  testid,
  className,
  contentClassName,
}) {
  const mobile = useIsMobile();

  const heading = (
    <span className="flex min-w-0 items-center gap-2.5">
      {icon && <span className="shrink-0 text-primary">{icon}</span>}
      <span className="truncate">{title}</span>
    </span>
  );

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent data-testid={testid} className={cn("max-h-[88svh]", className)}>
          <div className="border-b border-border px-5 pb-3 pt-1">
            <DrawerTitle className="text-heading">{heading}</DrawerTitle>
            <DrawerDescription className="sr-only">{description || String(title)}</DrawerDescription>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4",
              contentClassName
            )}
          >
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testid}
        className={cn("max-h-[85vh] max-w-2xl overflow-y-auto rounded-xl border-border", className)}
      >
        <DialogHeader>
          <DialogTitle className="text-heading">{heading}</DialogTitle>
          <DialogDescription className="sr-only">{description || String(title)}</DialogDescription>
        </DialogHeader>
        <div className={contentClassName}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

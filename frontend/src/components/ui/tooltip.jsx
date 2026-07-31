import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

/**
 * Radix tooltip, re-authored onto our tokens.
 *
 * The registry default was `bg-primary text-primary-foreground` — in this
 * system that is INDIGO, the colour reserved for the single primary action on
 * a screen. A passive hint wearing the primary-action colour is exactly the
 * "weight applied without semantic logic" this design system was built to
 * remove, so the class list here is replaced rather than overridden.
 *
 * The conventional dark slab was tried and rejected on evidence: the token
 * that would give it, `text-inverse`, flips with the theme while
 * `--neutral-900` does not, so `bg-neutral-900 text-text-inverse` renders
 * near-black on near-black in dark mode. The surface treatment below is
 * correct in both themes by construction, and matches the popover language
 * already shipped in the header.
 *
 * Elevation is legitimate here. The system reserves shadow for things that
 * genuinely float, and a tooltip is one of the few that does.
 */
const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 max-w-xs overflow-hidden rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-small text-text shadow-md",
        "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1",
        className
      )}
      {...props} />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }

import * as React from "react";
import {
  Tooltip as Root,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

/**
 * Tooltip — the app-facing wrapper.
 *
 * WHY THIS EXISTS AT ALL. The header controls and the My Work row actions are
 * icon-only and were relying on the native `title` attribute. That has a
 * ~700ms delay you cannot tune, OS styling you cannot theme, no keyboard
 * path, and it never appears on touch — so on the phone, which is where this
 * product mostly lives, half the icon buttons were simply unlabelled. Radix
 * gives focus and Escape handling and a real accessible name.
 *
 * A TOOLTIP IS NOT A PLACE TO PUT INFORMATION. It is a label for a control
 * whose icon is not self-evident. Anything a decision depends on belongs on
 * the screen — this system's rule is that the count of what is hidden always
 * travels with it, and a tooltip cannot satisfy that on a touch device where
 * it may never open. Naming a control is the whole remit.
 *
 * The trigger renders `asChild`, so it adopts whatever you pass and adds no
 * wrapper element — an extra span inside a flex row would shift the layout it
 * was only meant to annotate.
 *
 * @typedef {object} TooltipProps
 * @property {string} label The accessible name. Sentence case, no full stop.
 * @property {React.ReactNode} children The control being named.
 * @property {'top'|'right'|'bottom'|'left'} [side='top']
 * @property {number} [delay=250] Shorter than the native title's ~700ms.
 *
 * @example
 * <Tooltip label="Sign out">
 *   <IconButton icon={<SignOut />} />
 * </Tooltip>
 */
export function Tooltip({ label, children, side = "top", delay = 250, ...props }) {
  if (!label) return children;
  return (
    <Root delayDuration={delay}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} {...props}>
        {label}
      </TooltipContent>
    </Root>
  );
}

export { TooltipProvider };

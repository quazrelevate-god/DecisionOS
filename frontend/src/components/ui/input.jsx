import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        // MPWA-01 (§5.1): h -> var(--control-h-base) — 36 desktop, 48 mobile.
        // NM-3: the inset recipe — a field you type INTO is the one place the
        // metaphor is intuitive (§1). min-h-11 lifts the desktop 36 to the
        // spec's 44 floor without touching the mobile var. Focus is a 2px
        // indigo ring, never the shadow change alone (§6). Disabled drops the
        // shadow entirely: a well that cannot receive input reads flat.
        "flex min-h-11 h-[var(--control-h-base)] w-full nm-inset px-3 py-1 text-base transition-shadow file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }

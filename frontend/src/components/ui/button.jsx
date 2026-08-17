import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // RD-1 (2026-08-17): every variant loses its drop shadow. Buttons in the
      // reference are flat — a filled rectangle for the primary action, a
      // hairline rectangle for everything else — and hover is a colour shift,
      // never a lift. `default` resolves to --primary, which is the brand
      // indigo: this is the one place the accent is allowed to fill a surface.
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-brand-700 active:bg-brand-800",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-danger-700",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-muted",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // MPWA-01 (§5.1): heights come from --control-h-*, which switch at the
      // lg breakpoint. Desktop keeps shadcn's 32/36/40; mobile lands on
      // 44/48/48. Never patch a size at a call-site.
      size: {
        default: "h-[var(--control-h-base)] px-4 py-2",
        sm: "h-[var(--control-h-sm)] rounded-md px-3 text-[length:var(--text-label)]",
        lg: "h-[var(--control-h-md)] rounded-md px-8",
        icon: "h-[var(--control-h-base)] w-[var(--control-h-base)]",
        // 56px on mobile — the tier §5.1 reserves for money-committing
        // actions (Approve / Reject / Submit).
        commit: "h-[var(--control-h-lg)] rounded-md px-6 text-base font-semibold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      // NM-3 (NEUMORPHIC-REVAMP §3) amends RD-1's flat rule selectively, on
      // §0's line: furniture may carry soft depth, the message may not.
      //   default     — the PRIMARY ACTION: solid indigo fill, always. Never
      //                 same-as-background (§6). It gains only the small soft
      //                 shadow; its identity stays the fill.
      //   destructive — a message (danger). Flat solid, untouched.
      //   outline/secondary — furniture: the raised-tile treatment, pressing
      //                 in on :active, which is what makes "pressable" legible
      //                 without relying on the raised/inset convention alone.
      //   ghost/link  — no surface, nothing to soften.
      // Radius: rounded-control (14px) across all variants — base beats the
      // recipe's rounded-tile because utilities out-cascade @layer components.
      // Focus: 2px indigo ring, never shadow alone (§6).
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-nm-sm hover:bg-brand-700 active:bg-brand-800",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-danger-700",
        outline:
          "nm-tile text-foreground hover:shadow-nm active:shadow-nm-press",
        secondary:
          "nm-tile text-primary hover:shadow-nm active:shadow-nm-press",
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

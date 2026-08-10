import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

/**
 * Meridian buttons.
 *
 * Hover never lightens the fill — it lifts. Press always compresses. Only the
 * exact animated properties are transitioned (never `transition-all`).
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg",
    "text-sm font-medium",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out",
    "active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-emphasis hover:shadow-sm hover:-translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:shadow-sm hover:-translate-y-px",
        outline:
          "border border-border bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-accent",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        subtle:
          "bg-primary-subtle text-primary hover:bg-primary/15",
        link:
          "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-6 text-[0.9375rem]",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-md",
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

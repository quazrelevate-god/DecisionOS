import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * The system's action element.
 *
 * There is exactly one primary per screen and it is the most visually dominant
 * thing on it. The variants encode that hierarchy structurally — there is no
 * `color` prop, so no caller can hand a button danger red for emphasis:
 *
 *   primary      deep indigo solid   the one action the screen exists for
 *   secondary    outline             supporting actions
 *   tertiary     ghost               utility actions that must not compete
 *   destructive  red OUTLINE only    delete / reject. Never a solid red slab.
 *
 * Disabled is neutral, never a pale tint of the primary — a faded indigo button
 * reads as "primary, but broken" instead of "unavailable".
 *
 * @typedef {'primary'|'secondary'|'tertiary'|'destructive'} ButtonVariant
 * @typedef {'sm'|'md'|'lg'} ButtonSize
 */

const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md",
    "font-medium transition-colors select-none",
    // Focus is always the indigo ring, at every size and variant.
    "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none",
    "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        secondary:
          "border border-hairline-strong bg-surface text-text hover:bg-surface-hover active:bg-surface-sunken",
        tertiary: "text-text-secondary hover:bg-surface-hover hover:text-text active:bg-surface-sunken",
        destructive:
          "border border-destructive-line bg-transparent text-destructive-text hover:bg-destructive-tint active:bg-destructive-tint",
      },
      size: {
        sm: "h-control-sm px-3 text-small [&_svg]:size-4",
        md: "h-control-md px-4 text-body [&_svg]:size-4",
        lg: "h-control-lg px-5 text-body [&_svg]:size-5",
      },
      iconOnly: {
        true: "px-0 aspect-square",
        false: "",
      },
    },
    compoundVariants: [
      { iconOnly: true, size: "sm", class: "w-control-sm" },
      { iconOnly: true, size: "md", class: "w-control-md" },
      { iconOnly: true, size: "lg", class: "w-control-lg" },
    ],
    defaultVariants: { variant: "primary", size: "md", iconOnly: false },
  }
);

/**
 * Disabled is neutral, never a pale tint of the primary.
 *
 * Applied in JS rather than as `disabled:` utilities because a loading button is
 * also `disabled` (it must not be clickable) but must KEEP its variant: a
 * primary that turns grey the moment it starts working reads as "this broke",
 * not "this is running". Relying on Tailwind variant ordering to settle that
 * conflict would be fragile, so the choice is made explicitly here.
 */
const DISABLED_VISUALS =
  "bg-surface-sunken text-text-disabled border-hairline shadow-none hover:bg-surface-sunken";

/**
 * @typedef {object} ButtonProps
 * @property {ButtonVariant} [variant='primary']
 * @property {ButtonSize} [size='md']
 * @property {boolean} [loading=false] Replaces the label with a spinner and disables the button.
 * @property {boolean} [disabled=false]
 * @property {boolean} [asChild=false] Render the child element instead of a <button> (e.g. a router link).
 * @property {React.ReactNode} [leadingIcon]
 * @property {React.ReactNode} [trailingIcon]
 * @property {string} [className]
 * @property {React.ReactNode} children
 *
 * @example
 * <Button size="lg" onClick={submit}>Review 3 decisions</Button>
 * <Button variant="secondary">Save draft</Button>
 * <Button variant="tertiary" leadingIcon={<EnvelopeSimple />}>Send Daily Digest</Button>
 * <Button variant="destructive" loading={deleting}>Delete draft</Button>
 */
const Button = React.forwardRef(
  (
    {
      className,
      variant,
      size,
      iconOnly = false,
      loading = false,
      disabled = false,
      asChild = false,
      leadingIcon,
      trailingIcon,
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;

    return (
      <Comp
        ref={ref}
        className={cn(
          buttonVariants({ variant, size, iconOnly }),
          disabled && !loading && DISABLED_VISUALS,
          className
        )}
        disabled={asChild ? undefined : isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {/* The label keeps its box while loading so the button never resizes. */}
        <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
          {leadingIcon}
          {children}
          {trailingIcon}
        </span>
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <CircleNotch className="animate-spin" aria-hidden="true" />
            <span className="sr-only">Loading</span>
          </span>
        )}
      </Comp>
    );
  }
);
Button.displayName = "Button";

/**
 * Square icon-only button. `label` is required and becomes the accessible name —
 * an icon button with no name is unusable with a screen reader.
 *
 * @typedef {object} IconButtonProps
 * @property {string} label Accessible name, e.g. "Dismiss notification".
 * @property {React.ReactNode} icon
 * @property {ButtonVariant} [variant='tertiary']
 * @property {ButtonSize} [size='md']
 * @property {boolean} [loading=false]
 * @property {boolean} [disabled=false]
 *
 * @example
 * <IconButton label="Toggle theme" icon={<Moon />} onClick={toggle} />
 */
const IconButton = React.forwardRef(({ label, icon, variant = "tertiary", ...props }, ref) => (
  <Button ref={ref} variant={variant} iconOnly aria-label={label} title={label} {...props}>
    {icon}
  </Button>
));
IconButton.displayName = "IconButton";

export { Button, IconButton, buttonVariants };

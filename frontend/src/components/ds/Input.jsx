import * as React from "react";
import { cn } from "@/lib/utils";
import { controlBase, controlBorder } from "./Field";

/**
 * Single-line text input.
 *
 * Placeholders are sentence case and describe the expected content — they are
 * never a substitute for the label.
 *
 * @typedef {object} InputProps
 * @property {string} [id]
 * @property {boolean} [invalid=false] Set by Field when an error is present.
 * @property {string} [describedBy]
 * @property {boolean} [disabled=false]
 * @property {React.ReactNode} [leadingIcon]
 * @property {string} [className]
 *
 * @example
 * <Field label="Supplier" helper="Who the payment is going to">
 *   {(ctl) => <Input {...ctl} placeholder="Acme Packaging" />}
 * </Field>
 */
export const Input = React.forwardRef(
  ({ className, invalid = false, describedBy, leadingIcon, disabled, ...props }, ref) => {
    const control = (
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          controlBase,
          controlBorder(invalid),
          "h-control-md px-3",
          leadingIcon && "pl-9",
          className
        )}
        {...props}
      />
    );

    if (!leadingIcon) return control;
    return (
      <div className="relative">
        <span
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2 [&_svg]:size-4",
            disabled ? "text-text-disabled" : "text-text-tertiary"
          )}
          aria-hidden="true"
        >
          {leadingIcon}
        </span>
        {control}
      </div>
    );
  }
);
Input.displayName = "Input";

import * as React from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { controlBase, controlBorder } from "./Field";

/**
 * Native select, styled to match the rest of the input set.
 *
 * Native on purpose: it is keyboard- and screen-reader-correct for free, and on
 * mobile it gets the platform picker. Reach for a listbox only when options need
 * richer content than a string.
 *
 * @typedef {object} SelectOption
 * @property {string} value
 * @property {string} label
 * @property {boolean} [disabled]
 *
 * @typedef {object} SelectProps
 * @property {SelectOption[]} options
 * @property {string} [placeholder] Rendered as a disabled first option.
 * @property {string} [id]
 * @property {boolean} [invalid=false]
 * @property {string} [describedBy]
 * @property {boolean} [disabled=false]
 *
 * @example
 * <Field label="Assignee">
 *   {(ctl) => <Select {...ctl} placeholder="Choose someone"
 *     options={[{ value: "pn", label: "Prasanna Narayanan" }]} />}
 * </Field>
 */
export const Select = React.forwardRef(
  ({ className, options = [], placeholder, invalid = false, describedBy, disabled, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn(
          controlBase,
          controlBorder(invalid),
          "h-control-md pl-3 pr-9 appearance-none cursor-pointer disabled:cursor-not-allowed",
          className
        )}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown
        size={14}
        weight="bold"
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2",
          disabled ? "text-text-disabled" : "text-text-tertiary"
        )}
      />
    </div>
  )
);
Select.displayName = "Select";

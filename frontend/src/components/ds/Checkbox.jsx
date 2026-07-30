import * as React from "react";
import { Check, Minus } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * Checkbox. Checked is the primary indigo; the control is never red, including
 * in its error state — an unchecked required box is handled by the field's
 * helper text, not by turning the box into an alarm.
 *
 * Built on a real <input type="checkbox"> kept visually hidden but focusable,
 * so keyboard, form submission and screen readers behave natively.
 *
 * @typedef {object} CheckboxProps
 * @property {boolean} [checked]
 * @property {boolean} [indeterminate=false]
 * @property {(e: React.ChangeEvent<HTMLInputElement>) => void} [onChange]
 * @property {string} [label]
 * @property {string} [description] Secondary line under the label.
 * @property {boolean} [disabled=false]
 * @property {boolean} [invalid=false]
 *
 * @example
 * <Checkbox label="Notify the assignee" description="Sends a WhatsApp message"
 *   checked={notify} onChange={(e) => setNotify(e.target.checked)} />
 */
export const Checkbox = React.forwardRef(
  ({ className, label, description, indeterminate = false, disabled, invalid = false, ...props }, ref) => {
    const innerRef = React.useRef(null);
    React.useImperativeHandle(ref, () => innerRef.current);
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label
        className={cn(
          "group inline-flex items-start gap-2.5",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          className
        )}
      >
        <span className="relative inline-flex shrink-0 mt-0.5">
          <input
            ref={innerRef}
            type="checkbox"
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className="peer sr-only"
            {...props}
          />
          <span
            aria-hidden="true"
            className={cn(
              "size-[18px] rounded-sm border flex items-center justify-center transition-colors",
              "border-hairline-strong bg-surface text-transparent",
              "peer-checked:bg-primary peer-checked:border-primary peer-checked:text-primary-foreground",
              "peer-indeterminate:bg-primary peer-indeterminate:border-primary peer-indeterminate:text-primary-foreground",
              "peer-focus-visible:ring-focus peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
              "peer-disabled:bg-surface-sunken peer-disabled:border-hairline peer-disabled:text-text-disabled",
              invalid && "border-destructive-line"
            )}
          >
            {indeterminate ? <Minus size={12} weight="bold" /> : <Check size={12} weight="bold" />}
          </span>
        </span>

        {(label || description) && (
          <span className="min-w-0">
            {label && (
              <span className={cn("block text-body", disabled ? "text-text-disabled" : "text-text")}>{label}</span>
            )}
            {description && (
              <span className={cn("block text-small", disabled ? "text-text-disabled" : "text-text-tertiary")}>
                {description}
              </span>
            )}
          </span>
        )}
      </label>
    );
  }
);
Checkbox.displayName = "Checkbox";

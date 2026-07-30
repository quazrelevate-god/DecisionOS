import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * On/off switch for settings that apply immediately.
 *
 * Use a Checkbox instead when the value is part of a form the user submits —
 * a toggle promises the change has already taken effect.
 *
 * @typedef {object} ToggleProps
 * @property {boolean} checked
 * @property {(next: boolean) => void} onCheckedChange
 * @property {string} label Accessible name; also rendered unless hideLabel.
 * @property {string} [description]
 * @property {boolean} [hideLabel=false]
 * @property {boolean} [disabled=false]
 *
 * @example
 * <Toggle label="Daily digest" description="Sent at 7am"
 *   checked={on} onCheckedChange={setOn} />
 */
export const Toggle = React.forwardRef(
  ({ className, checked, onCheckedChange, label, description, hideLabel = false, disabled, ...props }, ref) => (
    <div className={cn("flex items-start gap-3", className)}>
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-pill border border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:border-hairline",
          checked ? "bg-primary hover:bg-primary-hover" : "bg-neutral-300 hover:bg-neutral-400"
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-5 rounded-pill bg-surface shadow-xs transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          )}
        />
      </button>

      {!hideLabel && (label || description) && (
        <span className="min-w-0">
          <span className={cn("block text-body", disabled ? "text-text-disabled" : "text-text")}>{label}</span>
          {description && (
            <span className={cn("block text-small", disabled ? "text-text-disabled" : "text-text-tertiary")}>
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  )
);
Toggle.displayName = "Toggle";

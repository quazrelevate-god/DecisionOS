import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * CLAIMED progress — the value a person asserted about their own task.
 *
 * Four segments, because 0/25/50/75/100 are the only values the app can
 * produce (MyWork's PROGRESS_OPTIONS). A continuous bar would imply a
 * precision the data has never had; the segments say "three of four quarters",
 * which is the truth.
 *
 * Its shape is deliberately different from ProgressSteps so a claimed number
 * can never be mistaken for a computed one.
 *
 * The fill is indigo at every value — never red when behind, never green at
 * 100. Being behind is a judgement the row's urgency edge already makes, and
 * greening at completion would make success decorative.
 *
 * @typedef {0|25|50|75|100} QuarterValue
 * @typedef {object} ProgressQuartersProps
 * @property {number} value 0–100; snapped to the nearest quarter.
 * @property {(next: QuarterValue) => void} [onValueChange] Makes the control interactive.
 * @property {boolean} [showLabel=true]
 * @property {boolean} [disabled=false]
 * @property {string} [label] Accessible name, e.g. the task title.
 *
 * @example
 * <ProgressQuarters value={task.progress} label={task.title} />
 * <ProgressQuarters value={task.progress} onValueChange={save} label={task.title} />
 */
export const ProgressQuarters = React.forwardRef(
  ({ className, value = 0, onValueChange, showLabel = true, disabled = false, label, ...props }, ref) => {
    const filled = Math.round(Math.max(0, Math.min(100, value)) / 25);
    const interactive = Boolean(onValueChange) && !disabled;

    const segment = (i) => {
      const isFilled = i < filled;
      const cls = cn(
        "h-2 flex-1 rounded-sm transition-colors",
        isFilled ? (disabled ? "bg-neutral-300" : "bg-primary") : "bg-surface-sunken",
        interactive &&
          "cursor-pointer hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      );
      if (!interactive) return <span key={i} className={cls} aria-hidden="true" />;
      const next = /** @type {QuarterValue} */ ((i + 1) * 25);
      return (
        <button
          key={i}
          type="button"
          className={cls}
          aria-label={`Set progress to ${next}%`}
          onClick={() => onValueChange(next)}
        />
      );
    };

    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-3", className)}
        role="group"
        aria-label={label ? `Progress for ${label}` : "Progress"}
        {...props}
      >
        <div
          className="flex gap-1 flex-1 min-w-24"
          role="meter"
          aria-valuenow={filled * 25}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ? `${label} progress` : "Progress"}
        >
          {[0, 1, 2, 3].map(segment)}
        </div>
        {showLabel && (
          <span
            data-numeric
            className={cn(
              "text-small tabular-nums shrink-0",
              disabled ? "text-text-disabled" : "text-text-secondary"
            )}
          >
            {filled * 25}%
          </span>
        )}
      </div>
    );
  }
);
ProgressQuarters.displayName = "ProgressQuarters";

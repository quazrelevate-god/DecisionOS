import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * COMPUTED progress — derived from an execution plan's checklist, not claimed
 * by anyone.
 *
 * Continuous bar plus the count, because the count is the honest unit: "4 of 6
 * steps" is the fact, and 67% is a rendering of it. Its shape differs from
 * ProgressQuarters so the two kinds of number stay distinguishable at a glance.
 *
 * Indigo at every value, for the same reason as ProgressQuarters: progress is
 * not a judgement about whether the work is on time.
 *
 * @typedef {object} ProgressStepsProps
 * @property {number} done
 * @property {number} total
 * @property {boolean} [showPercent=true]
 * @property {boolean} [disabled=false]
 * @property {string} [label] Accessible name, e.g. the task title.
 *
 * @example
 * <ProgressSteps done={4} total={6} label={task.title} />
 */
export const ProgressSteps = React.forwardRef(
  ({ className, done = 0, total = 0, showPercent = true, disabled = false, label, ...props }, ref) => {
    const safeTotal = Math.max(0, total);
    const safeDone = Math.max(0, Math.min(safeTotal, done));
    const pct = safeTotal ? Math.round((safeDone / safeTotal) * 100) : 0;

    return (
      <div ref={ref} className={cn("flex items-center gap-3", className)} {...props}>
        <span
          className="relative h-2 flex-1 min-w-24 overflow-hidden rounded-pill bg-surface-sunken"
          role="meter"
          aria-valuenow={safeDone}
          aria-valuemin={0}
          aria-valuemax={safeTotal}
          aria-label={label ? `${label} progress` : "Progress"}
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-pill transition-[width]",
              disabled ? "bg-neutral-300" : "bg-primary"
            )}
            style={{ width: pct + "%" }}
          />
        </span>
        <span
          data-numeric
          className={cn("text-small tabular-nums shrink-0", disabled ? "text-text-disabled" : "text-text-secondary")}
        >
          {safeDone} of {safeTotal} steps
          {showPercent && <span className="text-text-tertiary"> · {pct}%</span>}
        </span>
      </div>
    );
  }
);
ProgressSteps.displayName = "ProgressSteps";

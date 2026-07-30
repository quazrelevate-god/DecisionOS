import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Progress slider — a range input for values the user sets directly, most often
 * percent-complete on a task.
 *
 * The filled portion is the primary indigo and stays indigo at every value: a
 * track that reddens as completion falls would be using danger for emphasis.
 * Being behind is a judgement the surrounding UI makes, not the control.
 *
 * The value is rendered with tabular figures so it does not jitter while dragging.
 *
 * @typedef {object} SliderFieldProps
 * @property {number} value
 * @property {(next: number) => void} onValueChange
 * @property {number} [min=0]
 * @property {number} [max=100]
 * @property {number} [step=5]
 * @property {string} [label]
 * @property {(v: number) => string} [formatValue]
 * @property {boolean} [disabled=false]
 *
 * @example
 * <SliderField label="Progress" value={pct} onValueChange={setPct} />
 */
export const SliderField = React.forwardRef(
  (
    {
      className,
      value,
      onValueChange,
      min = 0,
      max = 100,
      step = 5,
      label,
      formatValue = (v) => v + "%",
      disabled,
      id,
      describedBy,
      ...props
    },
    ref
  ) => {
    const pct = Math.round(((value - min) / (max - min)) * 100);

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {label && (
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id} className={cn("text-label uppercase", disabled ? "text-text-disabled" : "text-text-secondary")}>
              {label}
            </label>
            <span
              data-numeric
              className={cn("text-small tabular-nums", disabled ? "text-text-disabled" : "text-text-secondary")}
            >
              {formatValue(value)}
            </span>
          </div>
        )}

        <div className="relative flex items-center h-5">
          {/* Track + fill are presentational; the real input sits on top, transparent. */}
          <span aria-hidden="true" className="absolute inset-x-0 h-1.5 rounded-pill bg-surface-sunken" />
          <span
            aria-hidden="true"
            className={cn("absolute left-0 h-1.5 rounded-pill", disabled ? "bg-neutral-300" : "bg-primary")}
            style={{ width: pct + "%" }}
          />
          <input
            ref={ref}
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            aria-describedby={describedBy}
            onChange={(e) => onValueChange?.(Number(e.target.value))}
            className={cn(
              "relative w-full appearance-none bg-transparent cursor-pointer disabled:cursor-not-allowed",
              "focus-visible:outline-none",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-4",
              "[&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:bg-surface",
              "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary",
              "[&::-webkit-slider-thumb]:shadow-xs",
              "disabled:[&::-webkit-slider-thumb]:border-neutral-300",
              "focus-visible:[&::-webkit-slider-thumb]:ring-focus focus-visible:[&::-webkit-slider-thumb]:ring-ring",
              "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:bg-surface",
              "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary"
            )}
            {...props}
          />
        </div>
      </div>
    );
  }
);
SliderField.displayName = "SliderField";

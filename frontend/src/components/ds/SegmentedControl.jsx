import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Segmented control — one choice from a small, fixed set that reshapes the view
 * below it. Selected is indigo text on an indigo tint, never a solid fill: this
 * switches a view, it does not perform the screen's action.
 *
 * Arrow keys move between options, matching the tablist pattern, because a
 * segmented control that only responds to clicks is a row of buttons wearing a
 * costume.
 *
 * @typedef {object} SegmentedOption
 * @property {string} value
 * @property {string} label
 * @property {number} [count]
 * @property {boolean} [disabled]
 *
 * @typedef {object} SegmentedControlProps
 * @property {SegmentedOption[]} options
 * @property {string} value
 * @property {(next: string) => void} onValueChange
 * @property {'sm'|'md'} [size='md']
 * @property {string} [label] Accessible name for the group.
 *
 * @example
 * <SegmentedControl value={view} onValueChange={setView} label="Task view"
 *   options={[{ value: "mine", label: "Mine", count: 4 }, { value: "all", label: "All" }]} />
 */
export const SegmentedControl = React.forwardRef(
  ({ className, options = [], value, onValueChange, size = "md", label, ...props }, ref) => {
    const refs = React.useRef([]);

    const onKeyDown = (e, i) => {
      const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!delta) return;
      e.preventDefault();
      const enabled = options.map((o, idx) => (o.disabled ? null : idx)).filter((x) => x !== null);
      const pos = enabled.indexOf(i);
      const next = enabled[(pos + delta + enabled.length) % enabled.length];
      refs.current[next]?.focus();
      onValueChange?.(options[next].value);
    };

    return (
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        className={cn("inline-flex items-center gap-1 rounded-md bg-surface-sunken p-1", className)}
        {...props}
      >
        {options.map((o, i) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => (refs.current[i] = el)}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={o.disabled}
              onKeyDown={(e) => onKeyDown(e, i)}
              onClick={() => onValueChange?.(o.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring",
                size === "sm" ? "h-7 px-2.5 text-small" : "h-8 px-3 text-small",
                selected
                  ? "bg-primary-tint text-primary-text"
                  : "text-text-secondary hover:bg-surface hover:text-text",
                o.disabled && "pointer-events-none text-text-disabled"
              )}
            >
              {o.label}
              {typeof o.count === "number" && (
                <span data-numeric className={cn("tabular-nums", selected ? "text-primary-text" : "text-text-tertiary")}>
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
);
SegmentedControl.displayName = "SegmentedControl";

/**
 * Filter pills — additive filters with counts, where a segmented control would
 * imply the options are exhaustive and mutually exclusive.
 *
 * Counts are always shown, including zero: a zero tells you the filter exists
 * and is empty, which is different from the filter being missing. Zero-count
 * pills are dimmed rather than hidden so the set stays stable while filtering.
 *
 * @typedef {object} FilterPillsProps
 * @property {SegmentedOption[]} options
 * @property {string|string[]} value
 * @property {(next: any) => void} onValueChange
 * @property {boolean} [multiple=false]
 * @property {string} [label]
 *
 * @example
 * <FilterPills options={types} value={active} onValueChange={setActive} multiple label="Type" />
 */
export const FilterPills = React.forwardRef(
  ({ className, options = [], value, onValueChange, multiple = false, label, ...props }, ref) => {
    const selectedSet = new Set(multiple ? value || [] : [value]);

    const toggle = (v) => {
      if (!multiple) return onValueChange?.(v);
      const next = new Set(selectedSet);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      onValueChange?.([...next]);
    };

    return (
      <div ref={ref} role="group" aria-label={label} className={cn("flex flex-wrap items-center gap-2", className)} {...props}>
        {options.map((o) => {
          const selected = selectedSet.has(o.value);
          const empty = o.count === 0;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              disabled={o.disabled}
              onClick={() => toggle(o.value)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-small font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                selected
                  ? "border-transparent bg-primary-tint text-primary-text"
                  : "border-hairline bg-surface text-text-secondary hover:bg-surface-hover hover:text-text",
                empty && !selected && "text-text-tertiary",
                o.disabled && "pointer-events-none text-text-disabled"
              )}
            >
              {o.label}
              {typeof o.count === "number" && (
                <span data-numeric className={cn("tabular-nums", selected ? "text-primary-text" : "text-text-tertiary")}>
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }
);
FilterPills.displayName = "FilterPills";

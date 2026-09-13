// ASK-25 · ScopeSlider — the neumorphic segmented control with a SLIDING
// thumb. A pressed track (.kr-pressed) holding a raised thumb (.kr-pop) that
// travels to whichever segment is chosen; the thumb is the only thing that
// moves (transform, 240ms on the app's ease), so the labels never reflow.
// Both materials are the Dex well's own, which is where it first appeared:
// the Desk's Company/You switch. Approvals' All/Mine is the same control.
//
// Segments are equal width — the thumb's travel is `index × segWidth`, so a
// label that would not fit its segment should widen `segWidth`, never the
// one button.
//
// variant="glass" (2026-09-14, founder) is the task drawer's material instead:
// a soft gray track holding a white glass thumb. Approvals uses it; the Desk's
// switch keeps the default.
import * as React from "react";
import { cn } from "@/lib/utils";
import { DRAWER_TRACK, GLASS_PILL } from "./glass";

/**
 * @param {Array<{key: string, label: string}>} options   the segments, in order
 * @param {string}   value        the chosen key
 * @param {function} onChange     (key) => void
 * @param {number}   segWidth     px per segment (default 104)
 * @param {string}   testid       base test id: `${testid}-slider` on the group,
 *                                `${testid}-${key}` on each segment
 * @param {string}   variant      "neumorphic" (default) or "glass"
 */
export function ScopeSlider({ options, value, onChange, segWidth = 104, label = "Scope", testid = "scope", className, variant = "neumorphic" }) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const glass = variant === "glass";
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("relative inline-flex rounded-pill p-1", glass ? DRAWER_TRACK : "kr-pressed", className)}
      data-testid={`${testid}-slider`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1 top-1 h-9 rounded-pill transition-transform duration-[240ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          glass ? GLASS_PILL : "kr-pop"
        )}
        style={{ width: segWidth, transform: `translateX(${idx * segWidth}px)` }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          data-testid={`${testid}-${o.key}`}
          style={{ width: segWidth }}
          className={cn(
            "relative z-10 h-9 rounded-pill text-sm transition-colors focus-visible:outline-none focus-visible:ring-2",
            glass ? "focus-visible:ring-neutral-900/25" : "focus-visible:ring-kr-ink/60",
            value === o.key
              ? (glass ? "font-semibold text-neutral-900" : "font-semibold text-foreground")
              : (glass ? "font-medium text-neutral-600 hover:text-neutral-900" : "font-medium text-foreground/65 hover:text-foreground/85")
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default ScopeSlider;

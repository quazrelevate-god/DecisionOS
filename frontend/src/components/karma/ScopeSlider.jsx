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
//
// ASK-34 B1 — variant="ink" and `fluid`, for the phone's black Desk card.
// NOT A FOURTH MATERIAL. KM-54..60 standardised one segment material app-wide
// and the point of putting the phone's Decisions/Approvals/Watch tabs here is
// to stay inside it: same component, same geometry, same sliding thumb, same
// behaviour. What "ink" changes is the SURFACE the recipe is cut for — .kr-pop
// and .kr-pressed are tuned for the pale canvas and are invisible on near-black
// (index.css already carries a `.kr-glass.dark .kr-pop` override for exactly
// this reason), so on ink the pair becomes a translucent white track holding a
// brighter white thumb. A browser-tab look would have been the fourth material;
// this is the third cut of the first one.
// `fluid` makes the segments share the width instead of each taking segWidth px
// — a phone card has whatever width the screen gives it, and three fixed
// segments would either overflow 360 or leave a gap at 430. The thumb's travel
// becomes idx x 100% of its own width, which is exact at any size.
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
 * @param {string}   thumbClassName  ASK-50 — extra classes on the sliding thumb,
 *                                so a caller can tint it by what is chosen (the
 *                                New Task priority does); nothing else sets it.
 * @param {string}   variant      "neumorphic" (default) or "glass"
 */
export function ScopeSlider({
  options, value, onChange, segWidth = 104, segHeight = "2.25rem",
  label = "Scope", testid = "scope", className, variant = "neumorphic", fluid = false, thumbClassName,
}) {
  const idx = Math.max(0, options.findIndex((o) => o.key === value));
  const glass = variant === "glass";
  const ink = variant === "ink";
  /* p-1 either side, so the segments share (100% - 0.5rem).
     THE THUMB gets that width as a value, because it is absolutely positioned
     and has to travel idx x 100% of itself. THE BUTTONS get flex-1 instead: a
     percentage width on a shrink-0 flex item is treated as auto while the
     browser works out intrinsic size, so the track reported its labels'
     max-content as its minimum and the whole card grew to 568px inside a 358px
     board. flex-1 basis-0 + min-w-0 can shrink to nothing, so the card is sized
     by its container and the segments divide whatever that is. */
  const thumbStyle = fluid
    ? { width: `calc((100% - 0.5rem) / ${options.length})`, height: segHeight }
    : { width: segWidth, height: segHeight };
  const segStyle = fluid ? { height: segHeight } : { width: segWidth, height: segHeight };
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("relative rounded-pill p-1", fluid ? "flex w-full" : "inline-flex",
        glass ? DRAWER_TRACK : ink ? "bg-white/[.07] ring-1 ring-inset ring-white/10" : "kr-pressed", className)}
      data-testid={`${testid}-slider`}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-1 top-1 rounded-pill transition-transform duration-[240ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
          glass ? GLASS_PILL : ink ? "bg-white/[.16] ring-1 ring-inset ring-white/20" : "kr-pop",
          thumbClassName
        )}
        style={{ ...thumbStyle, transform: `translateX(${fluid ? `${idx * 100}%` : `${idx * segWidth}px`})` }}
      />
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          data-testid={`${testid}-${o.key}`}
          style={segStyle}
          className={cn(
            "relative z-10 min-w-0 rounded-pill text-sm transition-colors focus-visible:outline-none focus-visible:ring-2",
            fluid && "flex-1 basis-0",
            glass ? "focus-visible:ring-neutral-900/25" : ink ? "focus-visible:ring-white/60" : "focus-visible:ring-kr-ink/60",
            value === o.key
              ? (glass ? "font-semibold text-neutral-900" : ink ? "font-semibold text-white" : "font-semibold text-foreground")
              : (glass ? "font-medium text-neutral-600 hover:text-neutral-900" : ink ? "font-medium text-white/60 hover:text-white/85" : "font-medium text-foreground/65 hover:text-foreground/85")
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default ScopeSlider;

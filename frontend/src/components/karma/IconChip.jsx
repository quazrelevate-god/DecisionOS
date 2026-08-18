// KR-4 · IconChip — the reference card's top-left anchor: a circular
// 1px-outlined chip with the glyph inside, optionally wearing a small orange
// alert badge on its shoulder.
//
// The ring colour is a LOCAL variable (--kr-chip-line) rather than a class,
// so surfaces that re-scope tokens (.kr-dark-band, .kr-glass) can brighten
// every chip inside them with one declaration instead of prop-drilling a
// `dark` flag through every card.
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * @param {Component} icon   Phosphor icon component
 * @param {number}    size   outer diameter, px (reference: 40)
 * @param {boolean|number} alert  true = dot, number = count badge — ORANGE,
 *                                the alert grammar; never used decoratively
 */
export function IconChip({ icon: Icon, size = 40, alert = false, className, ...rest }) {
  const glyph = Math.round(size * 0.45);
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full border",
        "border-[hsl(var(--kr-chip-line,var(--kr-outline)))] text-current",
        className
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon size={glyph} weight="regular" aria-hidden="true" />
      {alert !== false && alert !== 0 && alert != null && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute rounded-full bg-kr-accent text-white",
            typeof alert === "number"
              ? "-right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center px-1 text-[10px] font-bold leading-none"
              : "-right-0.5 -top-0.5 h-2.5 w-2.5"
          )}
        >
          {typeof alert === "number" ? Math.min(99, alert) : null}
        </span>
      )}
    </span>
  );
}

export default IconChip;

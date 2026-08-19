// KR-4 · PillNav — the reference's centred header navigation: active = solid
// ink pill with white text, inactive = a faded black hairline that glows on
// hover without moving (KR-14).
//
// Built on NavLink so active state comes from the ROUTER (aria-current=page
// for free), not from local state that can drift from the URL. The outline
// on inactive pills is the kr-outline token — these are controls, and the
// outline is their WCAG boundary.
import * as React from "react";
import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * @param {Array} items  [{ to, label, testid, end?, badge? }]
 * @param {'md'|'sm'} size
 */
export function PillNav({ items = [], size = "md", className, testid }) {
  const pad = size === "sm" ? "h-9 px-3.5 text-sm" : "h-10 px-4 text-sm";
  return (
    <nav className={cn("flex items-center gap-2", className)} data-testid={testid}>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.to}
          end={it.end}
          data-testid={it.testid}
          className={({ isActive }) =>
            cn(
              "relative inline-flex items-center gap-1.5 rounded-pill font-medium whitespace-nowrap",
              /* No `transition-colors` here: it lives in @layer utilities,
                 which the cascade puts AFTER @layer components, so it would
                 overwrite .kr-glow's own transition and the halo would snap
                 instead of blooming. .kr-glow owns the timing for inactive
                 pills; the active pill has no hover state to time. */
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline focus-visible:ring-offset-2",
              pad,
              isActive
                ? "bg-kr-ink text-white"
                /* KR-14 — the unselected pills step BACK, then light up on
                   hover without moving.
                   Founder: "the remaining pills should be slightly grayed
                   out, and when I hover it should not have any popping up
                   effect — instead a glow or colour feel. It should not
                   physically move."
                   So: no translate, no scale, nothing that shifts a
                   neighbour's position. The hairline and the label both sit
                   at ~45% at rest and come up to full on hover, and .kr-glow
                   adds the halo. Motion here would also be the wrong signal —
                   these are destinations, and a destination that flinches
                   when you approach it reads as a button, not a place. */
                : "kr-glow border-[0.5px] border-kr-ink/45 text-foreground/55"
            )
          }
        >
          {it.label}
          {it.badge > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-kr-accent px-1 text-[10px] font-bold leading-none text-white">
              {Math.min(99, it.badge)}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default PillNav;

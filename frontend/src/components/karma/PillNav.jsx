// KR-4 · PillNav — the reference's centred header navigation: active = solid
// ink pill with white text, inactive = 1px outlined pill on the open ground.
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
              "transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline focus-visible:ring-offset-2",
              pad,
              isActive
                ? "bg-kr-ink text-white"
                : "border border-kr-outline text-foreground/80 hover:text-foreground hover:border-foreground/60"
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

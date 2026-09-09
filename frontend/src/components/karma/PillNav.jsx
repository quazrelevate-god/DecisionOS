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
/**
 * KM-44 · `plate` — the header variant, sitting on .kr-navplate's 25% black
 * semi-octagon. It is a separate palette rather than a tweak because the
 * GROUND changed: the plate composites to luminance 0.47 over this app's warm
 * sky, so the quiet end of the scale (a 55%-ink label that read fine on the
 * bare canvas) drops to 3.44:1 on it and has to come up.
 *
 * The three states become a single idea — how lit is this pill:
 *   rest    ink at 75%, hairline at 35%        5.84:1, quiet but legible
 *   hover   a white wash lifts it half way     full ink, the hairline firms up
 *   active  a solid white pill, ink label      18.9:1, the one lit thing
 *
 * Active goes WHITE rather than staying the ink pill it is off-plate, on the
 * founder's call — and it is the right way round: the plate darkens everything,
 * so the selected destination should be the thing that stays bright. Ink on
 * ink-tinted grey would have been a shape you find rather than one you see.
 * The white wash on hover is a preview of that, which is what makes hover feel
 * like it is pointing at the selection rather than a separate effect.
 */
export function PillNav({ items = [], size = "md", className, testid, plate = false, navRef }) {
  const pad = size === "sm" ? "h-9 px-3.5 text-sm" : "h-10 px-4 text-sm";
  return (
    /* KM-46 — the plate class moved to the HEADER; this only reports its own
       width up so the dip can be cut to fit. */
    <nav ref={navRef} className={cn("flex items-center gap-2", className)} data-testid={testid}>
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
              /* `transition-colors` is safe on the plate variant and NOT on the
                 other: it lives in @layer utilities, which the cascade puts
                 after @layer components, so on a .kr-glow pill it would
                 overwrite that recipe's own transition and the halo would snap
                 instead of blooming. The plate variant does not use .kr-glow,
                 so it owns its timing outright. */
              plate && "transition-colors duration-200",
              isActive
                ? plate
                  /* The 1px ring is not decoration. A white pill on this
                     plate reads 2.76:1 as a SHAPE, under the 3.0 WCAG 1.4.11
                     asks of a boundary that identifies a component's state —
                     the label contrast is fine (19.6) but the pill's own edge
                     was not. Ink at 28% over the plate gives that edge 4.70:1
                     against the fill it encloses, so the selected item is
                     findable by shape as well as by weight. */
                  /* KM-51 — `bg-[#fff]`, not `bg-white`, and the difference is
                     not cosmetic. A legacy compatibility shim in index.css
                     (`@layer utilities { .dark .bg-white { background-color:
                      hsl(var(--card)) } }`, ~line 266) blanket-rewrites EVERY
                     bg-white in dark mode. /brain runs dark, so the selected
                     pill's fill silently became --card, rgb(24,24,27), while
                     text-kr-ink stayed rgb(12,12,13): measured 1.06:1, black
                     on black. Founder: "the current page menu, which is Dex,
                     is completely dark."
                     The shim matches on the class NAME, so an arbitrary-value
                     class is out of its reach and the pill is the literal
                     white this design always meant. Identical on light pages;
                     19.6:1 in the Dex room, where a white pill on the dark
                     plate is exactly the "one lit thing" this variant is for. */
                  ? "bg-[#fff] text-kr-ink shadow-[0_0_0_1px_hsl(230_30%_18%/.28),0_2px_10px_-3px_hsl(230_30%_18%/.45)]"
                  : "bg-kr-ink text-white"
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
                : plate
                  /* /85, not /75: the shelf went from 25% to 32% black on the
                     founder's call and took the resting label from 5.76 to
                     4.48, just under the line. Darkening the ink is the lever
                     that costs nothing here — the fill stays where it was. */
                  ? "border-[0.5px] border-kr-ink/40 bg-white/20 text-foreground/85 hover:border-kr-ink/70 hover:bg-white/45 hover:text-foreground"
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

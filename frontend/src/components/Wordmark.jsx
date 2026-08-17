// The DecisionOS wordmark — the supplied artwork, applied as supplied.
//
// One file, `public/brand/decisionos-logo.png`, byte-identical to what the
// owner provided. It is served statically rather than imported so the bundler
// never re-encodes it, and it is never redrawn in CSS or SVG: the lockup is
// identity, and a rebuilt approximation of a logo is a different logo.
//
// THE TRANSPARENT MARGIN. The file is 2172x724 but the ink sits in a 1905x269
// window inside it — 31% of the height above and below is empty. Rendered
// straight, `height: 24px` gives 9px of letterform, and any background sits on
// the box rather than on the logo. So the img is positioned inside a window the
// size of the ink and offset by the margin: the browser shows the ink and
// nothing else. The pixels are untouched; only the viewport onto them changes.
//
// DARK SURFACES. "Decision" is #000000 and disappears on a dark background.
// There is no reversed variant, and one cannot be derived: the obvious CSS
// trick — invert(1) hue-rotate(180deg) — takes the black to white correctly but
// takes the #0000D9 blue to #E0E0FF, a pale lavender. That is not the brand
// colour, so it is not an option.
//
// Until a reversed asset exists, dark surfaces get the artwork on a light
// plate. The lockup stays pixel-exact and stays legible; the plate is the
// compromise, and it is the thing to delete the moment a white-on-dark version
// of the logo arrives.
import * as React from "react";
import { cn } from "@/lib/utils";

const SRC = "/brand/decisionos-logo.png";

// Measured off the asset. If the file is ever replaced these must be re-measured
// — a logo with different padding would render cropped or floating.
const BOX_W = 2172;
const BOX_H = 724;
const INK_X = 138;
const INK_Y = 227;
const INK_W = 1905;
const INK_H = 269;

/**
 * @param {number}  [size]   ink height in px — how tall the letterforms read,
 *                           not how tall the file is
 * @param {boolean} [plate]  force the light plate, for surfaces that are dark in
 *                           BOTH themes (the Landing nav, the Login hero) where
 *                           a `dark:` variant never fires
 * @param {"ink"|"reversed"} [tone]
 *   "reversed" renders the lockup in solid white, for dark surfaces that want
 *   the logo *in* them rather than on a plate (the Ops hero).
 *
 *   This is not the failed trick described above. `invert(1) hue-rotate(180deg)`
 *   tries to keep two colours and mangles one of them — #0000D9 comes out pale
 *   lavender. `brightness(0) invert(1)` instead collapses to a SINGLE colour:
 *   brightness(0) takes every pixel to black while leaving alpha alone, then
 *   invert(1) takes that black to white. Nothing is approximated, because
 *   nothing is trying to survive: this is the one-colour reversed lockup, the
 *   ordinary companion to a two-colour positive one, and the letterforms and
 *   their anti-aliasing come through exactly as supplied.
 *
 *   It is still not a substitute for a real reversed asset with the blue intact.
 *   When one arrives, prefer it here and delete the filter.
 */
export function Wordmark({ size = 20, plate = false, tone = "ink", className }) {
  const reversed = tone === "reversed";
  const scale = size / INK_H;
  // The window is cropped to the ink bbox, which measures flush to the outermost
  // pixels of the D and the S. Cropped exactly there, their anti-aliased edges
  // get shaved and the letters read as clipped. `bleed` reopens a hair of
  // transparent room on every side so the ink floats inside the crop instead of
  // pressing against it — invisible on any surface (the pixels are transparent),
  // and it scales with the logo so the breathing room stays proportional.
  const bleed = Math.max(1, Math.round(size * 0.08));
  const win = {
    width: Math.round(INK_W * scale) + bleed * 2,
    height: Math.round(INK_H * scale) + bleed * 2,
  };
  const img = {
    width: Math.round(BOX_W * scale),
    height: Math.round(BOX_H * scale),
    marginLeft: -Math.round(INK_X * scale) + bleed,
    marginTop: -Math.round(INK_Y * scale) + bleed,
    maxWidth: "none",   // the app sets img{max-width:100%}; that would rescale it
    ...(reversed ? { filter: "brightness(0) invert(1)" } : null),
  };

  return (
    <span
      data-testid="wordmark"
      className={cn(
        // w-fit + self-start: the plate must hug the logo. Without them a
        // column-flex parent stretches this span to the container width
        // (measured 543px for a 170px logo) and the plate becomes a slab.
        "inline-flex w-fit shrink-0 items-center self-start",
        // bg-neutral-50, not bg-white: index.css carries a legacy override,
        // `.dark .bg-white { background-color: hsl(var(--card)) }`, from the
        // neo-brutalist cleanup. It repainted the plate near-black in dark mode
        // and left "Decision" invisible on it — the exact failure the plate is
        // here to prevent. The ramp step is fixed in both themes, which is what
        // a plate needs.
        // A reversed lockup needs no plate — being legible on dark is the whole
        // point of it, and a plate in both themes is what it exists to avoid.
        reversed
          ? null
          : plate
            ? "rounded-lg bg-neutral-50 px-2.5 py-2"
            : "dark:rounded-lg dark:bg-neutral-50 dark:px-2.5 dark:py-2",
        className
      )}
    >
      <span className="block overflow-hidden" style={win}>
        <img
          src={SRC}
          alt="DecisionOS"
          style={img}
          className="block"
          decoding="async"
        />
      </span>
    </span>
  );
}

export default Wordmark;

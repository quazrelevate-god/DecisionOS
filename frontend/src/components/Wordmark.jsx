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
 */
export function Wordmark({ size = 20, plate = false, className }) {
  const scale = size / INK_H;
  const win = { width: Math.round(INK_W * scale), height: Math.round(INK_H * scale) };
  const img = {
    width: Math.round(BOX_W * scale),
    height: Math.round(BOX_H * scale),
    marginLeft: -Math.round(INK_X * scale),
    marginTop: -Math.round(INK_Y * scale),
    maxWidth: "none",   // the app sets img{max-width:100%}; that would rescale it
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
        plate
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

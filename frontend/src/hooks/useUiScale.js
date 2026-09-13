// UI-SCALE · useUiScale — the page scales WITH the screen.
// (Unnumbered on purpose: ASK-27–31 are the task-drawer rework.)
//
// The Karma pages were composed at 1440 CSS px (the 14" laptop the founder
// signs off on). On a 24" or 27" monitor the same page sat in the middle of
// the viewport at the same size, with dead space either side: the layout
// grew, the type and the controls did not. Founder: "based on the screen
// size all the objects should size, font should increase or decrease."
//
// This writes ONE number to <html>, --ui-scale = viewport width / 1440,
// clamped, and a page opts in with the `ui-scale` class (index.css), which
// applies it as CSS `zoom`. Zoom is the right tool and not `transform:
// scale`: it changes USED values, so the page reflows at the new size — a
// 4-column grid stays 4 columns of bigger cards, scroll areas keep working,
// hit targets grow with the type. A transform only paints bigger.
//
// The scale is a TABLE, not a ratio — the founder's numbers, one step per
// screen class: a 1280 laptop 0.9, the 1440 reference 1.0, 1872 1.1, a 1920
// monitor 1.2, 2560 and up 1.3. Below 1024 the phone tree renders and the
// scale is 1 (it has its own breakpoints). Edit STEPS to retune; the widths
// are the smallest viewport that gets that step.
//
// APP-WIDE: the hook puts the `ui-scale` class on <body>, so the header, the
// dock, every page and every portal (dialogs, sheets, dropdowns — Radix
// mounts them on body) scale together. Called once, from App.
//
// Two things CSS zoom does NOT do, handled elsewhere:
//   · viewport units are not divided by zoom, so anything sized in vh on
//     desktop divides by var(--ui-scale) itself (Layout's shell, dialog
//     max-heights) or it overflows the real viewport by the scale factor;
//   · getBoundingClientRect reports visual px while offset*/client* report
//     an element's own px — measure in one space or the other, never both
//     (see Desk's row fitting).
// Radix poppers are fine: floating-ui ≥1.6.6 reads Element.currentCSSZoom.
import { useEffect } from "react";

export const UI_SCALE_REFERENCE_WIDTH = 1440;
const LG = 1024; // Tailwind's lg breakpoint — the desktop tree starts here

// [minimum viewport width, scale] — widest first. A viewport takes the
// first row whose width it reaches.
export const UI_SCALE_STEPS = [
  [2560, 1.3],
  [1920, 1.2],
  [1872, 1.1],
  [1440, 1.0],
  [LG, 0.9],
];

export function computeUiScale(width) {
  if (width < LG) return 1;
  const row = UI_SCALE_STEPS.find(([min]) => width >= min);
  return row ? row[1] : 1;
}

export function useUiScale() {
  useEffect(() => {
    const root = document.documentElement;
    document.body.classList.add("ui-scale");
    let raf = 0;
    const apply = () => {
      raf = 0;
      root.style.setProperty("--ui-scale", computeUiScale(window.innerWidth).toFixed(1));
    };
    const onResize = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--ui-scale");
      document.body.classList.remove("ui-scale");
    };
  }, []);
}

export default useUiScale;

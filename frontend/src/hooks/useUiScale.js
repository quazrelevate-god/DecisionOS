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
// Clamped to [0.9, 1.5]: below 1024 the phone tree renders and the scale is
// 1 (it has its own breakpoints); a 1280 laptop gets 0.9 so the desktop
// composition still fits; a 2560 monitor stops at 1.5 rather than becoming a
// kiosk. The reference width is a single constant so the design's frame and
// this hook can never drift apart.
//
// Scoped to a page on purpose for now (My Work is the pilot). Moving the
// `ui-scale` class from a page root to <body> is the whole change needed to
// scale the app — header, dock and dialogs included — once the pilot holds.
import { useEffect } from "react";

export const UI_SCALE_REFERENCE_WIDTH = 1440;
const MIN = 0.9;
const MAX = 1.5;
const LG = 1024; // Tailwind's lg breakpoint — the desktop tree starts here

export function computeUiScale(width) {
  if (width < LG) return 1;
  return Math.min(MAX, Math.max(MIN, width / UI_SCALE_REFERENCE_WIDTH));
}

export function useUiScale() {
  useEffect(() => {
    const root = document.documentElement;
    let raf = 0;
    const apply = () => {
      raf = 0;
      // Three decimals: enough that a 1px viewport change never re-lays the
      // page out for a scale change the eye cannot see.
      root.style.setProperty("--ui-scale", computeUiScale(window.innerWidth).toFixed(3));
    };
    const onResize = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--ui-scale");
    };
  }, []);
}

export default useUiScale;

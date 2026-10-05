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
// monitor 1.2, 2560 and up 1.3. Edit STEPS to retune; the widths are the
// smallest viewport that gets that step.
//
// ASK-43 — AND THE PHONE IS A STEP TOO, at 0.8. The founder found this
// themselves: "once I scaled it down from 100% to 75% in my browser and
// installed it as a PWA it aligns with my screen". Browser zoom at 75% does
// one thing — it hands the page a bigger CSS viewport and draws everything
// smaller — and that is exactly what this class already does everywhere else
// in the app. At 0.8 a 390x844 iPhone lays out as 487x1055 and every phone,
// whatever its aspect ratio, gets the same proportional room rather than the
// 6.1" screen being 81px short of the 6.7" one.
// WHAT THE PHONE NEEDS THAT DESKTOP DID NOT:
//   · 100dvh is not divided by zoom either, so Layout's phone shell divides
//     it itself, the same way the desktop shell already divides 100vh;
//   · env(safe-area-inset-*) IS multiplied by the zoom, so a 47px notch
//     inset would be drawn at 37.6 and the content would sit under the status
//     bar. index.css defines --sa-top/-bottom/-left/-right as the inset
//     divided by the scale, and the mobile chrome reads those;
//   · anything that measures with getBoundingClientRect (visual px) and
//     offsetHeight/clientHeight (the element's own px) in the same sum is now
//     mixing two spaces that differ by 25% — see the Desk's row fitting,
//     which converts one into the other before it adds them.
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
  [0, 0.8], // ASK-43 — every phone and tablet below the desktop tree
];

export function computeUiScale(width) {
  const row = UI_SCALE_STEPS.find(([min]) => width >= min);
  return row ? row[1] : 1;
}

export function useUiScale() {
  useEffect(() => {
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="viewport"]');
    const metaWas = meta ? meta.getAttribute("content") : null;
    document.body.classList.add("ui-scale");
    let raf = 0;
    let viaViewport = false;

    /* ZOOM IS NOT AVAILABLE EVERYWHERE, AND THE APP MUST NOT NEED IT.
       (2026-10-05, measured on two phones running the same binary.)
         iPhone 13 mini, iOS 27    — zoom honoured, page correct.
         iPhone 13,      iOS 26.3.1 — zoom IGNORED. Every box 1.25x, 1055px of
                                      page in an 844px window, the dock alone
                                      still because it is fixed.
       On the older one the device reported `--ui-scale 0.8`, `body.zoom 0.8`
       AND an inline `0.8`, measured an effective scale of 1, and answered
       `currentCSSZoom: unsupported` — a WebKit from before CSS `zoom` was
       standardised. It accepts the declaration, reports it back, and does not
       lay out by it. There is no way to set it that fixes that, so the app
       stops depending on it.
       THE FALLBACK IS THE OLDEST TRICK THERE IS: hand the page a wider layout
       viewport and let the browser fit it to the glass. `width=488` on a 390pt
       screen is drawn at 390/488 = 0.8 — the same result, through page scale,
       which every web view has always implemented.
       And then --ui-scale becomes 1, which is not a lie but the point: every
       compensation in this app (--sa-* over the scale, 100dvh over the scale,
       DexSlider's visual-to-CSS conversion) exists to undo a zoom, and with
       the viewport pre-scaled there is nothing to undo. One divides by 1 and
       they all come out right.
       WHICH PATH RUNS IS MEASURED, NEVER SNIFFED. A 100px ruler read back
       through getBoundingClientRect says what actually happened; no version
       test, no UA string, and a web view that gains zoom later simply keeps
       the fast path. */
    const deviceWidth = () => {
      /* screen.width is the glass, and does NOT move when we rewrite the
         viewport meta — innerWidth does, which would make this compound. */
      const w = window.screen && window.screen.width;
      return typeof w === "number" && w > 64 ? w : window.innerWidth;
    };

    const effectiveScale = () => {
      const ruler = document.createElement("div");
      ruler.style.cssText = "position:absolute;top:-9999px;left:0;width:100px;height:1px;pointer-events:none";
      document.body.appendChild(ruler);
      const got = ruler.getBoundingClientRect().width / 100;
      ruler.remove();
      return got;
    };

    const widenViewport = (s) => {
      if (!meta) return;
      /* FLOOR, not round. The browser fits this width to the glass, so asking
         for 488 on a 390pt screen scales by 390/488 = 0.7992 and the page ends
         a rounded pixel TALLER than the window — one stray pixel of scroll on
         a page whose whole point is not to scroll. Flooring always asks for
         slightly less than the exact 487.5, so the fit rounds the other way. */
      meta.setAttribute("content", `width=${Math.floor(deviceWidth() / s)}, viewport-fit=cover`);
    };

    const apply = () => {
      raf = 0;
      if (viaViewport) { widenViewport(computeUiScale(deviceWidth())); return; }

      const s = computeUiScale(window.innerWidth);
      /* TWO NUMBERS, BECAUSE --ui-scale WAS DOING TWO JOBS. (2026-10-05.)
         The viewport fallback sets --ui-scale to 1, and for everything that
         UNDOES a zoom — viewport units, env() insets, visual-to-CSS pixel
         conversion — that is exactly right: a pre-scaled viewport has nothing
         to undo. But a handful of rules were never compensations at all. They
         convert a DESIGN width given on the glass into the page's own pixels:
         `--app-shell: 28rem / scale` means "28rem as the eye sees it". Divided
         by 1 instead of 0.8 the shell came out 448 own px inside a 487 own px
         viewport and put ~20px gutters down both sides of every page — which
         is the precise bug the note above --app-shell was already written
         about, returning by another door.
         So --ui-density is the scale the design is drawn at, always, in both
         modes; --ui-scale stays what must be divided OUT, which the fallback
         correctly makes 1. */
      root.style.setProperty("--ui-density", s.toFixed(1));
      root.style.setProperty("--ui-scale", s.toFixed(1));
      try { document.body.style.zoom = String(s); } catch (e) { /* no zoom here */ }

      /* Only below the desktop tree: the viewport meta is a phone mechanism
         and a desktop browser ignores it, so there would be nothing to fall
         back TO. A laptop whose web view lacked zoom would simply run at 1,
         which is what it did before any of this existed. */
      if (s === 1 || window.innerWidth >= LG) return;
      if (Math.abs(effectiveScale() - s) <= 0.01) return;   // zoom landed; done

      viaViewport = true;
      document.body.classList.remove("ui-scale");
      try { document.body.style.zoom = ""; } catch (e) { /* never had one */ }
      root.style.setProperty("--ui-scale", "1");
      widenViewport(s);
    };
    const onResize = () => { if (!raf) raf = requestAnimationFrame(apply); };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      root.style.removeProperty("--ui-scale");
      try { document.body.style.zoom = ""; } catch (e) { /* never had one */ }
      if (meta && metaWas !== null) meta.setAttribute("content", metaWas);
      document.body.classList.remove("ui-scale");
    };
  }, []);
}

export default useUiScale;

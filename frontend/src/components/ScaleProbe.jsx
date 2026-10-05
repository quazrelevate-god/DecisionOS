/* WHAT THIS PHONE ACTUALLY THINKS ITS SCREEN IS.
 *
 * 2026-10-05. Yogesh's iPhone 13 draws the Desk about 25% too large and the
 * page scrolls under a dock that does not move. The same binary on the
 * founder's 13 mini is correct, and Display Zoom is off on both, so nothing
 * about the viewport the code CHOOSES can differ between them: computeUiScale
 * returns 0.8 for every width below 1024, and both phones are far below it.
 *
 * Reproducing it needed only one thing — `zoom` not taking effect. At a true
 * 390x844 with `.ui-scale { zoom }` defeated, the page measures 1055px tall in
 * an 844px window (+211 of scroll), every element lands 1.25x too big, and the
 * dock stays put because it is `fixed`. That is the bug exactly. What this
 * cannot tell us from a laptop is WHY the web view is ignoring it there.
 *
 * So the app says what it sees, on screen, where a photograph can carry it
 * back. Not a console.log: reading one off a device means a cable, a trusted
 * computer and Safari's inspector, and the founder has a camera.
 *
 * ONLY ON ?probe=scale. No route, no menu item, nothing to stumble into, and
 * it costs a disabled hook on every other load. Delete the file once the
 * answer is in — it is a diagnostic, not a feature.
 */
import { useEffect, useState } from "react";

export default function ScaleProbe() {
  const [on, setOn] = useState(false);
  const [m, setM] = useState(null);

  /* ALWAYS ON IN THIS BUILD — and the previous version is why.
     It only showed itself when getComputedStyle(body).zoom disagreed with
     --ui-scale, and on the founder's iPhone 13 it never showed while the page
     was plainly drawn 25% too large. So the web view REPORTS the zoom it was
     given and does not lay out by it; asking the engine what it thinks is
     worthless, and a diagnostic that hides unless the engine admits a fault is
     worse than none. Nothing here is conditional any more. */
  useEffect(() => { setOn(true); }, []);

  /* The reader starts only once the panel is on — whichever way it got there. */
  useEffect(() => {
    if (!on) return undefined;

    const read = () => {
      const root = document.documentElement;
      const cs = getComputedStyle(document.body);
      const probe = document.createElement("div");
      /* env() cannot be read back off a style declaration, so it is measured:
         a box whose height IS the inset reports it through its own rect. */
      probe.style.cssText =
        "position:fixed;top:0;left:0;width:0;" +
        "height:env(safe-area-inset-top,0px);pointer-events:none;visibility:hidden";
      document.body.appendChild(probe);
      const saTop = Math.round(probe.getBoundingClientRect().height);
      probe.remove();

      /* GROUND TRUTH. A box declared exactly 100 CSS px wide, measured through
         getBoundingClientRect, which reports VISUAL pixels. Inside a tree drawn
         at 0.8 it comes back 80. This is the only number in the panel the
         engine cannot be wrong about: it is not asking what zoom is set to, it
         is asking how big things actually ARE. `effective` is what we came for;
         everything beside it is context for why. */
      const ruler = document.createElement("div");
      ruler.style.cssText = "position:absolute;top:-9999px;left:0;width:100px;height:10px;pointer-events:none";
      document.body.appendChild(ruler);
      const effective = +(ruler.getBoundingClientRect().width / 100).toFixed(3);
      ruler.remove();

      const se = document.scrollingElement || root;
      setM({
        effective,
        inner: `${window.innerWidth}x${window.innerHeight}`,
        docEl: `${root.clientWidth}x${root.clientHeight}`,
        screen: `${window.screen?.width}x${window.screen?.height}`,
        dpr: window.devicePixelRatio,
        varScale: getComputedStyle(root).getPropertyValue("--ui-scale").trim() || "(unset)",
        /* What the engine SAYS, kept only so the two can be compared: on the
           iPhone 13 this read 0.8 while `effective` was 1. */
        zoomApplied: cs.zoom,
        hasClass: document.body.classList.contains("ui-scale") ? "yes" : "NO",
        inlineZoom: document.body.style.zoom || "(none)",
        currentCSSZoom: typeof document.body.currentCSSZoom === "number"
          ? document.body.currentCSSZoom : "(unsupported)",
        scroll: `${Math.round(se.scrollHeight)} in ${Math.round(se.clientHeight)}`,
        overflow: Math.round(se.scrollHeight - se.clientHeight),
        saTop,
        vvScale: window.visualViewport ? window.visualViewport.scale : "(none)",
        ua: navigator.userAgent.slice(-78),
      });
    };

    read();
    const id = setInterval(read, 1200);          // after fonts, layout and the dock settle
    window.addEventListener("resize", read);
    return () => { clearInterval(id); window.removeEventListener("resize", read); };
  }, [on]);

  if (!on || !m) return null;

  /* AT THE TOP, not the foot. The last one sat at bottom: 0 under a dock that
     is itself fixed at z 10000, and the founder's screenshots show no sign of
     it — covered, clipped, or pushed off by the very overflow it was there to
     report. Under the status bar there is nothing to lose a fight with.
     `zoom: 1` on the panel itself so it is legible whatever is happening to
     the tree around it. */
  const agrees = Math.abs(m.effective - (parseFloat(m.varScale) || 1)) <= 0.01;
  return (
    <div
      data-testid="scale-probe"
      style={{
        position: "fixed", left: 0, right: 0, top: 0, zIndex: 2147483647, zoom: 1,
        /* IT MUST NOT EAT TAPS. At the top it lies over the header — the bell,
           the tabs — and a diagnostic that stops the founder using the screen
           it is diagnosing is no use. Caught by verify:nav, which could not
           click through it. */
        pointerEvents: "none",
        background: agrees ? "#0b3b1af2" : "#5b0b0bf2", color: "#fff",
        font: "600 11px/1.5 ui-monospace,Menlo,monospace",
        padding: "calc(env(safe-area-inset-top,0px) + 6px) 10px 8px",
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}
    >
      {[
        `MEASURED ${m.effective}   vs --ui-scale ${m.varScale}   ${agrees ? "AGREE" : "** DISAGREE **"}`,
        `body.zoom(says) ${m.zoomApplied}  inline ${m.inlineZoom}  currentCSSZoom ${m.currentCSSZoom}`,
        `inner ${m.inner}  docEl ${m.docEl}  screen ${m.screen}  dpr ${m.dpr}`,
        `.ui-scale ${m.hasClass}   scrollH ${m.scroll}   OVERFLOW ${m.overflow}px   sa-top ${m.saTop}`,
        m.ua,
      ].join("\n")}
    </div>
  );
}

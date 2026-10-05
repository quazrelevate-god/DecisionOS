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

  /* IT TURNS ITSELF ON WHEN IT IS NEEDED, because the thing it diagnoses has
     no address bar. In the native shell the app is served from
     capacitor://localhost with no URL to edit, so `?probe=scale` — fine in a
     browser — can never be typed on the device that has the fault. So the
     check runs on every load and the panel appears ONLY when the web view and
     the stylesheet disagree: --ui-scale says 0.8 and the body is not actually
     drawn at 0.8. On a phone where zoom works that is never true and nothing
     renders; on the one where it does not, the evidence is already on screen
     when the founder looks. */
  useEffect(() => {
    let forced = false;
    try {
      forced = new URLSearchParams(window.location.search).get("probe") === "scale";
    } catch { forced = false; }
    if (forced) { setOn(true); return undefined; }

    const broken = () => {
      const want = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-scale"));
      if (!want || Number.isNaN(want)) return false;
      const got = parseFloat(getComputedStyle(document.body).zoom);
      // `zoom: normal` parses to NaN; that IS the failure, not an excuse.
      if (Number.isNaN(got)) return true;
      return Math.abs(got - want) > 0.01;
    };

    /* Checked after the first paint settles, not during it: the class and the
       variable are both written in an effect, so the opening frame legitimately
       has neither and must not be reported as a fault. */
    const t = setTimeout(() => { if (broken()) setOn(true); }, 900);
    return () => clearTimeout(t);
  }, []);

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

      const se = document.scrollingElement || root;
      setM({
        inner: `${window.innerWidth}x${window.innerHeight}`,
        screen: `${window.screen?.width}x${window.screen?.height}`,
        dpr: window.devicePixelRatio,
        varScale: getComputedStyle(root).getPropertyValue("--ui-scale").trim() || "(unset)",
        /* The number that matters. If the var says 0.8 and this says 1 or
           "normal", the web view is refusing the property and everything else
           in this box is a symptom. */
        zoomApplied: cs.zoom,
        hasClass: document.body.classList.contains("ui-scale") ? "yes" : "NO",
        currentCSSZoom: typeof document.body.currentCSSZoom === "number"
          ? document.body.currentCSSZoom : "(not supported)",
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

  /* Fixed, opaque, and OUTSIDE the zoomed tree's concerns: it reads its own
     numbers whether or not the thing it is measuring works. */
  return (
    <div
      data-testid="scale-probe"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2147483647,
        background: "#0b0b0cf2", color: "#fff", font: "600 11px/1.45 ui-monospace,Menlo,monospace",
        padding: "10px 12px", whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}
    >
      {[
        `inner      ${m.inner}        screen ${m.screen}  dpr ${m.dpr}`,
        `--ui-scale ${m.varScale}      body.zoom ${m.zoomApplied}   .ui-scale ${m.hasClass}`,
        `currentCSSZoom ${m.currentCSSZoom}   visualViewport.scale ${m.vvScale}`,
        `scrollHeight ${m.scroll}   OVERFLOW ${m.overflow}px   safe-top ${m.saTop}px`,
        m.ua,
      ].join("\n")}
    </div>
  );
}

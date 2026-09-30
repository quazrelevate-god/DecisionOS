/* IOS-3 (2026-09-30) · The app stops zooming when you tap a field.
 *
 * Reported from a real iPhone: tapping any text field threw the whole screen
 * into a zoom, and you had to pinch back out to carry on.
 *
 * WHY IT HAPPENS, AND WHY EVERY FIELD DOES IT. iOS auto-zooms a focused input
 * whose computed font-size is under 16px — that is Safari and WKWebView
 * behaviour, not a bug in the page. This app applies its own CSS `zoom`
 * through --ui-scale, and ASK-43 put every phone and tablet on 0.8
 * (hooks/useUiScale). `zoom` changes USED values, so a field declared at 15px
 * arrives at iOS as 12px. Even a 16px field lands at 12.8px. There is no
 * input in the product that clears the threshold, which is exactly why it
 * happened on "any other thing" too, not just one screen.
 *
 * SO THE FIX IS NOT BIGGER TYPE. Declaring 20px everywhere to survive the
 * multiplication would fight the type ladder on every screen to satisfy one
 * platform's heuristic, and would break the moment --ui-scale changed.
 *
 * Instead the viewport is pinned — in the NATIVE APP ONLY. In an app, pinch
 * to zoom the interface is not a thing people expect; the system text size
 * (Dynamic Type on iOS, font scale on Android, both already handled — see
 * B32) is the accessibility route, and it still works because it does not go
 * through this.
 *
 * ON THE WEB THIS MUST NOT RUN. index.html is shared, and a page that
 * forbids zoom is a WCAG 1.4.4 failure on a browser where pinch is the only
 * way in. isNativeApp() is the whole guard.
 *
 * Android is unaffected either way: Chromium has no focus-zoom heuristic. It
 * is applied there too rather than branching per platform, because "the app
 * does not pinch-zoom" is the same statement on both.
 */
import { isNativeApp } from "./back";

const PINNED = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";

/**
 * Pin the viewport scale inside the native app. No-op in a browser.
 * @returns {boolean} whether it was applied
 */
export function lockZoomInApp() {
  if (!isNativeApp()) return false;
  try {
    let tag = document.querySelector('meta[name="viewport"]');
    if (!tag) {
      tag = document.createElement("meta");
      tag.setAttribute("name", "viewport");
      document.head.appendChild(tag);
    }
    /* viewport-fit=cover is kept deliberately: without it env(safe-area-inset-*)
       reports 0 and every safe-area rule in index.css goes inert — which is
       the bug that hid the wordmark behind the Dynamic Island. */
    tag.setAttribute("content", PINNED);
    return true;
  } catch (e) {
    return false;                      // no document: tests, SSR
  }
}

export default lockZoomInApp;

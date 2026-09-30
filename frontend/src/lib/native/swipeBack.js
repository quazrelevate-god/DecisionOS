/* IOS-4 (2026-09-30) · Swiping back closes an open sheet, not just a page.
 *
 * IOS-2 turned on WKWebView's allowsBackForwardNavigationGestures, and the
 * edge swipe started working — for PAGES. /login to /signup and back is a URL
 * change, so the webview has a real history entry, takes a snapshot of it and
 * animates to it.
 *
 * An overlay is not a URL change. useBackDismiss pushes an entry at the SAME
 * url with a marker in history.state, which is what makes back close a sheet
 * before it leaves a screen. WKWebView will not offer those to the swipe: with
 * a sheet open the gesture does nothing at all. Found on the simulator, on the
 * founder's report — open a decision, swipe, and the sheet just sits there.
 *
 * WHY NOT MAKE THE OVERLAY A REAL URL. Because the marker entry is deliberate
 * and Android depends on it: same url means an overlay is not a place you can
 * link to, reload into, or land on from a notification, and changing that to
 * satisfy one platform's gesture would rewrite what an overlay IS on both.
 *
 * So the gesture is read here, and ONLY while an overlay owns the top entry —
 * exactly the case the native gesture declines. Page-to-page swiping is left
 * alone and stays native, with its snapshot and its rubber-banding, because
 * that half already works.
 *
 * iOS only. Android has a real back button and MOBILE-2 already routes it
 * through the same history; a second listener there would pop twice and close
 * the sheet AND leave the screen.
 */
import { OVERLAY_KEY } from "../../hooks/useBackDismiss";
import { isNativeApp } from "./back";

/* Tuned against the platform's own gesture. iOS treats roughly the left 20pt
   as the edge; a little wider is kinder without catching ordinary taps. */
const EDGE = 28;        // how near the left edge the finger must start
const TRAVEL = 70;      // how far right it must travel to mean it
const DRIFT = 50;       // vertical movement past which this is a scroll

/** True only inside the iOS app. */
export const isIosApp = () =>
  isNativeApp() && window.Capacitor?.getPlatform?.() === "ios";

/** Is an overlay holding the top history entry right now? */
function overlayOnTop() {
  try { return !!window.history.state?.[OVERLAY_KEY]; } catch (e) { return false; }
}

/**
 * Close the open overlay on a left-edge swipe, inside the iOS app.
 * @returns {Function} cleanup
 */
export function startOverlaySwipeBack() {
  if (!isIosApp() || typeof document === "undefined") return () => {};

  let startX = null;
  let startY = 0;
  let done = false;

  const onStart = (e) => {
    const t = e.touches && e.touches[0];
    done = false;
    startX = null;
    if (!t) return;
    /* Decided at touch-down, not at move: if no overlay is open this listener
       stays out of the way entirely and the native gesture has the touch. */
    if (t.clientX <= EDGE && overlayOnTop()) {
      startX = t.clientX;
      startY = t.clientY;
    }
  };

  const onMove = (e) => {
    if (startX === null || done) return;
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (Math.abs(t.clientY - startY) > DRIFT) { startX = null; return; }
    if (t.clientX - startX >= TRAVEL) {
      done = true;
      startX = null;
      /* Pops the marker entry; useBackDismiss hears popstate and closes the
         overlay. Same path the Android back button takes, so one behaviour is
         described in one place. */
      try { window.history.back(); } catch (err) { /* nothing to go back to */ }
    }
  };

  const onEnd = () => { startX = null; };

  /* Passive: this never preventDefaults. It reads the gesture and lets the
     page scroll normally if it turns out not to be one. */
  const opts = { passive: true };
  document.addEventListener("touchstart", onStart, opts);
  document.addEventListener("touchmove", onMove, opts);
  document.addEventListener("touchend", onEnd, opts);
  document.addEventListener("touchcancel", onEnd, opts);

  return () => {
    document.removeEventListener("touchstart", onStart, opts);
    document.removeEventListener("touchmove", onMove, opts);
    document.removeEventListener("touchend", onEnd, opts);
    document.removeEventListener("touchcancel", onEnd, opts);
  };
}

export default startOverlaySwipeBack;

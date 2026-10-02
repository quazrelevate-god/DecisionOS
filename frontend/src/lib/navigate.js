/* Going somewhere in the app, from code that is not a component.
 * (2026-10-02.)
 *
 * THE PROBLEM. A toast, an interceptor and a plain helper all sometimes need
 * to send somebody to a screen, and none of them can call useNavigate. The
 * fallback was `window.location.href = "/settings?..."`, which works and
 * costs the whole application: a full document load, the bundle parsed again,
 * every cache dropped, the session re-fetched. In a browser that is a blink.
 * In the installed PWA and the Capacitor shell it is the app restarting in
 * front of somebody who pressed a button on a toast — and this repo has
 * already paid for that lesson once, in the note on EmptyState about an
 * <a href> reloading the whole app.
 *
 * THE SHAPE, AND WHY THIS ONE. The app already solves this exact problem for
 * Android's deep links: lib/native/links takes a `go(path)` callback and
 * hooks/useNativeBack supplies `navigate`, because it is mounted at the root
 * inside the Router. So this is not a new mechanism — it is that one, given a
 * name and made reusable, registered from the same place for the same stated
 * reason. A second way to navigate would be the worse outcome.
 *
 * IT ALWAYS WORKS. Before React mounts, in a test, or if the bridge is ever
 * left unregistered, `goTo` falls back to a real location change. The caller
 * never has to know which happened, and nobody has to remember to check.
 */

let _navigate = null;

/** Called once, from inside the Router. Pass null on unmount. */
export function setAppNavigate(fn) {
  _navigate = typeof fn === "function" ? fn : null;
}

/** True when a router is listening — exported for tests, not for branching. */
export function hasAppNavigate() {
  return !!_navigate;
}

/* A hash has to be scrolled to ourselves. React Router does not do it: the
   browser only jumps to an anchor on a real document load, which is precisely
   what we have stopped doing. And the target is usually not on screen yet —
   the page has to mount, its tab has to switch, its data has to arrive — so
   this looks for it over a short budget rather than once. */
const LOOK_FOR_MS = 2500;

function scrollToWhenReady(id) {
  if (!id || typeof document === "undefined") return;
  const until = Date.now() + LOOK_FOR_MS;
  const look = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (Date.now() < until) window.requestAnimationFrame(look);
  };
  window.requestAnimationFrame(look);
}

/**
 * Go to a path inside the app, without reloading it.
 * @param {string} to e.g. "/settings?tab=business#ai-consent"
 */
export function goTo(to) {
  const path = String(to || "");
  if (!path) return;
  if (!_navigate) {
    window.location.assign(path);
    return;
  }
  _navigate(path);
  const at = path.indexOf("#");
  if (at >= 0) scrollToWhenReady(path.slice(at + 1));
}

export default goTo;

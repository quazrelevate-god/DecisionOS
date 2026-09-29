/* B19 (2026-09-29) · A link that belongs to DecisionOS opens DecisionOS.
 *
 * Invites, password resets and email verifications are all URLs on the web
 * app. With the app installed they still opened Chrome, which is the wrong
 * half of the product: an invited member ends up signed in to the website
 * rather than the app they just installed, and a notification would do the
 * same the day push ships.
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS CODE.
 *
 *   1. Android has to hand us the link. That is an App Links intent-filter in
 *      the manifest plus an `assetlinks.json` served from the site, naming the
 *      release signing certificate. The filter is there, pointed at whatever
 *      `appLinkHost` says (android/variables.gradle); the assetlinks file is
 *      served by frontend/server.js from ANDROID_APP_FINGERPRINT. Until that
 *      variable is set on the deploy, Android does not verify the link and
 *      keeps opening the browser — no crash, no error, just today's
 *      behaviour. See docs/DEEP_LINKS.md.
 *
 *   2. Once handed over, the app has to land on the right SCREEN rather than
 *      wherever it happened to be. That is this file, and it works the moment
 *      half one does.
 *
 * WHY A PATH AND NOT THE WHOLE URL. The link's host is the website's; the
 * app's pages are served from https://localhost, and navigating to the web
 * URL inside the webview would load the SITE into the app — a second copy of
 * the product, signed in separately, inside the first. Only the path and the
 * query travel.
 */
import { isNativeApp } from "./back";

/* The paths worth opening in the app. Anything else — a marketing page, a
   blog post, a PDF — is the website's business and is left to the browser,
   which is also why the intent-filter lists these paths and not the host. */
const IN_APP = ["/login", "/signup", "/reset-password", "/verify-email", "/inbox", "/my-work", "/decisions"];

/**
 * The in-app destination for a link, or null when it is not ours to open.
 * Pure, so the rules can be read and tested without a phone.
 * @param {string} url  the full URL Android handed us
 * @returns {string|null} a router path with its query, or null
 */
export function inAppPath(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const path = u.pathname.replace(/\/+$/, "") || "/";
  /* "/" carries nothing to act on: an invite is /login?invite=…, a reset is
     /reset-password?token=…. Sending the app to its own root on a bare link
     would throw away whatever screen the founder was already on. */
  const match = IN_APP.find((p) => path === p || path.startsWith(`${p}/`));
  if (!match) return null;
  return `${path}${u.search || ""}`;
}

/**
 * Listen for links Android hands the app.
 * @param {Function} go  (path) => void — navigate, through the router
 * @returns {Promise<Function>} cleanup
 */
export async function startNativeLinks(go) {
  if (!isNativeApp()) return () => {};
  const { App } = await import("@capacitor/app");

  /* The app may have been STARTED by the link rather than resumed: the event
     has already fired by the time React mounts, so ask as well as listen. */
  try {
    const launch = await App.getLaunchUrl();
    const path = launch?.url ? inAppPath(launch.url) : null;
    if (path) go?.(path);
  } catch {
    /* no launch url, which is the normal case */
  }

  const handle = await App.addListener("appUrlOpen", ({ url }) => {
    const path = inAppPath(url);
    if (path) go?.(path);
  });
  return () => handle.remove();
}

export default startNativeLinks;

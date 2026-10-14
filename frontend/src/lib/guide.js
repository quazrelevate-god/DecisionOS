/* 2026-10-12 · THE USER GUIDE IS A WEB PAGE, AND THE APP OPENS IT.
 *
 * The client asked for a guide new people can read. It lives on the website
 * (public/guide, served at /guide by server.js) rather than inside the app, so
 * it can be corrected without a store release and forwarded as one link.
 *
 * Three ways in, one function: Preferences (Settings) → Help & guide on the
 * phone, Help & guide in the desktop profile menu, and the walkthrough's last
 * step. In the native app it opens in the system's
 * in-app browser sheet (Custom Tab / SFSafariViewController), so the person
 * stays in DecisionOS and comes straight back; on the web, a new tab.
 *
 * `section` is an anchor on the page — "decide", "ask", "my-work" … — so a
 * screen can send someone to exactly the part that explains it.
 */
import { isNativeApp } from "./native/back";

/* The site the store app knows (android/variables.gradle, appLinkHost). */
const SITE = "https://www.decisionos.biz";

export function guideUrl(section) {
  const hash = section ? `#${section}` : "";
  /* A build can point at another copy — a local one, before the site has it:
     REACT_APP_GUIDE_URL=http://localhost:3000/guide/index.html */
  if (process.env.REACT_APP_GUIDE_URL) return `${process.env.REACT_APP_GUIDE_URL}${hash}`;
  if (isNativeApp()) return `${SITE}/guide/${hash}`;
  /* The web app is served by the same server as the guide. The dev server has
     no /guide route (server.js adds it in production), so it is asked for the
     file itself. */
  const path = process.env.NODE_ENV === "production" ? "/guide/" : "/guide/index.html";
  return `${path}${hash}`;
}

export async function openGuide(section) {
  const url = guideUrl(section);
  if (isNativeApp()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url, presentationStyle: "popover" });
      return;
    } catch {
      /* No plugin on an older binary: the system browser still works. */
    }
  }
  window.open(url, "_blank", "noopener");
}

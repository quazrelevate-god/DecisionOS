/* DEX ON THE HOME SCREEN (2026-10-29, founder): "a separate widget… the
 * 'decide or ask' bottom slider… in the transparent background of the home
 * screen launcher itself."
 *
 * The Android widget (DexWidgetProvider) opens DexQuickActivity, a
 * see-through window over the launcher that starts this app at
 * /quick?mode=ask|decide. Layout reads it from here: on /quick it draws only
 * the dock and the flow that was tapped, on a clear ground, and closing that
 * flow closes the window — back to the home screen, not into the app.
 */
import { isNativeApp } from "./back";

export const QUICK_PATH = "/quick";

export function quickMode(location) {
  if (!location.pathname.startsWith(QUICK_PATH)) return null;
  return new URLSearchParams(location.search).get("mode") === "ask" ? "ask" : "decide";
}

export async function leaveQuick() {
  if (!isNativeApp()) { window.location.replace("/app"); return; }
  const { App } = await import("@capacitor/app");
  App.exitApp();
}

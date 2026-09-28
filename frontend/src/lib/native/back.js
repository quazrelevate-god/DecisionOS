/* MOBILE-2 · What Android's Back gesture does inside the app.
 *
 * THE BUG, AND WHY IT IS NOT A BUG IN OUR CODE. In the APK, swiping back from
 * anywhere — a page, a pop-up, mid-review — closed DecisionOS and put the
 * founder on the phone's home screen. Nothing in the web app was wrong: the
 * back press never reached it. @capacitor/core does not touch the back press
 * at all (there is no onBackPressed anywhere in BridgeActivity), so with
 * targetSdk 36 the system's own default ran, and the system's default for an
 * activity with no registered callback is to finish it.
 *
 * WHAT MAKES IT REACH US. @capacitor/app registers an OnBackPressedCallback on
 * the activity's dispatcher, which AndroidX wires into the predictive-back
 * system — so it intercepts the gesture on Android 13 through 16. Then
 * (AppPlugin.java, read at 8.1.1):
 *
 *   · with NO JS listener it goes back in the webview's history, and if it
 *     cannot, it does nothing at all — back would feel dead on the first
 *     screen rather than exiting;
 *   · with a JS listener it hands us the press and `canGoBack`, and does
 *     nothing else. Leaving the app is then ours to do, through exitApp().
 *
 * So a listener is not optional once the plugin is installed. This is it.
 *
 * WHAT IT DECIDES, AND WHY THAT IS NEARLY FREE. The app has modelled overlays
 * as history entries since the mobile PWA work: a dialog, a sheet or a drawer
 * pushes one entry while it is open (hooks/useBackDismiss), and the focus
 * views put their state in the URL (useFocus). So "close the pop-up, stay on
 * the page" and "go back to the page before" are the same instruction to the
 * browser — history.back() — and the only thing missing in the APK was
 * somebody to give it. The one case history cannot answer is the first entry,
 * where going back would leave the app; that is the case this file is really
 * for.
 */
import { OVERLAY_KEY } from "../../hooks/useBackDismiss";

/** True inside the Capacitor shell; false in any browser (window.Capacitor
 *  does not exist there), which is how the web app stays untouched. */
export const isNativeApp = () =>
  typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

/* Where a back press lands when there is no history left: the screens a
   founder can be on with nothing behind them. "/" and "/app" resolve to one of
   the first two (App.js Home); "/login" is where a signed-out cold start
   begins. Back on any of these is a request to leave the app. */
export const ROOT_PATHS = ["/inbox", "/my-work", "/login", "/", "/app"];

/**
 * THE POLICY, as a pure function so it can be read and tested without a phone.
 *
 * @param {object}  historyState  window.history.state
 * @param {string}  pathname      window.location.pathname
 * @param {boolean} canGoBack     what the webview says (from the backButton event)
 * @returns {"close-overlay"|"back"|"home"|"exit"}
 */
export function backAction({ historyState, pathname, canGoBack = true } = {}) {
  const state = historyState || {};
  /* An overlay owns this entry (useBackDismiss put its marker there), so back
     belongs to the overlay and not to the page under it. Checked FIRST: a
     dialog opened on the very first screen sits at the same history index as
     that screen, so the index alone would read it as "nothing behind us" and
     offer to leave the app while a pop-up was open. */
  if (state[OVERLAY_KEY]) return "close-overlay";
  /* React Router (v7, BrowserRouter) numbers its entries in history.state.idx.
     Anything above zero means the app itself has somewhere to go back to — a
     previous page, or a previous section. `canGoBack` is the webview's own
     answer to the same question and they should agree; when they do not, the
     honest reading is that there is nothing behind us. */
  const idx = Number.isFinite(state.idx) ? state.idx : 0;
  if (idx > 0 && canGoBack) return "back";
  /* Nothing behind us, and we are not on a screen a founder starts from —
     a notification or a pasted link opened the app here. Leaving the app is
     the wrong answer to "go back" on a screen nobody navigated to, so go where
     back would have gone had they walked in. */
  if (!ROOT_PATHS.includes(pathname)) return "home";
  return "exit";
}

/* Two presses to leave, because one is how you lose a half-written decision.
   The window is deliberately short: long enough to be a deliberate second
   press, short enough that a press a minute later is not read as one. */
export const EXIT_CONFIRM_MS = 2000;

/**
 * Wire the gesture up. Everything it needs from the app is passed in, so this
 * file imports no React and no router.
 *
 * @param {object}   deps
 * @param {Function} deps.goHome   () => void — take the founder to their home screen
 * @param {Function} deps.say      (message) => void — the "press again" line
 * @returns {Promise<Function>} a cleanup that removes the listener
 */
export async function startNativeBack({ goHome, say } = {}) {
  if (!isNativeApp()) return () => {};
  /* Imported here rather than at the top of the file: the web bundle then
     never pulls the plugin in, and a browser that somehow ran this code would
     not fail on a missing native module. */
  const { App } = await import("@capacitor/app");
  let armedAt = 0;

  const handle = await App.addListener("backButton", ({ canGoBack }) => {
    const action = backAction({
      historyState: window.history.state,
      pathname: window.location.pathname,
      canGoBack,
    });
    if (action === "close-overlay" || action === "back") {
      armedAt = 0;
      window.history.back();
      return;
    }
    if (action === "home") {
      armedAt = 0;
      goHome?.();
      return;
    }
    const now = Date.now();
    if (now - armedAt < EXIT_CONFIRM_MS) {
      App.exitApp();
      return;
    }
    armedAt = now;
    say?.("Press back again to leave DecisionOS");
  });

  return () => handle.remove();
}

export default startNativeBack;

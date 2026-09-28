/* B02 (2026-09-29) · What to say when the microphone will not open.
 *
 * "Microphone not available" was the whole of it, everywhere. On a laptop
 * that is nearly enough — the browser's own padlock is right there. On a
 * phone it is a dead end: the founder has just denied a prompt (or denied it
 * last week and forgotten), and the app is telling them a fact about the
 * hardware rather than the one thing that would fix it.
 *
 * The distinction worth drawing is not the error's name, it is whose
 * permission it is:
 *   · in the APK, Android holds it, and it is changed in system settings;
 *   · in a browser, the site holds it, and it is changed in the address bar.
 * Everything else — no microphone at all, a driver that refused — is the same
 * sentence either way, because there is nothing the founder can do about it
 * from here except type instead.
 *
 * Typing is always offered, because it always works. The voice path is the
 * fast one, never the only one.
 */
import { isNativeApp } from "./back";

/** DOMException names getUserMedia raises for "you may not have this". */
const DENIED = ["NotAllowedError", "SecurityError", "PermissionDeniedError"];
const ABSENT = ["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"];

/**
 * @param {Error|DOMException|null} error  whatever getUserMedia rejected with
 * @returns {string} one sentence, and where it applies, the way out
 */
export function micProblem(error) {
  const name = error?.name || "";
  if (DENIED.includes(name)) {
    return isNativeApp()
      ? "DecisionOS doesn't have the microphone yet. Android Settings › Apps › DecisionOS › Permissions › Microphone — or just type it instead."
      : "Your browser is blocking the microphone. Allow it for this site and press again, or type it instead.";
  }
  if (ABSENT.includes(name)) return "No microphone on this device — type it instead.";
  return "Couldn't open the microphone — type it instead.";
}

export default micProblem;

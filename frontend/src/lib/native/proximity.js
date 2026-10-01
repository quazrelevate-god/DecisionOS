/* DEX-SLIDER Part 4 · THE PHONE AT YOUR EAR.
 *
 * While the decision door is RECORDING, the screen blanks when the phone is
 * held to the ear, so a founder can dictate a decision the way they would say
 * it to somebody — without their cheek pressing buttons.
 *
 * It did not work on the founder's iPhone because it did not exist: Part 4 was
 * deliberately skipped when Parts 3 and 5 were built, and nothing in the app
 * had ever asked for the sensor. This is that part.
 *
 * ONE PLUGIN, NOT A HAND-ROLLED ONE (@capgo/capacitor-proximity, Capacitor 8).
 * The brief is explicit about this and it is right: wake locks and sensor
 * lifecycles are exactly the code you do not want to own on two platforms.
 *
 * WHAT EACH SURFACE ACTUALLY DOES, and each degrades in silence:
 *   iOS      blanks the screen properly — this is UIDevice.proximityMonitoring,
 *            the same thing the Phone app uses.
 *   Android  the plugin blacks out OUR OWN WINDOW, not the system display.
 *            Accepted as-is; chasing the hidden wake lock is not worth it.
 *   Web      there is no sensor. The feature is simply absent — no error, no
 *            empty state, no mention of it anywhere in the UI.
 *
 * THE WORST BUG THIS FEATURE CAN HAVE is a phone left dark because we forgot
 * to turn monitoring off, so `disable()` is deliberately dumber than `enable()`:
 * it never checks whether it thinks monitoring is on, it just asks for off, and
 * it swallows everything. Calling it twice, or when it was never enabled, or
 * after the plugin failed to load, all have to be safe — because every one of
 * those happens on some unmount path.
 *
 * Recording itself is untouched by any of this. The microphone keeps running
 * with the screen dark; nothing auto-stops on silence; pulling the phone away
 * brings the screen back and the founder presses stop themselves.
 */
import { isNativeApp } from "./back";

let plugin = null;        // resolved module, or null while/if unavailable
let loading = null;       // in-flight import, so N callers share one
let enabled = false;      // what WE last asked for — never trusted for disable

async function resolve() {
  if (plugin) return plugin;
  if (!isNativeApp()) return null;
  if (!loading) {
    loading = import("@capgo/capacitor-proximity")
      .then((m) => { plugin = m.CapacitorProximity || null; return plugin; })
      .catch(() => null);
  }
  return loading;
}

/**
 * Start proximity monitoring. Safe to call when there is no sensor, no plugin
 * and no native shell — it resolves to false and the caller carries on.
 * @returns {Promise<boolean>} whether monitoring is now on
 */
export async function enableProximity() {
  try {
    const p = await resolve();
    if (!p) return false;
    /* Ask the device before asking for the behaviour. A phone with no sensor
       (and every browser) must not have monitoring "enabled" against it. */
    const status = await p.getStatus?.().catch(() => null);
    if (status && status.available === false) return false;
    await p.enable();
    enabled = true;
    return true;
  } catch (e) {
    return false;                      // no plugin, no sensor, no permission
  }
}

/**
 * Stop proximity monitoring. Never throws, never asks whether it was on, and
 * is correct to call from any teardown path including ones that run twice.
 */
export async function disableProximity() {
  enabled = false;
  try {
    const p = plugin || (await resolve());
    if (p) await p.disable();
  } catch (e) {
    /* Deliberately silent. A failure here is already the bad case; a thrown
       error inside an unmount would only take something else down with it. */
  }
}

/** What we last asked for. For diagnostics — never a precondition for off. */
export function proximityEnabled() {
  return enabled;
}

export default { enableProximity, disableProximity, proximityEnabled };

/* The first-week tour's hand-off (components/tour/FirstWeekTour).
 *
 * Signup knows the company Dex just built — its workflows, teams, rules and
 * routines — and the app does not yet, so the moment the founder presses
 * Enter the tour's script is filled from the draft and kept here. The app
 * plays it from this, with no request of its own, on the first screen it can
 * (after the welcome, the Terms and any other first-run card). The step is
 * kept too, so a tour that moves the founder from page to page picks up where
 * it was. Kept after it ends, so "Take the tour" can play it again.
 */
const KEY = "dos:first-tour";

export function readFirstTour() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}

function write(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: no tour, no harm */ }
  try { window.dispatchEvent(new Event("dos:first-tour")); } catch { /* no window */ }
}

export function saveFirstTour(journey) {
  write({ journey, pending: true, step: 0, savedAt: new Date().toISOString() });
}

export function setFirstTourStep(step) {
  const cur = readFirstTour();
  if (cur) write({ ...cur, step });
}

export function finishFirstTour() {
  const cur = readFirstTour();
  if (cur) write({ ...cur, pending: false, step: 0 });
}

/** Play it again; false when there is no company script on this device. */
export function replayFirstTour() {
  const cur = readFirstTour();
  if (!cur?.journey) return false;
  write({ ...cur, pending: true, step: 0 });
  return true;
}

export const firstTourPending = () => !!readFirstTour()?.pending;
export const hasFirstTour = () => !!readFirstTour()?.journey;

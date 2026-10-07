/* DEX-SLIDER Part 2 · the two doors into Dex, offered to the page.
 *
 * Ask lives in Layout: it owns the sheet, the channel and the recording, and
 * it has done since KM-54 collapsed the two-door picker. That was fine while
 * the only way in was the circle Layout itself renders — but the slider is on
 * the Desk, and a page cannot reach Layout's state.
 *
 * So Layout hands the doors down, the same shape it already hands down the
 * header slot (HeaderSlot.js). A page that wants one takes it; a page that
 * does not, and every page above lg, never sees it.
 *
 * `null` is the honest default: outside the mobile shell there is no sheet to
 * open, and a consumer must read that as "not here" rather than call into
 * nothing.
 */
import { createContext, useContext } from "react";

export const DexDoorsContext = createContext(null);

/** The doors, or null when there is no mobile shell above this page. */
export function useDexDoors() {
  return useContext(DexDoorsContext);
}

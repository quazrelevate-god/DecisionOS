/* Flags the founder can throw without a rewrite.
 *
 * Each one names an experiment that has a WHOLE other path still alive behind
 * it. Not a kill switch for a half-built feature and not a permanent fork: a
 * flag here is a promise that both sides still run, and that turning it off
 * puts the product back exactly as it was.
 *
 * Build-time constants, deliberately. A flag read from the environment or the
 * server is a flag that can differ between the founder's phone and the pilot's,
 * and these decide what a screen IS — not what it may do. Flipping one is an
 * edit, a build and a look, which is the honest cost of changing a screen.
 */

/* DEX-SLIDER (2026-10-01) — the phone Desk's Dex control.
 *
 * ON  the Desk is greeting, KPI tiles, the black card, then an iPhone-style
 *     slider above the dock: drag left for Ask, right for the decision door.
 *     The door is a full screen with the mic at its centre.
 * OFF the Desk is exactly what it was: greeting, tiles, the 17rem Dex well
 *     with its ripple and its two circles, then the black card. The Ask
 *     circle comes back beside the dock.
 *
 * The founder asked for the way back before the way forward, so nothing the
 * slider replaces has been deleted — the well and its door are untouched and
 * still render on this flag. Desktop never reads this: it has no slider, no
 * Ask circle and no reordering, at either setting.
 */
export const DEX_SLIDER = true;

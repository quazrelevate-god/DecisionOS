/* B04 follow-up (2026-09-29) — "is there a session on this device?", asked
 * without the network.
 *
 * CantReachUs told everyone "You're still signed in", which is the reassurance
 * the whole screen exists to give — a founder with one bar needed to know the
 * session was intact and the sign-in screen was a lie. But it was said
 * unconditionally, so a FRESH INSTALL with no session was told it too. Found
 * on the first signed release build: every swap between a debug and a release
 * APK needs an uninstall, so a tester meets that screen with no session
 * constantly, and it makes a claim it cannot support.
 *
 * The app cannot ask the server — that is the situation it is in. So it
 * remembers the one thing it can: whether a session was ever established on
 * this device, and whether it has since ended. Set when a user is known,
 * cleared on sign-out and on a confirmed 401, so the flag means "as far as
 * this device knows, there is a session" — exactly the claim the copy makes.
 *
 * Not authority, and never treated as it: nothing is unlocked by this. It
 * chooses one sentence over another, and the server still decides everything.
 */
const KEY = "dos_session_here";

/** Remember that a session exists on this device. */
export function rememberSessionHere() {
  try { localStorage.setItem(KEY, "1"); } catch (e) { /* storage blocked */ }
}

/** Forget it — sign-out, or a 401 that settled the question. */
export function forgetSessionHere() {
  try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
}

/** Was a session established here and not since ended? */
export function hadSessionHere() {
  try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
}

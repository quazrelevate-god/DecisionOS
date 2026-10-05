/* MOBILE-2 · The Android back gesture, mounted once for the whole app.
 *
 * The decision itself is lib/native/back.js, which knows nothing about React.
 * This is the wiring: where "home" is for the person signed in, and which
 * words the app says before it lets go of them.
 *
 * MOUNTED AT THE ROOT, NOT IN THE LAYOUT. @capacitor/app asks one question —
 * "does JS have a backButton listener?" — and it is asked of the plugin, not
 * of a screen. A listener that existed only inside the signed-in shell would
 * leave the sign-in screen answering to the plugin's own default, which on a
 * first entry is to do nothing at all. So it is mounted above the routes and
 * covers every screen, signed in or not.
 *
 * In a browser this is inert: startNativeBack returns immediately when
 * window.Capacitor is absent, and nothing is imported that a browser lacks.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../lib/perms";
import { startNativeBack } from "../lib/native/back";
// B19 — a link that belongs to DecisionOS lands on the right screen.
import { startNativeLinks } from "../lib/native/links";
// IOS-3 — tapping a field stops zooming the screen.
import { lockZoomInApp } from "../lib/native/viewport";
// IOS-4 — an edge swipe closes an open sheet, which WKWebView will not do.
import { startOverlaySwipeBack } from "../lib/native/swipeBack";
// PUSH (2026-10-05) — register for device notifications once signed in.
import { startPush } from "../lib/native/push";

export function useNativeBack() {
  const navigate = useNavigate();
  const { user } = useAuth();
  /* The same answer App.js's Home gives: the Desk for anyone who has it, and
     My Work for the people who do not. Kept in a ref-free effect dependency so
     a sign-in swaps the destination without re-registering the listener doing
     anything odd — the listener is cheap to replace. */
  const home = user ? (hasPerm(user, "inbox") ? "/inbox" : "/my-work") : "/login";

  /* IOS-3 — once, as early as the app has a DOM. Nothing to tear down: it
     rewrites one meta tag, and a browser never reaches it. */
  useEffect(() => { lockZoomInApp(); }, []);

  /* IOS-4 — iOS only, and only while an overlay holds the top history entry;
     everywhere else the native gesture keeps the touch. */
  useEffect(() => startOverlaySwipeBack(), []);

  /* B19 — the same mount point, because it answers the same plugin and has
     the same one requirement: a router to navigate with. */
  useEffect(() => {
    let stop = null;
    let cancelled = false;
    startNativeLinks((path) => navigate(path)).then((off) => {
      if (cancelled) off?.();
      else stop = off;
    });
    return () => { cancelled = true; stop?.(); };
  }, [navigate]);

  /* PUSH — only once there is a signed-in user (a token belongs to a person,
     and the permission prompt should not greet a sign-in screen). Keyed on the
     user id so it registers on sign-in and re-registers if the account changes,
     not on every unrelated user-object update. Sign-out cleanup lives in
     AuthContext.logout (it must not run on app close). Inert in a browser. */
  useEffect(() => {
    if (!user?.id) return undefined;
    let stop = null;
    let cancelled = false;
    startPush((path) => navigate(path)).then((off) => {
      if (cancelled) off?.();
      else stop = off;
    });
    return () => { cancelled = true; stop?.(); };
  }, [user?.id, navigate]);

  useEffect(() => {
    let stop = null;
    let cancelled = false;
    startNativeBack({
      goHome: () => navigate(home, { replace: true }),
      say: (message) => toast(message, { id: "native-back-exit", duration: 2000 }),
    }).then((off) => {
      if (cancelled) off?.();
      else stop = off;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [navigate, home]);
}

export default useNativeBack;

/* B04 (2026-09-29) — the screen for "we do not know yet", which used to be
 * the sign-in screen.
 *
 * Opening the app with no signal cleared nobody's session — the cookie was
 * always still there — but the app could not ask about it, read the silence
 * as signed out, and showed Sign in. A founder in a shed with one bar was
 * then asked for an OTP that could not arrive, to get back into an account
 * they had never left. The cure is to say what is actually true.
 *
 * WHO IT IS TALKING TO. "You're still signed in" is the reassurance this
 * screen exists to give, but it was said to everyone — including a fresh
 * install with no session, which is what a tester meets after every
 * uninstall. It is now said only to a device that has one (lib/sessionSeen).
 *
 * It retries itself (AuthContext watches `online` and beats every 15s), so
 * the button is for the impatient rather than the necessary, and the line
 * under it says so. No spinner: a spinner on a screen that may sit there for
 * a minute reads as a hang.
 */
import { WifiSlash } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { hadSessionHere } from "../../lib/sessionSeen";

export function CantReachUs() {
  const { retryMe } = useAuth();
  /* Only say "you're still signed in" to someone who is. A fresh install has
     no session, and this screen is the first thing a tester sees after every
     uninstall — see lib/sessionSeen.js. Read once: it cannot change while
     this screen is up without the screen going away. */
  const signedIn = hadSessionHere();
  return (
    <div
      className="flex min-h-[calc(100vh/var(--ui-scale,1))] flex-col items-center justify-center gap-4 px-8 text-center"
      data-testid="cant-reach-us"
      role="status"
    >
      <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-900/[0.05] text-slate-500">
        <WifiSlash size={26} weight="bold" aria-hidden="true" />
      </span>
      <div>
        <h1 className="font-display text-2xl text-foreground">Can&rsquo;t reach DecisionOS</h1>
        <p className="mt-1.5 max-w-xs text-sm text-muted-foreground" data-testid="cant-reach-why">
          {signedIn
            ? <>You&rsquo;re still signed in. This phone just can&rsquo;t get through right now.</>
            : <>This phone can&rsquo;t get through to us right now.</>}
        </p>
      </div>
      <button
        type="button"
        onClick={retryMe}
        data-testid="cant-reach-retry"
        className="kr-pop flex min-h-touch items-center rounded-pill px-6 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kr-outline"
      >
        Try now
      </button>
      <p className="text-xs text-muted-foreground">It keeps trying on its own.</p>
    </div>
  );
}

export default CantReachUs;

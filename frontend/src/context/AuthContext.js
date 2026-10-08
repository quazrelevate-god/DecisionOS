import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { SESSION_LOST_EVENT } from "../lib/api";
import { setViewerIsOwner } from "../lib/aiConsent";
import { clearSignupConsent } from "../lib/legal";
import { carryOverLocalDrafts } from "../lib/decisionDrafts";
import { clearAllDrafts } from "../lib/drafts";
/* PUSH (2026-10-05) — a device token is per-install; drop THIS device's on
   sign-out so the next person on a shared phone never gets the last one's
   notifications. Inert in a browser. */
import { unregisterPush } from "../lib/native/push";
/* B04 follow-up — which sentence CantReachUs is allowed to say. */
import { rememberSessionHere, forgetSessionHere } from "../lib/sessionSeen";

/* JOURNEY-1 J12 — what this browser keeps under a person's id (their My Work
   filters, mywork-prefs-<tenant>-<user>) goes when they sign out. */
function forgetPersonOnDevice(person) {
  const id = person?.id;
  if (!id) return;
  try {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.includes(id)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* storage blocked: nothing was kept either */ }
}
import { toast } from "sonner";
import { setAppLanguage } from "../i18n";

/* The page somebody was on when their session ended, handed to the sign-in
   screen so it can put them back. Read once and cleared: a stale value would
   send a later, deliberate sign-in somewhere they did not ask for. */
export const RETURN_TO_KEY = "dos_return_to";

/* 2026-10-03 — AND THE PAGE SOMEBODY ARRIVED AT SIGNED OUT.
   The note above was only written when a session ended under the open app.
   Tapping a link from an email or a WhatsApp reminder while signed out --
   /decisions/<id>, /finance?tab=inbox -- went to sign-in with nothing written
   down, so the founder signed in and landed on the Desk, the link spent.
   Written only on a load that has not had anyone signed in: once someone
   was, a missing user means they signed out on purpose (or the session ended,
   which writes its own note), and bringing a deliberate sign-out back to
   where it left is the stale value the note above warns about. */
let hadUserThisLoad = false;
export function rememberArrival(path) {
  if (hadUserThisLoad || !path || path === "/" || path.startsWith("/app")) return;
  try {
    if (!sessionStorage.getItem(RETURN_TO_KEY)) sessionStorage.setItem(RETURN_TO_KEY, path);
  } catch (e) { /* private window: they land on the Desk, as before */ }
}

export function takeReturnTo() {
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    if (v) sessionStorage.removeItem(RETURN_TO_KEY);
    return v || null;
  } catch (e) {
    return null;
  }
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  // Apply the user's saved language whenever it changes (follows them across devices).
  useEffect(() => {
    if (user?.language) setAppLanguage(user.language);
  }, [user?.language]);

  /* 2026-09-26 — "AI is off for this company" reads differently for the person
     who can turn it on. The axios interceptor that says it is not inside React
     (lib/api.js), so the answer is kept beside the words (lib/aiConsent). */
  useEffect(() => {
    setViewerIsOwner(user?.role === "owner");
  }, [user?.role]);

  /* PILOT-2 B (2026-09-27) — drafts saved before the flag moved to the server
     live in this browser's localStorage. The first time a signed-in person
     opens the app after the change, they are posted to their decisions and the
     old list is dropped, so nobody loses a draft in the switch. Best effort:
     a failure leaves the list to be tried again next time. */
  useEffect(() => {
    if (!user?.id) return;
    carryOverLocalDrafts().catch(() => { /* tried again on the next load */ });
  }, [user?.id]);

  /* B04 (2026-09-29) — "NO SIGNAL" IS NOT "SIGNED OUT".
     This swallowed every failure of /auth/me and left `user` null, which the
     router reads as signed out. On a laptop that is nearly always right: the
     request either answers or the browser is on a page that cannot work
     anyway. On a phone it is wrong most of the times it happens — a founder
     in a shed with one bar, or reopening in a lift, was shown the sign-in
     screen and asked for an OTP they could not receive, with a perfectly good
     session sitting in the cookie.
     So the two are told apart. A 401 (and only a 401) means signed out. A
     network error, a timeout or a 5xx means we do not know yet: `offline` goes
     true, nothing is cleared, and the question is asked again when the device
     says it is back. */
  const [offline, setOffline] = useState(false);
  const askMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data.user);
      setTenant(data.tenant);
      setOffline(false);
      return true;
    } catch (e) {
      /* No `response` at all is axios for "the request never got an answer":
         DNS, a dropped connection, or our own timeout. A 5xx did answer, but
         not about this session. */
      const unanswered = !e?.response || e.response.status >= 500;
      setOffline(unanswered);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Session is restored from the HttpOnly cookie via /auth/me.
    askMe();
    // Runs once on mount to restore the session; deps intentionally empty.
  }, [askMe]);

  /* B04 follow-up — one place, because there are four ways a user arrives
     (cold start, sign in, register, accept an invite) and only two ways they
     leave, and every one of them ends here. Deliberately NOT cleared when
     `offline` goes true: not knowing is the whole reason the flag exists. */
  useEffect(() => {
    if (user) { rememberSessionHere(); hadUserThisLoad = true; }
  }, [user]);

  /* And it retries itself, so the founder never has to know to pull-to-refresh:
     when the device reports the network is back, ask once more. `online` fires
     on a real phone the moment a lift doors open. */
  useEffect(() => {
    if (!offline || user) return undefined;
    const retry = () => { askMe(); };
    window.addEventListener("online", retry);
    /* The device can also be wrong — Android reports `online` for a captive
       Wi-Fi that answers nothing — so there is a slow beat as well. */
    const t = setInterval(retry, 15000);
    return () => {
      window.removeEventListener("online", retry);
      clearInterval(t);
    };
  }, [offline, user, askMe]);

  /* 2026-09-21 — THE SESSION ENDED UNDER THE OPEN APP (see lib/api.js).
     A 401 from any ordinary route while someone is signed in: ask /auth/me
     once — the one question that settles it — and only if that is refused
     too, sign this tab out. Clearing the user unmounts the signed-in shell,
     which stops every poller with it, and the router sends them to sign in.
     `checking` makes a burst of 401s (every poller at once) one check. */
  useEffect(() => {
    if (!user) return undefined;
    let checking = false;
    const onLost = async () => {
      if (checking) return;
      checking = true;
      try {
        await api.get("/auth/me");          // still signed in: that 401 was about something else
      } catch (e) {
        if (e?.response?.status === 401) {
          setUser(null);
          setTenant(null);
          forgetSessionHere();          // settled: the session is gone
          /* 2026-10-02 — AND REMEMBER WHERE THEY WERE. The toast below already
             explains what happened; what it could not do was give the page
             back. Signing in again landed everybody on the Desk, so a founder
             pulled out of Finance mid-reconciliation had to find their way
             back to it. sessionStorage, not local: this belongs to the tab
             that was thrown out, and must not follow them to another one. */
          try {
            const here = window.location.pathname + window.location.search;
            if (here && here !== "/" && !here.startsWith("/login")) {
              sessionStorage.setItem(RETURN_TO_KEY, here);
            }
          } catch (e) { /* private window: they land on the Desk, as before */ }
          toast.info("You were signed out. Sign in again to carry on.", { id: "session-lost" });
        }
      } finally {
        checking = false;
      }
    };
    window.addEventListener(SESSION_LOST_EVENT, onLost);
    return () => window.removeEventListener(SESSION_LOST_EVENT, onLost);
  }, [user]);

  /* 2026-09-20 — ANOTHER TAB SWITCHED COMPANY. The auth cookie is one per
     browser, so the moment one tab switches, every other tab is signed into
     the new workspace while still showing the old one — and a save from there
     would land in the wrong company. Each tab reloads itself instead. The
     event only fires in OTHER tabs, and only for this one key. */
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== "dos_active_workspace" || !e.newValue) return;
      const switchedTo = String(e.newValue).split(":")[0];
      if (switchedTo && switchedTo !== tenant?.id) window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tenant?.id]);

  const persist = (data) => {
    // Auth token lives in a secure HttpOnly cookie set by the server.
    setUser(data.user);
    setTenant(data.tenant);
    /* 2026-10-03 RBAC audit — and then ask /auth/me, the one answer that
       carries `effective_permissions`: the company's role settings, temporary
       grants and what owners were switched off from, resolved by the server.
       The sign-in responses do not, so until a reload the screens fell back to
       the built-in role defaults and could offer doors the server then shut
       (or hide ones it would open). Fire-and-forget: the session is already
       good, and askMe only replaces the user with the fuller answer. */
    askMe();
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    persist(data);
    return data;
  };

  /* Where the session was lost, for the sign-in page to return them to. */
  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    persist(data);
    return data;
  };

  // tenantId: which workspace the code was sent for, when the number belongs to
  // more than one. Without it the API answers 409 and asks.
  // inviteToken: a member's first sign-in comes through their invite link
  // (2026-09-19) — until then their number opens nothing on its own.
  const loginWithOtp = async (phone, code, tenantId, inviteToken, pickToken) => {
    const { data } = await api.post("/auth/otp/verify", {
      phone, code, ...(tenantId ? { tenant_id: tenantId } : {}), ...(inviteToken ? { invite_token: inviteToken } : {}),
      ...(pickToken ? { pick_token: pickToken } : {}),
    });
    // Audit A-03: a number in several companies is answered with the list
    // (after the code was checked), not a session. The caller asks which one.
    if (data?.choose) return data;
    persist(data);
    return data;
  };

  /* 2026-09-20 — move to another of this person's companies. The server mints
     a fresh token for the row that number holds there (the same founder has a
     separate user row per workspace), so the whole app reloads under the new
     workspace rather than trying to reconcile two. */
  const switchWorkspace = async (tenantId) => {
    await api.post("/auth/me/switch-workspace", { tenant_id: tenantId });
    /* NOTHING FROM THE OLD COMPANY MAY SURVIVE THE SWITCH (2026-09-20).
       The service worker caches API GETs by URL for 24h — tasks, people,
       invoices, /auth/me — so company B's screens could be answered with
       company A's data whenever the network is slow (NetworkFirst gives up at
       3s). The SW purges on this request itself; this message covers the case
       where it never saw it. */
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: "PURGE_API_CACHE" });
    } catch (e) { /* no worker here (dev, or an unsupported browser) */ }
    /* And tell the OTHER tabs. The auth cookie is one per browser, so a tab
       still showing company A is, from this moment, writing into company B.
       A `storage` write fires in every other tab of this origin; each one
       reloads itself into the workspace that is now current. */
    try {
      localStorage.setItem("dos_active_workspace", `${tenantId}:${Date.now()}`);
    } catch (e) { /* private window: the reload below still fixes this tab */ }
    // The switch answers with the new workspace but not with the person (they
    // are a different user row there), so identity is re-read rather than
    // guessed: /auth/me under the new cookie returns both.
    const { data } = await api.get("/auth/me");
    persist(data);
    return data;
  };

  const logout = async () => {
    /* PILOT-1 A — unsent words (lib/drafts.js) leave with the person. A
       session that merely ENDS under the open app (above) keeps them: that is
       not the person choosing to leave, and they are scoped to them, so they
       come back when the same person signs in again.
       JOURNEY-1 J12 — and they leave FIRST, before anything is awaited. The
       phone's Sign out (Settings) starts a full page load straight after
       calling this, which cut the wait for the server short, so the drafts
       were never cleared: on a shared phone Amit's unsent update was still
       on the device when Priya signed in. His My Work filters too — they
       name him, and they go with him. */
    clearAllDrafts();
    forgetPersonOnDevice(user);
    /* 2026-10-08 — the one-time "Welcome, <name>" screen leaves with them too.
       A founder who signed up and signed out before seeing it left the flag
       behind, and the next person to sign in on this device was greeted with
       their name, full-screen, over a Desk they could not click. */
    try { localStorage.removeItem("dos_welcome"); } catch (e) { /* storage unavailable */ }
    // And a signup agreement left in this tab is not the next person's.
    clearSignupConsent();
    /* PUSH — tell the backend to stop sending to this device, like the drafts
       above: local/outbound side first, before the session ends. Guarded and
       best-effort (no-op in a browser), so it never delays a sign-out. */
    try { await unregisterPush(); } catch (e) { /* best effort */ }
    /* JOURNEY-1 J12-05 — AND THE SAVED SCREENS GO WITH THEM. The service
       worker empties the API cache when the sign-out POST passes through it
       (service-worker.js, the /api/auth/logout route), which is a condition
       and not a guarantee: no worker yet on a first load, an installed app
       whose worker is being replaced, a browser without one at all. On a
       shared phone the next person would then open the app to the last
       person's Desk, drawn from the cache before the first request comes
       back. Emptied from the page as well, where CacheStorage is the same
       store, so it does not depend on the request being seen. Done BEFORE the
       network call: the phone's Sign out starts a page load straight after
       this returns and anything left awaiting is cut short. */
    if (typeof caches !== "undefined") {
      try { await caches.delete("decisionos-api"); } catch (e) { /* no cache to clear */ }
    }
    /* B07 (2026-09-29) — a short leash on the one call that ends the session.
       This inherits the app's 30s timeout otherwise, and sign-out is the one
       action nobody should be made to wait on: the caller now awaits this
       before it navigates, so a dead network would have left a founder
       looking at Settings for half a minute. Six seconds is generous for a
       request that writes one row, and if it is not answered the local half
       has already happened (above) — the cookie is dead on the next reply
       either way, and the screen goes to sign in. */
    try {
      await api.post("/auth/logout", undefined, { timeout: 6000 });
    } catch (e) {
      // ignore network errors on logout
    }
    setUser(null);
    setTenant(null);
    forgetSessionHere();
  };

  const refreshTenant = async () => {
    const { data } = await api.get("/auth/me");
    setTenant(data.tenant);
    return data.tenant;
  };

  const refreshMe = async () => {
    const { data } = await api.get("/auth/me");
    setUser(data.user);
    setTenant(data.tenant);
    return data.user;
  };

  const value = useMemo(
    () => ({ user, tenant, loading, offline, retryMe: askMe, login, register, logout, refreshTenant,
             refreshMe, loginWithOtp, switchWorkspace }),
    /* login/register/etc close only over stable refs (api import, setState),
       so omitting them is safe — and REQUIRED for this memo to do anything.
       They are redeclared every render, so listing them would recompute
       `value` every render and re-render every consumer of the context: the
       exact cost the memo exists to avoid. The alternative is a useCallback
       around each, which buys nothing here and puts five more hooks in the
       auth path. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, tenant, loading, offline, askMe]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

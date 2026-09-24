import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api, { SESSION_LOST_EVENT } from "../lib/api";
import { clearAllDrafts } from "../lib/drafts";

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

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  // Apply the user's saved language whenever it changes (follows them across devices).
  useEffect(() => {
    if (user?.language) setAppLanguage(user.language);
  }, [user?.language]);

  useEffect(() => {
    // Session is restored from the HttpOnly cookie via /auth/me.
    api
      .get("/auth/me")
      .then(({ data }) => {
        setUser(data.user);
        setTenant(data.tenant);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // Runs once on mount to restore the session; deps intentionally empty.
  }, []);

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
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    persist(data);
    return data;
  };

  const register = async (payload) => {
    const { data } = await api.post("/auth/register", payload);
    persist(data);
    return data;
  };

  // tenantId: which workspace the code was sent for, when the number belongs to
  // more than one. Without it the API answers 409 and asks.
  // inviteToken: a member's first sign-in comes through their invite link
  // (2026-09-19) — until then their number opens nothing on its own.
  const loginWithOtp = async (phone, code, tenantId, inviteToken) => {
    const { data } = await api.post("/auth/otp/verify", {
      phone, code, ...(tenantId ? { tenant_id: tenantId } : {}), ...(inviteToken ? { invite_token: inviteToken } : {}),
    });
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
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // ignore network errors on logout
    }
    setUser(null);
    setTenant(null);
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
    () => ({ user, tenant, loading, login, register, logout, refreshTenant, refreshMe, loginWithOtp,
             switchWorkspace }),
    /* login/register/etc close only over stable refs (api import, setState),
       so omitting them is safe — and REQUIRED for this memo to do anything.
       They are redeclared every render, so listing them would recompute
       `value` every render and re-render every consumer of the context: the
       exact cost the memo exists to avoid. The alternative is a useCallback
       around each, which buys nothing here and puts five more hooks in the
       auth path. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, tenant, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

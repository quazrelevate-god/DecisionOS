import { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "../lib/api";
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

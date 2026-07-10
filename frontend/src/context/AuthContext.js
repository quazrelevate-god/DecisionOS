import { createContext, useContext, useEffect, useState } from "react";
import api from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Session is restored from the HttpOnly cookie via /auth/me.
    api
      .get("/auth/me")
      .then(({ data }) => {
        setUser(data.user);
        setTenant(data.tenant);
      })
      .catch(() => localStorage.removeItem("dos_token"))
      .finally(() => setLoading(false));
    // Runs once on mount to restore the session; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (data) => {
    // Token now lives in an HttpOnly cookie set by the server. Keep a copy for
    // backward-compatible Bearer fallback during the migration window.
    if (data.token) localStorage.setItem("dos_token", data.token);
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

  const loginWithOtp = async (phone, code) => {
    const { data } = await api.post("/auth/otp/verify", { phone, code });
    persist(data);
    return data;
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // ignore network errors on logout
    }
    localStorage.removeItem("dos_token");
    setUser(null);
    setTenant(null);
  };

  const refreshTenant = async () => {
    const { data } = await api.get("/auth/me");
    setTenant(data.tenant);
    return data.tenant;
  };

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout, refreshTenant, loginWithOtp }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

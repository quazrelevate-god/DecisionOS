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
      .catch(() => {})
      .finally(() => setLoading(false));
    // Runs once on mount to restore the session; deps intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout, refreshTenant, refreshMe, loginWithOtp }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

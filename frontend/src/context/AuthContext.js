import { createContext, useContext, useEffect, useState } from "react";
import api from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("dos_token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get("/auth/me")
      .then(({ data }) => {
        setUser(data.user);
        setTenant(data.tenant);
      })
      .catch(() => localStorage.removeItem("dos_token"))
      .finally(() => setLoading(false));
  }, []);

  const persist = (data) => {
    localStorage.setItem("dos_token", data.token);
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

  const logout = () => {
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
    <AuthContext.Provider value={{ user, tenant, loading, login, register, logout, refreshTenant }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

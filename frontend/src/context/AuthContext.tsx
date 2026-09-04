import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi, getStoredToken, setStoredToken } from "../api/client";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleSessionExpired = () => {
      setToken(null);
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("aiwa:session-expired", handleSessionExpired);
    return () => window.removeEventListener("aiwa:session-expired", handleSessionExpired);
  }, []);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    if (user) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

    async function bootstrap() {
      try {
        const me = await authApi.me({ signal: controller.signal });
        if (active) setUser(me);
      } catch {
        if (controller.signal.aborted) return;
        setStoredToken(null);
        if (active) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      active = false;
      controller.abort();
    };
  }, [token, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      async login(email, password) {
        const result = await authApi.login(email, password);
        setStoredToken(result.token);
        setToken(result.token);
        setUser(result.user);
      },
      async register(name, email, password) {
        const result = await authApi.register(name, email, password);
        setStoredToken(result.token);
        setToken(result.token);
        setUser(result.user);
      },
      logout() {
        setStoredToken(null);
        setToken(null);
        setUser(null);
      }
    }),
    [loading, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

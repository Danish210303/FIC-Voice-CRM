import { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from "react";
import { api, isTokenExpired } from "../api/client";

type User = {
  id: string;
  name: string;
  role: "admin" | "team_leader" | "supervisor" | "agent";
  employee_id: string;
  email?: string;
  pool_id?: string | null;
  shift?: string | null;
};

type AuthContextType = {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null;
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("user") : null;
    if (!token || !stored || isTokenExpired(token)) {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("access_token");
        localStorage.removeItem("user");
      }
      return null;
    }
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  });

  const logout = useCallback(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("access_token");
      localStorage.removeItem("user");
    }
    setUser(null);
    if (typeof window !== "undefined") {
      window.location.hash = "#/login";
    }
  }, []);

  // Proactively validate token on startup/mount
  useEffect(() => {
    const token = localStorage.getItem("access_token");
    if (token) {
      api.get("/api/auth/me")
        .then((userData: any) => {
          if (userData && (userData.id || userData._id)) {
            const formattedUser: User = {
              id: userData.id || userData._id,
              name: userData.name || "Agent",
              role: userData.role || "agent",
              employee_id: userData.employee_id || "",
              email: userData.email,
              pool_id: userData.pool_id || null,
              shift: userData.shift || null,
            };
            setUser(formattedUser);
            localStorage.setItem("user", JSON.stringify(formattedUser));
          }
        })
        .catch((err: any) => {
          if (err?.status === 401 || err?.name === "AuthError") {
            logout();
          }
        });
    } else {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    const handleUnauthorized = () => {
      logout();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("auth:unauthorized", handleUnauthorized);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("auth:unauthorized", handleUnauthorized);
      }
    };
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api.post("/api/auth/login", { email, password });
    localStorage.setItem("access_token", data.access_token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

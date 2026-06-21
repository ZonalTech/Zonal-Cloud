import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi, clearToken, setToken } from "./api";
import type { User } from "../types";

interface AuthContextValue {
  user: User | null;
  token: string | null;
  loading: boolean;
  // Set to the admin's email when the current session is an impersonation.
  impersonatedBy: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string,
    organizationSlug: string,
  ) => Promise<void>;
  logout: () => void;
  // Adopt an impersonation token (from /impersonate?token=...) and load the user.
  adoptToken: (token: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem("zonal-token"));
  const [impersonatedBy, setImpersonatedBy] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const navigate = useNavigate();

  useEffect(() => {
    const storedToken = localStorage.getItem("zonal-token");
    if (!storedToken) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(({ user: fetchedUser, impersonatedBy: imp }) => {
        setUser(fetchedUser);
        setImpersonatedBy(imp ?? null);
      })
      .catch(() => {
        clearToken();
        setTokenState(null);
        setUser(null);
        setImpersonatedBy(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login({ email, password });
    setToken(res.token);
    setTokenState(res.token);
    setUser(res.user);
    setImpersonatedBy(null);
  }, []);

  // Adopt a token minted elsewhere (an admin impersonation session). Stores it,
  // verifies it via /me, and captures who is impersonating.
  const adoptToken = useCallback(async (incoming: string) => {
    setToken(incoming);
    setTokenState(incoming);
    const { user: fetchedUser, impersonatedBy: imp } = await authApi.me();
    setUser(fetchedUser);
    setImpersonatedBy(imp ?? null);
  }, []);

  const register = useCallback(
    async (
      username: string,
      email: string,
      password: string,
      organizationSlug: string,
    ) => {
      const res = await authApi.register({ username, email, password, organizationSlug });
      setToken(res.token);
      setTokenState(res.token);
      setUser(res.user);
      setImpersonatedBy(null);
    },
    [],
  );

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setImpersonatedBy(null);
    navigate("/login");
  }, [navigate]);

  const value: AuthContextValue = {
    user,
    token,
    loading,
    impersonatedBy,
    login,
    register,
    logout,
    adoptToken,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

import type { App, AuditLog, Metrics, Org, Quota, User, UserRole } from "../types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export function getToken(): string | null {
  return localStorage.getItem("zonal-token");
}

export function setToken(token: string): void {
  localStorage.setItem("zonal-token", token);
}

export function clearToken(): void {
  localStorage.removeItem("zonal-token");
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const authApi = {
  login(email: string, password: string): Promise<{ token: string; user: User }> {
    return request("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  me(): Promise<{ user: User }> {
    return request("/v1/auth/me");
  },
};

export const adminApi = {
  getUsers(): Promise<{ users: User[] }> {
    return request("/v1/admin/users");
  },

  suspendUser(id: string): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/suspend`, { method: "POST" });
  },

  setUserRole(id: string, role: UserRole): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  },

  getOrgs(): Promise<{ orgs: Org[] }> {
    return request("/v1/admin/orgs");
  },

  setOrgQuota(id: string, quota: Partial<Quota>): Promise<{ quota: Quota }> {
    return request(`/v1/admin/orgs/${id}/quota`, {
      method: "POST",
      body: JSON.stringify(quota),
    });
  },

  getApps(): Promise<{ apps: App[] }> {
    return request("/v1/admin/apps");
  },

  stopApp(id: string): Promise<{ app: App }> {
    return request(`/v1/admin/apps/${id}/stop`, { method: "POST" });
  },

  getMetrics(): Promise<Metrics> {
    return request("/v1/admin/metrics");
  },

  getAuditLogs(): Promise<{ logs: AuditLog[] }> {
    return request("/v1/admin/audit");
  },
};

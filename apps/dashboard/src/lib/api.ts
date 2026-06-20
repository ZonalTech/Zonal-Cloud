import type { App, Deployment, DeployToken, User } from "../types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

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
      ...(options.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { code: "UNKNOWN", message: res.statusText } }));
    throw new Error((err as { error?: { message?: string } })?.error?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// Auth API

interface RegisterPayload {
  email: string;
  password: string;
  orgName: string;
}

interface LoginPayload {
  email: string;
  password: string;
}

interface AuthResponse {
  token: string;
  user: User;
}

export const authApi = {
  register(payload: RegisterPayload): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  login(payload: LoginPayload): Promise<AuthResponse> {
    return request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  me(): Promise<{ user: User }> {
    return request<{ user: User }>("/v1/auth/me");
  },
};

// Apps API

interface CreateAppPayload {
  name: string;
  source: "git" | "upload";
  repoUrl?: string;
  branch?: string;
}

interface DeployPayload {
  ref?: string;
}

interface AppResponse {
  app: App;
}

interface AppsResponse {
  apps: App[];
}

interface AppDetailResponse {
  app: App;
  deployments: Deployment[];
}

interface DeploymentResponse {
  deployment: Deployment;
}

interface TokenCreateResponse {
  token: string;
}

interface TokensResponse {
  tokens: Array<{ id: string; name: string; lastUsedAt?: string }>;
}

export const appsApi = {
  list(): Promise<AppsResponse> {
    return request<AppsResponse>("/v1/apps");
  },

  create(payload: CreateAppPayload): Promise<AppResponse> {
    return request<AppResponse>("/v1/apps", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  get(id: string): Promise<AppDetailResponse> {
    return request<AppDetailResponse>(`/v1/apps/${id}`);
  },

  deploy(id: string, payload?: DeployPayload): Promise<DeploymentResponse> {
    return request<DeploymentResponse>(`/v1/apps/${id}/deploy`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  },

  stop(id: string): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getLogs(id: string): EventSource {
    const token = getToken();
    const url = new URL(`${BASE}/v1/apps/${id}/logs`);
    if (token) {
      url.searchParams.set("token", token);
    }
    return new EventSource(url.toString());
  },

  createToken(id: string, name: string): Promise<TokenCreateResponse> {
    return request<TokenCreateResponse>(`/v1/apps/${id}/tokens`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  listTokens(id: string): Promise<TokensResponse> {
    return request<TokensResponse>(`/v1/apps/${id}/tokens`);
  },
};

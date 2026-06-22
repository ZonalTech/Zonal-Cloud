import type { App, Deployment, User, Notification } from "../types";

// API base resolution order:
//   1. window.__ZONAL_CONFIG__.apiUrl — injected at container runtime by
//      nginx's entrypoint from the ZONAL_API_URL env var. This lets ONE
//      prebuilt image serve any domain (set by the operator / zonalctl).
//   2. VITE_API_URL — baked at build time (used in local dev / source builds).
//   3. localhost fallback for `npm run dev`.
declare global {
  interface Window {
    __ZONAL_CONFIG__?: { apiUrl?: string };
  }
}

const BASE =
  (typeof window !== "undefined" && window.__ZONAL_CONFIG__?.apiUrl) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:4000";

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
  username: string;
  email: string;
  password: string;
  organizationSlug: string;
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

  me(): Promise<{ user: User; impersonatedBy?: string }> {
    return request<{ user: User; impersonatedBy?: string }>("/v1/auth/me");
  },

  forgotPassword(
    email: string,
  ): Promise<{ message: string; devResetUrl?: string; devResetToken?: string }> {
    return request("/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(token: string, password: string): Promise<{ message: string }> {
    return request("/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
  },

  // Permanently delete the signed-in user's own account (re-confirm password).
  deleteAccount(password: string): Promise<{ message: string }> {
    return request("/v1/auth/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },
};

// Apps API

interface CreateAppPayload {
  name: string;
  source: "git" | "upload";
  type?: "static" | "node" | "fullstack" | "nodered" | "frappe";
  repoUrl?: string;
  branch?: string;
  githubRepoFullName?: string;
  // For type=frappe: the first git app to put on the bench (more added later).
  frappeGitUrl?: string;
  frappeBranch?: string;
  // The Frappe framework version the bench is built on (frappe/frappe branch).
  frappeVersion?: string;
}

export interface FrappeApp {
  id: string;
  appId: string;
  gitUrl: string;
  branch: string | null;
  appName: string | null;
  position: number;
  installed: boolean;
  createdAt: string;
}

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
}

interface GithubStatus {
  connected: boolean;
  login?: string;
}

interface UpdateAppPayload {
  name?: string;
  repoUrl?: string;
  branch?: string;
  buildCmd?: string;
  outputDir?: string;
}

interface DeployPayload {
  ref?: string;
}

interface AppResponse {
  app: App;
  // Set only when creating a Node-RED app: the seeded admin account's password,
  // returned exactly once (stored hashed thereafter).
  noderedAdminPassword?: string;
}

// A Node-RED editor account (type = nodered). Never includes the password hash.
export interface NodeRedUser {
  id: string;
  username: string;
  // "*" = full access, "read" = read-only.
  permission: "*" | "read";
  createdAt: string;
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

export type AdminLoginResponse =
  | {
      mode: "frappe";
      loginUrl: string;
      redirectUrl: string;
      usr: string;
      pwd: string;
    }
  | { mode: "redirect"; redirectUrl: string };

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

  // Upload a source folder for an upload-type app. Sends each file plus a
  // parallel "paths" array of relative paths so the server rebuilds the tree.
  // Bypasses the JSON `request` helper because this is multipart/form-data.
  async uploadSource(id: string, files: File[]): Promise<{ ok: boolean; files: number }> {
    const form = new FormData();
    const paths = files.map((f) => (f.webkitRelativePath || f.name));
    for (const file of files) form.append("files", file);
    form.append("paths", JSON.stringify(paths));

    const token = getToken();
    const res = await fetch(`${BASE}/v1/apps/${id}/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) {
      const err = await res
        .json()
        .catch(() => ({ error: { message: res.statusText } }));
      throw new Error(
        (err as { error?: { message?: string } })?.error?.message ?? res.statusText,
      );
    }
    return res.json() as Promise<{ ok: boolean; files: number }>;
  },

  get(id: string): Promise<AppDetailResponse> {
    return request<AppDetailResponse>(`/v1/apps/${id}`);
  },

  // What's needed to sign into the deployed app as its administrator. Frappe
  // apps return managed credentials to POST at the site's login endpoint;
  // others return a plain redirect target.
  adminLogin(id: string): Promise<AdminLoginResponse> {
    return request<AdminLoginResponse>(`/v1/apps/${id}/admin-login`);
  },

  update(id: string, payload: UpdateAppPayload): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  remove(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/apps/${id}`, {
      method: "DELETE",
    });
  },

  deploy(id: string, payload?: DeployPayload): Promise<DeploymentResponse> {
    return request<DeploymentResponse>(`/v1/apps/${id}/deploy`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    });
  },

  // Migrate = forced clean rebuild + rollback-safe redeploy. If the new build
  // fails, the backend restores the previous container so the site stays up.
  migrate(id: string, payload?: DeployPayload): Promise<DeploymentResponse> {
    return request<DeploymentResponse>(`/v1/apps/${id}/migrate`, {
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

  // Cancel an in-progress build (stuck or unwanted). Stops the retrying deploy
  // job, tears down the build containers, and resets the app to "stopped".
  cancel(id: string): Promise<AppResponse> {
    return request<AppResponse>(`/v1/apps/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Restart the running container in place (no rebuild). For Node-RED this
  // reloads settings.js + flows from the persistent volume.
  restart(id: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/v1/apps/${id}/restart`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  // Snapshot of the running container's recent stdout/stderr (the live app's
  // own runtime logs). Poll this to refresh.
  runtimeLogs(id: string): Promise<{ running: boolean; lines: string[] }> {
    return request<{ running: boolean; lines: string[] }>(
      `/v1/apps/${id}/runtime-logs`,
    );
  },

  getLogs(id: string): EventSource {
    const token = getToken();
    const url = new URL(`${BASE}/v1/apps/${id}/logs`);
    if (token) {
      url.searchParams.set("token", token);
    }
    return new EventSource(url.toString());
  },

  // Full stored log for one specific (e.g. failed) deployment — for the
  // error-analysis page. Distinct from getLogs(), which streams the latest.
  getDeploymentLog(
    id: string,
    deploymentId: string,
  ): Promise<{ status: string; ref: string | null; createdAt: string; lines: string[] }> {
    return request(`/v1/apps/${id}/deployments/${deploymentId}/log`);
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

  listDomains(id: string): Promise<{ domains: CustomDomain[] }> {
    return request<{ domains: CustomDomain[] }>(`/v1/apps/${id}/domains`);
  },

  addDomain(id: string, domain: string): Promise<{ domain: CustomDomain }> {
    return request<{ domain: CustomDomain }>(`/v1/apps/${id}/domains`, {
      method: "POST",
      body: JSON.stringify({ domain }),
    });
  },

  verifyDomain(
    id: string,
    domainId: string,
  ): Promise<{ domain: CustomDomain; verified: boolean; message: string }> {
    return request(`/v1/apps/${id}/domains/${domainId}/verify`, { method: "POST" });
  },

  removeDomain(id: string, domainId: string): Promise<{ ok: boolean }> {
    return request(`/v1/apps/${id}/domains/${domainId}`, { method: "DELETE" });
  },

  // ---- Frappe bench apps (type = frappe) ----

  listFrappeApps(id: string): Promise<{ frappeApps: FrappeApp[] }> {
    return request(`/v1/apps/${id}/frappe-apps`);
  },

  addFrappeApp(
    id: string,
    payload: { gitUrl: string; branch?: string; appName?: string },
  ): Promise<{ frappeApp: FrappeApp; rebuildRequired: boolean }> {
    return request(`/v1/apps/${id}/frappe-apps`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  removeFrappeApp(
    id: string,
    frappeAppId: string,
  ): Promise<{ ok: boolean; rebuildRequired: boolean }> {
    return request(`/v1/apps/${id}/frappe-apps/${frappeAppId}`, { method: "DELETE" });
  },

  // Set/upgrade the Frappe framework version. Applied on the next deploy.
  setFrappeVersion(
    id: string,
    version: string,
  ): Promise<{ app: App; previousVersion: string; rebuildRequired: boolean }> {
    return request(`/v1/apps/${id}/frappe-version`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  },

  // ---- Node-RED editor accounts (type = nodered) ----

  listNodeRedUsers(id: string): Promise<{ users: NodeRedUser[] }> {
    return request(`/v1/apps/${id}/nodered-users`);
  },

  addNodeRedUser(
    id: string,
    payload: { username: string; password: string; permission?: "*" | "read" },
  ): Promise<{ user: NodeRedUser; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateNodeRedUser(
    id: string,
    nodeRedUserId: string,
    payload: { password?: string; permission?: "*" | "read" },
  ): Promise<{ user: NodeRedUser; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users/${nodeRedUserId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  removeNodeRedUser(
    id: string,
    nodeRedUserId: string,
  ): Promise<{ ok: boolean; applied: { restarted: boolean } }> {
    return request(`/v1/apps/${id}/nodered-users/${nodeRedUserId}`, {
      method: "DELETE",
    });
  },
};

// Managed DNS API

export const DNS_RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "TXT",
  "NS",
  "SRV",
  "CAA",
] as const;
export type DnsRecordType = (typeof DNS_RECORD_TYPES)[number];

export interface DnsZone {
  id: string;
  organizationId: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  nameservers: string[];
}

export interface DnsRecord {
  name: string; // "@" for apex
  type: DnsRecordType;
  ttl: number;
  records: string[];
  // True for platform-managed RRsets (apex NS) — shown read-only.
  managed?: boolean;
}

export const dnsApi = {
  listZones(): Promise<DnsZone[]> {
    return request<DnsZone[]>("/v1/dns/zones");
  },

  createZone(name: string): Promise<DnsZone> {
    return request<DnsZone>("/v1/dns/zones", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  deleteZone(name: string): Promise<{ deleted: boolean }> {
    return request(`/v1/dns/zones/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
  },

  listRecords(zone: string): Promise<DnsRecord[]> {
    return request<DnsRecord[]>(
      `/v1/dns/zones/${encodeURIComponent(zone)}/records`,
    );
  },

  upsertRecord(
    zone: string,
    payload: { name: string; type: DnsRecordType; ttl?: number; records: string[] },
  ): Promise<DnsRecord> {
    return request(`/v1/dns/zones/${encodeURIComponent(zone)}/records`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  deleteRecord(
    zone: string,
    payload: { name: string; type: DnsRecordType },
  ): Promise<{ deleted: boolean }> {
    return request(`/v1/dns/zones/${encodeURIComponent(zone)}/records`, {
      method: "DELETE",
      body: JSON.stringify(payload),
    });
  },
};

export interface CustomDomain {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed";
  verifiedAt: string | null;
  createdAt: string;
  instructions: {
    txtRecord: { host: string; type: string; value: string };
    routeRecord: { host: string; type: string; value: string };
  };
}

// GitHub API

export const githubApi = {
  status(): Promise<GithubStatus> {
    return request<GithubStatus>("/v1/github/status");
  },

  // Returns the GitHub consent URL to send the browser to.
  authorize(): Promise<{ url: string }> {
    return request<{ url: string }>("/v1/github/authorize");
  },

  listRepos(): Promise<{ repos: GithubRepo[] }> {
    return request<{ repos: GithubRepo[] }>("/v1/github/repos");
  },

  // Branches for a repo, default branch first. `fullName` is "owner/repo".
  listBranches(fullName: string): Promise<{ branches: string[]; defaultBranch: string }> {
    return request<{ branches: string[]; defaultBranch: string }>(
      `/v1/github/repos/${fullName}/branches`,
    );
  },

  // Branches for an arbitrary repo URL (Repository URL mode), via ls-remote.
  listRemoteBranches(repoUrl: string): Promise<{ branches: string[] }> {
    return request<{ branches: string[] }>(
      `/v1/github/remote-branches?repoUrl=${encodeURIComponent(repoUrl)}`,
    );
  },

  // Available Frappe framework versions (version-15+ newest-first, plus nightly).
  listFrappeVersions(): Promise<{ versions: Array<{ value: string; label: string }> }> {
    return request("/v1/github/frappe-versions");
  },

  disconnect(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/v1/github/disconnect", {
      method: "DELETE",
    });
  },
};

// Notifications API

export const notificationsApi = {
  // Recent notifications (read + unread) plus the live unread count for the
  // bell badge. The badge tracks unreadCount, not the list length, so opening
  // the panel doesn't reset the counter.
  listRecent(): Promise<{ notifications: Notification[]; unreadCount: number }> {
    return request<{ notifications: Notification[]; unreadCount: number }>(
      "/v1/notifications",
    );
  },

  // The user's full deployment-failure history for the Errors page (not limited
  // to today, unlike the bell feed).
  listDeploymentFailures(): Promise<{ notifications: Notification[] }> {
    return request<{ notifications: Notification[] }>("/v1/notifications/errors");
  },

  getOne(id: string): Promise<{ notification: Notification }> {
    return request<{ notification: Notification }>(`/v1/notifications/${id}`);
  },

  markRead(id: string): Promise<{ cleared: number }> {
    return request<{ cleared: number }>(`/v1/notifications/${id}/read`, {
      method: "POST",
    });
  },

  markAllRead(): Promise<{ cleared: number }> {
    return request<{ cleared: number }>("/v1/notifications/read-all", {
      method: "POST",
    });
  },
};

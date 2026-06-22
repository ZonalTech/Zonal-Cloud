import type {
  AdminApp,
  AdminOrganization,
  App,
  AppType,
  AuditLog,
  BulkMigrateResult,
  DeploymentError,
  DeploymentLog,
  InfraSettings,
  Metrics,
  Organization,
  Performance,
  PerformanceFilters,
  Quota,
  ResourceUsage,
  SystemInfo,
  User,
  UserRole,
} from "../types";

// API base resolution order:
//   1. window.__ZONAL_CONFIG__.apiUrl — injected at container runtime by
//      nginx's entrypoint from the ZONAL_API_URL env var, so ONE prebuilt
//      image serves any domain (set by the operator / zonalctl).
//   2. VITE_API_URL — baked at build time (local dev / source builds).
//   3. localhost fallback for `npm run dev`.
declare global {
  interface Window {
    __ZONAL_CONFIG__?: { apiUrl?: string; dashboardUrl?: string; mailUrl?: string };
  }
}

const BASE =
  (typeof window !== "undefined" && window.__ZONAL_CONFIG__?.apiUrl) ||
  (import.meta.env.VITE_API_URL as string | undefined) ||
  "http://localhost:4000";

// Public URL of the user-facing dashboard app. Same resolution order as the
// API base: runtime config (window.__ZONAL_CONFIG__.dashboardUrl) → build-time
// VITE_DASHBOARD_URL → localhost dev default.
export function getDashboardUrl(): string {
  return (
    (typeof window !== "undefined" && window.__ZONAL_CONFIG__?.dashboardUrl) ||
    (import.meta.env.VITE_DASHBOARD_URL as string | undefined) ||
    "http://localhost:5173"
  );
}

// Public URL of the managed-mail (Stalwart) admin/web UI, injected at runtime.
// Empty string when mail isn't configured, so callers can hide the link.
export function getMailUrl(): string {
  return (
    (typeof window !== "undefined" && window.__ZONAL_CONFIG__?.mailUrl) ||
    (import.meta.env.VITE_MAIL_URL as string | undefined) ||
    ""
  );
}

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

  changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ token: string; user: User }> {
    return request("/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
};

export const adminApi = {
  getUsers(): Promise<{ users: User[] }> {
    return request("/v1/admin/users");
  },

  suspendUser(id: string): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/suspend`, { method: "POST" });
  },

  unsuspendUser(id: string): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/unsuspend`, { method: "POST" });
  },

  updateUser(
    id: string,
    payload: { username?: string; email?: string; organizationId?: string; password?: string },
  ): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  },

  deleteUser(id: string): Promise<{ ok: boolean }> {
    return request(`/v1/admin/users/${id}`, { method: "DELETE" });
  },

  setUserRole(id: string, role: UserRole): Promise<{ user: User }> {
    return request(`/v1/admin/users/${id}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    });
  },

  // Mint a short-lived session to log in to the dashboard AS this user.
  impersonateUser(
    id: string,
  ): Promise<{ token: string; user: User; dashboardUrl: string }> {
    return request(`/v1/admin/users/${id}/impersonate`, { method: "POST" });
  },

  getOrganizations(): Promise<{ organizations: AdminOrganization[] }> {
    return request("/v1/admin/organizations");
  },

  createOrganization(payload: {
    name: string;
    slug?: string;
  }): Promise<{ organization: Organization }> {
    return request("/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  setOrganizationQuota(id: string, quota: Partial<Quota>): Promise<{ quota: Quota }> {
    return request(`/v1/admin/organizations/${id}/quota`, {
      method: "POST",
      body: JSON.stringify(quota),
    });
  },

  getApps(): Promise<{ apps: AdminApp[] }> {
    return request("/v1/admin/apps");
  },

  stopApp(id: string): Promise<{ app: App }> {
    return request(`/v1/admin/apps/${id}/stop`, { method: "POST" });
  },

  // Platform-wide security patch + migrate: force a clean rebuild ("migrate") of
  // every deployable site. Optionally scope to a single app type. Superadmin-only.
  bulkMigrate(type?: AppType): Promise<BulkMigrateResult> {
    return request(`/v1/admin/apps/bulk-migrate`, {
      method: "POST",
      body: JSON.stringify(type ? { type } : {}),
    });
  },

  // Run a curated bench maintenance action against a Frappe app's container.
  frappeBench(
    id: string,
    action: string,
  ): Promise<{ action: string; output: string; exitCode: number }> {
    return request(`/v1/admin/apps/${id}/frappe/bench`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  },

  // Run a single read-only SQL query against a Frappe app's database.
  frappeSql(
    id: string,
    query: string,
  ): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean }> {
    return request(`/v1/admin/apps/${id}/frappe/sql`, {
      method: "POST",
      body: JSON.stringify({ query }),
    });
  },

  // Install or uninstall a Frappe app module on the live site.
  frappeSiteApp(
    id: string,
    action: "install" | "uninstall",
    appName: string,
  ): Promise<{ action: string; appName: string; output: string; exitCode: number }> {
    return request(`/v1/admin/apps/${id}/frappe/site-app`, {
      method: "POST",
      body: JSON.stringify({ action, appName }),
    });
  },

  getMetrics(): Promise<Metrics> {
    return request("/v1/admin/metrics");
  },

  // Deployment performance for the charts. Defaults to all sites; pass organizationId
  // (customer) and/or appId (site) to scope it, and days for the window.
  getPerformance(filters: PerformanceFilters = {}): Promise<Performance> {
    const qs = new URLSearchParams();
    if (filters.organizationId) qs.set("organizationId", filters.organizationId);
    if (filters.appId) qs.set("appId", filters.appId);
    if (filters.minutes) qs.set("minutes", String(filters.minutes));
    else if (filters.days) qs.set("days", String(filters.days));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/v1/admin/performance${suffix}`);
  },

  // Host capacity: CPU cores, memory, disk, active users.
  getSystem(): Promise<SystemInfo> {
    return request("/v1/admin/system");
  },

  // Live resource usage, uptime and responsiveness per site and per customer.
  getResources(filters: { organizationId?: string; appId?: string } = {}): Promise<ResourceUsage> {
    const qs = new URLSearchParams();
    if (filters.organizationId) qs.set("organizationId", filters.organizationId);
    if (filters.appId) qs.set("appId", filters.appId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/v1/admin/resources${suffix}`);
  },

  getAuditLogs(): Promise<{ logs: AuditLog[] }> {
    return request("/v1/admin/audit");
  },

  aiStatus(): Promise<{ enabled: boolean }> {
    return request("/v1/admin/ai/status");
  },

  getSettings(): Promise<{ agentApiUrl: string; agentTokenSet: boolean }> {
    return request("/v1/admin/settings");
  },

  updateSettings(payload: {
    agentApiUrl?: string;
    agentToken?: string;
  }): Promise<{ agentApiUrl: string; agentTokenSet: boolean }> {
    return request("/v1/admin/settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  getInfraSettings(): Promise<InfraSettings> {
    return request("/v1/admin/infra-settings");
  },

  updateInfraSettings(payload: {
    mariadbAdminHost?: string;
    mariadbAdminPort?: number;
    mariadbAdminUser?: string;
    mariadbAdminPassword?: string;
    appMariadbHost?: string;
    appMariadbPort?: number;
    frappeRedisUrl?: string;
    frappeBaseImage?: string;
  }): Promise<InfraSettings> {
    return request("/v1/admin/infra-settings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  listAgentTokens(): Promise<{
    tokens: Array<{ id: string; name: string; lastUsedAt: string | null; createdAt: string }>;
  }> {
    return request("/v1/admin/agent-tokens");
  },

  createAgentToken(name: string): Promise<{ id: string; name: string; token: string }> {
    return request("/v1/admin/agent-tokens", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  },

  revokeAgentToken(id: string): Promise<{ ok: boolean }> {
    return request(`/v1/admin/agent-tokens/${id}`, { method: "DELETE" });
  },

  generateMcpConfig(): Promise<Record<string, unknown>> {
    return request("/v1/admin/mcp-config", { method: "POST" });
  },

  analyzeApp(
    id: string,
  ): Promise<{ deploymentId: string; status: string; analysis: string }> {
    return request(`/v1/admin/apps/${id}/analyze`, { method: "POST" });
  },

  // Deployment failures across all orgs (cross-tenant), for the Errors page.
  getDeploymentErrors(): Promise<{ notifications: DeploymentError[] }> {
    return request("/v1/admin/errors");
  },

  getDeploymentLog(deploymentId: string): Promise<DeploymentLog> {
    return request(`/v1/admin/deployments/${deploymentId}/log`);
  },

  // Run the AI analysis over a deployment's log.
  analyzeDeployment(
    deploymentId: string,
  ): Promise<{ deploymentId: string; status: string; analysis: string }> {
    return request(`/v1/admin/deployments/${deploymentId}/analyze`, { method: "POST" });
  },

  // ---- Platform ops (zone CLI) ----
  listOpsCommands(): Promise<{ commands: OpsCommand[] }> {
    return request("/v1/admin/ops/commands");
  },

  runOpsCommand(key: string): Promise<OpsResult> {
    return request(`/v1/admin/ops/run/${encodeURIComponent(key)}`, {
      method: "POST",
    });
  },

  // ---- DNS (cross-tenant) ----
  listDnsZones(): Promise<AdminDnsZone[]> {
    return request("/v1/admin/dns/zones");
  },

  listDnsRecords(zone: string): Promise<DnsRecord[]> {
    return request(`/v1/admin/dns/zones/${encodeURIComponent(zone)}/records`);
  },

  deleteDnsZone(zone: string): Promise<{ deleted: boolean }> {
    return request(`/v1/admin/dns/zones/${encodeURIComponent(zone)}`, {
      method: "DELETE",
    });
  },
};

// ---- Platform ops (zone CLI) types ----
export interface OpsCommand {
  key: string;
  label: string;
  mutating: boolean;
}

export interface OpsResult {
  command: string;
  output: string;
  exitCode: number;
}

// ---- DNS types (admin / cross-tenant) ----
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

export interface AdminDnsZone {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  organizationId: string;
  organizationName: string;
  nameservers: string[];
}

export interface DnsRecord {
  name: string;
  type: DnsRecordType;
  ttl: number;
  records: string[];
  managed?: boolean;
}

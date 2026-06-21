export type AppStatus = "idle" | "building" | "live" | "failed" | "stopped";
export type DeploymentStatus = "queued" | "building" | "live" | "failed";
export type UserRole = "user" | "admin" | "superadmin";
export type UserStatus = "active" | "suspended";
export type OrganizationStatus = "active" | "suspended";
export type AppSource = "git" | "upload";
export type AppType = "static" | "node" | "fullstack" | "nodered" | "frappe";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro";
  status: OrganizationStatus;
  createdAt: string;
  // When the subscription lapses (ISO string). Null/absent = no expiry.
  subscriptionExpiresAt?: string | null;
  // Last observed activity (ISO string). Null/absent = never seen active.
  lastActiveAt?: string | null;
}

// Organization as returned by the admin list, enriched with its quota and
// member/resource counts for the detail pane.
export interface AdminOrganization extends Organization {
  quota?: Quota | null;
  counts?: { users: number; projects: number; apps: number };
}

export interface User {
  id: string;
  organizationId: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  // When true, the user must set a new password before using the panel
  // (default seeded admin, or an admin-reset password).
  mustChangePassword?: boolean;
  createdAt: string;
}

export interface Quota {
  id: string;
  organizationId: string;
  maxApps: number;
  // cpu/memory/disk are resource strings (e.g. "1", "512m", "2g") per the API contract
  cpu: string;
  memory: string;
  disk: string;
  buildMinutes: number;
  maxConcurrentDeploys: number;
}

export interface App {
  id: string;
  projectId: string;
  name: string;
  type: AppType;
  source: AppSource;
  repoUrl?: string;
  branch?: string;
  subdomain: string;
  buildCmd?: string;
  outputDir?: string;
  status: AppStatus;
  createdAt?: string;
}

export interface Deployment {
  id: string;
  appId: string;
  ref?: string;
  status: DeploymentStatus;
  imageRef?: string;
  logsRef?: string;
  createdAt: string;
}

export interface DeployToken {
  id: string;
  appId: string;
  name: string;
  lastUsedAt?: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  createdAt: string;
}

// A deployment-failure notification, shown on the admin Errors page. Includes
// the recipient's email (admin is cross-tenant) and the metadata captured at
// failure time (step, reason, appId, deploymentId).
export interface DeploymentError {
  id: string;
  userId: string;
  organizationId: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  user?: { email: string } | null;
}

export interface DeploymentLog {
  deploymentId: string;
  appName: string;
  status: string;
  ref: string | null;
  createdAt: string;
  lines: string[];
}

export interface Metrics {
  users: number;
  organizations: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

// App as returned by the admin /apps list, which includes the owning project
// so the UI can group/filter sites by customer (organization).
export interface AdminApp extends App {
  project?: {
    organizationId: string;
    name: string;
    userId: string;
    user?: { email: string; username: string };
  };
}

// One bucket in the deployment time series. `date` is an ISO date (YYYY-MM-DD)
// for day buckets, or a full ISO timestamp for minute buckets — see Performance.bucket.
export interface PerformancePoint {
  date: string;
  total: number;
  live: number;
  failed: number;
}

// Aggregated deployment performance for the admin charts.
export interface Performance {
  windowDays: number;
  windowMinutes: number;
  bucket: "minute" | "day";
  stepMinutes: number;
  since: string;
  scope: { organizationId: string | null; appId: string | null; sites: number };
  totals: {
    deployments: number;
    live: number;
    failed: number;
    queued: number;
    building: number;
    successRate: number | null;
  };
  series: PerformancePoint[];
  deploymentStatus: Record<DeploymentStatus, number>;
  appStatus: Partial<Record<AppStatus, number>>;
  topSites: { appId: string; name: string; deployments: number }[];
}

export interface PerformanceFilters {
  organizationId?: string;
  appId?: string;
  days?: number;
  minutes?: number;
}

// Host-level capacity + platform user counts.
export interface SystemInfo {
  hostname: string;
  cores: number;
  loadAvg: number[];
  memory: { total: number; free: number; used: number };
  disk: { total: number; free: number; used: number } | null;
  users: { active: number; total: number };
  uptimeSeconds: number;
}

// Live resource usage / uptime / responsiveness per site.
export interface ResourceSite {
  appId: string;
  name: string;
  subdomain: string;
  organizationId: string | null;
  customer: string | null;
  status: AppStatus;
  up: boolean;
  cpuPct: number | null;
  memBytes: number | null;
  memLimitBytes: number | null;
  uptimeSeconds: number | null;
  latencyMs: number | null;
  quota: { cpu: string; memory: string; disk: string } | null;
}

export interface ResourceCustomer {
  organizationId: string;
  customer: string;
  sites: number;
  sitesUp: number;
  cpuPct: number;
  memBytes: number;
  avgLatencyMs: number | null;
}

export interface ResourceUsage {
  generatedAt: string;
  scope: { organizationId: string | null; appId: string | null; sites: number };
  totals: { sites: number; sitesUp: number; cpuPct: number; memBytes: number };
  sites: ResourceSite[];
  byCustomer: ResourceCustomer[];
  fastest: ResourceSite[];
  slowest: ResourceSite[];
}

export interface InfraSettings {
  mariadbAdminHost: string;
  mariadbAdminPort: number;
  mariadbAdminUser: string;
  mariadbAdminPasswordSet: boolean;
  appMariadbHost: string;
  appMariadbPort: number;
  frappeRedisUrl: string;
  frappeBaseImage: string;
}

// Result of a platform-wide security-patch + migrate wave (forced clean rebuild
// of every deployable site, optionally scoped to one app type).
export interface BulkMigrateResult {
  total: number;
  queued: number;
  skipped: number;
  failed: number;
  deployments: Array<{ appId: string; name: string; deploymentId: string }>;
  skippedSites: Array<{ appId: string; name: string; status: AppStatus; reason: string }>;
  failures: Array<{ appId: string; name: string; error: string }>;
}

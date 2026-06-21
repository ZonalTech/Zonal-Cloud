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
}

export interface User {
  id: string;
  organizationId: string;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface Quota {
  id: string;
  organizationId: string;
  maxApps: number;
  cpu: number;
  memory: number;
  disk: number;
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
  // Public URL the deployed app is reachable at (built by the API from the
  // subdomain + BASE_DOMAIN + APP_HTTP_PORT).
  url?: string;
  createdAt?: string;
  // Email (or username) of the app's creator. Only populated by the detail
  // endpoint (getApp), not the list.
  createdBy?: string | null;
  // For Frappe apps: the framework version the bench is built on
  // (frappe/frappe branch, e.g. "version-15").
  frappeVersion?: string | null;
  // For Node-RED apps: the host port this instance is published on (container
  // :1880 mapped to this port on the Docker host).
  noderedPort?: number | null;
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
  actorUserId: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface Metrics {
  users: number;
  organizations: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

export type NotificationType = "account_impersonated" | "deployment_failed";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  metadata?: Record<string, unknown>;
  // null/absent = unread; an ISO timestamp once the user has cleared it.
  readAt?: string | null;
  createdAt: string;
}

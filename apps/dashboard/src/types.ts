export type AppStatus = "idle" | "building" | "live" | "failed" | "stopped";
export type DeploymentStatus = "queued" | "building" | "live" | "failed";
export type UserRole = "user" | "admin" | "superadmin";
export type UserStatus = "active" | "suspended";
export type OrgStatus = "active" | "suspended";
export type AppSource = "git" | "upload";
export type AppType = "static" | "node" | "fullstack" | "nodered";

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: "free" | "pro";
  status: OrgStatus;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

export interface Quota {
  id: string;
  orgId: string;
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
  orgs: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

// Shared TypeScript types for Zonal Cloud.
// Authored by the backend agent. Frontends import these.
// Do not add emojis or decorative comments.

// ---- Enums ----

export type OrgPlan = 'free' | 'pro';
export type OrgStatus = 'active' | 'suspended';

export type UserRole = 'user' | 'admin' | 'superadmin';
export type UserStatus = 'active' | 'suspended';

export type AppType = 'static' | 'node' | 'fullstack' | 'nodered';
export type AppSource = 'git' | 'upload';
export type AppStatus = 'idle' | 'building' | 'live' | 'failed' | 'stopped';

export type DeploymentStatus = 'queued' | 'building' | 'live' | 'failed';

// ---- Entities ----

export interface Org {
  id: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: OrgStatus;
  createdAt: string;
}

/** passwordHash is omitted from all API responses */
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
  cpu: string;
  memory: string;
  disk: string;
  buildMinutes: number;
  maxConcurrentDeploys: number;
}

export interface Project {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  slug: string;
}

export interface App {
  id: string;
  projectId: string;
  name: string;
  type: AppType;
  source: AppSource;
  repoUrl: string | null;
  branch: string | null;
  subdomain: string;
  buildCmd: string | null;
  outputDir: string | null;
  status: AppStatus;
}

export interface Deployment {
  id: string;
  appId: string;
  ref: string | null;
  status: DeploymentStatus;
  imageRef: string | null;
  logsRef: string | null;
  createdAt: string;
}

export interface EnvVar {
  id: string;
  appId: string;
  key: string;
  isSecret: boolean;
}

export interface DeployToken {
  id: string;
  appId: string;
  name: string;
  lastUsedAt: string | null;
}

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  target: string;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

// ---- Request types ----

export interface RegisterRequest {
  email: string;
  password: string;
  orgName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface CreateAppRequest {
  name: string;
  source: AppSource;
  repoUrl?: string;
  branch?: string;
  buildCmd?: string;
  outputDir?: string;
  projectId?: string;
}

export interface DeployRequest {
  ref?: string;
}

export interface CreateTokenRequest {
  name: string;
}

export interface UpdateQuotaRequest {
  maxApps?: number;
  cpu?: string;
  memory?: string;
  disk?: string;
  buildMinutes?: number;
  maxConcurrentDeploys?: number;
}

export interface UpdateRoleRequest {
  role: UserRole;
}

// ---- Response types ----

export interface RegisterResponse {
  token: string;
  user: User;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

export interface ListAppsResponse {
  apps: App[];
}

export interface CreateAppResponse {
  app: App;
}

export interface GetAppResponse {
  app: App;
  deployments: Deployment[];
}

export interface DeployResponse {
  deployment: Deployment;
}

export interface StopAppResponse {
  app: App;
}

export interface CreateTokenResponse {
  /** Plaintext token — shown once only */
  token: string;
  id: string;
  name: string;
}

export interface ListTokensResponse {
  tokens: Pick<DeployToken, 'id' | 'name' | 'lastUsedAt'>[];
}

export interface AdminListUsersResponse {
  users: User[];
}

export interface AdminListOrgsResponse {
  orgs: Org[];
}

export interface AdminListAppsResponse {
  apps: App[];
}

export interface AdminMetrics {
  users: number;
  orgs: number;
  apps: number;
  deployments: number;
  queueDepth: number;
}

export interface AdminAuditResponse {
  logs: AuditLog[];
}

// ---- Error ----

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

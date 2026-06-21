import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { encrypt, decrypt } from '../common/encrypt.util';

const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH = 'https://github.com/login/oauth';

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
}

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  private clientId(): string {
    const id = this.config.get<string>('GITHUB_CLIENT_ID');
    if (!id) {
      throw new BadRequestException({
        code: 'GITHUB_NOT_CONFIGURED',
        message: 'GitHub OAuth is not configured on this server',
      });
    }
    return id;
  }

  private clientSecret(): string {
    const secret = this.config.get<string>('GITHUB_CLIENT_SECRET');
    if (!secret) {
      throw new BadRequestException({
        code: 'GITHUB_NOT_CONFIGURED',
        message: 'GitHub OAuth is not configured on this server',
      });
    }
    return secret;
  }

  private apiBaseUrl(): string {
    return this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:4000';
  }

  private dashboardUrl(): string {
    return this.config.get<string>('DASHBOARD_URL') ?? 'http://localhost:5173';
  }

  private callbackUrl(): string {
    return `${this.apiBaseUrl()}/v1/github/callback`;
  }

  // Build the GitHub consent URL. `state` carries a signed JWT-less payload:
  // we embed the userId HMAC'd so the callback can trust it without a session.
  buildAuthorizeUrl(userId: string): { url: string } {
    const state = this.signState(userId);
    const params = new URLSearchParams({
      client_id: this.clientId(),
      redirect_uri: this.callbackUrl(),
      scope: 'repo read:user',
      state,
      allow_signup: 'false',
    });
    return { url: `${GITHUB_OAUTH}/authorize?${params.toString()}` };
  }

  private stateSecret(): string {
    return (
      this.config.get<string>('GITHUB_STATE_SECRET') ??
      this.config.get<string>('JWT_SECRET') ??
      'change-me'
    );
  }

  private signState(userId: string): string {
    const payload = `${userId}.${Date.now()}`;
    const sig = crypto
      .createHmac('sha256', this.stateSecret())
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}.${sig}`).toString('base64url');
  }

  private verifyState(state: string): string {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
    }
    const parts = decoded.split('.');
    if (parts.length !== 3) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
    }
    const [userId, ts, sig] = parts;
    const expected = crypto
      .createHmac('sha256', this.stateSecret())
      .update(`${userId}.${ts}`)
      .digest('hex');
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'State signature mismatch' });
    }
    // State valid for 10 minutes.
    if (Date.now() - Number(ts) > 10 * 60 * 1000) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'State expired' });
    }
    return userId;
  }

  // Exchange the OAuth code for a token, persist the account, redirect target.
  async handleCallback(code: string, state: string): Promise<{ redirectTo: string }> {
    const userId = this.verifyState(state);

    const tokenRes = await fetch(`${GITHUB_OAUTH}/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId(),
        client_secret: this.clientSecret(),
        code,
        redirect_uri: this.callbackUrl(),
      }),
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenJson.access_token) {
      throw new BadRequestException({
        code: 'GITHUB_OAUTH_FAILED',
        message: tokenJson.error_description ?? 'Failed to obtain GitHub token',
      });
    }

    const accessToken = tokenJson.access_token;

    // Identify the user.
    const ghUser = await this.githubFetch<{ id: number; login: string }>(
      accessToken,
      '/user',
    );

    await this.prisma.githubAccount.upsert({
      where: { userId },
      create: {
        userId,
        githubId: String(ghUser.id),
        login: ghUser.login,
        accessToken: encrypt(accessToken),
        scope: tokenJson.scope ?? null,
      },
      update: {
        githubId: String(ghUser.id),
        login: ghUser.login,
        accessToken: encrypt(accessToken),
        scope: tokenJson.scope ?? null,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'github.connect',
      target: userId,
      metadata: { login: ghUser.login },
    });

    return { redirectTo: `${this.dashboardUrl()}/apps/new?github=connected` };
  }

  async getStatus(userId: string): Promise<{ connected: boolean; login?: string }> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { login: true },
    });
    return account ? { connected: true, login: account.login } : { connected: false };
  }

  async disconnect(userId: string): Promise<{ ok: boolean }> {
    await this.prisma.githubAccount.deleteMany({ where: { userId } });
    await this.auditService.log({
      actorUserId: userId,
      action: 'github.disconnect',
      target: userId,
    });
    return { ok: true };
  }

  async listRepos(userId: string): Promise<{ repos: GithubRepo[] }> {
    const token = await this.getToken(userId);
    const raw = await this.githubFetch<
      Array<{
        id: number;
        full_name: string;
        name: string;
        private: boolean;
        default_branch: string;
        html_url: string;
        clone_url: string;
      }>
    >(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');

    const repos: GithubRepo[] = raw.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
    }));

    return { repos };
  }

  // List the branches of a repo the connected user can access, default branch first.
  async listBranches(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<{ branches: string[]; defaultBranch: string }> {
    const token = await this.getToken(userId);

    const repoInfo = await this.githubFetch<{ default_branch: string }>(
      token,
      `/repos/${owner}/${repo}`,
    );

    const raw = await this.githubFetch<Array<{ name: string }>>(
      token,
      `/repos/${owner}/${repo}/branches?per_page=100`,
    );

    const names = raw.map((b) => b.name);
    const defaultBranch = repoInfo.default_branch;
    // Surface the default branch first so the UI can preselect it.
    const branches = [
      ...(names.includes(defaultBranch) ? [defaultBranch] : []),
      ...names.filter((n) => n !== defaultBranch),
    ];

    return { branches, defaultBranch };
  }

  // List branches of an arbitrary git repo URL via `git ls-remote --heads`.
  // No clone — just the remote ref advertisement. For github.com URLs we inject
  // the user's OAuth token (if connected) so private repos resolve too.
  async listRemoteBranches(
    userId: string,
    repoUrl: string,
  ): Promise<{ branches: string[] }> {
    const trimmed = repoUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new BadRequestException({
        code: 'BAD_REPO_URL',
        message: 'Repository URL must start with http(s)://',
      });
    }

    let authedUrl = trimmed;
    // Inject the connected token for private github.com repos.
    if (/^https:\/\/github\.com\//i.test(trimmed)) {
      const token = await this.getTokenIfConnected(userId);
      if (token) {
        authedUrl = trimmed.replace(
          /^https:\/\//i,
          `https://x-access-token:${token}@`,
        );
      }
    }

    let raw: string;
    try {
      raw = await simpleGit().listRemote(['--heads', authedUrl]);
    } catch {
      // Don't leak the token-bearing URL in the error.
      throw new BadRequestException({
        code: 'GIT_LS_REMOTE_FAILED',
        message:
          'Could not read branches from that repository. Check the URL and access.',
      });
    }

    // Each line: "<sha>\trefs/heads/<branch>"
    const branches = raw
      .split('\n')
      .map((line) => line.split('\t')[1])
      .filter((ref): ref is string => Boolean(ref) && ref.startsWith('refs/heads/'))
      .map((ref) => ref.replace('refs/heads/', ''));

    // Surface common defaults first for nicer UX.
    const preferred = ['main', 'master'];
    branches.sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });

    return { branches };
  }

  // List the available Frappe FRAMEWORK versions from frappe/frappe, for the
  // version selector. Returns the `version-NN` branches >= 15 (newest first) so
  // future majors (16, 17, …) appear automatically, plus "develop" as the
  // bleeding-edge nightly. Each entry carries a friendly label.
  async listFrappeVersions(): Promise<{
    versions: Array<{ value: string; label: string }>;
  }> {
    let branches: string[] = [];
    try {
      const raw = await simpleGit().listRemote([
        '--heads',
        'https://github.com/frappe/frappe',
      ]);
      branches = raw
        .split('\n')
        .map((line) => line.split('\t')[1])
        .filter((ref): ref is string => Boolean(ref) && ref.startsWith('refs/heads/'))
        .map((ref) => ref.replace('refs/heads/', ''));
    } catch {
      // Network/registry hiccup — fall back to a sane static list so the UI
      // still works. version-15 is the current stable floor.
      branches = ['version-15', 'develop'];
    }

    // Keep only version-NN branches with NN >= 15, sorted newest first.
    const versionNums = branches
      .map((b) => /^version-(\d+)$/.exec(b))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => Number(m[1]))
      .filter((n) => n >= 15)
      .sort((a, b) => b - a);

    const versions: Array<{ value: string; label: string }> = [];
    // "develop" is Frappe's nightly/bleeding-edge branch — list it first as the
    // latest, only if it actually exists on the remote.
    if (branches.includes('develop')) {
      versions.push({ value: 'develop', label: 'develop (nightly)' });
    }
    versionNums.forEach((n, i) => {
      versions.push({
        value: `version-${n}`,
        // The highest numbered stable version is the latest stable.
        label: i === 0 ? `version-${n} (latest stable)` : `version-${n}`,
      });
    });

    // Guarantee at least version-15 is offered.
    if (!versions.some((v) => v.value === 'version-15')) {
      versions.push({ value: 'version-15', label: 'version-15' });
    }

    return { versions };
  }

  // Returns the decrypted access token for a connected user, or throws.
  async getToken(userId: string): Promise<string> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    if (!account) {
      throw new ForbiddenException({
        code: 'GITHUB_NOT_CONNECTED',
        message: 'GitHub account not connected',
      });
    }
    return decrypt(account.accessToken);
  }

  async getTokenIfConnected(userId: string): Promise<string | null> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    return account ? decrypt(account.accessToken) : null;
  }

  // Install a push webhook on the repo. Returns the hook id + generated secret.
  async createWebhook(
    userId: string,
    repoFullName: string,
    appId: string,
  ): Promise<{ hookId: string; secret: string }> {
    const token = await this.getToken(userId);
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookUrl = `${this.apiBaseUrl()}/v1/github/webhook/${appId}`;

    const hook = await this.githubFetch<{ id: number }>(
      token,
      `/repos/${repoFullName}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      },
    );

    return { hookId: String(hook.id), secret };
  }

  async deleteWebhook(
    userId: string,
    repoFullName: string,
    hookId: string,
  ): Promise<void> {
    const token = await this.getTokenIfConnected(userId);
    if (!token) return;
    try {
      await this.githubFetch(token, `/repos/${repoFullName}/hooks/${hookId}`, {
        method: 'DELETE',
      });
    } catch {
      // Hook may already be gone — ignore.
    }
  }

  // Verify the X-Hub-Signature-256 header against the stored per-app secret.
  verifySignature(secret: string, payload: Buffer, signatureHeader?: string): boolean {
    if (!signatureHeader) return false;
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Handle an incoming push webhook: verify signature, find the app, return the
  // ref to deploy (caller enqueues the deploy via AppsService to avoid a cycle).
  async resolveWebhookDeploy(
    appId: string,
    event: string | undefined,
    payload: Buffer,
    signature: string | undefined,
  ): Promise<{ appId: string; ref: string } | null> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { id: true, webhookSecret: true, branch: true },
    });
    if (!app || !app.webhookSecret) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    if (!this.verifySignature(app.webhookSecret, payload, signature)) {
      throw new UnauthorizedException({
        code: 'BAD_SIGNATURE',
        message: 'Webhook signature verification failed',
      });
    }

    // GitHub pings the hook on creation — acknowledge without deploying.
    if (event === 'ping') return null;
    if (event !== 'push') return null;

    const parsed = JSON.parse(payload.toString('utf8')) as { ref?: string };
    const pushedBranch = parsed.ref?.replace('refs/heads/', '');

    // Only deploy when the push targets the app's tracked branch.
    if (pushedBranch && app.branch && pushedBranch !== app.branch) {
      return null;
    }

    return { appId: app.id, ref: pushedBranch ?? app.branch ?? 'main' };
  }

  private async githubFetch<T>(
    token: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'zonal-cloud',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (res.status === 401) {
      throw new ForbiddenException({
        code: 'GITHUB_TOKEN_INVALID',
        message: 'GitHub token rejected — please reconnect',
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new BadRequestException({
        code: 'GITHUB_API_ERROR',
        message: `GitHub API error (${res.status}): ${text.slice(0, 200)}`,
      });
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import * as Docker from 'dockerode';
import * as dns from 'dns/promises';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import {
  maintenanceContainerCmd,
  MAINTENANCE_IMAGE,
} from './maintenance-page';
import { CreateAppDto } from './dto/create-app.dto';
import { UpdateAppDto } from './dto/update-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { AddDomainDto } from './dto/add-domain.dto';
import { AddFrappeAppDto, SetFrappeVersionDto } from './dto/frappe-app.dto';
import { AddNodeRedUserDto, UpdateNodeRedUserDto } from './dto/nodered-user.dto';
import { buildAppUrl } from '../common/app-url.util';
import { appUploadDir } from '../common/upload-path.util';
import { encrypt, decrypt } from '../common/encrypt.util';
import {
  noderedVolumeName,
  renderNodeRedSettings,
  hashNodeRedPassword,
  NODERED_DATA_DIR,
  NODERED_UID,
  NODERED_GID,
} from './nodered';
import { MariadbProvisionService } from '../database/mariadb-provision.service';
import { Observable, Subject } from 'rxjs';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40);
}

@Injectable()
export class AppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly logStore: LogStoreService,
    private readonly auditService: AuditService,
    private readonly mariadbProvision: MariadbProvisionService,
  ) {}

  async listApps(userId: string, organizationId: string) {
    // Find all projects in the org, then all apps in those projects
    const apps = await this.prisma.app.findMany({
      where: {
        project: {
          organizationId,
        },
      },
      include: {
        project: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { project: { name: 'asc' } },
    });
    return {
      apps: apps.map((a) => ({
        ...a,
        // Every app type — Node-RED included — is routed by Traefik on its
        // subdomain, so the public URL is the clean subdomain (no host port).
        url: buildAppUrl(a.subdomain),
      })),
    };
  }

  async createApp(userId: string, organizationId: string, dto: CreateAppDto) {
    // Get or create a default project for the org/user
    let project = await this.prisma.project.findFirst({
      where: { organizationId, userId },
    });

    if (dto.projectId) {
      project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
      if (!project || project.organizationId !== organizationId) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
      }
    }

    if (!project) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organization: true } });
      const orgSlug = user?.organization?.slug ?? 'default';
      let projectSlug = `${orgSlug}-default`;

      const existing = await this.prisma.project.findUnique({ where: { slug: projectSlug } });
      if (existing) projectSlug = `${projectSlug}-${Date.now()}`;

      project = await this.prisma.project.create({
        data: {
          organizationId,
          userId,
          name: 'Default',
          slug: projectSlug,
        },
      });
    }

    // Generate unique subdomain
    const baseSlug = slugify(dto.name);
    let subdomain = baseSlug;
    const existing = await this.prisma.app.findUnique({ where: { subdomain } });
    if (existing) subdomain = `${baseSlug}-${uuidv4().substring(0, 6)}`;

    const isFrappe = dto.type === 'frappe';
    const isNodeRed = dto.type === 'nodered';
    // Frappe apps: the site name MUST equal the served hostname (Frappe routes
    // by Host header), so it mirrors the subdomain. Generate a random admin
    // password now and store it encrypted; it is decrypted and injected only at
    // deploy time. The named volume holds the bench `sites/` dir across redeploys.
    const frappeAdminPassword = isFrappe
      ? crypto.randomBytes(18).toString('base64url')
      : null;

    // Node-RED apps: a default "admin" editor account is seeded so the instance
    // is locked from the first deploy. We generate the password once, hash it
    // for storage, and return the plaintext to the caller so it can be shown to
    // the user a single time (it is never recoverable afterward).
    const noderedAdminPassword = isNodeRed
      ? crypto.randomBytes(12).toString('base64url')
      : null;

    // Node-RED is reached publicly through Traefik on its subdomain (like every
    // other app type) and over the Docker network by container name internally,
    // so no host port is published — noderedPort stays null.
    const noderedPort = null;

    const app = await this.prisma.app.create({
      data: {
        projectId: project.id,
        name: dto.name,
        type: dto.type ?? 'static',
        source: dto.source,
        repoUrl: dto.repoUrl ?? null,
        branch: dto.branch ?? 'main',
        subdomain,
        buildCmd: dto.buildCmd ?? null,
        outputDir: dto.outputDir ?? 'dist',
        status: 'idle',
        githubRepoFullName: dto.githubRepoFullName ?? null,
        frappeSiteName: isFrappe ? subdomain : null,
        frappeAdminPasswordEnc: frappeAdminPassword
          ? encrypt(frappeAdminPassword)
          : null,
        frappeVolumeName: isFrappe ? `zonal-frappe-${subdomain}` : null,
        frappeVersion: isFrappe ? dto.frappeVersion?.trim() || 'version-15' : null,
        noderedVolumeName: isNodeRed ? noderedVolumeName(subdomain) : null,
        noderedPort,
        // Store the seeded admin password encrypted so "Login as administrator"
        // can sign the user into the editor without them re-entering it.
        noderedAdminPasswordEnc:
          isNodeRed && noderedAdminPassword
            ? encrypt(noderedAdminPassword)
            : null,
      },
    });

    // Seed the default Node-RED admin editor account.
    if (isNodeRed && noderedAdminPassword) {
      await this.prisma.nodeRedUser.create({
        data: {
          appId: app.id,
          username: 'admin',
          passwordHash: hashNodeRedPassword(noderedAdminPassword),
          permission: '*',
        },
      });
    }

    // For Frappe apps, record the first bench app (if supplied) so the first
    // deploy fetches + installs it. More can be added later from the app page.
    if (isFrappe && dto.frappeGitUrl?.trim()) {
      await this.prisma.frappeApp.create({
        data: {
          appId: app.id,
          gitUrl: dto.frappeGitUrl.trim(),
          branch: dto.frappeBranch?.trim() || null,
          position: 0,
          installed: false,
        },
      });
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.create',
      target: app.id,
      metadata: { name: app.name, source: app.source, type: app.type },
    });

    // Stand up a maintenance placeholder so the app's URL shows a friendly
    // "being set up" page instead of a 404 / default nginx welcome until the
    // first real deploy swaps this container out. Best-effort: a failure here
    // must not block app creation.
    await this.startMaintenanceContainer(app.subdomain);

    // Surface the seeded Node-RED admin password to the caller exactly once —
    // it is only stored hashed and cannot be recovered later.
    return { app, noderedAdminPassword: noderedAdminPassword ?? undefined };
  }

  async getApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    // The creator-identity lookup and the deployment history are independent, so
    // run them concurrently rather than serially (one less round-trip of latency).
    const [project, deployments] = await Promise.all([
      // The app's creator is the owner of its project; surface their identity for
      // the dashboard's "created by" line.
      this.prisma.project.findUnique({
        where: { id: app.projectId },
        select: { user: { select: { email: true, username: true } } },
      }),
      this.prisma.deployment.findMany({
        where: { appId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      app: {
        ...app,
        // Routed by Traefik on the subdomain for all types (Node-RED included).
        url: buildAppUrl(app.subdomain),
        createdBy: project?.user?.email ?? project?.user?.username ?? null,
      },
      deployments,
    };
  }

  // Builds the data the controller needs to log the dashboard user into the
  // deployed app as its administrator.
  //
  // For Frappe apps we hold the generated Administrator password (encrypted), so
  // we can establish a real session: the controller serves a tiny auto-submitting
  // form that POSTs usr/pwd to the site's /api/method/login. The browser submits
  // it cross-origin, so Frappe sets the `sid` cookie on the *app's* origin (not
  // the API's) and the user lands authenticated. The password travels in a POST
  // body — never the URL — and the form page is served only to an authenticated,
  // org-scoped dashboard user.
  //
  // For every other app type we have no stored credentials, so this degrades to
  // a plain redirect to the app's conventional admin/login path.
  async getAdminLogin(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    // All app types — Node-RED included — are routed by Traefik on the
    // subdomain, so the base URL is the clean subdomain (no host port).
    const base = buildAppUrl(app.subdomain).replace(/\/$/, '');

    if (app.type === 'frappe' && app.frappeAdminPasswordEnc) {
      await this.auditService.log({
        action: 'app.admin_login',
        target: app.id,
        metadata: { subdomain: app.subdomain },
      });
      return {
        mode: 'frappe' as const,
        loginUrl: `${base}/api/method/login`,
        redirectUrl: `${base}/app`,
        usr: 'Administrator',
        pwd: decrypt(app.frappeAdminPasswordEnc),
      };
    }

    // Node-RED: exchange the stored admin credentials for an editor access token
    // (server-side), then hand the browser a URL with ?access_token=… — the
    // editor reads it, stores it in localStorage and lands signed in as
    // administrator. The password never travels to the browser.
    if (app.type === 'nodered' && app.noderedAdminPasswordEnc) {
      const token = await this.noderedAccessToken(
        app.subdomain,
        'admin',
        decrypt(app.noderedAdminPasswordEnc),
      );
      await this.auditService.log({
        action: 'app.admin_login',
        target: app.id,
        metadata: { subdomain: app.subdomain },
      });
      return {
        mode: 'redirect' as const,
        redirectUrl: `${base}/?access_token=${encodeURIComponent(token)}`,
      };
    }

    // No managed credentials — send the user to the app's login surface. For
    // Node-RED the editor is served at the root and presents its own adminAuth
    // login form, so the bare base URL is the right target.
    const path = app.type === 'fullstack' ? '/login' : '/';
    return { mode: 'redirect' as const, redirectUrl: `${base}${path}` };
  }

  // Exchange Node-RED editor credentials for an access token via the instance's
  // /auth/token endpoint. Node-RED is no longer published on a host port — it's
  // routed by Traefik on its subdomain — and the API runs on the Docker HOST,
  // so it cannot resolve the container name (zonal_net-internal DNS). We reach
  // the instance the same way the browser does: through Traefik.
  //
  // The HTTP request goes to the Traefik HTTP entrypoint (NODERED_TRAEFIK_ORIGIN,
  // default http://127.0.0.1 — Traefik owns :80 on this host) with the Host
  // header set to the app's public hostname so Traefik routes it to the right
  // instance. Throws a friendly error if unreachable or the credentials are stale.
  private async noderedAccessToken(
    subdomain: string,
    username: string,
    password: string,
  ): Promise<string> {
    const body = new URLSearchParams({
      client_id: 'node-red-editor',
      grant_type: 'password',
      scope: '*',
      username,
      password,
    }).toString();

    // Public URL Traefik routes to this instance (e.g. http://nodered.localhost
    // [:port]). Its hostname becomes the Host header; the origin Traefik listens
    // on is NODERED_TRAEFIK_ORIGIN (defaults to the public URL itself, which is
    // correct whenever Traefik's entrypoint host:port match the public URL).
    const publicUrl = new URL(buildAppUrl(subdomain));
    const origin = (
      process.env.NODERED_TRAEFIK_ORIGIN ?? publicUrl.origin
    ).replace(/\/$/, '');

    let res: Response;
    try {
      res = await fetch(`${origin}/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Route by the app's public hostname even when hitting Traefik by IP.
          Host: publicUrl.host,
        },
        body,
      });
    } catch {
      throw new BadRequestException({
        code: 'NODERED_UNREACHABLE',
        message:
          'Could not reach the Node-RED instance. Make sure it is deployed and running, then try again.',
      });
    }
    if (!res.ok) {
      throw new BadRequestException({
        code: 'NODERED_AUTH_FAILED',
        message:
          'Could not sign in to Node-RED with the stored admin credentials. Reset the admin password and try again.',
      });
    }
    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) {
      throw new BadRequestException({
        code: 'NODERED_AUTH_FAILED',
        message: 'Node-RED did not return an access token.',
      });
    }
    return data.access_token;
  }

  // ---- Frappe bench apps (type = frappe) ----

  // List the git apps configured on a Frappe app's bench (in install order).
  async listFrappeApps(organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type !== 'frappe') {
      throw new BadRequestException({
        code: 'NOT_FRAPPE_APP',
        message: 'This app is not a Frappe app',
      });
    }
    const apps = await this.prisma.frappeApp.findMany({
      where: { appId },
      orderBy: { position: 'asc' },
    });
    return { frappeApps: apps };
  }

  // Add a git app to a Frappe app's bench. It is fetched (bench get-app) and
  // installed on the site on the NEXT deploy — adding it here just records it
  // and flags that a rebuild is needed. Returns the created record.
  async addFrappeApp(
    userId: string,
    organizationId: string,
    appId: string,
    dto: AddFrappeAppDto,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type !== 'frappe') {
      throw new BadRequestException({
        code: 'NOT_FRAPPE_APP',
        message: 'This app is not a Frappe app',
      });
    }

    const gitUrl = dto.gitUrl.trim();
    if (!/^(https?:\/\/|git@).+/.test(gitUrl)) {
      throw new BadRequestException({
        code: 'INVALID_GIT_URL',
        message: 'Provide a valid git URL (https:// or git@).',
      });
    }

    const existing = await this.prisma.frappeApp.findFirst({
      where: { appId, gitUrl },
    });
    if (existing) {
      throw new ConflictException({
        code: 'FRAPPE_APP_EXISTS',
        message: 'That app is already on this bench.',
      });
    }

    const count = await this.prisma.frappeApp.count({ where: { appId } });
    const created = await this.prisma.frappeApp.create({
      data: {
        appId,
        gitUrl,
        branch: dto.branch?.trim() || null,
        appName: dto.appName?.trim() || null,
        position: count,
        installed: false,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'frappe.app.add',
      target: appId,
      metadata: { gitUrl, branch: created.branch },
    });

    return { frappeApp: created, rebuildRequired: true };
  }

  // Remove a git app from a Frappe app's bench. Takes effect on the next deploy
  // (the app is dropped from the bench image). Note: an already-installed app is
  // NOT auto-uninstalled from the live site — Frappe app removal from a site is
  // a manual, data-sensitive operation surfaced via the root-access tools.
  async removeFrappeApp(
    userId: string,
    organizationId: string,
    appId: string,
    frappeAppId: string,
  ) {
    await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.frappeApp.findFirst({
      where: { id: frappeAppId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Frappe app not found' });
    }
    await this.prisma.frappeApp.delete({ where: { id: record.id } });

    await this.auditService.log({
      actorUserId: userId,
      action: 'frappe.app.remove',
      target: appId,
      metadata: { gitUrl: record.gitUrl },
    });

    return { ok: true, rebuildRequired: true };
  }

  // Change the Frappe framework version the bench is built on (upgrade or
  // downgrade). Recorded now; the NEXT deploy rebuilds the bench on the new
  // frappe/frappe branch and runs `bench migrate`, which carries the site's
  // schema forward. We do NOT auto-deploy — the user triggers it so they can
  // back up first (an upgrade is data-sensitive and forward-only in practice).
  async setFrappeVersion(
    userId: string,
    organizationId: string,
    appId: string,
    dto: SetFrappeVersionDto,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type !== 'frappe') {
      throw new BadRequestException({
        code: 'NOT_FRAPPE_APP',
        message: 'This app is not a Frappe app',
      });
    }
    const version = dto.version.trim();
    if (!/^[a-zA-Z0-9._\-/]+$/.test(version)) {
      throw new BadRequestException({
        code: 'INVALID_VERSION',
        message: 'Version must be a valid git branch/tag name.',
      });
    }
    const previous = app.frappeVersion ?? 'version-15';
    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { frappeVersion: version },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'frappe.version.set',
      target: appId,
      metadata: { from: previous, to: version },
    });

    return {
      app: updated,
      previousVersion: previous,
      rebuildRequired: previous !== version,
    };
  }

  // ---- Node-RED editor accounts (type = nodered) ----

  // Guard: the app exists, belongs to the org, and is a Node-RED app.
  private async findNodeRedApp(organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.type !== 'nodered') {
      throw new BadRequestException({
        code: 'NOT_NODERED_APP',
        message: 'This app is not a Node-RED app',
      });
    }
    return app;
  }

  // List the editor accounts for a Node-RED app (never returns hashes).
  async listNodeRedUsers(organizationId: string, appId: string) {
    await this.findNodeRedApp(organizationId, appId);
    const users = await this.prisma.nodeRedUser.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        username: true,
        permission: true,
        createdAt: true,
      },
    });
    return { users };
  }

  // Add an editor account. The password is hashed for storage and the accounts
  // are applied to the running instance (settings.js rewrite + restart) so the
  // change takes effect immediately.
  async addNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    dto: AddNodeRedUserDto,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const existing = await this.prisma.nodeRedUser.findUnique({
      where: { appId_username: { appId, username: dto.username } },
    });
    if (existing) {
      throw new ConflictException({
        code: 'USER_EXISTS',
        message: `An account named "${dto.username}" already exists`,
      });
    }

    const user = await this.prisma.nodeRedUser.create({
      data: {
        appId,
        username: dto.username,
        passwordHash: hashNodeRedPassword(dto.password),
        permission: dto.permission ?? '*',
      },
      select: { id: true, username: true, permission: true, createdAt: true },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.add',
      target: appId,
      metadata: { username: user.username, permission: user.permission },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { user, applied };
  }

  // Update an account's password and/or permission, then re-apply.
  async updateNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    nodeRedUserId: string,
    dto: UpdateNodeRedUserDto,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const record = await this.prisma.nodeRedUser.findFirst({
      where: { id: nodeRedUserId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    const data: { passwordHash?: string; permission?: string } = {};
    if (dto.password !== undefined) {
      data.passwordHash = hashNodeRedPassword(dto.password);
    }
    if (dto.permission !== undefined) data.permission = dto.permission;

    const user = await this.prisma.nodeRedUser.update({
      where: { id: record.id },
      data,
      select: { id: true, username: true, permission: true, createdAt: true },
    });

    // Keep the encrypted admin password in sync so "Login as administrator"
    // stays valid: when the "admin" account's password is changed, re-store it
    // encrypted (it backs the auto-login token exchange).
    if (dto.password !== undefined && record.username === 'admin') {
      await this.prisma.app.update({
        where: { id: appId },
        data: { noderedAdminPasswordEnc: encrypt(dto.password) },
      });
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.update',
      target: appId,
      metadata: { username: user.username, fields: Object.keys(data) },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { user, applied };
  }

  // Remove an account, then re-apply. The last remaining account cannot be
  // removed — an unprotected editor would be left wide open.
  async removeNodeRedUser(
    userId: string,
    organizationId: string,
    appId: string,
    nodeRedUserId: string,
  ) {
    const app = await this.findNodeRedApp(organizationId, appId);

    const record = await this.prisma.nodeRedUser.findFirst({
      where: { id: nodeRedUserId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
    }

    const count = await this.prisma.nodeRedUser.count({ where: { appId } });
    if (count <= 1) {
      throw new BadRequestException({
        code: 'LAST_USER',
        message:
          'Cannot remove the last account — at least one editor account is required',
      });
    }

    await this.prisma.nodeRedUser.delete({ where: { id: record.id } });

    await this.auditService.log({
      actorUserId: userId,
      action: 'nodered.user.remove',
      target: appId,
      metadata: { username: record.username },
    });

    const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
    return { ok: true, applied };
  }

  // Regenerate settings.js from the app's current accounts and restart the
  // running container so the new auth takes effect. Best-effort: returns
  // { restarted: false } if the container isn't running yet (e.g. the app has
  // not been deployed). The accounts are persisted regardless and will be
  // rendered into settings.js on the next deploy.
  private async applyNodeRedAccounts(
    subdomain: string,
    appId: string,
  ): Promise<{ restarted: boolean }> {
    const users = await this.prisma.nodeRedUser.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
      select: { username: true, passwordHash: true, permission: true },
    });
    const settings = renderNodeRedSettings(users);

    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containerName = `zonal-${subdomain}`;

      // The container must already exist (i.e. the app was deployed) for a live
      // apply. If not, skip — the deploy pipeline will render settings.js.
      try {
        await docker.getContainer(containerName).inspect();
      } catch {
        return { restarted: false };
      }

      // settings.js lives in the persistent volume, not on the host FS, so write
      // it via a one-shot container that mounts the same volume.
      await this.writeNodeRedSettings(docker, noderedVolumeName(subdomain), settings);

      // Restart so Node-RED reloads settings.js (adminAuth is read at startup).
      await docker.getContainer(containerName).restart({ t: 5 });
      return { restarted: true };
    } catch (err) {
      console.warn(
        `[apps] applying Node-RED accounts for ${subdomain} failed:`,
        err instanceof Error ? err.message : err,
      );
      return { restarted: false };
    }
  }

  // Write settings.js into the Node-RED data volume via a short-lived helper
  // container (busybox) that mounts the volume. The content is passed base64 to
  // avoid any shell-quoting issues, then decoded into /data/settings.js.
  private async writeNodeRedSettings(
    docker: Docker,
    volumeName: string,
    settings: string,
  ): Promise<void> {
    await this.ensureImage(docker, 'busybox:1.36');
    const b64 = Buffer.from(settings, 'utf8').toString('base64');
    // Write settings.js and keep /data owned by the Node-RED user (1000:1000) —
    // the image runs as that non-root user and fails with EACCES on a root-owned
    // volume. See NODERED_UID in apps/nodered.ts.
    const script =
      `echo ${b64} | base64 -d > ${NODERED_DATA_DIR}/settings.js && ` +
      `chown -R ${NODERED_UID}:${NODERED_GID} ${NODERED_DATA_DIR}`;
    const container = await docker.createContainer({
      Image: 'busybox:1.36',
      Cmd: ['sh', '-c', script],
      HostConfig: {
        Binds: [`${volumeName}:${NODERED_DATA_DIR}`],
        AutoRemove: true,
      },
    });
    await container.start();
    // Wait for the one-shot to finish so the restart below sees the new file.
    await container.wait();
  }

  // Store an uploaded source folder for an app. Each file carries a relative
  // path (the browser's webkitRelativePath). We clear the app's previous upload
  // and rewrite the tree, so an upload fully replaces what was there before.
  // The app must be source=upload. Files build on the next manual Deploy.
  async uploadSource(
    userId: string,
    organizationId: string,
    appId: string,
    files: Array<{ relPath: string; buffer: Buffer }>,
  ) {
    const app = await this.findAppForOrg(appId, organizationId);
    if (app.source !== 'upload') {
      throw new BadRequestException({
        code: 'NOT_UPLOAD_APP',
        message: 'This app is not configured for uploads',
      });
    }
    if (files.length === 0) {
      throw new BadRequestException({
        code: 'NO_FILES',
        message: 'No files were uploaded',
      });
    }

    const dir = appUploadDir(appId);
    // Replace any prior upload.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    // Many folder pickers nest everything under a single top-level dir (the
    // chosen folder's name). Strip that common prefix so the app's files sit at
    // the upload root, where the build expects them (package.json, etc.).
    const commonPrefix = stripCommonTopDir(files.map((f) => f.relPath));

    let written = 0;
    for (const file of files) {
      const safeRel = sanitizeRelPath(
        commonPrefix ? file.relPath.slice(commonPrefix.length) : file.relPath,
      );
      if (!safeRel) continue;
      const dest = path.join(dir, safeRel);
      // Guard against path traversal escaping the upload dir.
      if (!dest.startsWith(dir + path.sep)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.buffer);
      written += 1;
    }

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.upload',
      target: appId,
      metadata: { files: written },
    });

    return { ok: true, files: written };
  }

  async updateApp(
    userId: string,
    organizationId: string,
    appId: string,
    dto: UpdateAppDto,
  ) {
    await this.findAppForOrg(appId, organizationId);

    const data: {
      name?: string;
      repoUrl?: string | null;
      branch?: string;
      buildCmd?: string | null;
      outputDir?: string | null;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.repoUrl !== undefined) data.repoUrl = dto.repoUrl || null;
    if (dto.branch !== undefined) data.branch = dto.branch || undefined;
    if (dto.buildCmd !== undefined) data.buildCmd = dto.buildCmd || null;
    if (dto.outputDir !== undefined) data.outputDir = dto.outputDir || null;

    const app = await this.prisma.app.update({
      where: { id: appId },
      data,
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.update',
      target: appId,
      metadata: { fields: Object.keys(data) },
    });

    return { app };
  }

  async deleteApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    // Tear down the running container (best-effort).
    await this.stopContainer(app.subdomain);

    // Frappe apps: drop the managed MariaDB database/user and remove the named
    // volume holding the bench `sites/` dir. All best-effort — a failure here
    // must not block deletion of the app record.
    if (app.type === 'frappe') {
      const frappeDb = await this.prisma.frappeDatabase.findUnique({
        where: { appId },
      });
      if (frappeDb) {
        try {
          await this.mariadbProvision.dropForApp(
            frappeDb.dbName,
            frappeDb.userName,
          );
        } catch (err) {
          console.warn(
            `[apps] dropping MariaDB for ${app.subdomain} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (app.frappeVolumeName) {
        await this.removeVolume(app.frappeVolumeName);
      }
    }

    // Node-RED apps: drop the persistent data volume (flows, installed nodes,
    // settings.js). Best-effort — must not block deletion. The NodeRedUser
    // records cascade on App delete.
    if (app.type === 'nodered' && app.noderedVolumeName) {
      await this.removeVolume(app.noderedVolumeName);
    }

    // Remove any uploaded source files (best-effort).
    fs.rmSync(appUploadDir(appId), { recursive: true, force: true });

    // Remove child records first — schema has no cascade configured for these.
    // FrappeDatabase cascades on App delete, so it is removed automatically.
    await this.prisma.$transaction([
      this.prisma.deployToken.deleteMany({ where: { appId } }),
      this.prisma.envVar.deleteMany({ where: { appId } }),
      this.prisma.deployment.deleteMany({ where: { appId } }),
      this.prisma.app.delete({ where: { id: appId } }),
    ]);

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.delete',
      target: appId,
      metadata: { name: app.name },
    });

    return { ok: true, githubRepoFullName: app.githubRepoFullName, githubWebhookId: app.githubWebhookId };
  }

  // Persist webhook details after the GitHub service installs the hook.
  async attachWebhook(
    appId: string,
    organizationId: string,
    repoFullName: string,
    webhookId: string,
    webhookSecret: string,
  ) {
    await this.findAppForOrg(appId, organizationId);
    return this.prisma.app.update({
      where: { id: appId },
      data: {
        githubRepoFullName: repoFullName,
        githubWebhookId: webhookId,
        webhookSecret,
      },
    });
  }

  async deploy(userId: string, organizationId: string, appId: string, dto: DeployDto) {
    const app = await this.findAppForOrg(appId, organizationId);

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
      forceClean: dto.forceClean,
    });

    await this.auditService.log({
      actorUserId: userId ?? undefined,
      action: dto.forceClean ? 'app.migrate' : 'app.deploy',
      target: appId,
      metadata: { deploymentId: deployment.id, ref: dto.ref, forceClean: dto.forceClean },
    });

    return { deployment };
  }

  // Migrate = forced clean rebuild + rollback-safe redeploy. Same pipeline as
  // deploy, but builds with no cache and restores the previous container if the
  // swap fails, so the site never goes down. Implemented as deploy({forceClean}).
  async migrate(userId: string, organizationId: string, appId: string, dto: DeployDto) {
    return this.deploy(userId, organizationId, appId, { ...dto, forceClean: true });
  }

  async deployByToken(appId: string, dto: DeployDto) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: dto.ref ?? app.branch ?? 'main',
        status: 'queued',
      },
    });

    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'building' },
    });

    await this.deployService.enqueue({
      deploymentId: deployment.id,
      appId,
      ref: dto.ref,
      forceClean: dto.forceClean,
    });

    return { deployment };
  }

  streamLogs(organizationId: string, appId: string): Observable<{ data: string }> {
    const subject = new Subject<{ data: string }>();

    // Emit logs asynchronously. Each Redis log line is sent as its OWN SSE
    // event (never joined with "\n", which SSE would mangle). We tail until the
    // deployment reaches a terminal state, flush any final lines written at the
    // finish, then signal end-of-stream with a sentinel so the client knows to
    // stop reconnecting.
    (async () => {
      try {
        // Enforce org ownership before streaming any logs (prevents cross-tenant
        // log access by app id). Throws NotFound if the app is not in this org.
        await this.findAppForOrg(appId, organizationId);

        const latest = await this.prisma.deployment.findFirst({
          where: { appId },
          orderBy: { createdAt: 'desc' },
        });

        if (!latest) {
          subject.next({ data: 'No deployments found for this app' });
          subject.next({ data: '@end' });
          subject.complete();
          return;
        }

        const terminal = (s: string) =>
          s === 'live' || s === 'failed' || s === 'stopped';

        let cursor = 0;
        const flushNew = async () => {
          const lines = await this.logStore.getFrom(latest.id, cursor);
          for (const line of lines) {
            subject.next({ data: line });
          }
          cursor += lines.length;
        };

        // Initial backlog.
        await flushNew();

        // If still in flight, poll for new lines + the deployment status until
        // it finishes. Re-reading status each tick is what fixes the "stuck on
        // Building" freeze: once it goes live/failed/stopped we flush the tail
        // and end cleanly.
        let status = latest.status as string;
        const startedAt = Date.now();
        const MAX_MS = 15 * 60 * 1000; // safety cap: 15 min
        while (!terminal(status) && Date.now() - startedAt < MAX_MS) {
          await new Promise((r) => setTimeout(r, 500));
          await flushNew();
          const fresh = await this.prisma.deployment.findUnique({
            where: { id: latest.id },
            select: { status: true },
          });
          status = fresh?.status ?? status;
        }

        // Final flush to catch lines written right as it finished.
        await flushNew();

        subject.next({ data: '@end' });
        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  // Fetch the full stored log for ONE specific deployment (not just the latest),
  // org-scoped, for the error-analysis page. Logs live in Redis with a TTL, so
  // an old deployment's log may have expired — we return what's there plus the
  // deployment's terminal status so the UI can explain an empty log.
  async getDeploymentLog(
    organizationId: string,
    appId: string,
    deploymentId: string,
  ): Promise<{ status: string; ref: string | null; createdAt: Date; lines: string[] }> {
    await this.findAppForOrg(appId, organizationId);
    const deployment = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, appId },
      select: { status: true, ref: true, createdAt: true },
    });
    if (!deployment) {
      throw new NotFoundException('Deployment not found');
    }
    const lines = await this.logStore.getAll(deploymentId);
    return {
      status: deployment.status,
      ref: deployment.ref,
      createdAt: deployment.createdAt,
      lines,
    };
  }

  async stopApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);
    await this.stopContainer(app.subdomain);

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.stop',
      target: appId,
    });

    return { app: updated };
  }

  // Cancel an in-progress build. The deploy runs as a retrying BullMQ job, so a
  // stuck or unwanted build keeps re-running and leaves the app pinned in
  // 'building' with no UI escape hatch. This:
  //   1. removes the app's deploy jobs from the queue (stops further retries),
  //   2. tears down any in-flight build containers + the app container so the
  //      current attempt's work is killed, and
  //   3. marks the latest building deployment + the app as 'stopped', and ends
  //      the live log stream so the dashboard returns to a terminal state.
  async cancelApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    // 1. Stop the job from retrying.
    const removed = await this.deployService.cancelForApp(appId);

    // 2. Kill build containers. The app container shares the zonal-<subdomain>
    // name; the build's intermediate containers are anonymous, so prune the
    // dangling build state for this app's image as well.
    await this.stopContainer(app.subdomain);
    await this.killBuildContainers(app.subdomain);

    // 3. Reset the latest building deployment + the app to a terminal state.
    const building = await this.prisma.deployment.findFirst({
      where: { appId, status: 'building' },
      orderBy: { createdAt: 'desc' },
    });
    if (building) {
      await this.prisma.deployment.update({
        where: { id: building.id },
        data: { status: 'failed' },
      });
      // End the live log stream so the dashboard's LogViewer stops "Live".
      await this.logStore.append(building.id, '@fail Build|Cancelled by user');
    }

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.cancel',
      target: appId,
      metadata: { subdomain: app.subdomain, jobsRemoved: removed },
    });

    return { app: updated };
  }

  // Restart the running container in place (docker restart). Unlike a redeploy
  // this keeps the same image/container, so a Node-RED instance reloads its
  // settings.js + flows from the persistent volume without a rebuild. Throws if
  // there is no container yet (the app hasn't been deployed) so the UI can tell
  // the user to deploy first.
  async restartApp(userId: string, organizationId: string, appId: string) {
    const app = await this.findAppForOrg(appId, organizationId);

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const containerName = `zonal-${app.subdomain}`;
    try {
      await docker.getContainer(containerName).inspect();
    } catch {
      throw new BadRequestException({
        code: 'NOT_RUNNING',
        message: 'No running instance to restart — deploy the app first.',
      });
    }

    await docker.getContainer(containerName).restart({ t: 5 });

    await this.auditService.log({
      actorUserId: userId,
      action: 'app.restart',
      target: appId,
      metadata: { subdomain: app.subdomain },
    });

    return { ok: true };
  }

  // Snapshot of the running container's recent stdout/stderr (the live app's
  // own logs — e.g. Node-RED's runtime output: started flows, node installs,
  // errors). Non-following: returns the last `tail` lines and exits, so the UI
  // can poll/refresh. Returns running:false (and no lines) when the app has no
  // container yet, so the UI can prompt the user to deploy.
  async getRuntimeLogs(
    organizationId: string,
    appId: string,
    tail = 200,
  ): Promise<{ running: boolean; lines: string[] }> {
    const app = await this.findAppForOrg(appId, organizationId);

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });
    const container = docker.getContainer(`zonal-${app.subdomain}`);
    try {
      await container.inspect();
    } catch {
      return { running: false, lines: [] };
    }

    // Clamp tail to a sane window so a huge value can't be abused.
    const safeTail = Math.min(Math.max(Math.floor(tail) || 0, 1), 1000);
    const buf = (await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
      tail: safeTail,
      timestamps: false,
    })) as unknown as Buffer;

    // Docker multiplexes stdout/stderr with an 8-byte header per frame; strip
    // the control bytes and split into clean lines.
    const text = buf
      .toString('utf8')
      .replace(/[\x00-\x08]/g, '')
      .replace(/[\x0e-\x1f]/g, '');
    const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
    return { running: true, lines };
  }

  async createToken(userId: string, organizationId: string, appId: string, dto: CreateTokenDto) {
    await this.findAppForOrg(appId, organizationId);

    const plainToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(plainToken, 10);

    const deployToken = await this.prisma.deployToken.create({
      data: {
        appId,
        name: dto.name,
        hashedToken,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'token.create',
      target: appId,
      metadata: { tokenId: deployToken.id, name: dto.name },
    });

    return {
      token: plainToken,
      id: deployToken.id,
      name: deployToken.name,
    };
  }

  async listTokens(userId: string, organizationId: string, appId: string) {
    await this.findAppForOrg(appId, organizationId);

    const tokens = await this.prisma.deployToken.findMany({
      where: { appId },
      select: { id: true, name: true, lastUsedAt: true },
      orderBy: { name: 'asc' },
    });

    return { tokens };
  }

  // ---- Custom domains ----

  async listDomains(organizationId: string, appId: string) {
    await this.findAppForOrg(appId, organizationId);
    const domains = await this.prisma.customDomain.findMany({
      where: { appId },
      orderBy: { createdAt: 'asc' },
    });
    return { domains: domains.map((d) => this.domainView(d)) };
  }

  async addDomain(userId: string, organizationId: string, appId: string, dto: AddDomainDto) {
    await this.findAppForOrg(appId, organizationId);
    const domain = dto.domain.trim().toLowerCase();

    const existing = await this.prisma.customDomain.findUnique({ where: { domain } });
    if (existing) {
      throw new ConflictException({
        code: 'DOMAIN_TAKEN',
        message: 'That domain is already attached to an app.',
      });
    }

    const created = await this.prisma.customDomain.create({
      data: {
        appId,
        domain,
        status: 'pending',
        verifyToken: `zonal-verify=${crypto.randomBytes(16).toString('hex')}`,
      },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.add',
      target: appId,
      metadata: { domain },
    });

    return { domain: this.domainView(created) };
  }

  /**
   * Verify ownership by looking for the verify token in a TXT record at
   * _zonal-challenge.<domain>. On success the domain is marked verified; the
   * next deploy attaches its Traefik router (with TLS on the VPS).
   */
  async verifyDomain(userId: string, organizationId: string, appId: string, domainId: string) {
    await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }

    let txt: string[][] = [];
    try {
      txt = await dns.resolveTxt(`_zonal-challenge.${record.domain}`);
    } catch {
      txt = [];
    }
    const flat = txt.map((parts) => parts.join(''));
    const verified = flat.includes(record.verifyToken);

    const updated = await this.prisma.customDomain.update({
      where: { id: record.id },
      data: verified
        ? { status: 'verified', verifiedAt: new Date() }
        : { status: 'failed' },
    });

    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.verify',
      target: appId,
      metadata: { domain: record.domain, verified },
    });

    return {
      domain: this.domainView(updated),
      verified,
      message: verified
        ? 'Domain verified. Redeploy the app for it to go live.'
        : 'TXT record not found yet. DNS can take a few minutes to propagate.',
    };
  }

  async removeDomain(userId: string, organizationId: string, appId: string, domainId: string) {
    await this.findAppForOrg(appId, organizationId);
    const record = await this.prisma.customDomain.findFirst({
      where: { id: domainId, appId },
    });
    if (!record) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
    }
    await this.prisma.customDomain.delete({ where: { id: record.id } });
    await this.auditService.log({
      actorUserId: userId,
      action: 'domain.remove',
      target: appId,
      metadata: { domain: record.domain },
    });
    return { ok: true };
  }

  // Adds the DNS instructions the user must create to verify + point the domain.
  private domainView(d: {
    id: string;
    domain: string;
    status: string;
    verifyToken: string;
    verifiedAt: Date | null;
    createdAt: Date;
  }) {
    const target = process.env.BASE_DOMAIN ?? 'localhost';
    return {
      id: d.id,
      domain: d.domain,
      status: d.status,
      verifiedAt: d.verifiedAt,
      createdAt: d.createdAt,
      instructions: {
        // 1) prove ownership, 2) point traffic at the platform
        txtRecord: { host: `_zonal-challenge.${d.domain}`, type: 'TXT', value: d.verifyToken },
        routeRecord: { host: d.domain, type: 'CNAME', value: target },
      },
    };
  }

  private async findAppForOrg(appId: string, organizationId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true } } },
    });

    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    return app;
  }

  private async stopContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(`zonal-${subdomain}`);
      // Remove (not just stop): the placeholder/app container has a
      // restart-policy and its name would otherwise collide if the subdomain
      // is later reused. force:true stops it first if running.
      await container.remove({ force: true });
    } catch {
      // Container may not exist — ignore
    }
  }

  // Tear down a cancelled build's in-flight Docker work (best-effort). A running
  // `docker build` spawns anonymous intermediate containers from the app's
  // RUN-layer steps; killing them aborts the current build step. We then prune
  // dangling build state so a stuck layer isn't reused, mirroring the deploy
  // processor's own cache-clearing. Any failure here is swallowed — the queue
  // job removal + status reset already unstick the app.
  private async killBuildContainers(subdomain: string): Promise<void> {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const run = promisify(execFile);
      // Kill any running containers spawned from this app's build image layers.
      await run('bash', [
        '-c',
        `docker ps -q --filter=ancestor='zonal-app-${subdomain}' | xargs -r docker kill`,
      ]).catch(() => {});
      // Prune the builder cache so the next deploy doesn't resume a poisoned
      // layer from the cancelled build.
      await run('docker', ['builder', 'prune', '-f']).catch(() => {});
    } catch {
      // Docker unreachable or no matching containers — nothing to tear down.
    }
  }

  // Remove a named Docker volume (best-effort). Used to clean up a Frappe app's
  // bench `sites/` volume on deletion. The container must already be removed
  // (stopContainer above) or the volume is still in use and the remove no-ops.
  private async removeVolume(volumeName: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      await docker.getVolume(volumeName).remove({ force: true });
    } catch (err) {
      console.warn(
        `[apps] removing volume ${volumeName} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Start a maintenance placeholder container for a freshly-created app so its
  // URL serves a "being set up" page until the first deploy. Mirrors the deploy
  // pipeline's container name (`zonal-<subdomain>`) and Traefik label scheme so
  // the real deploy cleanly replaces it via stopContainerIfExists + recreate.
  // Best-effort: any failure is logged and swallowed — it must never block
  // app creation (e.g. when Docker isn't reachable in a given environment).
  private async startMaintenanceContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const containerName = `zonal-${subdomain}`;

      // If a container already exists for this subdomain, leave it alone.
      try {
        await docker.getContainer(containerName).inspect();
        return;
      } catch {
        // Not found — proceed to create the placeholder.
      }

      await this.ensureImage(docker, MAINTENANCE_IMAGE);

      const labels: Record<string, string> = {
        'traefik.enable': 'true',
        [`traefik.http.routers.${subdomain}.rule`]: `Host(\`${subdomain}.localhost\`)`,
        [`traefik.http.services.${subdomain}.loadbalancer.server.port`]: '80',
      };

      const networkMode = process.env.DOCKER_NETWORK ?? 'zonal_net';
      const container = await docker.createContainer({
        Image: MAINTENANCE_IMAGE,
        name: containerName,
        Labels: labels,
        Cmd: maintenanceContainerCmd(),
        HostConfig: {
          NetworkMode: networkMode,
          RestartPolicy: { Name: 'unless-stopped' },
        },
      });
      await container.start();
    } catch (err) {
      // Swallow — the catch-all fallback page still covers this app if the
      // placeholder can't be started.
      // eslint-disable-next-line no-console
      console.warn(
        `[apps] maintenance container for ${subdomain} not started:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Pull an image if it isn't present locally. dockerode's pull is stream-based,
  // so we wait for it to finish before creating the container.
  private async ensureImage(docker: Docker, image: string): Promise<void> {
    try {
      await docker.getImage(image).inspect();
      return; // already present
    } catch {
      // Not present — pull it.
    }
    const stream = await docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (err: Error | null) =>
        err ? reject(err) : resolve(),
      );
    });
  }
}

// Normalize an uploaded relative path: forward slashes, no leading slash, and
// no ".." segments (so a malicious path can't escape the upload dir). Returns
// "" for paths that resolve to nothing usable.
function sanitizeRelPath(rel: string): string {
  const parts = rel
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.' && seg !== '..');
  return parts.join('/');
}

// If every uploaded path shares the same first segment (the picked folder's
// own name, which browsers prepend), return that prefix incl. trailing slash
// so callers can strip it. Returns "" when there is no single common top dir.
function stripCommonTopDir(relPaths: string[]): string {
  const tops = new Set<string>();
  for (const p of relPaths) {
    const top = p.replace(/\\/g, '/').split('/')[0];
    if (!top) return '';
    tops.add(top);
  }
  return tops.size === 1 ? `${[...tops][0]}/` : '';
}

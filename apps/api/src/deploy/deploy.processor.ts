import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, execFile } from 'child_process';
import * as Docker from 'dockerode';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { LogStoreService } from './log-store.service';
import { DEPLOY_QUEUE } from './deploy.constants';
import { decrypt } from '../common/encrypt.util';
import {
  buildAppUrl,
  buildSubdomainRouterLabels,
  appSubdomainHost,
} from '../common/app-url.util';
import { appUploadDir } from '../common/upload-path.util';
import { DbProvisionService } from '../database/db-provision.service';
import { MariadbProvisionService } from '../database/mariadb-provision.service';
import { PlatformSettingsService } from '../common/platform-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EMPTY_CONTENT_HTML_B64 } from './empty-content-page';
import {
  NODERED_IMAGE,
  NODERED_PORT,
  NODERED_DATA_DIR,
  NODERED_UID,
  NODERED_GID,
  renderNodeRedSettings,
} from '../apps/nodered';

// A single git app to fetch onto a Frappe bench (from the App's FrappeApp list).
interface FrappeAppSpec {
  gitUrl: string;
  branch?: string | null;
  appName?: string | null;
}

// Port that static/dynamic/fullstack app containers listen on and Traefik
// routes to. Unprivileged so images running as a non-root user can bind it.
// The platform injects PORT=this and the generated nginx fallback listens here.
const APP_LISTEN_PORT = 8080;

export interface DeployJobData {
  deploymentId: string;
  appId: string;
  ref?: string;
  // Migrate: force a clean rebuild (no cache) and perform a rollback-safe
  // container swap that restores the previous container if the swap fails, so
  // the site never goes down.
  forceClean?: boolean;
}

@Processor(DEPLOY_QUEUE)
export class DeployProcessor extends WorkerHost {
  private docker: Docker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logStore: LogStoreService,
    private readonly dbProvision: DbProvisionService,
    private readonly mariadbProvision: MariadbProvisionService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async process(job: Job<DeployJobData>): Promise<void> {
    const { deploymentId, appId } = job.data;

    // BullMQ retries failed jobs (see DeployService.enqueue). attemptsMade is 0
    // on the first run, 1 on the first retry, etc.
    const maxAttempts = job.opts.attempts ?? 1;
    const attempt = job.attemptsMade + 1;
    const isRetry = job.attemptsMade > 0;
    // Migrate forces a clean build from the very first attempt. A retry always
    // builds clean too. Either one means: prune caches + build with --no-cache.
    const forceClean = job.data.forceClean === true;
    const cleanBuild = isRetry || forceClean;
    const startedAt = Date.now();

    await this.info(
      deploymentId,
      attempt > 1
        ? `Build started (attempt ${attempt} of ${maxAttempts})`
        : 'Build started',
    );
    this.debug(deploymentId, `deployment=${deploymentId} job.id=${job.id} appId=${appId} ref=${job.data.ref ?? '(default)'}`);
    this.debug(
      deploymentId,
      `runtime: node=${process.version} platform=${process.platform} arch=${process.arch} pid=${process.pid}`,
    );
    this.debug(
      deploymentId,
      `env: DOCKER_NETWORK=${process.env.DOCKER_NETWORK ?? 'zonal_net'} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`,
    );

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'building' },
    });

    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: {
        envVars: true,
        project: { select: { userId: true } },
        customDomains: { where: { status: 'verified' } },
        frappeApps: { orderBy: { position: 'asc' } },
        noderedUsers: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!app) {
      // Missing app is not transient — fail permanently, do not retry.
      await this.stageFail(deploymentId, 'Initializing', 'App not found');
      await this.markFailed(deploymentId, appId, 'App not found', 'Initializing');
      return;
    }

    this.debug(
      deploymentId,
      `app: name=${app.name} subdomain=${app.subdomain} type=${app.type} source=${app.source} branch=${app.branch ?? 'main'}`,
    );
    this.debug(
      deploymentId,
      `app config: buildCmd=${app.buildCmd ?? '(default)'} outputDir=${app.outputDir ?? 'dist'} envVars=${app.envVars.length} github=${app.githubRepoFullName ?? '(none)'}`,
    );

    const workDir = `/tmp/zonal-build-${deploymentId}`;
    let currentStage = 'Initializing';

    try {
      // ── Stage: Preparing ──────────────────────────────────────────────
      currentStage = 'Preparing';
      const prepStart = Date.now();
      await this.stageStart(deploymentId, currentStage);
      if (isRetry) {
        await this.info(deploymentId, `Retry ${job.attemptsMade}: clearing build cache`);
        await this.clearCaches(deploymentId, app.subdomain);
      } else if (forceClean) {
        await this.info(deploymentId, 'Migrate: clean rebuild — clearing build cache');
        await this.clearCaches(deploymentId, app.subdomain);
      }
      this.debug(deploymentId, `work dir ${workDir}`);
      if (fs.existsSync(workDir)) {
        this.debug(deploymentId, 'removing stale work dir');
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workDir, { recursive: true });
      await this.stageOk(deploymentId, currentStage, prepStart);

      // ── Stage: Cloning repository ─────────────────────────────────────
      // Node-RED apps have no source repo — they run the official image — so
      // there is nothing to clone or copy.
      //
      // Frappe apps are NOT built from a cloned working tree either: the bench
      // image is generated from an apps.json and each app is fetched inside the
      // image build by `bench get-app` (see generateFrappeDockerfile). Cloning
      // the App's repoUrl here would download a tree the build never uses, so we
      // skip it and let the bench build stage show the real app fetch.
      if (app.type === 'nodered') {
        await this.info(
          deploymentId,
          'Node-RED app — running the official image (no source build)',
        );
      } else if (app.type === 'frappe') {
        const frappeAppCount = app.frappeApps.length;
        await this.info(
          deploymentId,
          frappeAppCount > 0
            ? `Frappe bench — ${frappeAppCount} git app(s) will be fetched during the bench build`
            : 'Frappe bench — Frappe core only (no extra apps configured)',
        );
      } else if (app.source === 'git' && app.repoUrl) {
        currentStage = 'Cloning repository';
        const cloneStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        await this.info(deploymentId, `${app.repoUrl} (branch ${app.branch ?? 'main'})`);
        this.debug(deploymentId, `git clone --depth 1 --branch ${app.branch ?? 'main'} (token redacted)`);
        const cloneUrl = await this.authenticatedCloneUrl(app);
        const git = simpleGit();
        await git.clone(cloneUrl, workDir, ['--depth', '1', '--branch', app.branch ?? 'main']);
        this.debug(deploymentId, `cloned files: ${this.listDir(workDir)}`);
        await this.stageOk(deploymentId, currentStage, cloneStart);
      } else if (app.source === 'upload') {
        currentStage = 'Copying uploaded files';
        const copyStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        const srcDir = appUploadDir(app.id);
        if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) {
          throw new Error(
            'No uploaded files found for this app. Upload your code folder, then deploy.',
          );
        }
        // Copy the uploaded source tree into the build work dir.
        fs.cpSync(srcDir, workDir, { recursive: true });
        await this.info(deploymentId, `copied uploaded files: ${this.listDir(workDir)}`);
        await this.stageOk(deploymentId, currentStage, copyStart);
      } else {
        await this.info(deploymentId, 'No source configured — nothing to build');
      }

      // ── Stage: Building image ─────────────────────────────────────────
      // Each app type has a different "build": Node-RED pulls the official
      // image (no build), Frappe builds a full bench image (init + build),
      // everything else runs nixpacks/Dockerfile. Name the stage after what is
      // actually happening so the deploy log reads true to the process.
      let imageTag: string;
      if (app.type === 'nodered') {
        // Node-RED runs the official image directly — there is nothing to
        // build, so the stage is the image pull. ensureImage streams real
        // pull progress (layer-by-layer) under this stage.
        currentStage = 'Pulling Node-RED image';
        const pullStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        await this.ensureImage(deploymentId, NODERED_IMAGE, true);
        imageTag = NODERED_IMAGE;
        await this.info(deploymentId, `Image ready: ${NODERED_IMAGE}`);
        await this.stageOk(deploymentId, currentStage, pullStart);
      } else if (app.type === 'frappe') {
        currentStage = 'Building bench image';
        const buildStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        imageTag = `zonal-app-${app.subdomain}:${deploymentId}`;
        this.debug(deploymentId, `image tag: ${imageTag}`);
        await this.buildImage(deploymentId, workDir, imageTag, app, cleanBuild);
        await this.stageOk(deploymentId, currentStage, buildStart);
      } else {
        currentStage = 'Building';
        const buildStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        imageTag = `zonal-app-${app.subdomain}:${deploymentId}`;
        this.debug(deploymentId, `image tag: ${imageTag}`);
        await this.buildImage(deploymentId, workDir, imageTag, app, cleanBuild);
        await this.stageOk(deploymentId, currentStage, buildStart);
      }

      // Shared container parameters. The image was built above while the old
      // container kept serving (no downtime during the long build). Per-type
      // provisioning (DB, Frappe site, Node-RED settings) runs in its own stage
      // below; the rollback-safe container swap is the final stage.
      const containerName = `zonal-${app.subdomain}`;

      // The port Traefik proxies to, per app type:
      //   frappe   → gunicorn on 8000
      //   nodered  → editor on 1880
      //   else (static / dynamic / fullstack) → APP_LISTEN_PORT (8080).
      // 8080 (not 80) is deliberate: it's unprivileged, so the app works whether
      // its image runs as root or a non-root user. Both the generated nginx
      // fallback and a repo's own Node server are made to listen here:
      //   - the platform injects PORT=<containerPort> below (PaaS convention),
      //   - the generated fallback templates `listen $PORT` from it.
      const containerPort =
        app.type === 'frappe'
          ? 8000
          : app.type === 'nodered'
            ? NODERED_PORT
            : APP_LISTEN_PORT;
      // Every app type — Node-RED included — is routed by Traefik on its
      // subdomain (container :containerPort behind <subdomain>.<BASE_DOMAIN>), so
      // the public URL stays clean with no host port.
      const labels = this.buildTraefikLabels(app.subdomain, containerPort, app.customDomains);
      const networkMode = process.env.DOCKER_NETWORK ?? 'zonal_net';
      const envList = app.envVars.map((v) => `${v.key}=${v.value}`);
      // Make the app listen on the SAME port Traefik routes to. A $PORT-honouring
      // server (the PaaS convention, used by the generated fallback and most Node
      // apps) then binds the right port; without this it picks its own default
      // (e.g. 3000/8000) that won't match containerPort → 502 Bad Gateway.
      // Frappe (gunicorn) and Node-RED listen on fixed ports, so skip them. A
      // user-set PORT env var always wins (we never override an explicit value).
      if (
        app.type !== 'nodered' &&
        app.type !== 'frappe' &&
        !app.envVars.some((v) => v.key === 'PORT')
      ) {
        envList.push(`PORT=${containerPort}`);
      }
      // Extra HostConfig bits populated per app type (Frappe and Node-RED each
      // need a persistent volume bind for their data dir).
      const extraBinds: string[] = [];

      // ── Per-app database ──────────────────────────────────────────────
      // Full-stack apps get a managed database provisioned inside the shared
      // Postgres server (reuse the platform's Postgres). The connection string
      // is injected as DATABASE_URL unless the user already set one explicitly.
      if (app.type === 'fullstack') {
        const userSetDbUrl = app.envVars.some((v) => v.key === 'DATABASE_URL');
        if (userSetDbUrl) {
          await this.info(
            deploymentId,
            'DATABASE_URL is set via env vars — skipping managed database',
          );
        } else {
          currentStage = 'Provisioning database';
          const dbStart = Date.now();
          await this.stageStart(deploymentId, currentStage);
          try {
            await this.info(deploymentId, 'Provisioning managed database');
            const db = await this.dbProvision.ensureForApp(app.id, app.subdomain);
            const url = this.dbProvision.buildAppDatabaseUrl(db);
            envList.push(`DATABASE_URL=${url}`);
            this.debug(
              deploymentId,
              `injected DATABASE_URL for db=${db.dbName} role=${db.roleName} host=${db.host}:${db.port}`,
            );
            await this.info(
              deploymentId,
              `Database ready: ${db.dbName} (reachable at ${db.host}:${db.port})`,
            );
            await this.stageOk(deploymentId, currentStage, dbStart);
          } catch (dbErr: unknown) {
            const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
            // A provisioning failure is fatal for a full-stack app — without a
            // database the backend can't function. Surface it as a deploy failure.
            throw new Error(`Database provisioning failed: ${reason}`);
          }
        }
      }

      // ── Frappe: MariaDB + site bootstrap ──────────────────────────────
      // Frappe apps get a dedicated MariaDB database (provisioned inside the
      // shared MariaDB server) and a persistent volume for their sites/ dir. The
      // Frappe site is created on the first deploy and migrated on every later
      // one. Connection/site config is passed to the bench step + the running
      // container via env.
      if (app.type === 'frappe') {
        if (!app.frappeSiteName || !app.frappeVolumeName) {
          throw new Error(
            'Frappe app is missing its site configuration — recreate the app.',
          );
        }
        currentStage = 'Setting up Frappe site';
        const siteStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        try {
          await this.info(deploymentId, 'Provisioning managed MariaDB database');
          const fdb = await this.mariadbProvision.ensureForApp(app.id, app.subdomain);
          const dbPassword = this.mariadbProvision.appUserPassword(fdb);
          const adminPassword = app.frappeAdminPasswordEnc
            ? decrypt(app.frappeAdminPasswordEnc)
            : '';
          const redisUrl = await this.settings.frappeRedisUrl();

          // Env consumed by the bench bootstrap step + the running container.
          const frappeEnv: Record<string, string> = {
            SITE_NAME: app.frappeSiteName,
            DB_HOST: fdb.host,
            DB_PORT: String(fdb.port),
            DB_NAME: fdb.dbName,
            DB_USER: fdb.userName,
            DB_PASSWORD: dbPassword,
            ADMIN_PASSWORD: adminPassword,
            REDIS_CACHE: `${redisUrl}/0`,
            REDIS_QUEUE: `${redisUrl}/1`,
            REDIS_SOCKETIO: `${redisUrl}/2`,
          };
          for (const [k, v] of Object.entries(frappeEnv)) {
            // Don't override an explicit user-set env var of the same key.
            if (!app.envVars.some((e) => e.key === k)) envList.push(`${k}=${v}`);
          }

          await this.info(
            deploymentId,
            `MariaDB ready: ${fdb.dbName} (reachable at ${fdb.host}:${fdb.port})`,
          );

          // Persist the bench sites/ dir across redeploys.
          extraBinds.push(`${app.frappeVolumeName}:/home/frappe/frappe-bench/sites`);

          // Create or migrate the Frappe site using the freshly built image, with
          // the persistent volume mounted, BEFORE swapping the long-running
          // container in. ensureFrappeSite streams the real bench output
          // (new-site / install-app / migrate) under this stage.
          await this.ensureFrappeSite(deploymentId, app, imageTag, networkMode, frappeEnv);
          await this.stageOk(deploymentId, currentStage, siteStart);
        } catch (fErr: unknown) {
          const reason = fErr instanceof Error ? fErr.message : String(fErr);
          throw new Error(`Frappe provisioning failed: ${reason}`);
        }
      }

      // ── Node-RED: persistent volume + settings.js ─────────────────────
      // Node-RED keeps its flows, installed nodes and settings.js in a named
      // volume mounted at /data so they survive restarts/redeploys. We render
      // settings.js (with adminAuth from the app's editor accounts) into the
      // volume BEFORE the container starts so the editor is protected from the
      // first boot.
      if (app.type === 'nodered') {
        const volume = app.noderedVolumeName ?? `zonal-nodered-${app.subdomain}`;
        currentStage = 'Configuring Node-RED';
        const cfgStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        try {
          await this.info(
            deploymentId,
            `Routing this instance via Traefik on ${appSubdomainHost(app.subdomain)} (-> container ${NODERED_PORT})`,
          );
          await this.info(
            deploymentId,
            `Writing settings.js to the /data volume (${volume})`,
          );
          await this.info(
            deploymentId,
            `Applying adminAuth for ${app.noderedUsers.length} editor account(s): ${
              app.noderedUsers.map((u) => u.username).join(', ') || '(none)'
            }`,
          );
          const settings = renderNodeRedSettings(
            app.noderedUsers.map((u) => ({
              username: u.username,
              passwordHash: u.passwordHash,
              permission: u.permission,
            })),
          );
          await this.writeNodeRedSettings(deploymentId, volume, settings);
          extraBinds.push(`${volume}:${NODERED_DATA_DIR}`);
          await this.info(
            deploymentId,
            'Flows, nodes and credentials persist in this volume across redeploys',
          );
          await this.info(
            deploymentId,
            `Node-RED ready with ${app.noderedUsers.length} editor account(s)`,
          );
          await this.stageOk(deploymentId, currentStage, cfgStart);
        } catch (nrErr: unknown) {
          const reason = nrErr instanceof Error ? nrErr.message : String(nrErr);
          throw new Error(`Node-RED provisioning failed: ${reason}`);
        }
      }

      // ── Stage: starting the container ─────────────────────────────────
      // Rollback-safe swap, named after what is actually being started. We
      // snapshot the old container first so that, if the swap fails, we can
      // recreate it from the exact image it was running — the site is restored
      // instead of going down.
      currentStage =
        app.type === 'frappe'
          ? 'Starting Frappe'
          : app.type === 'nodered'
            ? 'Starting Node-RED'
            : 'Deploying';
      const deployStart = Date.now();
      await this.stageStart(deploymentId, currentStage);

      const backup = await this.snapshotContainer(deploymentId, containerName);
      if (backup) {
        this.debug(
          deploymentId,
          `backup captured: image=${backup.image} (will restore this if the swap fails)`,
        );
      }

      try {
        await this.stopContainerIfExists(deploymentId, containerName);

        this.debug(
          deploymentId,
          `creating container ${containerName} (image=${imageTag} network=${networkMode} port=${containerPort})`,
        );
        if (app.customDomains.length) {
          await this.info(
            deploymentId,
            `Routing custom domains: ${app.customDomains.map((d) => d.domain).join(', ')}`,
          );
        }
        // No host ports are published for any app type — Traefik reaches every
        // container over the zonal_net network and routes the subdomain to it.
        const container = await this.docker.createContainer({
          Image: imageTag,
          name: containerName,
          Labels: labels,
          HostConfig: {
            NetworkMode: networkMode,
            RestartPolicy: { Name: 'unless-stopped' },
            ...(extraBinds.length ? { Binds: extraBinds } : {}),
          },
          Env: envList,
        });

        await container.start();
        this.debug(deploymentId, `container id=${container.id.slice(0, 12)} started`);

        // Node-RED boots a few seconds after the container starts (it loads
        // settings.js, starts the flow runtime and the editor). Tail its logs
        // into the deploy log so the user sees the runtime come up ("Server now
        // running at ...", "Started flows") and any startup errors — without
        // this the deploy log goes quiet the moment the container starts.
        if (app.type === 'nodered') {
          await this.tailNodeRedStartup(deploymentId, container);
        }
      } catch (swapErr: unknown) {
        // The swap failed. Bring the previous container back so the site stays
        // up, then rethrow so the deployment is recorded as failed.
        const reason = swapErr instanceof Error ? swapErr.message : String(swapErr);
        await this.info(
          deploymentId,
          `Swap failed (${reason}) — restoring the previous container`,
        );
        if (backup) {
          const restored = await this.restoreContainer(
            deploymentId,
            containerName,
            backup,
          );
          if (restored) {
            await this.info(deploymentId, 'Previous version restored — site is still up');
          } else {
            await this.info(
              deploymentId,
              'WARNING: could not restore the previous container — site may be down',
            );
          }
        } else {
          await this.info(
            deploymentId,
            'No previous container to restore (first deploy)',
          );
        }
        throw swapErr;
      }
      await this.stageOk(deploymentId, currentStage, deployStart);

      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'live', imageRef: imageTag },
      });

      await this.prisma.app.update({
        where: { id: appId },
        data: { status: 'live' },
      });

      await this.info(deploymentId, `Deployed in ${this.elapsed(startedAt)}`);
      await this.info(deploymentId, `Live at ${buildAppUrl(app.subdomain)}`);

      // Cleanup build dir
      this.debug(deploymentId, `removing work dir ${workDir}`);
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      await this.stageFail(deploymentId, currentStage, message);
      if (stack) {
        for (const line of stack.split('\n').slice(1)) {
          this.debug(deploymentId, line.trim());
        }
      }

      // Always clean the work dir so the next attempt starts fresh.
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.debug(deploymentId, 'work dir cleaned after failure');
      } catch {
        // ignore cleanup errors
      }

      if (attempt < maxAttempts) {
        // Let BullMQ retry: throwing re-queues the job with backoff.
        await this.info(
          deploymentId,
          `Attempt ${attempt} of ${maxAttempts} failed — retrying with a clean cache`,
        );
        throw err;
      }

      // Attempts exhausted — record the terminal failure. The stage that failed
      // (e.g. "Cloning repository") becomes the notification's title; the full
      // error text is kept as detail for the analysis page.
      await this.markFailed(
        deploymentId,
        appId,
        `${message} (after ${maxAttempts} attempts)`,
        currentStage,
      );
    }
  }

  // For GitHub-connected apps over HTTPS, inject the owner's OAuth token so
  // private repos clone. Falls back to the bare URL for public repos / no token.
  private async authenticatedCloneUrl(app: {
    repoUrl: string | null;
    githubRepoFullName?: string | null;
    project?: { userId: string } | null;
  }): Promise<string> {
    const repoUrl = app.repoUrl ?? '';
    if (
      !app.githubRepoFullName ||
      !app.project?.userId ||
      !repoUrl.startsWith('https://github.com/')
    ) {
      return repoUrl;
    }

    const account = await this.prisma.githubAccount.findUnique({
      where: { userId: app.project.userId },
      select: { accessToken: true },
    });
    if (!account) return repoUrl;

    try {
      const token = decrypt(account.accessToken);
      // https://x-access-token:<token>@github.com/owner/repo.git
      return repoUrl.replace(
        'https://github.com/',
        `https://x-access-token:${token}@github.com/`,
      );
    } catch {
      return repoUrl;
    }
  }

  // Builds the Traefik labels for an app container: the default
  // <slug>.localhost router plus one router per verified custom domain. When
  // ACME_RESOLVER is set (the VPS), custom-domain routers also request TLS via
  // Let's Encrypt; locally (no resolver) they stay HTTP.
  private buildTraefikLabels(
    subdomain: string,
    containerPort: number,
    customDomains: { domain: string }[],
  ): Record<string, string> {
    const resolver = process.env.ACME_RESOLVER; // e.g. "letsencrypt" on the VPS
    // Default router on <slug>.<BASE_DOMAIN> (HTTPS on the VPS, HTTP locally).
    const labels: Record<string, string> = buildSubdomainRouterLabels(
      subdomain,
      containerPort,
    );

    for (const { domain } of customDomains) {
      // Router name must be a safe Traefik identifier.
      const router = `d-${domain.replace(/[^a-z0-9]/gi, '-')}`;
      labels[`traefik.http.routers.${router}.rule`] = `Host(\`${domain}\`)`;
      labels[`traefik.http.routers.${router}.service`] = subdomain;
      if (resolver) {
        labels[`traefik.http.routers.${router}.entrypoints`] = 'websecure';
        labels[`traefik.http.routers.${router}.tls`] = 'true';
        labels[`traefik.http.routers.${router}.tls.certresolver`] = resolver;
      }
    }
    return labels;
  }

  private async buildImage(
    deploymentId: string,
    workDir: string,
    imageTag: string,
    app: {
      buildCmd?: string | null;
      outputDir?: string | null;
      type: string;
      frappeVersion?: string | null;
    },
    noCache = false,
  ): Promise<void> {
    // Frappe always builds from a generated Dockerfile (a full bench image:
    // Python + Node + bench). The bench's apps are taken from the app's
    // FrappeApp list (bench get-app each), NOT a repo apps.json. nixpacks cannot
    // produce this, so skip builder auto-detection for frappe apps.
    if (app.type === 'frappe') {
      const frappeApps = (app as { frappeApps?: FrappeAppSpec[] }).frappeApps ?? [];
      const frappeVersion = app.frappeVersion || 'version-15';
      // Describe the real bench build so the log reflects what Docker is doing:
      // a `bench init` on the chosen Frappe branch that fetches Frappe core plus
      // each configured app via `bench get-app`, then `bench build` to compile
      // assets. The streamed docker output (Step N/M, bench logs) follows.
      await this.info(
        deploymentId,
        `Building Frappe bench image on ${frappeVersion}`,
      );
      await this.info(
        deploymentId,
        `bench init — fetching Frappe core (${frappeVersion}) + ${frappeApps.length} app(s)`,
      );
      await this.info(deploymentId, 'Apps installed on this bench:');
      await this.info(deploymentId, `  • frappe (${frappeVersion})`);
      for (const a of frappeApps) {
        if (!a.gitUrl) continue;
        const name = a.appName?.trim() || a.gitUrl.replace(/\.git$/, '').split('/').pop() || a.gitUrl;
        await this.info(
          deploymentId,
          `  • ${name} — ${a.gitUrl} (${a.branch || frappeVersion})`,
        );
      }
      await this.info(deploymentId, 'bench build — compiling JS/CSS assets for all apps');
      await this.generateFrappeDockerfile(workDir, frappeApps, frappeVersion, deploymentId);
      fs.writeFileSync(
        path.join(workDir, '.dockerignore'),
        ['.git', 'Dockerfile', '.dockerignore'].join('\n'),
        'utf8',
      );
      await this.runDockerBuild(deploymentId, workDir, imageTag, noCache);
      await this.info(deploymentId, 'Bench image built — site setup runs next');
      return;
    }

    // A repo that ships its own Dockerfile wins over nixpacks and the generated
    // fallback — it's the most explicit statement of how the author wants the
    // image built. Use it as-is and DON'T write a .dockerignore that excludes
    // "Dockerfile" (that would drop the repo's own build file from the context).
    const repoDockerfile = fs.existsSync(path.join(workDir, 'Dockerfile'));
    if (repoDockerfile) {
      await this.log(
        deploymentId,
        'Repository provides a Dockerfile — building with it (skipping nixpacks/fallback)',
      );
      // Respect the repo's own .dockerignore. If it has none, add a minimal one
      // that only drops .git from the context — crucially NOT "Dockerfile",
      // which the repo needs in the build context.
      if (!fs.existsSync(path.join(workDir, '.dockerignore'))) {
        fs.writeFileSync(path.join(workDir, '.dockerignore'), '.git\n', 'utf8');
      }
      await this.runDockerBuild(deploymentId, workDir, imageTag, noCache);
      return;
    }

    const nixpacksAvailable = await this.checkNixpacks();
    this.debug(deploymentId, `builder selection: nixpacks=${nixpacksAvailable} noCache=${noCache}`);

    if (nixpacksAvailable) {
      await this.log(deploymentId, 'nixpacks binary found — building with nixpacks');
      // Pass arguments as an array (no shell) so a malicious buildCmd cannot be
      // interpreted as host shell. Run with cwd=workDir instead of `cd`.
      const args = ['build', '.', '--name', imageTag];
      if (app.buildCmd) {
        args.push('--build-cmd', app.buildCmd);
      }
      if (noCache) {
        // nixpacks passes through Docker build flags via --no-cache.
        args.push('--no-cache');
      }
      await this.runCommand(deploymentId, 'nixpacks', args, workDir);
    } else {
      await this.log(deploymentId, 'nixpacks binary not found, using Dockerfile fallback');
      await this.generateDockerfile(workDir, app, deploymentId);
      // Keep .git and the generated Dockerfile out of the image build context.
      fs.writeFileSync(
        path.join(workDir, '.dockerignore'),
        ['.git', 'Dockerfile', '.dockerignore'].join('\n'),
        'utf8',
      );
      await this.runDockerBuild(deploymentId, workDir, imageTag, noCache);
    }
  }

  private async checkNixpacks(): Promise<boolean> {
    try {
      execSync('which nixpacks', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private async generateDockerfile(
    workDir: string,
    app: { buildCmd?: string | null; outputDir?: string | null; type: string },
    deploymentId?: string,
  ): Promise<void> {
    const hasPackageJson = fs.existsSync(path.join(workDir, 'package.json'));

    // SPA-aware nginx config: serve real files, but fall back to /index.html
    // for unknown paths so client-side routes (e.g. /services on a React Router
    // app) work on direct load / refresh instead of returning 404. Stock
    // nginx:alpine has no such fallback, which 404s every deep link. Written
    // inside the image via a RUN heredoc (not a context file) so nothing extra
    // lands in the build context or the served html root.
    const spaConfStep = [
      'RUN printf \'%s\\n\' \\',
      `  'server {' \\`,
      `  '    listen ${APP_LISTEN_PORT};' \\`,
      "  '    server_name _;' \\",
      "  '    root /usr/share/nginx/html;' \\",
      "  '    index index.html;' \\",
      "  '    location / { try_files $uri $uri/ /index.html; }' \\",
      "  '}' > /etc/nginx/conf.d/default.conf",
    ].join('\n');

    // "No content" guard, baked into every image. Two parts:
    //  1. Purge stock nginx's html dir BEFORE copying the build output, so its
    //     "Welcome to nginx!" index.html can never survive a contentless deploy.
    //  2. After the copy, if there is still no index.html at the web root, drop
    //     in our branded "nothing deployed here" page (404) instead. This is the
    //     last RUN, so it sees the final state of the copied output.
    // Without this, an empty build (wrong output dir, empty repo) leaves the web
    // root either empty or carrying nginx's default page — the visitor sees raw
    // nginx branding instead of a page we control.
    const purgeStockHtmlStep = 'RUN rm -rf /usr/share/nginx/html/* /usr/share/nginx/html/.??*';
    const emptyContentGuardStep = [
      'RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \\',
      `      echo ${EMPTY_CONTENT_HTML_B64} | base64 -d > /usr/share/nginx/html/index.html && \\`,
      // Serve the placeholder for every path with a 404 — there is no real app.
      "      printf '%s\\n' \\",
      `        'server {' \\`,
      `        '    listen ${APP_LISTEN_PORT};' \\`,
      "        '    server_name _;' \\",
      "        '    root /usr/share/nginx/html;' \\",
      "        '    location / { return 404; }' \\",
      "        '    error_page 404 /index.html;' \\",
      "        '    location = /index.html { internal; add_header Cache-Control \"no-store\" always; }' \\",
      "        '}' > /etc/nginx/conf.d/default.conf; \\",
      '    fi',
    ].join('\n');

    let dockerfile: string;
    if (hasPackageJson) {
      // Node project: install deps, run the build, serve the output dir.
      const buildCmd = app.buildCmd ?? 'npm install && npm run build';
      const outputDir = app.outputDir ?? 'dist';
      dockerfile = [
        'FROM node:20-alpine AS builder',
        'WORKDIR /app',
        'COPY package*.json ./',
        'RUN npm install --legacy-peer-deps',
        'COPY . .',
        `RUN ${buildCmd}`,
        '',
        'FROM nginx:alpine',
        purgeStockHtmlStep,
        spaConfStep,
        'COPY --from=builder /app/' + outputDir + ' /usr/share/nginx/html',
        emptyContentGuardStep,
        `EXPOSE ${APP_LISTEN_PORT}`,
        'CMD ["nginx", "-g", "daemon off;"]',
      ].join('\n');
      if (deploymentId) {
        this.debug(deploymentId, 'Dockerfile: detected package.json — Node build + nginx serve (SPA fallback, no-content guard)');
      }
    } else {
      // Plain static site (no package.json): serve the repo files directly.
      dockerfile = [
        'FROM nginx:alpine',
        purgeStockHtmlStep,
        spaConfStep,
        'COPY . /usr/share/nginx/html',
        emptyContentGuardStep,
        `EXPOSE ${APP_LISTEN_PORT}`,
        'CMD ["nginx", "-g", "daemon off;"]',
      ].join('\n');
      if (deploymentId) {
        this.debug(deploymentId, 'Dockerfile: no package.json — serving static files directly via nginx (SPA fallback, no-content guard)');
      }
    }

    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile, 'utf8');
  }

  // Generate the Dockerfile for a FULL Frappe bench. The apps installed on the
  // bench come from the App's FrappeApp list (each a git url + branch), NOT a
  // repo apps.json: we synthesize the apps.json from the list. Frappe core is
  // always the first entry (bench requires it). We build on the configured base
  // image (settings/env FRAPPE_BASE_IMAGE), run `bench init` against the
  // generated apps.json (each app fetched with `bench get-app`), then
  // `bench build` to compile assets. The container runs all Frappe processes
  // (gunicorn web + socketio + workers + scheduler) via honcho, on port 8000.
  //
  // Site creation/migration is NOT done here — it happens at deploy time
  // against the persistent sites volume (see ensureFrappeSite), because the
  // site + its database are stateful and must survive image rebuilds.
  private async generateFrappeDockerfile(
    workDir: string,
    frappeApps: FrappeAppSpec[],
    frappeBranch: string,
    deploymentId?: string,
  ): Promise<void> {
    const configuredBase = await this.settings.frappeBaseImage();
    // The base image tag should track the chosen Frappe version. When the
    // configured base follows the `frappe/build:<tag>` convention, swap its tag
    // for the selected version (e.g. version-14). Otherwise use it verbatim
    // (the operator pinned a specific image on purpose).
    const baseImage = /^frappe\/build:/.test(configuredBase)
      ? `frappe/build:${frappeBranch}`
      : configuredBase;

    // Synthesize the frappe_docker-style apps.json. Frappe core is always first,
    // pinned to the chosen framework version. Each extra app is a {url, branch}
    // entry (defaulting to the framework version); bench fetches them in order.
    const appsJson: Array<{ url: string; branch: string }> = [
      { url: 'https://github.com/frappe/frappe', branch: frappeBranch },
    ];
    for (const a of frappeApps) {
      if (!a.gitUrl) continue;
      appsJson.push({ url: a.gitUrl, branch: a.branch || frappeBranch });
    }
    const appsJsonStr = JSON.stringify(appsJson, null, 2);
    fs.writeFileSync(path.join(workDir, 'apps.json'), appsJsonStr, 'utf8');

    // bench init reads the apps from apps.json (base64-encoded into the image as
    // frappe_docker expects). We keep the bench under /home/frappe/frappe-bench
    // — the conventional location the base image's frappe user owns.
    const dockerfile = [
      `FROM ${baseImage}`,
      'USER frappe',
      'WORKDIR /home/frappe',
      // Provide the synthesized apps.json to bench init.
      'COPY --chown=frappe:frappe apps.json /opt/frappe/apps.json',
      'RUN export APPS_JSON_BASE64=$(base64 -w 0 /opt/frappe/apps.json) && \\',
      `    bench init \\`,
      `      --frappe-branch ${frappeBranch} \\`,
      '      --apps_path /opt/frappe/apps.json \\',
      '      --no-procfile \\',
      '      --no-backups \\',
      '      --skip-redis-config-generation \\',
      '      --verbose \\',
      '      /home/frappe/frappe-bench',
      'WORKDIR /home/frappe/frappe-bench',
      // Compile JS/CSS assets for all installed apps.
      'RUN bench build --production || bench build',
      'EXPOSE 8000',
      // honcho runs every process from the bench Procfile (web + socketio +
      // queue workers + scheduler). The Procfile is generated at deploy time by
      // the site bootstrap step (it depends on the configured redis/db), so the
      // CMD just starts honcho against the bench dir.
      'CMD ["honcho", "start"]',
    ].join('\n');

    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile, 'utf8');
    if (deploymentId) {
      this.debug(
        deploymentId,
        `Frappe Dockerfile written (base=${baseImage}, apps=${appsJson.length}); site bootstrap at deploy time`,
      );
    }
  }

  // Create the Frappe site on the first deploy, or migrate it on subsequent
  // deploys. Runs a ONE-SHOT container from the freshly built image with the
  // app's persistent sites/ volume mounted, so the site dir + its data survive
  // across redeploys. Output is streamed through the normal log store.
  //
  // First deploy (no sites/<site> in the volume):
  //   - point the bench at the managed MariaDB + Redis,
  //   - `bench new-site <site>` with the MariaDB root password (Frappe creates
  //     its own site DB) and the generated admin password,
  //   - install every app present in the bench onto the site,
  //   - generate the Procfile honcho will run, and mark the site as the default.
  // Subsequent deploys (site dir already present):
  //   - `bench --site <site> migrate` to apply schema changes for the new code.
  private async ensureFrappeSite(
    deploymentId: string,
    app: { id: string; subdomain: string; frappeSiteName: string | null },
    imageTag: string,
    networkMode: string,
    env: Record<string, string>,
  ): Promise<void> {
    const site = app.frappeSiteName as string;
    const bench = '/home/frappe/frappe-bench';
    const volume = `zonal-frappe-${app.subdomain}`;
    const admin = await this.mariadbProvision.adminCredentials();

    // The bench step inside the container reaches MariaDB/Redis by their
    // in-network service names (DB_HOST/REDIS_* in `env`), NOT the API's admin
    // host. Pass the MariaDB ROOT password so `bench new-site` can create the
    // site database; the in-network DB host is env.DB_HOST.
    const dbHost = env.DB_HOST;

    // Build a shell script that decides new-site vs migrate based on whether the
    // site dir already exists in the mounted volume. Configure common bench
    // settings (db host, redis) first so both paths use the managed services.
    const script = [
      'set -e',
      `cd ${bench}`,
      // Point bench at the managed services (idempotent; safe on every run).
      `bench set-config -g db_host "${dbHost}"`,
      `bench set-config -g redis_cache "$REDIS_CACHE"`,
      `bench set-config -g redis_queue "$REDIS_QUEUE"`,
      `bench set-config -g redis_socketio "$REDIS_SOCKETIO"`,
      // Regenerate the Procfile honcho runs (web/socketio/workers/scheduler).
      'bench setup procfile || true',
      `if [ -d "${bench}/sites/${site}" ]; then`,
      `  echo "[zonal] site ${site} exists — running bench migrate";`,
      `  bench --site ${site} migrate;`,
      'else',
      `  echo "[zonal] creating new Frappe site ${site}";`,
      `  bench new-site ${site} \\`,
      '    --no-mariadb-socket \\',
      '    --mariadb-root-username "$MARIADB_ROOT_USER" \\',
      '    --mariadb-root-password "$MARIADB_ROOT_PASSWORD" \\',
      '    --admin-password "$ADMIN_PASSWORD" \\',
      '    --db-name "$DB_NAME";',
      // Install every app that is part of this bench onto the new site.
      `  for a in $(bench --site ${site} list-apps 2>/dev/null || cat ${bench}/sites/apps.txt); do \\`,
      `    bench --site ${site} install-app "$a" || true; \\`,
      '  done;',
      `  bench use ${site};`,
      'fi',
    ].join('\n');

    // Env for the one-shot bootstrap container: the site/db/redis env plus the
    // MariaDB root credentials (needed only here, for new-site).
    const oneShotEnv: Record<string, string> = {
      ...env,
      MARIADB_ROOT_USER: admin.user,
      MARIADB_ROOT_PASSWORD: admin.password,
    };

    await this.info(deploymentId, `Setting up Frappe site ${site} (new-site or migrate)`);
    await this.runFrappeOneShot(
      deploymentId,
      imageTag,
      volume,
      networkMode,
      oneShotEnv,
      ['bash', '-lc', script],
    );

    // The bench image was built with every configured app, and the bootstrap
    // installs all of them on the site — so mark them installed for the UI.
    await this.prisma.frappeApp.updateMany({
      where: { appId: app.id },
      data: { installed: true },
    });
    await this.info(deploymentId, `Frappe site ${site} ready`);
  }

  // Run a one-shot container from the built image with the sites/ volume mounted,
  // stream its logs, remove it when done, and reject if it exits non-zero.
  private async runFrappeOneShot(
    deploymentId: string,
    imageTag: string,
    volume: string,
    networkMode: string,
    env: Record<string, string>,
    cmd: string[],
  ): Promise<void> {
    const container = await this.docker.createContainer({
      Image: imageTag,
      Cmd: cmd,
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
      HostConfig: {
        NetworkMode: networkMode,
        Binds: [`${volume}:/home/frappe/frappe-bench/sites`],
        AutoRemove: false,
      },
    });

    try {
      const stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });
      stream.on('data', (chunk: Buffer) => {
        // Docker multiplexes stdout/stderr with an 8-byte header per frame; strip
        // it best-effort and emit clean lines.
        const text = chunk.toString('utf8').replace(/[\x00-\x08]/g, '');
        for (const line of text.split('\n')) {
          const trimmed = line.replace(/[\x0e-\x1f]/g, '').trimEnd();
          if (trimmed) this.logSync(deploymentId, trimmed);
        }
      });

      await container.start();
      const result = await container.wait();
      const code = (result as { StatusCode?: number }).StatusCode ?? 0;
      if (code !== 0) {
        throw new Error(`Frappe site bootstrap exited with code ${code}`);
      }
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // Already gone — ignore.
      }
    }
  }

  // Tail a freshly-started Node-RED container's logs into the deploy log so the
  // user can watch the runtime boot. Follows the stream until Node-RED reports
  // it is up ("Server now running" / "Started flows") or a timeout elapses —
  // whichever comes first — then detaches (the container keeps running). The
  // detach never throws: this is observability only and must not fail a deploy
  // whose container already started successfully.
  private async tailNodeRedStartup(
    deploymentId: string,
    container: Docker.Container,
    timeoutMs = 25000,
  ): Promise<void> {
    await this.info(deploymentId, 'Starting Node-RED — streaming startup logs');
    try {
      const stream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 0,
        timestamps: false,
      })) as unknown as NodeJS.ReadableStream & { destroy?: () => void };

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            stream.destroy?.();
          } catch {
            // Already closed — ignore.
          }
          resolve();
        };

        const timer = setTimeout(() => {
          this.logSync(
            deploymentId,
            '@debug Node-RED startup log tail timed out — instance continues in the background',
          );
          finish();
        }, timeoutMs);

        stream.on('data', (chunk: Buffer) => {
          // Docker multiplexes stdout/stderr with an 8-byte header per frame;
          // strip the control bytes and emit clean lines.
          const text = chunk.toString('utf8').replace(/[\x00-\x08]/g, '');
          for (const raw of text.split('\n')) {
            const line = raw.replace(/[\x0e-\x1f]/g, '').trimEnd();
            if (!line) continue;
            this.logSync(deploymentId, line);
            // Node-RED prints these once the editor + flow runtime are up.
            if (/Server now running|Started flows|Started modules/i.test(line)) {
              this.logSync(deploymentId, '@info Node-RED is up and serving the editor');
              finish();
            }
          }
        });
        stream.on('error', finish);
        stream.on('end', finish);
        stream.on('close', finish);
      });
    } catch (err) {
      // Couldn't attach — note it but don't fail the deploy.
      this.debug(
        deploymentId,
        `could not tail Node-RED logs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Pull an image if it isn't already present locally, streaming pull progress
  // to the deploy log. Used for the official Node-RED image (no build step).
  // When `showProgress` is set, per-layer status is surfaced as normal output
  // (the Node-RED "install" the user wants to see); otherwise it stays as dimmed
  // debug (e.g. the internal busybox helper pull).
  private async ensureImage(
    deploymentId: string,
    image: string,
    showProgress = false,
  ): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      if (showProgress) {
        await this.info(deploymentId, `Image ${image} already present locally`);
      } else {
        this.debug(deploymentId, `image ${image} already present`);
      }
      return;
    } catch {
      // Not present — pull it.
    }
    if (showProgress) {
      await this.info(deploymentId, `${image}: Pulling from Docker Hub`);
    }
    const stream = await this.docker.pull(image);
    // Collapse Docker's chatty per-chunk progress into one line per layer state
    // transition (e.g. "Downloading" → "Download complete" → "Pull complete").
    const lastStatus = new Map<string, string>();
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => (err ? reject(err) : resolve()),
        (event: { status?: string; id?: string }) => {
          if (!event.status || !event.id) return;
          if (showProgress) {
            // Only emit when this layer's status actually changes, so the log
            // shows the real pull (layer-by-layer) without thousands of lines.
            if (lastStatus.get(event.id) !== event.status) {
              lastStatus.set(event.id, event.status);
              this.logSync(deploymentId, `${event.id}: ${event.status}`);
            }
          } else {
            this.debug(deploymentId, `pull ${event.id}: ${event.status}`);
          }
        },
      );
    });
  }

  // Write the generated settings.js into the Node-RED data volume via a
  // short-lived busybox container (the volume isn't on the host FS). Content is
  // passed base64 so nothing in it can break the shell command.
  private async writeNodeRedSettings(
    deploymentId: string,
    volume: string,
    settings: string,
  ): Promise<void> {
    await this.ensureImage(deploymentId, 'busybox:1.36');
    const b64 = Buffer.from(settings, 'utf8').toString('base64');
    // Write settings.js, then hand the whole /data volume to the Node-RED user
    // (uid:gid 1000:1000). The official image runs as that non-root user, so an
    // unowned (root) volume makes Node-RED fail to start with EACCES on
    // /data/node_modules. chown -R is idempotent and cheap on the small dir.
    const script =
      `echo ${b64} | base64 -d > ${NODERED_DATA_DIR}/settings.js && ` +
      `chown -R ${NODERED_UID}:${NODERED_GID} ${NODERED_DATA_DIR}`;
    const container = await this.docker.createContainer({
      Image: 'busybox:1.36',
      Cmd: ['sh', '-c', script],
      HostConfig: {
        Binds: [`${volume}:${NODERED_DATA_DIR}`],
        AutoRemove: false,
      },
    });
    try {
      await container.start();
      const result = await container.wait();
      const code = (result as { StatusCode?: number }).StatusCode ?? 0;
      if (code !== 0) {
        throw new Error(`writing Node-RED settings.js exited with code ${code}`);
      }
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // Already gone — ignore.
      }
    }
  }

  private async runDockerBuild(
    deploymentId: string,
    workDir: string,
    imageTag: string,
    noCache = false,
  ): Promise<void> {
    await this.log(deploymentId, `Building Docker image: ${imageTag}${noCache ? ' (--no-cache)' : ''}`);
    // Build with whichever builder the daemon provides. We intentionally do NOT
    // pass `--progress=plain`: it is BuildKit-only and the legacy builder rejects
    // it (exit 125). When BuildKit *is* active (DOCKER_BUILDKIT=1 in the
    // environment, or a daemon that defaults to it) `docker build` still streams
    // full logs to stderr, which we capture. `--no-cache` is valid on both.
    const args = ['build'];
    if (noCache) args.push('--no-cache');
    args.push('-t', imageTag, workDir);
    await this.runCommand(deploymentId, 'docker', args);
    await this.log(deploymentId, 'Docker build complete');
  }

  // Runs a program with an explicit argument array and no shell, so untrusted
  // values (image tags, build commands, paths) cannot inject host shell syntax.
  private async runCommand(
    deploymentId: string,
    file: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): Promise<void> {
    const display = `${file} ${args.join(' ')}`;
    const start = Date.now();
    this.debug(deploymentId, `exec: ${display}${cwd ? ` (cwd=${cwd})` : ''}`);
    return new Promise((resolve, reject) => {
      // Larger buffer so big build outputs are not truncated.
      const child = execFile(file, args, {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env,
      });

      child.stdout?.on('data', (data: string) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logSync(deploymentId, line);
        }
      });

      child.stderr?.on('data', (data: string) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logSync(deploymentId, `[stderr] ${line}`);
        }
      });

      child.on('close', (code) => {
        this.debug(
          deploymentId,
          `exec done: ${file} exited code=${code} (${this.elapsed(start)})`,
        );
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}: ${display}`));
        }
      });

      child.on('error', (err) => {
        this.debug(deploymentId, `exec error: ${file}: ${err.message}`);
        reject(err);
      });
    });
  }

  // Clear build caches so a retry does not reuse a poisoned layer/dir. Best
  // effort: cache-clearing failures must not abort the deploy.
  private async clearCaches(deploymentId: string, subdomain: string): Promise<void> {
    // 1. Remove any stale build working directory.
    const workDir = `/tmp/zonal-build-${deploymentId}`;
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.debug(deploymentId, `cleared stale work dir ${workDir}`);
      }
    } catch (err) {
      this.debug(deploymentId, `work dir clear failed: ${String(err)}`);
    }

    // 2. Remove previously built images for this app so we don't ship a stale tag.
    try {
      await this.runCommandSafe(deploymentId, 'bash', [
        '-c',
        `docker images --filter=reference='zonal-app-${subdomain}:*' -q | xargs -r docker rmi -f`,
      ]);
      this.debug(deploymentId, `pruned old images for ${subdomain}`);
    } catch (err) {
      this.debug(deploymentId, `image prune failed: ${String(err)}`);
    }

    // 3. Prune the Docker builder cache (dangling layers from the failed build).
    try {
      await this.runCommandSafe(deploymentId, 'docker', ['builder', 'prune', '-f']);
      this.debug(deploymentId, 'pruned docker builder cache');
    } catch (err) {
      this.debug(deploymentId, `builder prune failed: ${String(err)}`);
    }
  }

  // Like runCommand but never rejects — used for best-effort cache clearing.
  private async runCommandSafe(
    deploymentId: string,
    file: string,
    args: string[],
  ): Promise<void> {
    try {
      await this.runCommand(deploymentId, file, args);
    } catch (err) {
      this.debug(deploymentId, `(ignored) ${file} failed: ${String(err)}`);
    }
  }

  // ---- Structured logging ----
  //
  // Each emitted line is prefixed with a level token the dashboard parses and
  // strips to render a Netlify-style grouped, timed deploy log:
  //   @stage <name>        — begin a stage group (e.g. "Building")
  //   @ok <name>|<time>     — stage finished OK, with elapsed time
  //   @fail <name>|<reason> — stage failed
  //   @info <text>          — normal informational line
  //   @cmd <text>           — a command being executed (accent/monospace)
  //   @debug <text>         — verbose diagnostic (dimmed, collapsible)
  //   (anything else)       — raw program output under the current stage
  // Older clients that don't parse the tokens still get readable text.

  private logSync(deploymentId: string, line: string): void {
    // Fire-and-forget append to Redis
    this.logStore.append(deploymentId, line).catch(() => {});
  }

  private async log(deploymentId: string, line: string): Promise<void> {
    console.log(`[deploy:${deploymentId}] ${line}`);
    await this.logStore.append(deploymentId, line);
  }

  // Informational line shown in the main flow.
  private async info(deploymentId: string, text: string): Promise<void> {
    await this.log(deploymentId, `@info ${text}`);
  }

  // Begin a named stage group.
  private async stageStart(deploymentId: string, name: string): Promise<void> {
    await this.log(deploymentId, `@stage ${name}`);
  }

  // Mark the current stage finished with its elapsed time.
  private async stageOk(deploymentId: string, name: string, startMs: number): Promise<void> {
    await this.log(deploymentId, `@ok ${name}|${this.elapsed(startMs)}`);
  }

  private async stageFail(deploymentId: string, name: string, reason: string): Promise<void> {
    await this.log(deploymentId, `@fail ${name}|${reason}`);
  }

  // Verbose debug line. Captured to the log store (so it streams to the UI,
  // where it renders dimmed) and mirrored to stdout. DEPLOY_DEBUG=false silences.
  private debug(deploymentId: string, line: string): void {
    if (process.env.DEPLOY_DEBUG === 'false') return;
    console.debug(`[deploy:${deploymentId}] [debug] ${line}`);
    this.logSync(deploymentId, `@debug ${line}`);
  }

  private elapsed(startMs: number): string {
    const ms = Date.now() - startMs;
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}m ${rem}s`;
  }

  private listDir(dir: string): string {
    try {
      return fs.readdirSync(dir).slice(0, 50).join(', ') || '(empty)';
    } catch {
      return '(unreadable)';
    }
  }

  private async markFailed(
    deploymentId: string,
    appId: string,
    reason: string,
    step = 'Deploy',
  ): Promise<void> {
    await this.log(deploymentId, `Deployment failed: ${reason}`);
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'failed' },
    });
    const app = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'failed' },
      select: {
        name: true,
        project: { select: { userId: true, organizationId: true } },
      },
    });

    // Notify the app owner that the deployment failed. The message stays
    // CONCISE — it names the app and the failing step only; the full error text
    // lives in metadata.reason for the analysis page, so we never dump a wall of
    // build output into the toast/bell.
    try {
      await this.notifications.create({
        userId: app.project.userId,
        organizationId: app.project.organizationId,
        type: 'deployment_failed',
        message: `Deployment of "${app.name}" failed at "${step}".`,
        metadata: { appId, deploymentId, step, reason, appName: app.name },
      });
    } catch (err) {
      this.debug(deploymentId, `failed to create notification: ${String(err)}`);
    }
  }

  private async stopContainerIfExists(deploymentId: string, name: string): Promise<void> {
    try {
      const container = this.docker.getContainer(name);
      const info = await container.inspect();
      this.debug(deploymentId, `existing container ${name}: running=${info.State.Running} — removing`);
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove({ force: true });
      this.debug(deploymentId, `removed existing container ${name}`);
    } catch {
      // Container does not exist — that is fine
      this.debug(deploymentId, `no existing container ${name} to remove`);
    }
  }

  // Capture enough of the currently-running container to recreate it verbatim
  // if a deploy swap fails. Returns null when there is no existing container
  // (e.g. the very first deploy) — nothing to roll back to in that case.
  private async snapshotContainer(
    deploymentId: string,
    name: string,
  ): Promise<ContainerBackup | null> {
    try {
      const info = await this.docker.getContainer(name).inspect();
      // Pin to the image *ID* (not tag): even if the tag is later pruned, the
      // ID keeps the layers alive as long as we recreate from it promptly.
      const image = info.Image;
      const networkMode =
        info.HostConfig?.NetworkMode || process.env.DOCKER_NETWORK || 'zonal_net';
      return {
        image,
        labels: info.Config?.Labels ?? {},
        env: info.Config?.Env ?? [],
        networkMode,
        restartPolicy: info.HostConfig?.RestartPolicy?.Name || 'unless-stopped',
      };
    } catch {
      this.debug(deploymentId, `no running container ${name} to snapshot`);
      return null;
    }
  }

  // Recreate the previous container from a snapshot. Best-effort: this runs on
  // the failure path, so it must not throw — a failure here is logged and the
  // caller reports the site may be down.
  private async restoreContainer(
    deploymentId: string,
    name: string,
    backup: ContainerBackup,
  ): Promise<boolean> {
    try {
      // Remove whatever half-created container may exist under the name first.
      await this.stopContainerIfExists(deploymentId, name);
      const container = await this.docker.createContainer({
        Image: backup.image,
        name,
        Labels: backup.labels,
        HostConfig: {
          NetworkMode: backup.networkMode,
          RestartPolicy: { Name: backup.restartPolicy as Docker.HostRestartPolicy['Name'] },
        },
        Env: backup.env,
      });
      await container.start();
      this.debug(
        deploymentId,
        `restored container ${name} from image ${backup.image.slice(0, 19)}`,
      );
      return true;
    } catch (err) {
      this.debug(deploymentId, `restore failed: ${String(err)}`);
      return false;
    }
  }
}

interface ContainerBackup {
  image: string;
  labels: Record<string, string>;
  env: string[];
  networkMode: string;
  restartPolicy: string;
}

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

export interface DeployJobData {
  deploymentId: string;
  appId: string;
  ref?: string;
}

@Processor(DEPLOY_QUEUE)
export class DeployProcessor extends WorkerHost {
  private docker: Docker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logStore: LogStoreService,
  ) {
    super();
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async process(job: Job<DeployJobData>): Promise<void> {
    const { deploymentId, appId } = job.data;

    await this.log(deploymentId, `Starting deployment ${deploymentId}`);

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'building' },
    });

    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { envVars: true },
    });

    if (!app) {
      await this.fail(deploymentId, appId, 'App not found');
      return;
    }

    try {
      const workDir = `/tmp/zonal-build-${deploymentId}`;
      fs.mkdirSync(workDir, { recursive: true });

      // Step 1: Clone repo
      if (app.source === 'git' && app.repoUrl) {
        await this.log(deploymentId, `Cloning ${app.repoUrl} branch ${app.branch ?? 'main'}`);
        const git = simpleGit();
        await git.clone(app.repoUrl, workDir, ['--depth', '1', '--branch', app.branch ?? 'main']);
        await this.log(deploymentId, 'Clone complete');
      } else {
        await this.log(deploymentId, 'Source is upload — skipping clone (upload handler not yet wired)');
      }

      // Step 2: Build image
      const imageTag = `zonal-app-${app.subdomain}:${deploymentId}`;
      await this.buildImage(deploymentId, workDir, imageTag, app);

      // Step 3: Stop old container if running
      await this.stopContainerIfExists(app.subdomain);

      // Step 4: Start new container
      const containerPort = 80;
      const container = await this.docker.createContainer({
        Image: imageTag,
        name: `zonal-${app.subdomain}`,
        Labels: {
          'traefik.enable': 'true',
          [`traefik.http.routers.${app.subdomain}.rule`]: `Host(\`${app.subdomain}.localhost\`)`,
          [`traefik.http.services.${app.subdomain}.loadbalancer.server.port`]: String(containerPort),
        },
        HostConfig: {
          NetworkMode: process.env.DOCKER_NETWORK ?? 'zonal_net',
          RestartPolicy: { Name: 'unless-stopped' },
        },
        Env: app.envVars.map((v) => `${v.key}=${v.value}`),
      });

      await container.start();
      await this.log(deploymentId, `Container started: zonal-${app.subdomain}`);
      await this.log(deploymentId, `App available at http://${app.subdomain}.localhost`);

      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: { status: 'live', imageRef: imageTag },
      });

      await this.prisma.app.update({
        where: { id: appId },
        data: { status: 'live' },
      });

      await this.log(deploymentId, 'Deployment complete — status: live');

      // Cleanup build dir
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(deploymentId, appId, message);
    }
  }

  private async buildImage(
    deploymentId: string,
    workDir: string,
    imageTag: string,
    app: { buildCmd?: string | null; outputDir?: string | null; type: string },
  ): Promise<void> {
    const nixpacksAvailable = await this.checkNixpacks();

    if (nixpacksAvailable) {
      await this.log(deploymentId, 'nixpacks binary found — building with nixpacks');
      // Pass arguments as an array (no shell) so a malicious buildCmd cannot be
      // interpreted as host shell. Run with cwd=workDir instead of `cd`.
      const args = ['build', '.', '--name', imageTag];
      if (app.buildCmd) {
        args.push('--build-cmd', app.buildCmd);
      }
      await this.runCommand(deploymentId, 'nixpacks', args, workDir);
    } else {
      await this.log(deploymentId, 'nixpacks binary not found, using Dockerfile fallback');
      await this.generateDockerfile(workDir, app);
      await this.runDockerBuild(deploymentId, workDir, imageTag);
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
  ): Promise<void> {
    const buildCmd = app.buildCmd ?? 'npm install && npm run build';
    const outputDir = app.outputDir ?? 'dist';

    const dockerfile = [
      'FROM node:20-alpine AS builder',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install --legacy-peer-deps',
      'COPY . .',
      `RUN ${buildCmd}`,
      '',
      'FROM nginx:alpine',
      'COPY --from=builder /app/' + outputDir + ' /usr/share/nginx/html',
      'EXPOSE 80',
      'CMD ["nginx", "-g", "daemon off;"]',
    ].join('\n');

    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile, 'utf8');
  }

  private async runDockerBuild(
    deploymentId: string,
    workDir: string,
    imageTag: string,
  ): Promise<void> {
    await this.log(deploymentId, `Building Docker image: ${imageTag}`);
    await this.runCommand(deploymentId, 'docker', ['build', '-t', imageTag, workDir]);
    await this.log(deploymentId, 'Docker build complete');
  }

  // Runs a program with an explicit argument array and no shell, so untrusted
  // values (image tags, build commands, paths) cannot inject host shell syntax.
  private async runCommand(
    deploymentId: string,
    file: string,
    args: string[],
    cwd?: string,
  ): Promise<void> {
    const display = `${file} ${args.join(' ')}`;
    return new Promise((resolve, reject) => {
      const child = execFile(file, args, { cwd });

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
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}: ${display}`));
        }
      });

      child.on('error', reject);
    });
  }

  private logSync(deploymentId: string, line: string): void {
    // Fire-and-forget append to Redis
    this.logStore.append(deploymentId, line).catch(() => {});
  }

  private async log(deploymentId: string, line: string): Promise<void> {
    console.log(`[deploy:${deploymentId}] ${line}`);
    await this.logStore.append(deploymentId, line);
  }

  private async fail(deploymentId: string, appId: string, reason: string): Promise<void> {
    await this.log(deploymentId, `Deployment failed: ${reason}`);
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'failed' },
    });
    await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'failed' },
    });
  }

  private async stopContainerIfExists(subdomain: string): Promise<void> {
    const name = `zonal-${subdomain}`;
    try {
      const container = this.docker.getContainer(name);
      const info = await container.inspect();
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove({ force: true });
    } catch {
      // Container does not exist — that is fine
    }
  }
}

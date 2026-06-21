import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DEPLOY_QUEUE, DEPLOY_JOB } from './deploy.constants';
import { DeployJobData } from './deploy.processor';

@Injectable()
export class DeployService {
  constructor(
    @InjectQueue(DEPLOY_QUEUE) private readonly deployQueue: Queue<DeployJobData>,
  ) {}

  async enqueue(data: DeployJobData) {
    // Retry failed deployments automatically with exponential backoff. The
    // processor is idempotent (cleans the build dir, prunes the Docker cache and
    // rebuilds with --no-cache on retries), so re-running a failed job is safe.
    const job = await this.deployQueue.add(DEPLOY_JOB, data, {
      attempts: Number(process.env.DEPLOY_MAX_ATTEMPTS ?? 3),
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    });
    return job;
  }

  async getQueueDepth(): Promise<number> {
    const [waiting, active] = await Promise.all([
      this.deployQueue.getWaitingCount(),
      this.deployQueue.getActiveCount(),
    ]);
    return waiting + active;
  }

  // Cancel any pending/in-progress deploy jobs for an app. Returns the number of
  // jobs removed. Used by the "Cancel build" action so a stuck or unwanted build
  // stops retrying: we drop the job from every non-terminal state so BullMQ won't
  // re-run it (the retry attempts that would otherwise fire). Active jobs whose
  // processor is still running can't be hard-killed from here — removing them
  // prevents further retries, and the caller kills the build containers
  // separately so the current attempt's work is torn down too.
  async cancelForApp(appId: string): Promise<number> {
    // 'waiting'/'delayed' = queued or backing off between retries; 'active' =
    // currently being processed; 'failed' = a prior attempt parked for retry.
    const jobs = await this.deployQueue.getJobs([
      'waiting',
      'delayed',
      'active',
      'failed',
    ]);
    let removed = 0;
    for (const job of jobs) {
      if (job.data?.appId !== appId) continue;
      try {
        await job.remove();
        removed += 1;
      } catch {
        // Active jobs can't always be removed mid-run; ignore and rely on the
        // container teardown + status reset to unstick the app.
      }
    }
    return removed;
  }
}

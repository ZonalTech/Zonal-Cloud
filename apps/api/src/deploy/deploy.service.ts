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
    const job = await this.deployQueue.add(DEPLOY_JOB, data, {
      attempts: 1,
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
}

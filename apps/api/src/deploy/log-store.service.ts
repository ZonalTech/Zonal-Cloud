import { Injectable } from '@nestjs/common';
import { InjectRedis } from '../common/inject-redis.decorator';
import Redis from 'ioredis';

const LOG_KEY_PREFIX = 'deploy:logs:';
const LOG_TTL_SECONDS = 3600; // 1 hour

@Injectable()
export class LogStoreService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async append(deploymentId: string, line: string): Promise<void> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    await this.redis.rpush(key, line);
    await this.redis.expire(key, LOG_TTL_SECONDS);
  }

  async getAll(deploymentId: string): Promise<string[]> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    return this.redis.lrange(key, 0, -1);
  }

  async tailStream(deploymentId: string): Promise<AsyncIterable<string>> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    const redis = this.redis;
    let index = 0;

    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            // Poll for new log lines with a short delay
            for (let attempts = 0; attempts < 120; attempts++) {
              const lines = await redis.lrange(key, index, -1);
              if (lines.length > 0) {
                index += lines.length;
                return { value: lines.join('\n'), done: false };
              }
              // Check if deployment is done — if key expired, stop
              const exists = await redis.exists(key);
              if (!exists && attempts > 5) {
                return { value: '', done: true };
              }
              await new Promise((r) => setTimeout(r, 500));
            }
            return { value: '', done: true };
          },
        };
      },
    };
  }
}

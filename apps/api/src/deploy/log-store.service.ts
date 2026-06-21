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
    // Stamp every line with the wall-clock time it was emitted, as a parseable
    // prefix `@ts:<epochMillis>\x1f<line>`. The dashboard splits on \x1f to show
    // a timestamp gutter; older/plain readers can ignore it. \x1f (unit
    // separator) is used so it never collides with real log content.
    const stamped = `@ts:${Date.now()}\x1f${line}`;
    await this.redis.rpush(key, stamped);
    await this.redis.expire(key, LOG_TTL_SECONDS);
  }

  async getAll(deploymentId: string): Promise<string[]> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    return this.redis.lrange(key, 0, -1);
  }

  // Return log lines from `start` (0-based) to the end. Used by the SSE streamer
  // to fetch only lines it hasn't sent yet (cursor-based tailing).
  async getFrom(deploymentId: string, start: number): Promise<string[]> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    return this.redis.lrange(key, start, -1);
  }
}

import { Inject } from '@nestjs/common';

export const REDIS_TOKEN = 'REDIS_CLIENT';

export const InjectRedis = () => Inject(REDIS_TOKEN);

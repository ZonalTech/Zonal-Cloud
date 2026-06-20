import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { DeployService } from './deploy.service';
import { DeployProcessor } from './deploy.processor';
import { LogStoreService } from './log-store.service';
import { DEPLOY_QUEUE } from './deploy.constants';
import { REDIS_TOKEN } from '../common/inject-redis.decorator';
import Redis from 'ioredis';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        },
      }),
    }),
    BullModule.registerQueue({
      name: DEPLOY_QUEUE,
    }),
  ],
  providers: [
    DeployService,
    DeployProcessor,
    LogStoreService,
    {
      provide: REDIS_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new Redis({
          host: config.get<string>('REDIS_HOST') ?? 'localhost',
          port: config.get<number>('REDIS_PORT') ?? 6379,
        });
      },
    },
  ],
  exports: [DeployService, LogStoreService],
})
export class DeployModule {}

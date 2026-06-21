import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { CommonModule } from './common/common.module';
import { RequestContextInterceptor } from './common/request-context.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AppsModule } from './apps/apps.module';
import { AdminModule } from './admin/admin.module';
import { DeployModule } from './deploy/deploy.module';
import { GithubModule } from './github/github.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CommonModule,
    PrismaModule,
    AuthModule,
    AppsModule,
    AdminModule,
    DeployModule,
    GithubModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}

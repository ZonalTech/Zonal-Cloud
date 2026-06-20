import { Module } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { DeployModule } from '../deploy/deploy.module';
import { DeployTokenGuard } from './deploy-token.guard';
import { AuditService } from '../common/audit.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [DeployModule, AuthModule],
  controllers: [AppsController],
  providers: [AppsService, DeployTokenGuard, AuditService],
})
export class AppsModule {}

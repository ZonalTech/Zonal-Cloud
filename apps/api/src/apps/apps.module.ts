import { Module, forwardRef } from '@nestjs/common';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';
import { DeployModule } from '../deploy/deploy.module';
import { DeployTokenGuard } from './deploy-token.guard';
import { AuditService } from '../common/audit.service';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { MariadbProvisionService } from '../database/mariadb-provision.service';
import { PlatformSettingsService } from '../common/platform-settings.service';

@Module({
  imports: [DeployModule, AuthModule, forwardRef(() => GithubModule)],
  controllers: [AppsController],
  providers: [
    AppsService,
    DeployTokenGuard,
    AuditService,
    MariadbProvisionService,
    PlatformSettingsService,
  ],
  exports: [AppsService],
})
export class AppsModule {}

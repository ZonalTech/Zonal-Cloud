import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AiService } from './ai.service';
import { FrappeAdminService } from './frappe-admin.service';
import { DeployModule } from '../deploy/deploy.module';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../common/audit.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsService } from '../common/platform-settings.service';
import { DnsModule } from '../dns/dns.module';

@Module({
  imports: [DeployModule, AuthModule, NotificationsModule, DnsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AiService,
    AuditService,
    FrappeAdminService,
    PlatformSettingsService,
  ],
})
export class AdminModule {}

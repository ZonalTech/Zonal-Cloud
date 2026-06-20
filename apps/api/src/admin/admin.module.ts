import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DeployModule } from '../deploy/deploy.module';
import { AuditService } from '../common/audit.service';

@Module({
  imports: [DeployModule],
  controllers: [AdminController],
  providers: [AdminService, AuditService],
})
export class AdminModule {}

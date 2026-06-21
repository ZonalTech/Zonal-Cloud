import { Module, forwardRef } from '@nestjs/common';
import { GithubController } from './github.controller';
import { GithubService } from './github.service';
import { AuthModule } from '../auth/auth.module';
import { AppsModule } from '../apps/apps.module';
import { AuditService } from '../common/audit.service';

@Module({
  imports: [AuthModule, forwardRef(() => AppsModule)],
  controllers: [GithubController],
  providers: [GithubService, AuditService],
  exports: [GithubService],
})
export class GithubModule {}

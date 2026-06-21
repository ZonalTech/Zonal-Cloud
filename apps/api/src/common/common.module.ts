import { Global, Module } from '@nestjs/common';
import { RequestContextService } from './request-context';
import { UserPurgeService } from './user-purge.service';

/**
 * Global module for cross-cutting request-scoped infrastructure. Exporting from a
 * @Global module means AuditService (provided per feature-module) can inject
 * RequestContextService without each module importing it. UserPurgeService is
 * shared by the admin and self-service account-deletion flows.
 */
@Global()
@Module({
  providers: [RequestContextService, UserPurgeService],
  exports: [RequestContextService, UserPurgeService],
})
export class CommonModule {}

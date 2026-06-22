import { Module } from '@nestjs/common';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';
import { PowerDnsClient } from './powerdns.client';
import { AuditService } from '../common/audit.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Managed DNS hosting product. Customers create zones and records that the
 * platform's PowerDNS nameservers serve authoritatively. AuthModule is imported
 * for the JWT strategy used by JwtAuthGuard; RequestContextService (needed by
 * AuditService) comes from the global CommonModule.
 */
@Module({
  imports: [AuthModule],
  controllers: [DnsController],
  providers: [DnsService, PowerDnsClient, AuditService],
  exports: [DnsService],
})
export class DnsModule {}

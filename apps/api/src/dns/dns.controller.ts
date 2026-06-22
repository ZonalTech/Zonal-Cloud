import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { DnsService } from './dns.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { UpsertRecordDto, DeleteRecordDto } from './dto/record.dto';

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

/**
 * Customer-facing managed DNS endpoints. All routes are org-scoped via the JWT;
 * the service enforces ownership and the DNS add-on quota.
 *
 *   GET    /v1/dns/zones
 *   POST   /v1/dns/zones                       { name }
 *   DELETE /v1/dns/zones/:name
 *   GET    /v1/dns/zones/:name/records
 *   PUT    /v1/dns/zones/:name/records         { name, type, ttl, records[] }
 *   DELETE /v1/dns/zones/:name/records         { name, type }
 */
@Controller('dns')
@UseGuards(JwtAuthGuard)
export class DnsController {
  constructor(private readonly dns: DnsService) {}

  @Get('zones')
  listZones(@CurrentUser() user: AuthUser) {
    return this.dns.listZones(user.organizationId);
  }

  @Post('zones')
  createZone(@CurrentUser() user: AuthUser, @Body() dto: CreateZoneDto) {
    return this.dns.createZone(user.id, user.organizationId, dto);
  }

  @Delete('zones/:name')
  deleteZone(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.dns.deleteZone(user.id, user.organizationId, name);
  }

  @Get('zones/:name/records')
  listRecords(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.dns.listRecords(user.organizationId, name);
  }

  // PUT = create-or-replace the whole RRset for (name, type).
  @Put('zones/:name/records')
  upsertRecord(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() dto: UpsertRecordDto,
  ) {
    return this.dns.upsertRecord(user.id, user.organizationId, name, dto);
  }

  @Delete('zones/:name/records')
  deleteRecord(
    @CurrentUser() user: AuthUser,
    @Param('name') name: string,
    @Body() dto: DeleteRecordDto,
  ) {
    return this.dns.deleteRecord(user.id, user.organizationId, name, dto);
  }
}

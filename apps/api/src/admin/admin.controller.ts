import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

interface AuthUser {
  id: string;
  orgId: string;
  role: string;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'superadmin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Post('users/:id/suspend')
  suspendUser(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.suspendUser(actor.id, id);
  }

  @Post('users/:id/role')
  updateRole(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.adminService.updateRole(actor.id, id, dto);
  }

  @Get('orgs')
  listOrgs() {
    return this.adminService.listOrgs();
  }

  @Post('orgs/:id/quota')
  updateQuota(
    @CurrentUser() actor: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateQuotaDto,
  ) {
    return this.adminService.updateQuota(actor.id, id, dto);
  }

  @Get('apps')
  listAllApps() {
    return this.adminService.listAllApps();
  }

  @Post('apps/:id/stop')
  adminStopApp(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.adminService.adminStopApp(actor.id, id);
  }

  @Get('metrics')
  getMetrics() {
    return this.adminService.getMetrics();
  }

  @Get('audit')
  getAuditLogs() {
    return this.adminService.getAuditLogs();
  }
}

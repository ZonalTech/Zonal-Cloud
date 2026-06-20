import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppsService } from './apps.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DeployTokenGuard } from './deploy-token.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { CreateAppDto } from './dto/create-app.dto';
import { DeployDto } from './dto/deploy.dto';
import { CreateTokenDto } from './dto/create-token.dto';
import { Request } from 'express';

interface AuthUser {
  id: string;
  orgId: string;
  role: string;
}

@Controller('apps')
export class AppsController {
  constructor(private readonly appsService: AppsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  listApps(@CurrentUser() user: AuthUser) {
    return this.appsService.listApps(user.id, user.orgId);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  createApp(@CurrentUser() user: AuthUser, @Body() dto: CreateAppDto) {
    return this.appsService.createApp(user.id, user.orgId, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  getApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.getApp(user.id, user.orgId, id);
  }

  @Post(':id/deploy')
  @UseGuards(DeployTokenGuard)
  async deploy(
    @Req() req: Request & { user: AuthUser; deployTokenApp?: string },
    @Param('id') id: string,
    @Body() dto: DeployDto,
  ) {
    const user = req.user;
    // Deploy token path — no orgId check needed (guard verified token belongs to app)
    if (req.deployTokenApp) {
      return this.appsService.deployByToken(id, dto);
    }
    return this.appsService.deploy(user.id, user.orgId, id, dto);
  }

  @Sse(':id/logs')
  @UseGuards(JwtAuthGuard)
  streamLogs(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Observable<MessageEvent> {
    return this.appsService.streamLogs(user.orgId, id).pipe(
      map((event) => ({
        data: event.data,
        type: 'log',
      })),
    );
  }

  @Post(':id/stop')
  @UseGuards(JwtAuthGuard)
  stopApp(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.stopApp(user.id, user.orgId, id);
  }

  @Post(':id/tokens')
  @UseGuards(JwtAuthGuard)
  createToken(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTokenDto,
  ) {
    return this.appsService.createToken(user.id, user.orgId, id, dto);
  }

  @Get(':id/tokens')
  @UseGuards(JwtAuthGuard)
  listTokens(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.appsService.listTokens(user.id, user.orgId, id);
  }
}

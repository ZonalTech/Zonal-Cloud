import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

interface AuthUser {
  id: string;
  // Present only on impersonation sessions.
  imp?: { by: string; email: string };
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Notifications belong to the real account owner. During an impersonation
  // session the admin must not see or clear the user's private notices (that
  // would defeat the "you were impersonated" notice itself), so we refuse.
  private assertNotImpersonating(user: AuthUser): void {
    if (user.imp) {
      throw new ForbiddenException({
        code: 'IMPERSONATION_FORBIDDEN',
        message: 'Notifications are not available during an impersonation session.',
      });
    }
  }

  // The bell's feed: recent notifications (read AND unread) plus the live
  // unread count for the badge. Opening the panel must NOT clear the badge, so
  // the count is decoupled from what's listed.
  @Get()
  list(@CurrentUser() user: AuthUser) {
    this.assertNotImpersonating(user);
    return this.notifications.listRecent(user.id);
  }

  // The user's full deployment-failure history for the Errors page. Declared
  // BEFORE `:id` so the static path isn't captured by the param route.
  @Get('errors')
  listDeploymentFailures(@CurrentUser() user: AuthUser) {
    this.assertNotImpersonating(user);
    return this.notifications.listUserDeploymentFailures(user.id);
  }

  // Fetch one notification (read or unread) for the error-analysis page.
  @Get(':id')
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertNotImpersonating(user);
    const notification = await this.notifications.getOne(user.id, id);
    if (!notification) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found' });
    }
    return { notification };
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    this.assertNotImpersonating(user);
    return this.notifications.markRead(user.id, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(@CurrentUser() user: AuthUser) {
    this.assertNotImpersonating(user);
    return this.notifications.markAllRead(user.id);
  }
}

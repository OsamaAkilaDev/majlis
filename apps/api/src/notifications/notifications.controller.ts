import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { notificationListQuerySchema, type Notification, type NotificationPage } from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: Nest DI resolves this from design:paramtypes.
import { NotificationService } from './notification.service';

class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}

/**
 * The in-app inbox. Both routes are self-scoped by `actor.id` rather than by
 * a permission key: there is no notification anybody but its owner may read,
 * so there is nothing for the matrix to say.
 */
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Actor() actor: User, @Query() query: NotificationListQueryDto): Promise<NotificationPage> {
    return this.notifications.list(actor, query);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiResponse({ status: 404, description: 'No such notification.', type: ProblemDetailsDto })
  read(@Actor() actor: User, @Param('id') id: string): Promise<Notification> {
    return this.notifications.markRead(actor, id);
  }
}

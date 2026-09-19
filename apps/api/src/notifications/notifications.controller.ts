import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { notificationListQuerySchema, type Notification, type NotificationPage } from '@majlis/contracts';
import { createZodDto } from 'nestjs-zod';
import { Actor } from '../auth/actor.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { User } from '../generated/prisma/client';
import { NotificationService } from './notification.service';

class NotificationListQueryDto extends createZodDto(notificationListQuerySchema) {}

// Self-scoped by `actor.id` rather than by a permission key: no notification is
// readable by anybody but its owner, so the matrix has nothing to say.
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

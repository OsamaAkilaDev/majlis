import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiResponse } from '@nestjs/swagger';
import type { NotificationSweepResult } from '@majlis/contracts';
import { Public } from '../auth/public.decorator';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import { NOTIFICATION_SWEEP_SECRET_HEADER } from '../config/sweep-header';
import type { Env } from '../config/env.schema';
import { assertSweepSecret } from '../events/lifecycle-sweep.controller';
import { NotificationService } from './notification.service';

/**
 * Delivers the PENDING notifications the triggers have committed since the
 * last run. Authenticated by a shared secret rather than a session, because
 * the caller is an external scheduler with no user behind it, and by its own
 * secret rather than the lifecycle sweep's, so one leaked scheduler
 * credential does not authorise both endpoints.
 */
@Controller('internal')
export class NotificationSweepController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly notifications: NotificationService,
  ) {}

  @Public()
  @Post('notification-sweep')
  @HttpCode(200)
  @ApiResponse({ status: 401, description: 'That sweep secret is not valid.', type: ProblemDetailsDto })
  async sweep(
    @Headers(NOTIFICATION_SWEEP_SECRET_HEADER) presented: string | undefined,
  ): Promise<NotificationSweepResult> {
    assertSweepSecret(presented, this.config.get('NOTIFICATION_SWEEP_SECRET', { infer: true }));
    return this.notifications.deliverPending();
  }
}

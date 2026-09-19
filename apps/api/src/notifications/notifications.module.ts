import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { NOTIFICATION_CHANNEL, SkippingChannel, type NotificationChannel } from './notification-channel';
import { NotificationService } from './notification.service';
import { NotificationSweepController } from './notification-sweep.controller';
import { NotificationsController } from './notifications.controller';
import { ResendChannel } from './resend.channel';

// Global because NotificationService is injected from clubs, events,
// certificates and auth. The channel is chosen once at boot from whether
// RESEND_API_KEY is set: no key means every row lands on SKIPPED.
@Global()
@Module({
  controllers: [NotificationsController, NotificationSweepController],
  providers: [
    NotificationService,
    {
      provide: NOTIFICATION_CHANNEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): NotificationChannel => {
        const apiKey = config.get('RESEND_API_KEY', { infer: true });
        if (!apiKey) return new SkippingChannel();
        return new ResendChannel(
          apiKey,
          config.get('RESEND_FROM', { infer: true }),
          config.get('PUBLIC_WEB_ORIGIN', { infer: true }).replace(/\/+$/, ''),
        );
      },
    },
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}

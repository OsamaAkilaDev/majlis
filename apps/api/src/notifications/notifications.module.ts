import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { NOTIFICATION_CHANNEL, SkippingChannel, type NotificationChannel } from './notification-channel';
import { NotificationService } from './notification.service';
import { NotificationSweepController } from './notification-sweep.controller';
import { NotificationsController } from './notifications.controller';
import { ResendChannel } from './resend.channel';

/**
 * Global, mirroring AuditModule: NotificationService is injected from clubs,
 * events, certificates and auth, so it has to be resolvable everywhere
 * without each of those modules importing this one.
 *
 * The channel is chosen once, at boot, from whether RESEND_API_KEY is set.
 * That is the whole of "Resend ships unwired": no key means every row lands
 * on SKIPPED and the in-app inbox works completely, and pasting a key in
 * turns email on with no code change.
 */
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

import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';

/**
 * Global, mirroring AuditModule: NotificationService is injected from clubs,
 * events, certificates and auth, so it has to be resolvable everywhere
 * without each of those modules importing this one.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}

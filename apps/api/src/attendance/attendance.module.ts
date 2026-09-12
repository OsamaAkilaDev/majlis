import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { QrPassController } from './qr-pass.controller';
import { QrPassService } from './qr-pass.service';

/**
 * EventsModule is imported for EventLifecycleService: every check-in and
 * every correction advances the event first, so nobody scans against a
 * status the clock has already moved past. Events does not import
 * attendance, so there is no cycle.
 */
@Module({
  imports: [EventsModule],
  controllers: [QrPassController, AttendanceController],
  providers: [QrPassService, AttendanceService],
})
export class AttendanceModule {}

import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
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
 *
 * CertificatesModule is imported for the other direction of a correction:
 * recording someone absent has to revoke the certificate issued off their
 * attendance, in the same transaction. Certificates imports only storage.
 */
@Module({
  imports: [EventsModule, CertificatesModule],
  controllers: [QrPassController, AttendanceController],
  providers: [QrPassService, AttendanceService],
})
export class AttendanceModule {}

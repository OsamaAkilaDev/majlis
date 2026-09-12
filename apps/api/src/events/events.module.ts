import { Module } from '@nestjs/common';
import { CertificatesModule } from '../certificates/certificates.module';
import { ClubsModule } from '../clubs/clubs.module';
import { AssignmentsService } from './assignments.service';
import { EventLifecycleService } from './event-lifecycle.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { LifecycleSweepController } from './lifecycle-sweep.controller';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';

/**
 * ClubsModule is imported for ClubsService's upload minting and verification,
 * which are generic over ImageKind and already the only place a stored image
 * URL is derived. Clubs does not import events, so there is no cycle.
 */
@Module({
  imports: [ClubsModule, CertificatesModule],
  controllers: [EventsController, RegistrationsController, LifecycleSweepController],
  providers: [EventsService, EventLifecycleService, AssignmentsService, RegistrationsService],
  // AttendanceModule advances an event before every check-in and every
  // correction, so nobody scans against a status the clock has moved past.
  exports: [EventLifecycleService],
})
export class EventsModule {}

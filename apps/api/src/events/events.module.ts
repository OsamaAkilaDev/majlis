import { Module } from '@nestjs/common';
import { ClubsModule } from '../clubs/clubs.module';
import { AssignmentsService } from './assignments.service';
import { EventLifecycleService } from './event-lifecycle.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { LifecycleSweepController } from './lifecycle-sweep.controller';

/**
 * ClubsModule is imported for ClubsService's upload minting and verification,
 * which are generic over ImageKind and already the only place a stored image
 * URL is derived. Clubs does not import events, so there is no cycle.
 */
@Module({
  imports: [ClubsModule],
  controllers: [EventsController, LifecycleSweepController],
  providers: [EventsService, EventLifecycleService, AssignmentsService],
})
export class EventsModule {}

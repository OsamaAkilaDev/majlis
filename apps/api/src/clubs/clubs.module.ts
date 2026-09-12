import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { MembershipController } from './membership/membership.controller';
import { MembershipService } from './membership/membership.service';
import { TeamController } from './team/team.controller';
import { TeamService } from './team/team.service';

@Module({
  imports: [StorageModule],
  controllers: [ClubsController, TeamController, MembershipController],
  providers: [ClubsService, TeamService, MembershipService],
  exports: [ClubsService],
})
export class ClubsModule {}

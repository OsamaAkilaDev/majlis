import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';
import { TeamController } from './team/team.controller';
import { TeamService } from './team/team.service';

@Module({
  imports: [StorageModule],
  controllers: [ClubsController, TeamController],
  providers: [ClubsService, TeamService],
})
export class ClubsModule {}

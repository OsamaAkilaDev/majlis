import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ClubsController } from './clubs.controller';
import { ClubsService } from './clubs.service';

@Module({
  imports: [StorageModule],
  controllers: [ClubsController],
  providers: [ClubsService],
})
export class ClubsModule {}

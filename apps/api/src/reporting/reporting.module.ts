import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

@Module({
  controllers: [ReportingController, ExportsController],
  providers: [ReportingService],
})
export class ReportingModule {}

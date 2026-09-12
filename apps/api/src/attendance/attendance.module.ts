import { Module } from '@nestjs/common';
import { QrPassController } from './qr-pass.controller';
import { QrPassService } from './qr-pass.service';

@Module({
  controllers: [QrPassController],
  providers: [QrPassService],
})
export class AttendanceModule {}

import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CertificatesController } from './certificates.controller';
import { CertificatesService } from './certificates.service';
import { VerifyController } from './verify.controller';

/**
 * Exports CertificatesService so EventsModule can issue opportunistically
 * after an advance. Certificates imports nothing from events but the pure
 * transition function, so the dependency runs one way and there is no cycle.
 */
@Module({
  imports: [StorageModule],
  controllers: [CertificatesController, VerifyController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}

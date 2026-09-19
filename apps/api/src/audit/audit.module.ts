import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';
import { AuditService } from './audit.service';

// Global because AuditService is injected across module boundaries.
// AuditReadService is deliberately not exported: the writer is the only half
// anybody outside this module should reach.
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditReadService],
  exports: [AuditService],
})
export class AuditModule {}

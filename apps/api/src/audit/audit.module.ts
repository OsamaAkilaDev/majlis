import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditReadService } from './audit-read.service';
import { AuditService } from './audit.service';

/**
 * Global, mirroring PrismaModule and RequestContextModule: AuditService is
 * injected across module boundaries (the permissions guard, auth, users) so
 * it needs to be resolvable everywhere without every feature module
 * re-importing AuditModule.
 *
 * AuditReadService is deliberately NOT exported: nothing but this module's
 * own controller reads the log, and the writer is the only half anybody else
 * should be able to reach.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditReadService],
  exports: [AuditService],
})
export class AuditModule {}

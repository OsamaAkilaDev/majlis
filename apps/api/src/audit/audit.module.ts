import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global, mirroring PrismaModule and RequestContextModule: AuditService is
 * injected across module boundaries (the permissions guard, auth, users) so
 * it needs to be resolvable everywhere without every feature module
 * re-importing AuditModule.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

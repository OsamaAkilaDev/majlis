import { Controller, Get, Module } from '@nestjs/common';
import { Actor } from '../../src/auth/actor.decorator';
import type { User } from '../../src/generated/prisma/client';

/**
 * Stands in for the real `/me` route Task 11 builds. Task 7 needs *some*
 * protected route to prove SessionGuard against before that lands; Task 8
 * reuses the same controller to prove PermissionsGuard.
 *
 * Registered only in the test modules that need it (see
 * `createTestApp({ imports: [ProtectedTestModule] })`) — never in
 * AppModule. SessionGuard still applies: it is a global APP_GUARD from
 * AuthModule, which every test app compiles via AppModule regardless of
 * which module adds this controller.
 */
@Controller('__test')
export class ProtectedController {
  @Get('protected')
  get(@Actor() actor: User): { id: string } {
    return { id: actor.id };
  }
}

@Module({ controllers: [ProtectedController] })
export class ProtectedTestModule {}

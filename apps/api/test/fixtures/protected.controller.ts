import { Controller, Get, Module } from '@nestjs/common';
import { Actor } from '../../src/auth/actor.decorator';
import type { User } from '../../src/generated/prisma/client';

/** A protected route to prove SessionGuard against. Registered only in the test
 * modules that need it, never in AppModule. SessionGuard still applies: it is a
 * global APP_GUARD from AuthModule, which every test app compiles. */
@Controller('__test')
export class ProtectedController {
  @Get('protected')
  get(@Actor() actor: User): { id: string } {
    return { id: actor.id };
  }
}

@Module({ controllers: [ProtectedController] })
export class ProtectedTestModule {}

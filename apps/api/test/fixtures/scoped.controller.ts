import { Body, Controller, Get, Module, Param, Patch } from '@nestjs/common';
import { RequirePermission } from '../../src/auth/require-permission.decorator';
import type { UserStatus } from '../../src/generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: injected below.
import { TransactionHost } from '../../src/prisma/transaction.host';

/**
 * Proves the club-scope path of PermissionsGuard end to end over HTTP. No
 * Stage 2 endpoint uses club scope — Stage 4 is the first real one — so
 * without this fixture the decorator's scope-reading path ships unexercised
 * by an actual request and Stage 4 inherits it unverified.
 *
 * Registered only in the test modules that need it, never in AppModule.
 */
@Controller('__test/clubs/:clubId')
export class ScopedTestController {
  @Get('edit')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })
  edit(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Stands in for the real `PATCH /api/v1/users/:id/status` route Task 11
 * builds. Ruled before Stage 2 started: Task 8 needs *some* ADMIN-only,
 * unscoped route to prove PermissionsGuard's denial + audit path before that
 * endpoint exists; Task 11 re-asserts denial against the real one.
 *
 * The handler performs a real write (through TransactionHost, never
 * PrismaService) rather than a no-op — otherwise "the write did not happen"
 * would hold trivially even against a guard that lets every request through,
 * since a no-op handler never writes regardless of what the guard decides.
 */
@Controller('__test/users')
export class UserStatusTestController {
  constructor(private readonly host: TransactionHost) {}

  @Patch(':id/status')
  @RequirePermission('user:suspend')
  async suspend(
    @Param('id') id: string,
    @Body() body: { status: UserStatus },
  ): Promise<{ id: string }> {
    await this.host.tx.user.update({ where: { id }, data: { status: body.status } });
    return { id };
  }
}

@Module({ controllers: [ScopedTestController, UserStatusTestController] })
export class ScopedTestModule {}

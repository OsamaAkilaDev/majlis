import { Body, Controller, Get, Module, Param, Patch } from '@nestjs/common';
import { RequirePermission } from '../../src/auth/require-permission.decorator';
import type { UserStatus } from '../../src/generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- value import: injected below.
import { TransactionHost } from '../../src/prisma/transaction.host';

/** Exercises the club-scope path of PermissionsGuard over HTTP. Registered only
 * in the test modules that need it, never in AppModule. */
@Controller('__test/clubs/:clubId')
export class ScopedTestController {
  @Get('edit')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.clubId' })
  edit(): { ok: true } {
    return { ok: true };
  }

  /** A route the router genuinely matches (an empty `:clubId` 404s before the
   * guard runs) whose `from` reads a property off `undefined`. Exercises
   * readAt's `typeof acc !== 'object'` check, without which this is a 500. */
  @Get('broken-scope')
  @RequirePermission('club:edit', { scope: 'club', from: 'params.missing.deeper' })
  brokenScope(): { ok: true } {
    return { ok: true };
  }
}

/** An ADMIN-only unscoped route for PermissionsGuard's denial and audit path.
 * The handler does a real write, not a no-op: otherwise "the write did not
 * happen" holds even against a guard that lets every request through. */
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

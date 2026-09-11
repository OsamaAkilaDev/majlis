import { Injectable } from '@nestjs/common';
import type {
  CursorPageQuery,
  PatchMeBody,
  PatchUserStatusBody,
  UserListPage,
  UserProfile,
} from '@majlis/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: Nest's constructor DI resolves this provider from the emitted `design:paramtypes` metadata, which needs a real runtime reference.
import { AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import type { User } from '../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a value import: same reason as AuditService above.
import { TransactionHost } from '../prisma/transaction.host';

/**
 * Picks exactly the fields a profile response ever carries — never the raw
 * Prisma `User` row, which also has `passwordHash`. Shared by `/me` and the
 * admin status endpoint, which return the same shape for two different
 * targets (the caller, and the user an admin just acted on).
 */
function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    platformRole: user.platformRole,
    status: user.status,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /me. `actor` is the row SessionGuard already loaded fresh for this
   * request — no second read needed.
   */
  me(actor: User): UserProfile {
    return toUserProfile(actor);
  }

  /**
   * PATCH /me. Picks `fullName` and `avatarUrl` explicitly and never spreads
   * the request body into Prisma's `data` — that is exactly what would let a
   * client smuggle `platformRole` or `status` into the same call and
   * escalate itself to Admin. A key left out of `data` entirely (rather than
   * set to `undefined`) is Prisma's own "no change" — that is what makes a
   * request with only `fullName` leave `avatarUrl` untouched.
   */
  async updateMe(actor: User, body: PatchMeBody): Promise<UserProfile> {
    const data: { fullName?: string; avatarUrl?: string | null } = {};
    if (body.fullName !== undefined) data.fullName = body.fullName;
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl;

    const updated = await this.host.tx.user.update({ where: { id: actor.id }, data });
    return toUserProfile(updated);
  }

  /**
   * GET /users. Cursor-paginated on `id` — uuid v7, so ascending order is
   * also creation order — which is what makes the cursor a stable position
   * rather than one a concurrent insert or update could reshuffle. `limit`'s
   * upper bound is enforced by `cursorPageQuerySchema` at the validation
   * boundary (see @majlis/contracts), not re-checked here.
   */
  async list(query: CursorPageQuery): Promise<UserListPage> {
    const rows = await this.host.tx.user.findMany({
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        platformRole: u.platformRole,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
    };
  }

  /**
   * PATCH /users/{id}/status — the only route that suspends or reinstates an
   * account. Everything runs in one transaction.
   *
   * No discriminated-result dance here, unlike AuthService.refresh: every
   * throw below fires before this transaction has written anything, so
   * letting host.run's interactive `$transaction` roll it back on either
   * check discards nothing. Past both checks, the remaining statements
   * either all commit together or all roll back together — there is no point
   * where a write must survive a later failure in the same call.
   */
  async updateStatus(actor: User, targetId: string, body: PatchUserStatusBody): Promise<UserProfile> {
    const next = body.status;

    return this.host.run(async () => {
      if (actor.id === targetId) {
        throw new UnprocessableError('You cannot change your own account status.');
      }

      const before = await this.host.tx.user.findUnique({ where: { id: targetId } });
      if (!before) throw new NotFoundError('No such user.');
      if (before.status === next) throw new ConflictError('That account is already in that state.');

      const after = await this.host.tx.user.update({
        where: { id: targetId },
        data: { status: next },
      });

      if (next === 'SUSPENDED') {
        // Without this, reinstating the account later resurrects a stale
        // 30-day refresh token instead of forcing a fresh login. Reinstating
        // (SUSPENDED -> ACTIVE) does not need the mirror-image revoke:
        // suspension already revoked every live token for this user, so
        // there is nothing left to revoke on the way back up.
        await this.host.tx.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      await this.audit.record({
        action: next === 'SUSPENDED' ? 'user.suspended' : 'user.reinstated',
        entityType: 'User',
        entityId: targetId,
        outcome: 'SUCCESS',
        reason: body.reason,
        actorUserId: actor.id,
        before: { status: before.status },
        after: { status: after.status },
      });

      return toUserProfile(after);
    });
  }
}

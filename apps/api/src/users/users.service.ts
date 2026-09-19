import { Injectable } from '@nestjs/common';
import type {
  PatchMeBody,
  PatchUserBody,
  PatchUserStatusBody,
  UserListPage,
  UserListQuery,
  UserProfile,
  UserSearchQuery,
  UserSearchResult,
} from '@majlis/contracts';
import { AuditService } from '../audit/audit.service';
import { cursorArgs, cursorPage } from '../common/cursor-page';
import { ConflictError, NotFoundError, UnprocessableError } from '../common/problem/domain-error';
import { Prisma, type User } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';

// Gates the raw `::uuid` casts below; case-insensitive because Postgres
// compares uuids that way.
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a path parameter names the caller's own row. Not `===`: Postgres
 * compares `uuid` case-insensitively, so an admin sending their own id
 * upper-cased slips past a plain string compare while every lookup after it
 * still resolves to their own row.
 */
function isSelf(actorId: string, targetId: string): boolean {
  return actorId.toLowerCase() === targetId.toLowerCase();
}

/**
 * An admin who cannot sign in is not an admin for this purpose: SessionGuard
 * refuses any user who is not ACTIVE, so counting suspended admins here would
 * let the last usable one be demoted or suspended. `AuthService.adminExists`
 * counts by role alone, which is the right question only for bootstrap.
 */
const ACTIVE_ADMIN = { platformRole: 'ADMIN', status: 'ACTIVE' } as const;

const SEARCH_LIMIT = 20;

/**
 * Serialises every write that lowers the number of admins. A row lock is not
 * enough: the invariant is a count across the table, so two admins demoting
 * each other lock different rows, both read two admins, and the platform
 * commits its way to zero admins with no route back. Distinct from
 * BOOTSTRAP_LOCK_KEY: same invariant from opposite ends, must not block.
 */
const ADMIN_COUNT_LOCK_KEY = 8_273_645_522;

// Exactly the fields a profile response carries, never the raw `User` row,
// which also holds `passwordHash`.
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

/**
 * Allow-listed rather than "the row minus passwordHash": an audit row outlives
 * the account and is read by a human, so it must never become the one place a
 * hash or a future secret column is printed. A new `User` column stays invisible
 * here until somebody adds it on purpose.
 */
const AUDITED_FIELDS = ['fullName', 'email', 'avatarUrl', 'platformRole'] as const;

function pickAudited(user: User, changed: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of AUDITED_FIELDS) {
    if (changed.includes(key)) out[key] = user[key];
  }
  return out;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly host: TransactionHost,
    private readonly audit: AuditService,
  ) {}

  // `actor` is the row SessionGuard already loaded fresh for this request.
  me(actor: User): UserProfile {
    return toUserProfile(actor);
  }

  /**
   * Picks the two fields explicitly and never spreads the request body into
   * Prisma's `data`: a spread lets a client smuggle `platformRole` or `status`
   * into the same call and escalate itself to Admin.
   */
  async updateMe(actor: User, body: PatchMeBody): Promise<UserProfile> {
    const data: { fullName?: string; avatarUrl?: string | null } = {};
    if (body.fullName !== undefined) data.fullName = body.fullName;
    if (body.avatarUrl !== undefined) data.avatarUrl = body.avatarUrl;

    const updated = await this.host.tx.user.update({ where: { id: actor.id }, data });
    return toUserProfile(updated);
  }

  /**
   * Cursor-paginated on `id` (uuid v7, so ascending order is creation order),
   * which is what keeps the cursor stable under concurrent inserts. `limit`'s
   * upper bound is enforced by `cursorPageQuerySchema`, not re-checked here.
   * `mode: 'insensitive'` is load-bearing: Postgres LIKE is case-sensitive.
   */
  async list(query: UserListQuery): Promise<UserListPage> {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { fullName: { contains: query.q, mode: 'insensitive' as const } },
              { email: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const rows = await this.host.tx.user.findMany({
      where,
      ...cursorArgs(query),
    });

    const { items, nextCursor } = cursorPage(rows, query.limit);

    return {
      items: items.map((u) => ({
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        platformRole: u.platformRole,
        status: u.status,
        createdAt: u.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /**
   * Authorized by the club in the path (`user:search`) but deliberately not
   * restricted to that club's members: the point is appointing people who are
   * not members yet. Three columns only, never the row: `platformRole`,
   * `status` and `createdAt` belong to the Admin-only `GET /users`.
   */
  async search(query: UserSearchQuery): Promise<UserSearchResult> {
    const items = await this.host.tx.user.findMany({
      where: {
        OR: [
          { fullName: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
      // Capped, not paged: a cursor here would be a way to walk the whole
      // directory two characters at a time.
      take: SEARCH_LIMIT,
    });

    return { items };
  }

  /**
   * An admin's edit of somebody else's account: always with a reason, always
   * audited in the same transaction as the write. Only the keys actually
   * present are written, because in Prisma an absent key and an explicit
   * `null` mean different things and have to stay distinguishable.
   */
  async update(actor: User, targetId: string, body: PatchUserBody): Promise<UserProfile> {
    const { reason, ...fields } = body;
    const changing: string[] = Object.keys(fields);
    if (changing.length === 0) {
      throw new UnprocessableError('Nothing to change.');
    }

    const rolePatch = fields.platformRole !== undefined;

    if (rolePatch && isSelf(actor.id, targetId)) {
      throw new UnprocessableError('You cannot change your own platform role.');
    }

    return this.host.run(async () => {
      // Route a malformed id through a typed Prisma call so problem.filter.ts
      // still maps it to 400 (P2023) instead of the ::uuid cast below raising
      // a raw Postgres error (P2010).
      if (!UUID_SHAPE.test(targetId)) {
        await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });
      }

      if (rolePatch) {
        await this.host.tx
          .$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_COUNT_LOCK_KEY}::bigint)`;
      }

      // "user" is a reserved word in Postgres and must be quoted.
      const locked = await this.host.tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "user" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('No such user.');

      const before = await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });

      // Counted under the advisory lock, so a concurrent demotion has either
      // committed and is visible here, or is still waiting and will count this
      // one.
      if (rolePatch && before.platformRole === 'ADMIN' && fields.platformRole === 'STUDENT') {
        const admins = await this.host.tx.user.count({ where: ACTIVE_ADMIN });
        if (admins <= 1) {
          throw new UnprocessableError('That is the last admin. Appoint another one first.');
        }
      }

      let after: User;
      try {
        after = await this.host.tx.user.update({ where: { id: targetId }, data: fields });
      } catch (e) {
        // A lost race on the email unique index is a conflict, not a fault.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }

      if (fields.email !== undefined && fields.email !== before.email) {
        // The address is the credential, so changing it ends their sessions.
        // Both halves are needed: revoking refresh tokens stops a new access
        // token being minted, and `sessionsInvalidatedAt` is what SessionGuard
        // compares each request's `iat` against, without which the access token
        // already in the browser stays valid for its remaining 15 minutes.
        const now = new Date();
        await this.host.tx.refreshToken.updateMany({
          where: { userId: targetId, revokedAt: null },
          data: { revokedAt: now },
        });
        after = await this.host.tx.user.update({
          where: { id: targetId },
          data: { sessionsInvalidatedAt: now },
        });
      }

      // `user.role_changed` whenever the role moved, so a privilege grant stays
      // filterable in the audit log rather than buried among name corrections.
      await this.audit.record({
        action: rolePatch && before.platformRole !== after.platformRole
          ? 'user.role_changed'
          : 'user.updated',
        entityType: 'User',
        entityId: targetId,
        outcome: 'SUCCESS',
        reason,
        actorUserId: actor.id,
        before: pickAudited(before, changing),
        after: pickAudited(after, changing),
      });

      return toUserProfile(after);
    });
  }

  async updateStatus(actor: User, targetId: string, body: PatchUserStatusBody): Promise<UserProfile> {
    const next = body.status;

    return this.host.run(async () => {
      if (isSelf(actor.id, targetId)) {
        throw new UnprocessableError('You cannot change your own account status.');
      }

      // Suspending an admin takes the account out of service as surely as
      // demoting it does, so this route holds the same last-admin invariant
      // under the same lock, or the two routes together reach zero admins.
      if (next === 'SUSPENDED') {
        await this.host.tx
          .$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_COUNT_LOCK_KEY}::bigint)`;
      }

      // Route a malformed id through a typed Prisma call so problem.filter.ts
      // still maps it to 400 (P2023) instead of the ::uuid cast below raising
      // a raw Postgres error (P2010).
      if (!UUID_SHAPE.test(targetId)) {
        await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });
      }

      // Locks the target row before the read that decides the checks below, so
      // two concurrent suspends serialise here instead of both reading ACTIVE
      // and both writing a user.suspended audit row for one transition.
      // "user" is a reserved word in Postgres and must be quoted.
      const locked = await this.host.tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "user" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('No such user.');

      // Re-read under the lock just taken, not a stale read from before it.
      const before = await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });
      if (before.status === next) throw new ConflictError('That account is already in that state.');

      // Counted under the advisory lock, so a concurrent suspend or demote has
      // either committed and is visible, or is still waiting and counts this one.
      if (next === 'SUSPENDED' && before.platformRole === 'ADMIN') {
        const admins = await this.host.tx.user.count({ where: ACTIVE_ADMIN });
        if (admins <= 1) {
          throw new UnprocessableError('That is the last admin. Appoint another one first.');
        }
      }

      const after = await this.host.tx.user.update({
        where: { id: targetId },
        data: { status: next },
      });

      if (next === 'SUSPENDED') {
        // Without this, reinstating later resurrects a stale 30-day refresh
        // token instead of forcing a fresh login. Reinstating needs no mirror
        // revoke: suspension already took every live token.
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

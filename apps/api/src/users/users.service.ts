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

/**
 * Canonical UUID shape, used only to decide whether `updateStatus`'s FOR
 * UPDATE lock (below) is safe to run as raw SQL: see the comment at its
 * call site.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a path parameter names the caller's own row.
 *
 * Not `===`. Postgres compares `uuid` values case-insensitively and Prisma
 * hands them back lowercased, so a plain string compare between `actor.id` and
 * an id off the URL asks a different question from "is this the same row". An
 * admin sending their own id upper-cased slipped past both self guards below
 * while every lookup after them resolved to their own row: `UUID_SHAPE` is
 * case-insensitive, and `${id}::uuid` normalises.
 */
function isSelf(actorId: string, targetId: string): boolean {
  return actorId.toLowerCase() === targetId.toLowerCase();
}

/**
 * An admin who cannot sign in is not an admin for this purpose.
 *
 * `SessionGuard` refuses any user whose status is not ACTIVE, so counting
 * suspended admins here would let the last usable one be demoted or suspended
 * while the guard read a healthy number. `AuthService.adminExists` counts by
 * role alone on purpose, which is the right question for the bootstrap route
 * (a suspended admin can still be reinstated by a DBA) and the wrong one here.
 */
const ACTIVE_ADMIN = { platformRole: 'ADMIN', status: 'ACTIVE' } as const;

/** What one club-scoped search returns at most. */
const SEARCH_LIMIT = 20;

/**
 * Serialises every write that lowers the number of admins.
 *
 * A row lock is not enough here, the same way it is not enough for
 * `AuthService`'s bootstrap: the question is about a count across the table,
 * not about one row, and two admins demoting each other lock two different
 * rows. Both would read two admins, both would pass, and the platform would
 * commit its way to zero admins with no route back, since only an admin can
 * create a club and `/auth/bootstrap` shuts as soon as the first one exists.
 *
 * Distinct from BOOTSTRAP_LOCK_KEY: these two guard the same invariant from
 * opposite ends and must not block each other.
 */
const ADMIN_COUNT_LOCK_KEY = 8_273_645_522;

/**
 * Picks exactly the fields a profile response ever carries, never the raw
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

/**
 * The changed columns only, for an audit row's before/after.
 *
 * Allow-listed rather than "the row minus passwordHash": an audit row is read
 * by a human in the console and outlives the account, so it must never become
 * the one place a hash or a future secret column is printed. A new column on
 * `User` is invisible here until somebody adds it to this list on purpose.
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

  /**
   * GET /me. `actor` is the row SessionGuard already loaded fresh for this
   * request: no second read needed.
   */
  me(actor: User): UserProfile {
    return toUserProfile(actor);
  }

  /**
   * PATCH /me. Picks `fullName` and `avatarUrl` explicitly and never spreads
   * the request body into Prisma's `data`: that is exactly what would let a
   * client smuggle `platformRole` or `status` into the same call and
   * escalate itself to Admin. A key left out of `data` entirely (rather than
   * set to `undefined`) is Prisma's own "no change". That is what makes a
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
   * GET /users. Cursor-paginated on `id` (uuid v7, so ascending order is
   * also creation order), which is what makes the cursor a stable position
   * rather than one a concurrent insert or update could reshuffle. `limit`'s
   * upper bound is enforced by `cursorPageQuerySchema` at the validation
   * boundary (see @majlis/contracts), not re-checked here.
   *
   * `q` spans name and address: an admin chasing a support request holds one
   * or the other, rarely both, and a name-only match answers "no such user"
   * for every address they paste in. `mode: 'insensitive'` is not cosmetic
   * either, since Postgres LIKE is case-sensitive and a capital letter would
   * otherwise return nothing.
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
   * GET /clubs/{clubId}/user-search. Authorized by the club in the path
   * (`user:search`), but not restricted to that club's members: the whole
   * point is appointing and inviting people who are not members yet.
   *
   * Three columns, never the row. `platformRole`, `status` and `createdAt`
   * are `GET /users`' business, and that route stays Admin-only.
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
      // Capped rather than paged. `q` is already at least two characters
      // (see userSearchQuerySchema), and a cursor here would just be a way
      // to walk the directory two characters at a time.
      take: SEARCH_LIMIT,
    });

    return { items };
  }

  /**
   * PATCH /users/{id}/status, the only route that suspends or reinstates an
   * account. Everything runs in one transaction.
   *
   * No discriminated-result dance here, unlike AuthService.refresh: every
   * throw below fires before this transaction has written anything, so
   * letting host.run's interactive `$transaction` roll it back on either
   * check discards nothing. Past both checks, the remaining statements
   * either all commit together or all roll back together: there is no point
   * where a write must survive a later failure in the same call.
   */
  /**
   * PATCH /users/{id}. The admin's edit of somebody else's account: name,
   * address, avatar and platform role, any subset of them, always with a
   * reason, always audited in the same transaction as the write.
   *
   * Only the keys actually present are written. Spreading the parsed body
   * into `data` would look equivalent and is not: an absent key arrives as
   * `undefined`, and a `data` carrying `fullName: undefined` is a no-op in
   * Prisma but `avatarUrl: undefined` alongside an explicit `null` is not,
   * so the two cases have to stay distinguishable.
   */
  async update(actor: User, targetId: string, body: PatchUserBody): Promise<UserProfile> {
    const { reason, ...fields } = body;
    const changing: string[] = Object.keys(fields);
    if (changing.length === 0) {
      throw new UnprocessableError('Nothing to change.');
    }

    // The privilege-granting half. Read before the transaction so the guards
    // below read the same way whether or not a role is in play.
    const rolePatch = fields.platformRole !== undefined;

    if (rolePatch && isSelf(actor.id, targetId)) {
      // The mirror of updateStatus's self guard, and the reason the last
      // admin can never demote themselves by accident.
      throw new UnprocessableError('You cannot change your own platform role.');
    }

    return this.host.run(async () => {
      // Same P2010-vs-P2023 reasoning as updateStatus: route a malformed id
      // through a typed Prisma call so problem.filter.ts still maps it to
      // 400 rather than letting the ::uuid cast raise a raw Postgres error.
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
      // already committed and is visible here, or is still waiting on the
      // lock and will count this one.
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
        // The unique index on email, the same lost race signup reports as a
        // conflict rather than a server fault.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictError('An account with this email already exists.');
        }
        throw e;
      }

      if (fields.email !== undefined && fields.email !== before.email) {
        // The address is the credential they sign in with, so changing it ends
        // their sessions, exactly as a password reset does.
        //
        // Both halves are needed and they do different jobs. Revoking the
        // refresh tokens stops a new access token being minted; stamping
        // `sessionsInvalidatedAt` is what SessionGuard compares each request's
        // `iat` against, and without it the access token already in the
        // browser stays valid for the rest of its 15 minutes. Written into the
        // same `update` below rather than as a second statement would be
        // neater, but the row is already written by then, so this is an
        // explicit second write inside the same transaction.
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

      // One row, and `user.role_changed` whenever the role moved, so a
      // privilege grant is filterable in the audit log rather than buried
      // among name corrections.
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

      // Suspending an admin takes their account out of service just as surely
      // as demoting them does: SessionGuard refuses anyone not ACTIVE. So this
      // route has to hold the same invariant, under the same lock, or the two
      // routes together still reach a platform nobody can administer.
      if (next === 'SUSPENDED') {
        await this.host.tx
          .$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_COUNT_LOCK_KEY}::bigint)`;
      }

      // A malformed (non-UUID) id would fail the ::uuid cast below as a raw
      // Postgres error (P2010) rather than the typed Prisma validation error
      // (P2023) problem.filter.ts maps to 400, routing it through the same
      // typed call the pre-lock code always made keeps that mapping intact
      // for this route too. A well-formed id proceeds to the lock below
      // regardless of whether it matches a row.
      if (!UUID_SHAPE.test(targetId)) {
        await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });
      }

      // Locks the target row before the read that decides the two checks
      // below (same FOR UPDATE-then-Prisma-read pattern as
      // AuthService.refresh), so two concurrent suspend calls on the same
      // user serialise on this row instead of both reading ACTIVE, both
      // passing the no-op guard, and both writing a user.suspended audit row
      // for one transition. "user" is a reserved word in Postgres and must
      // be quoted in raw SQL.
      const locked = await this.host.tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "user" WHERE "id" = ${targetId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('No such user.');

      // Re-read under the lock just taken, so this is the fresh value a
      // concurrent updater's commit would have changed, not a stale read
      // from before the lock was acquired.
      const before = await this.host.tx.user.findUniqueOrThrow({ where: { id: targetId } });
      if (before.status === next) throw new ConflictError('That account is already in that state.');

      // Counted under the advisory lock taken above, so a concurrent suspend
      // or demote has either committed and is visible, or is still waiting and
      // will count this one.
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

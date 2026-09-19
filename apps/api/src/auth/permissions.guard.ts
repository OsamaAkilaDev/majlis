import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { ForbiddenError, UnauthorizedError } from '../common/problem/domain-error';
import type { User } from '../generated/prisma/client';
import { TransactionHost } from '../prisma/transaction.host';
import { evaluate, type ActorFacts } from './permissions';
import { PERMISSION_KEY, type RequiredPermission, type ScopeSpec } from './require-permission.decorator';

/**
 * ACTIVE-only club appointments for `userId` in `clubId`. `status` is
 * filtered in the WHERE clause, never afterwards. Spec §5.1: "No permission
 * is active until status = 'ACTIVE'." A resolver that queried without this
 * filter would grant full Lead authority to anyone merely INVITED, including
 * someone who DECLINED.
 *
 * Exported (with the TransactionHost passed in, matching the "write through
 * TransactionHost, never PrismaService" rule everywhere else in this
 * codebase) so the scope-resolver tests can call it directly, without going
 * through HTTP.
 */
export async function resolveClubFacts(
  host: TransactionHost,
  userId: string,
  clubId: string,
): Promise<Pick<ActorFacts, 'clubRoles'>> {
  const appointments = await host.tx.clubTeamAppointment.findMany({
    where: { userId, clubId, status: 'ACTIVE' },
    select: { role: true },
  });
  return { clubRoles: appointments.map((a) => a.role) };
}

/**
 * The same ACTIVE-only club appointments as `resolveClubFacts`, for the club
 * that owns `eventId`, in ONE statement instead of two. It replaces a lookup
 * of the event's `club_id` followed by a lookup keyed on it: the relation
 * filter resolves the club through the event, so the WHERE clause is
 * identical to the pair it stands in for, status filter included.
 *
 * An event id that resolves to nothing matches no appointment and so yields
 * no roles, which is what the two-query version did when the event lookup
 * came back null. The scan path is where this matters (spec 7.5): one fewer
 * round trip on the one surface with a latency requirement.
 */
export async function resolveEventClubFacts(
  host: TransactionHost,
  userId: string,
  eventId: string,
): Promise<Pick<ActorFacts, 'clubRoles'>> {
  const appointments = await host.tx.clubTeamAppointment.findMany({
    where: { userId, status: 'ACTIVE', club: { events: { some: { id: eventId } } } },
    select: { role: true },
  });
  return { clubRoles: appointments.map((a) => a.role) };
}

/**
 * Event assignments for `userId` on `eventId`. `EventAssignment` carries no
 * status column (an assignment row is authority the moment it exists), so,
 * unlike the club resolver, there is no status filter to apply here.
 */
export async function resolveEventFacts(
  host: TransactionHost,
  userId: string,
  eventId: string,
): Promise<Pick<ActorFacts, 'eventResponsibilities'>> {
  const assignments = await host.tx.eventAssignment.findMany({
    where: { userId, eventId },
    select: { responsibility: true },
  });
  return { eventResponsibilities: assignments.map((a) => a.responsibility) };
}

/**
 * Reads a dotted path (e.g. `'params.clubId'`) off an arbitrary object,
 * returning `undefined` rather than throwing for a missing or malformed
 * path. Used only to read the scope IDENTIFIER off the request (never a
 * role, club role, or ownership claim), so a missing/malformed path must
 * resolve to "no scope", which the guard then treats as a denial, not a 500.
 */
function readAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

function readScopeId(req: Request, scope: ScopeSpec | undefined): string | undefined {
  if (!scope) return undefined;
  const value = readAt(req, scope.from);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Best-effort target id for the audit row on a denial with no scope (e.g. `user:suspend`). */
function readTargetId(req: Request): string | undefined {
  const value = readAt(req, 'params.id');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The second global APP_GUARD, registered immediately after SessionGuard
 * (see AuthModule) so `req.actor` is already populated when this runs.
 *
 * Re-derives authority from the database on every request via
 * resolveClubFacts/resolveEventFacts: a client-supplied role, club id, or
 * ownership claim is never trusted, only the scope IDENTIFIER read off the
 * request (see readScopeId).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly host: TransactionHost,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(PERMISSION_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true; // authenticated (SessionGuard ran), but unscoped by permission

    const req = ctx.switchToHttp().getRequest<Request>();
    const actor = req.actor;
    if (!actor) throw new UnauthorizedError('Not signed in.');

    const scopeId = readScopeId(req, required.scope);
    const facts = await this.loadFacts(actor, required.scope, scopeId);
    if (evaluate(required.permission, facts)) return true;

    // Denial is audited even though the transaction the handler would have
    // opened never starts. This write gets its own transaction via
    // host.run(), which is what proves the row commits even though the
    // action it denies never runs.
    await this.host.run(() =>
      this.audit.record({
        action: 'permission.denied',
        entityType: required.scope?.scope === 'club' ? 'Club' : required.scope?.scope === 'event' ? 'Event' : 'User',
        entityId: scopeId ?? readTargetId(req) ?? actor.id,
        outcome: 'DENIED',
        reason: required.permission,
        actorUserId: actor.id,
      }),
    );
    throw new ForbiddenError('You do not have permission to do that.');
  }

  /**
   * Builds the ActorFacts evaluate() decides against. Exposed as a method on
   * the guard instance (not a free function) so it can call the injected
   * TransactionHost.
   *
   * Event scope also resolves club-level facts for the EVENT'S OWN CLUB,
   * decided here because spec §6.1's club officer rows (e.g. Lead) carry
   * authority over the club's events without a separate per-event
   * assignment row; resolving only EventAssignment would silently deny a
   * club Lead acting on their own club's event. A scope id that does not
   * resolve to a real row (bad id, or a deleted event) yields no authority
   * rather than throwing: an unresolvable scope must DENY, never 500.
   */
  async loadFacts(
    actor: User,
    scope: ScopeSpec | undefined,
    scopeId: string | undefined,
  ): Promise<ActorFacts> {
    const base: ActorFacts = {
      userId: actor.id,
      platformRole: actor.platformRole,
      clubRoles: [],
      eventResponsibilities: [],
    };
    if (!scope || !scopeId) return base;

    if (scope.scope === 'club') {
      const { clubRoles } = await resolveClubFacts(this.host, actor.id, scopeId);
      return { ...base, clubRoles };
    }

    const { eventResponsibilities } = await resolveEventFacts(this.host, actor.id, scopeId);
    const { clubRoles } = await resolveEventClubFacts(this.host, actor.id, scopeId);
    return { ...base, clubRoles, eventResponsibilities };
  }
}

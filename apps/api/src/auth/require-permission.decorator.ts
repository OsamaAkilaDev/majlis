import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ProblemDetailsDto } from '../common/problem/problem-details.dto';
import type { Permission } from './permissions';

/**
 * Where PermissionsGuard finds the scope identifier. `from` is a dotted path
 * read off the Express `Request` object (e.g. `'params.clubId'`), the
 * IDENTIFIER only. The guard re-derives who holds what authority over that
 * identifier from the database; it never trusts a role, club role, or
 * ownership claim carried on the request itself.
 */
export interface ScopeSpec {
  scope: 'club' | 'event' | 'certificate';
  from: string;
}

export interface RequiredPermission {
  permission: Permission;
  scope?: ScopeSpec;
}

export const PERMISSION_KEY = 'requiredPermission';

/**
 * Marks a handler as needing `permission`, optionally narrowed to a club or
 * event named by `scope`. Read by PermissionsGuard, the second global
 * APP_GUARD (registered after SessionGuard in AuthModule).
 *
 * It documents its own 403 as well as declaring it. Every route carrying this
 * decorator can be refused by PermissionsGuard with exactly one message, and
 * the matching `@ApiResponse` was hand-written identically beside all 41 call
 * sites. Emitting it here makes the document follow the guard rather than
 * tracking it by hand.
 *
 * The string is the one `PermissionsGuard.canActivate` throws. Changing it in
 * one place and not the other is what this closes.
 */
export const RequirePermission = (permission: Permission, scope?: ScopeSpec) =>
  applyDecorators(
    SetMetadata(PERMISSION_KEY, { permission, scope } satisfies RequiredPermission),
    ApiResponse({
      status: 403,
      description: 'You do not have permission to do that.',
      type: ProblemDetailsDto,
    }),
  );

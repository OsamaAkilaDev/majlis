import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

/**
 * Where PermissionsGuard finds the scope identifier. `from` is a dotted path
 * read off the Express `Request` object (e.g. `'params.clubId'`), the
 * IDENTIFIER only. The guard re-derives who holds what authority over that
 * identifier from the database; it never trusts a role, club role, or
 * ownership claim carried on the request itself.
 */
export interface ScopeSpec {
  scope: 'club' | 'event';
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
 */
export const RequirePermission = (permission: Permission, scope?: ScopeSpec) =>
  SetMetadata(PERMISSION_KEY, { permission, scope } satisfies RequiredPermission);

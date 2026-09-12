import { ConflictError } from './problem/domain-error';
import { Prisma } from '../generated/prisma/client';

/**
 * The violated index or constraint name, wherever Prisma 7's pg driver
 * adapter buries it. Prisma 7 requires a driver adapter (see
 * PrismaService), and under it `PrismaClientKnownRequestError.meta` for a
 * P2002 is never `{ target: [...columns] }` the way the engine-based client
 * documents it; it is `{ driverAdapterError: { cause: { constraint: { index
 * } } } }` instead. This reads `meta.target` first (kept in case a future
 * engine-based path returns to that shape), then the field the adapter
 * actually populates, then falls back to the raw driver message so the
 * match still has something to search if either shape changes again.
 *
 * Every P2002 this codebase turns into a specific `ConflictError` message
 * goes through this (see `conflictOn` below), or the check silently never
 * matches and the caller only ever sees the global Problem Details filter's
 * generic "This conflicts with an existing record" text.
 */
export function violatedConstraintName(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '';
  const m = meta as Record<string, unknown>;
  const target = m.target;
  if (Array.isArray(target)) return target.join(',');
  if (typeof target === 'string') return target;

  const cause = (m.driverAdapterError as Record<string, unknown> | undefined)?.cause as
    | Record<string, unknown>
    | undefined;
  const index = (cause?.constraint as Record<string, unknown> | undefined)?.index;
  if (typeof index === 'string') return index;
  return typeof cause?.originalMessage === 'string' ? cause.originalMessage : '';
}

/**
 * A `.catch` handler mapping the P2002 on a named index to the message that
 * index means. Keys are substrings of the index name, tried in order.
 *
 * Every branch requires a positive match rather than one defaulting to the
 * others: a defaulted branch cannot be proven to have identified anything,
 * since it fires whether or not `violatedConstraintName` actually worked.
 * Anything unmatched rethrows and reaches the global filter as itself.
 */
export function conflictOn(messages: Record<string, string>): (e: unknown) => never {
  return (e: unknown): never => {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const constraint = violatedConstraintName(e.meta);
      for (const [needle, message] of Object.entries(messages)) {
        if (constraint.includes(needle)) throw new ConflictError(message);
      }
    }
    throw e;
  };
}

import { ConflictError } from './problem/domain-error';
import { Prisma } from '../generated/prisma/client';

/**
 * Under Prisma 7's required driver adapter, a P2002's `meta` is NEVER the
 * documented `{ target: [...] }`; it is
 * `{ driverAdapterError: { cause: { constraint: { index } } } }`. Reads the
 * documented shape first, then the one the adapter populates, then the raw
 * driver message.
 *
 * Every P2002 turned into a specific ConflictError goes through this, or the
 * match silently never fires and the caller sees only the filter's generic
 * "This conflicts with an existing record".
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
 * Keys are substrings of the index name, tried in order. Every branch needs a
 * POSITIVE match, never a default: a defaulted branch fires whether or not
 * `violatedConstraintName` actually worked, so it proves nothing. Anything
 * unmatched rethrows.
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

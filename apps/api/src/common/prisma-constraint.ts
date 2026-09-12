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
 * Every `mapWriteError` in this codebase (ClubsService, TeamService,
 * MembershipService) that turns a P2002 into a specific `ConflictError`
 * message must go through this, or the check silently never matches and
 * the caller only ever sees the global Problem Details filter's generic
 * "This conflicts with an existing record" text.
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

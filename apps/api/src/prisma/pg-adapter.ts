import { PrismaPg } from '@prisma/adapter-pg';

/**
 * The one place a Prisma driver adapter is constructed, with the session
 * timezone pinned to UTC.
 *
 * Without the pin, `new Date('2026-06-15T12:00:00.000Z')` written through
 * Prisma lands in the column as `2026-06-15 12:00:00+04` (i.e. 08:00Z) on a
 * database whose `TimeZone` is Asia/Dubai: the wall clock is preserved and
 * the instant is not. Prisma reads it back through the same offset, so the
 * application sees the value it wrote and no test notices, while the row
 * holds the wrong absolute instant and every non-Prisma reader (a SQL
 * report, a BI tool) is off by the server's offset. Supabase runs UTC and
 * the local server does not, so the same code wrote different instants in
 * development than in production.
 *
 * `options` is libpq's per-connection GUC switch, which node-postgres
 * forwards in the startup packet. Passing it as a field of the pool config
 * rather than appending it to the connection string avoids having to guess
 * how the string's query component is percent-decoded.
 */
export function pgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c timezone=UTC' });
}

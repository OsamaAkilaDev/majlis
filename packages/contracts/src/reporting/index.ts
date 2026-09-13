import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

/** GET /reports/overview. Platform totals, Admin only. */
export const overviewReportSchema = z.object({
  clubsByStatus: z.record(z.string(), z.number().int()),
  eventsByStatus: z.record(z.string(), z.number().int()),
  users: z.number().int(),
  activeMemberships: z.number().int(),
  certificatesIssued: z.number().int(),
});

/**
 * GET /clubs/:clubId/reports. `attendanceRate` is attended over expected,
 * where expected excludes the waitlist: somebody who never held a place was
 * never expected in the room. It is 0 when nothing was expected, rather than
 * NaN.
 */
export const clubReportSchema = z.object({
  clubId: z.uuid(),
  events: z.number().int(),
  registrations: z.number().int(),
  expected: z.number().int(),
  attended: z.number().int(),
  attendanceRate: z.number().min(0).max(1),
  certificatesIssued: z.number().int(),
});

/**
 * One audit row as the viewer reads it. Read-only: there is no route in the
 * product that writes or deletes one, and the table is append-only by
 * statement-level trigger.
 */
export const auditEntrySchema = z.object({
  id: z.uuid(),
  actorUserId: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  outcome: z.enum(['SUCCESS', 'DENIED']),
  reason: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  requestId: z.string(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export const auditPageSchema = cursorPageSchema(auditEntrySchema);

export const auditListQuerySchema = cursorPageQuerySchema.extend({
  entityType: z.string().min(1).max(64).optional(),
  actorUserId: z.uuid().optional(),
});

/**
 * Spec 8 forbids an unbounded list anywhere, and an export is inherently a
 * bulk read. Both halves need these: the API writes the trailer row, and the
 * screen that triggered the download reads it back to report the cap. Two
 * copies of the sentence would drift the moment either side reworded it.
 */
export const EXPORT_ROW_CAP = 10_000;

export const EXPORT_CAP_NOTICE = `Truncated at ${EXPORT_ROW_CAP} rows. Narrow the export and try again.`;

/** True when an export ended in the cap trailer rather than a data row. */
export function isCapped(csv: string): boolean {
  return csv.trimEnd().endsWith(EXPORT_CAP_NOTICE);
}

/** The one query parameter every per-event export requires. */
export const eventExportQuerySchema = z.object({ eventId: z.uuid() });

export type OverviewReport = z.infer<typeof overviewReportSchema>;
export type ClubReport = z.infer<typeof clubReportSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type EventExportQuery = z.infer<typeof eventExportQuerySchema>;

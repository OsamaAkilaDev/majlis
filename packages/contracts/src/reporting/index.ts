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

/** The one query parameter every per-event export requires. */
export const eventExportQuerySchema = z.object({ eventId: z.uuid() });

export type OverviewReport = z.infer<typeof overviewReportSchema>;
export type ClubReport = z.infer<typeof clubReportSchema>;
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditPage = z.infer<typeof auditPageSchema>;
export type AuditListQuery = z.infer<typeof auditListQuerySchema>;
export type EventExportQuery = z.infer<typeof eventExportQuerySchema>;

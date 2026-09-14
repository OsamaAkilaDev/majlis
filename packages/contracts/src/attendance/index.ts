import { z } from 'zod';
import { emailSchema } from '../auth';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';
import { overrideReasonSchema } from '../common/override';
import { eventStatusSchema, registrationStatusSchema } from '../events';

export const attendanceMethodSchema = z.enum(['QR_SCAN', 'MANUAL']);

/**
 * GET /me/qr-pass. `token` is the signed pass itself, returned to its owner
 * and to nobody else: there is no route anywhere that returns another
 * user's token. It is never stored and never logged; only `tokenVersion`,
 * which the signature commits to, lives in the database (spec 5.1).
 */
export const qrPassSchema = z.object({
  token: z.string(),
  tokenVersion: z.number().int(),
  issuedAt: z.string(),
});

/**
 * POST /events/:eventId/check-in/scan. The token is the whole credential, so
 * it travels in the body and never in a query string, where it would land in
 * an access log the first time anything proxies this API.
 */
export const scanBodySchema = z.object({
  token: z.string().trim().min(1).max(512),
  deviceHint: z.string().trim().min(1).max(120).optional(),
});

/**
 * POST /events/:eventId/check-in/manual. Keyed by email rather than a second
 * human-readable credential format (decided 2026-09-12): the operator can
 * already read the address off the student, and a second credential is a
 * second thing to sign, rotate and get wrong.
 */
export const manualCheckInBodySchema = z.object({
  email: emailSchema,
  reason: z.string().trim().min(1).max(500),
});

const holder = {
  fullName: z.string(),
  email: z.string(),
  checkedInAt: z.string(),
};

/**
 * Six outcomes on one 200 response, discriminated by `result`. They are not
 * client errors: they are outcomes the operator has to read off a phone at
 * arm's length, so only the seventh, "not authorised to scan this event",
 * is an HTTP fault (403, written by PermissionsGuard).
 *
 * Only the two success shapes carry personal data. A failure never names a
 * student, which is what stops a mis-scan from disclosing an unrelated
 * person's identity to whoever is holding the scanner (spec 7.5).
 */
export const checkInResultSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('CHECKED_IN'), ...holder }),
  z.object({ result: z.literal('ALREADY_CHECKED_IN'), ...holder }),
  z.object({ result: z.literal('NOT_REGISTERED') }),
  z.object({ result: z.literal('REGISTRATION_CANCELLED') }),
  z.object({ result: z.literal('EVENT_NOT_OPEN'), eventStatus: eventStatusSchema }),
  z.object({ result: z.literal('INVALID_PASS') }),
]);

/** One row per registration, checked in or not: this is the check-in roster. */
export const attendanceRowSchema = z.object({
  /** The registration id: the roster is the registration list, with attendance on it. */
  id: z.uuid(),
  userId: z.uuid(),
  fullName: z.string(),
  email: z.string(),
  registrationStatus: registrationStatusSchema,
  checkedInAt: z.string().nullable(),
  method: attendanceMethodSchema.nullable(),
});

/**
 * The counter the scanner screen shows. `expected` counts the registrations
 * that held a confirmed place, whatever became of them; a waitlisted student
 * is not expected in the room.
 */
export const attendancePageSchema = cursorPageSchema(attendanceRowSchema).extend({
  checkedIn: z.number().int(),
  expected: z.number().int(),
});

export const attendanceListQuerySchema = cursorPageQuerySchema;

/**
 * PATCH /events/:eventId/attendance/:registrationId. `present` is the state
 * being asserted, not a toggle, so a retried correction is idempotent.
 * `override` carries an Admin's reason for correcting after the window has
 * closed, which is a separate decision from the correction's own reason.
 */
export const correctAttendanceBodySchema = z.object({
  present: z.boolean(),
  reason: z.string().trim().min(1).max(500),
  override: z.object({ reason: overrideReasonSchema }).optional(),
});

export type AttendanceMethod = z.infer<typeof attendanceMethodSchema>;
export type QrPass = z.infer<typeof qrPassSchema>;
export type ScanBody = z.infer<typeof scanBodySchema>;
export type ManualCheckInBody = z.infer<typeof manualCheckInBodySchema>;
export type CheckInResult = z.infer<typeof checkInResultSchema>;
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;
export type AttendancePage = z.infer<typeof attendancePageSchema>;
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
export type CorrectAttendanceBody = z.infer<typeof correctAttendanceBodySchema>;

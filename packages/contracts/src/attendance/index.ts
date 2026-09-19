import { z } from 'zod';
import { emailSchema } from '../auth';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';
import { overrideReasonSchema } from '../common/override';
import { eventStatusSchema, registrationStatusSchema } from '../events';

export const attendanceMethodSchema = z.enum(['QR_SCAN', 'MANUAL']);

/**
 * `token` is the signed pass itself, returned to its owner and to nobody
 * else: no route anywhere returns another user's. Never stored, never logged;
 * only `tokenVersion`, which the signature commits to, is in the database.
 */
export const qrPassSchema = z.object({
  token: z.string(),
  tokenVersion: z.number().int(),
  issuedAt: z.string(),
});

/** The token is the whole credential, so it travels in the body and never a
 *  query string, where the first proxy would write it to an access log. */
export const scanBodySchema = z.object({
  token: z.string().trim().min(1).max(512),
  deviceHint: z.string().trim().min(1).max(120).optional(),
});

/** Keyed by email, not a second credential format (decided 2026-09-12): a
 *  second credential is a second thing to sign, rotate and get wrong. */
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
 * Six outcomes on one 200, discriminated by `result`: they are things the
 * operator reads off a phone, not client errors. Only the seventh, "not
 * authorised to scan", is an HTTP fault.
 *
 * Only the two success shapes carry personal data. A failure never names a
 * student, or a mis-scan discloses an unrelated person to whoever holds the
 * scanner (spec 7.5).
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

/** `expected` counts registrations that held a confirmed place, whatever
 *  became of them: a waitlisted student is not expected in the room. */
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
export type AttendancePage = z.infer<typeof attendancePageSchema>;
export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
export type CorrectAttendanceBody = z.infer<typeof correctAttendanceBodySchema>;

import { z } from 'zod';
import { clubRoleSchema } from '../common/enums';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';
import { overrideBodySchema, overrideReasonSchema } from '../common/override';
import { httpsUrlSchema, signedUploadSchema } from '../clubs';

export const eventStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
  'CANCELLED',
]);

export const eventResponsibilitySchema = z.enum(['EVENT_LEAD', 'OPERATIONS', 'MARKETING']);

export const registrationStatusSchema = z.enum([
  'CONFIRMED',
  'WAITLISTED',
  'CANCELLED',
  'CHECKED_IN',
  'ATTENDED',
  'NO_SHOW',
  'REMOVED',
]);

export const attendancePolicySchema = z.enum(['CHECK_IN_ONLY']);

/** Accepts the `Z` form a browser's toISOString() produces and an explicit offset. */
const dateTime = z.iso.datetime({ offset: true });

/**
 * An IANA zone name, validated against the runtime's own tz database rather
 * than a hardcoded list: a zone the server cannot resolve would render every
 * time on the event page as an exception.
 */
const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'must be an IANA time zone name');

/**
 * No `bannerUrl`: like a club logo, the server never stores a client-supplied
 * image URL. `eventId` is minted by POST /clubs/:clubId/uploads/event-poster,
 * so the poster's object path exists before the event does.
 *
 * The check-in window is optional here and defaults to startsAt - 60 min …
 * endsAt + 30 min (spec 5.1), which is what makes ONGOING a pure function of
 * timestamps for an event nobody bothered to configure.
 */
export const createEventBodySchema = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().min(1).max(400),
  description: z.string().trim().min(1).max(8000),
  eventType: z.string().trim().min(2).max(60),
  audience: z.string().trim().min(2).max(120),
  venue: z.string().trim().min(1).max(240).nullish(),
  onlineUrl: httpsUrlSchema.nullish(),
  timezone: timezoneSchema.default('Asia/Dubai'),
  startsAt: dateTime,
  endsAt: dateTime,
  registrationOpensAt: dateTime,
  registrationClosesAt: dateTime,
  checkInOpensAt: dateTime.optional(),
  checkInClosesAt: dateTime.optional(),
  capacity: z.number().int().positive().max(100_000),
  waitlistEnabled: z.boolean().default(true),
  requiresClubMembership: z.boolean().default(false),
  certificateEnabled: z.boolean().default(false),
  certificateTitle: z.string().trim().min(1).max(160).nullish(),
  certificateSignatory: z.string().trim().min(1).max(160).nullish(),
  attendancePolicy: attendancePolicySchema.default('CHECK_IN_ONLY'),
  posterUploaded: z.boolean().default(false),
  /** Required when an Admin holding no club role creates. Spec 6.1. */
  overrideReason: overrideReasonSchema.optional(),
});

/**
 * POST /events/:eventId/publish carries nothing but the override reason, and
 * only when an Admin holding no club role is the one publishing.
 */
export const publishEventBodySchema = overrideBodySchema;

/**
 * Every key is optional, and which of them a given officer may actually send
 * is decided server-side by EVENT_FIELDS (apps/api/src/auth/field-permissions
 * .ts), not here: a schema cannot know who is asking.
 */
export const patchEventBodySchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    summary: z.string().trim().min(1).max(400),
    description: z.string().trim().min(1).max(8000),
    eventType: z.string().trim().min(2).max(60),
    audience: z.string().trim().min(2).max(120),
    venue: z.string().trim().min(1).max(240).nullable(),
    onlineUrl: httpsUrlSchema.nullable(),
    timezone: timezoneSchema,
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase words joined by hyphens')
      .max(80),
    startsAt: dateTime,
    endsAt: dateTime,
    registrationOpensAt: dateTime,
    registrationClosesAt: dateTime,
    checkInOpensAt: dateTime,
    checkInClosesAt: dateTime,
    capacity: z.number().int().positive().max(100_000),
    waitlistEnabled: z.boolean(),
    requiresClubMembership: z.boolean(),
    certificateEnabled: z.boolean(),
    certificateTitle: z.string().trim().min(1).max(160).nullable(),
    certificateSignatory: z.string().trim().min(1).max(160).nullable(),
    attendancePolicy: attendancePolicySchema,
    posterUploaded: z.boolean(),
    /** Required when an Admin holding no club role edits. Spec 6.1. */
    overrideReason: overrideReasonSchema,
  })
  .partial();

export const cancelEventBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const assignResponsibilityBodySchema = z.object({
  userId: z.uuid(),
  responsibility: eventResponsibilitySchema,
  /** Required when an Admin holding no club role assigns. Spec 6.1. */
  overrideReason: overrideReasonSchema.optional(),
});

/**
 * DELETE /events/:eventId/assignments/:assignmentId carries a body, the same
 * shape DELETE /clubs/:clubId/team/:appointmentId already uses for its reason.
 */
export const removeAssignmentBodySchema = overrideBodySchema;

/**
 * An ordinary student sends `{}`. `userId` is the Admin override from spec
 * 7.4, and the reason is required with it: an override with no recorded
 * reason is indistinguishable from a bug in the audit log.
 */
export const registerBodySchema = z
  .object({
    userId: z.uuid().optional(),
    overrideReason: overrideReasonSchema.optional(),
  })
  .refine((v) => v.userId === undefined || v.overrideReason !== undefined, {
    path: ['overrideReason'],
    message: 'is required when registering another user',
  });

/** POST /clubs/:clubId/uploads/event-poster mints the id the event will be created with. */
export const newEventUploadSchema = signedUploadSchema.extend({ eventId: z.uuid() });

export const eventSummarySchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  clubName: z.string(),
  clubLogoUrl: z.string(),
  title: z.string(),
  slug: z.string(),
  summary: z.string(),
  eventType: z.string(),
  audience: z.string(),
  venue: z.string().nullable(),
  onlineUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  timezone: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  registrationOpensAt: z.string(),
  registrationClosesAt: z.string(),
  capacity: z.number().int(),
  confirmedCount: z.number().int(),
  waitlistEnabled: z.boolean(),
  requiresClubMembership: z.boolean(),
  status: eventStatusSchema,
});

export const eventDetailSchema = eventSummarySchema.extend({
  description: z.string(),
  checkInOpensAt: z.string(),
  checkInClosesAt: z.string(),
  certificateEnabled: z.boolean(),
  certificateTitle: z.string().nullable(),
  certificateSignatory: z.string().nullable(),
  attendancePolicy: attendancePolicySchema,
  cancelledReason: z.string().nullable(),
  /** The viewer's own relationship to this event. Never another user's. */
  viewerRegistrationStatus: registrationStatusSchema.nullable(),
  viewerWaitlistPosition: z.number().int().nullable(),
  viewerClubRoles: z.array(clubRoleSchema),
  viewerResponsibilities: z.array(eventResponsibilitySchema),
});

export const eventPageSchema = cursorPageSchema(eventSummarySchema);

export const eventListQuerySchema = cursorPageQuerySchema.extend({
  clubId: z.uuid().optional(),
  status: eventStatusSchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
  /** Only events that have not ended yet. */
  upcoming: z.stringbool().optional(),
  /**
   * Which end of creation order the page starts from. `desc` is for a picker
   * that has to reach the event somebody just made; the default reads
   * forwards like every other list.
   */
  direction: z.enum(['asc', 'desc']).optional(),
});

export const assignmentSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  userId: z.uuid(),
  userFullName: z.string(),
  userEmail: z.string(),
  responsibility: eventResponsibilitySchema,
  createdAt: z.string(),
});

/**
 * Cursor-paginated like every other list (spec 8, "no unbounded list,
 * anywhere"). An event's assignments are a handful of rows in practice, but
 * nothing in the schema bounds them and a silently truncated roster of who may
 * scan is not a thing an officer can notice.
 */
export const assignmentListSchema = cursorPageSchema(assignmentSchema);

/**
 * The attendee roster. Carries full names and email addresses, so every read
 * of it is behind `registration:read` (spec 6.1, "View attendee personal
 * data"), and Marketing is excluded outright.
 */
export const registrationSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  userId: z.uuid(),
  userFullName: z.string(),
  userEmail: z.string(),
  status: registrationStatusSchema,
  waitlistPosition: z.number().int().nullable(),
  registeredAt: z.string(),
  promotedAt: z.string().nullable(),
  source: z.enum(['SELF', 'ADMIN_OVERRIDE']),
});

export const registrationPageSchema = cursorPageSchema(registrationSchema);

export const registrationListQuerySchema = cursorPageQuerySchema.extend({
  status: registrationStatusSchema.optional(),
});

/** GET /me/registrations carries the event, not the attendee: the attendee is the caller. */
export const myRegistrationSchema = z.object({
  id: z.uuid(),
  status: registrationStatusSchema,
  waitlistPosition: z.number().int().nullable(),
  registeredAt: z.string(),
  event: eventSummarySchema,
});

export const myRegistrationPageSchema = cursorPageSchema(myRegistrationSchema);

export const sweepResultSchema = z.object({
  scanned: z.number().int(),
  advanced: z.number().int(),
  /**
   * Certificates issued on the same call. The sweep is the only reliable
   * issuance path: an event completes when its check-in window shuts but
   * cannot issue until the attendance correction window closes 48 hours
   * later, so nothing that advanced a status can also issue for it.
   */
  certificatesIssued: z.number().int(),
});

export type EventStatus = z.infer<typeof eventStatusSchema>;
export type EventResponsibility = z.infer<typeof eventResponsibilitySchema>;
export type RegistrationStatus = z.infer<typeof registrationStatusSchema>;
export type AttendancePolicy = z.infer<typeof attendancePolicySchema>;
export type CreateEventBody = z.infer<typeof createEventBodySchema>;
export type PatchEventBody = z.infer<typeof patchEventBodySchema>;
export type CancelEventBody = z.infer<typeof cancelEventBodySchema>;
export type PublishEventBody = z.infer<typeof publishEventBodySchema>;
export type AssignResponsibilityBody = z.infer<typeof assignResponsibilityBodySchema>;
export type RemoveAssignmentBody = z.infer<typeof removeAssignmentBodySchema>;
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type NewEventUpload = z.infer<typeof newEventUploadSchema>;
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type AssignmentList = z.infer<typeof assignmentListSchema>;
export type Registration = z.infer<typeof registrationSchema>;
export type RegistrationPage = z.infer<typeof registrationPageSchema>;
export type RegistrationListQuery = z.infer<typeof registrationListQuerySchema>;
export type MyRegistration = z.infer<typeof myRegistrationSchema>;
export type MyRegistrationPage = z.infer<typeof myRegistrationPageSchema>;
export type SweepResult = z.infer<typeof sweepResultSchema>;

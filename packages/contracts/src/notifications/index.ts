import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

/**
 * Spec 7.7's trigger list, plus the password reset of Stage 7's Task 3.
 * A closed enum rather than a free string: the inbox renders per type and
 * the email layer picks a template per type, so an unknown value reaching
 * either is a bug worth failing on at the boundary.
 */
export const notificationTypeSchema = z.enum([
  'team.invited',
  'membership.decided',
  'event.published',
  'registration.confirmed',
  'registration.waitlisted',
  'registration.promoted',
  'event.changed',
  'event.cancelled',
  'certificate.issued',
  'certificate.revoked',
  'auth.password_reset',
]);

/**
 * The payload is JSONB carrying only ids and display strings the inbox
 * needs. No email address and nothing a log would have to redact, with the
 * single exception of `auth.password_reset`, which is never returned by
 * GET /me/notifications at all (see NotificationsService.list).
 */
export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});

export const notificationPageSchema = cursorPageSchema(notificationSchema);

/**
 * `unread` is tri-state on the wire: absent means "no filter", which is not
 * the same as `unread=false`. A plain `z.coerce.boolean()` would collapse
 * both of those AND turn the string 'false' into `true`, since every
 * non-empty string is truthy.
 */
export const notificationListQuerySchema = cursorPageQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type NotificationPage = z.infer<typeof notificationPageSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

/**
 * What POST /internal/notification-sweep reports. Every PENDING row it
 * picked up lands in exactly one of the three counters, so the sum is the
 * size of the batch.
 */
export const notificationSweepResultSchema = z.object({
  sent: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
});

export type NotificationSweepResult = z.infer<typeof notificationSweepResultSchema>;

import { z } from 'zod';
import { appointmentStatusSchema, clubRoleSchema } from '../common/enums';
import { overrideReasonSchema } from '../common/override';
import { cursorPageSchema } from '../common/pagination';

export { appointmentStatusSchema, clubRoleSchema };

/**
 * LEAD is excluded. Appointing a Lead is Admin-only and has its own route
 * (POST /clubs/:clubId/lead), so admitting LEAD here would let a Lead
 * appoint a co-Lead through a route only Lead permission guards.
 */
export const inviteTeamMemberBodySchema = z.object({
  userId: z.uuid(),
  role: z.enum(['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']),
  /** Required when an Admin holding no club role invites. Spec 6.1. */
  overrideReason: overrideReasonSchema.optional(),
});

export const endAppointmentBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const appointmentSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  userId: z.uuid(),
  userFullName: z.string(),
  /**
   * Omitted entirely, never nulled, for a reader who does not hold
   * `club:team-manage` in this club. The list itself is open to any
   * signed-in user; the addresses on it are not.
   */
  userEmail: z.string().optional(),
  role: clubRoleSchema,
  status: appointmentStatusSchema,
  invitationExpiresAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** True when this officer is no longer an ordinary member of the club. */
  hasLeftClub: z.boolean(),
});

export const invitationSchema = z.object({
  id: z.uuid(),
  clubId: z.uuid(),
  clubName: z.string(),
  clubLogoUrl: z.string(),
  role: clubRoleSchema,
  invitationExpiresAt: z.string(),
});

export const appointmentPageSchema = cursorPageSchema(appointmentSchema);
export const invitationPageSchema = cursorPageSchema(invitationSchema);

// ClubRole and AppointmentStatus types come from ../common/enums via the
// barrel; redeclaring them here would collide as ambiguous `export *` names.
export type InviteTeamMemberBody = z.infer<typeof inviteTeamMemberBodySchema>;
export type EndAppointmentBody = z.infer<typeof endAppointmentBodySchema>;
export type Appointment = z.infer<typeof appointmentSchema>;
export type Invitation = z.infer<typeof invitationSchema>;
export type AppointmentPage = z.infer<typeof appointmentPageSchema>;
export type InvitationPage = z.infer<typeof invitationPageSchema>;

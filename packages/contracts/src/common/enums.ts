import { z } from 'zod';

/**
 * Shared across clubs, team and membership contracts so the three cannot
 * drift into three separately-typed lists of the same five roles.
 */
export const clubRoleSchema = z.enum(['LEAD', 'VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS']);

export const membershipStatusSchema = z.enum(['PENDING', 'ACTIVE', 'REJECTED', 'LEFT', 'REMOVED']);

export const appointmentStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DECLINED', 'EXPIRED', 'ENDED']);

export type ClubRole = z.infer<typeof clubRoleSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

/**
 * Lives here rather than in ../events because ../clubs names it too, and
 * ../events already imports from ../clubs: declaring it there would make the
 * two modules a cycle, which Zod cannot survive at module init.
 */
export const eventStatusSchema = z.enum([
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_CLOSED',
  'ONGOING',
  'COMPLETED',
  'CERTIFIED',
  'CANCELLED',
]);

export type EventStatus = z.infer<typeof eventStatusSchema>;

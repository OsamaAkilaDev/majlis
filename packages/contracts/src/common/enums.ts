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

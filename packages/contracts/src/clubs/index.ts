import { z } from 'zod';
import { clubRoleSchema, membershipStatusSchema } from '../common/enums';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

export const clubStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']);
export const membershipPolicySchema = z.enum(['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED']);

/**
 * Zod 4's .url() checks shape, not scheme. Every stored URL in this product
 * is rendered into a browser, so the scheme is allowlisted explicitly.
 */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      return new URL(v).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an https URL');

export const academicYearSchema = z
  .string()
  .trim()
  .regex(/^\d{4}\/\d{4}$/, 'must look like 2026/2027')
  .refine((v) => {
    const [from, to] = v.split('/').map(Number) as [number, number];
    return to === from + 1;
  }, 'must be two consecutive years');

/**
 * No `logoUrl` here: the server never stores a client-supplied image URL.
 * `ClubsService.verifyUpload` builds it server-side from `clubId` once the
 * upload at that id is confirmed.
 */
export const createClubBodySchema = z.object({
  clubId: z.uuid(),
  departmentId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(2).max(60),
  academicYear: academicYearSchema,
  membershipPolicy: membershipPolicySchema,
});

export const patchClubBodySchema = z
  .object({
    departmentId: z.uuid(),
    description: z.string().trim().min(1).max(2000),
    category: z.string().trim().min(2).max(60),
    academicYear: academicYearSchema,
    membershipPolicy: membershipPolicySchema,
    logoUrl: httpsUrlSchema,
    bannerUrl: httpsUrlSchema.nullable(),
  })
  .partial();

export const patchClubStatusBodySchema = z.object({
  status: clubStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

export const appointLeadBodySchema = z.object({ userId: z.uuid() });

/** The kinds an upload URL may be requested for. Mirrors IMAGE_KINDS below. */
export const imageKindSchema = z.enum(['club-logo', 'club-banner']);

export type ImageKind = z.infer<typeof imageKindSchema>;

/**
 * Shared by the API (apps/api/src/storage/image-kinds.ts) and the browser
 * converter (apps/web/src/lib/image.ts). It lives here so the two cannot
 * drift: the browser encodes toward these numbers and the API verifies
 * against them.
 */
export const IMAGE_KINDS = {
  'club-logo': { maxBytes: 256 * 1024, box: { w: 512, h: 512 }, square: true },
  'club-banner': { maxBytes: 512 * 1024, box: { w: 1600, h: 600 }, square: false },
} as const satisfies Record<ImageKind, { maxBytes: number; box: { w: number; h: number }; square: boolean }>;

export const signedUploadSchema = z.object({
  path: z.string(),
  signedUrl: z.url(),
  token: z.string(),
  /** The URL to store once the upload succeeds, version suffix included. */
  publicUrl: httpsUrlSchema,
});

/** POST /uploads/club-logo also mints the id the club will be created with. */
export const newClubUploadSchema = signedUploadSchema.extend({ clubId: z.uuid() });

export const clubSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  logoUrl: z.string(),
  status: clubStatusSchema,
  membershipPolicy: membershipPolicySchema,
  departmentName: z.string(),
  memberCount: z.number().int().nonnegative(),
});

export const clubDetailSchema = clubSummarySchema.extend({
  description: z.string(),
  academicYear: z.string(),
  bannerUrl: z.string().nullable(),
  departmentId: z.uuid(),
  /** The viewer's own relationship to this club. Never another user's. */
  viewerMembershipStatus: membershipStatusSchema.nullable(),
  viewerClubRoles: z.array(clubRoleSchema),
});

export const clubPageSchema = cursorPageSchema(clubSummarySchema);

export const clubListQuerySchema = cursorPageQuerySchema.extend({
  departmentId: z.uuid().optional(),
  status: clubStatusSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
});

export type ClubStatus = z.infer<typeof clubStatusSchema>;
export type MembershipPolicy = z.infer<typeof membershipPolicySchema>;
export type CreateClubBody = z.infer<typeof createClubBodySchema>;
export type PatchClubBody = z.infer<typeof patchClubBodySchema>;
export type PatchClubStatusBody = z.infer<typeof patchClubStatusBodySchema>;
export type AppointLeadBody = z.infer<typeof appointLeadBodySchema>;
export type SignedUpload = z.infer<typeof signedUploadSchema>;
export type NewClubUpload = z.infer<typeof newClubUploadSchema>;
export type ClubSummary = z.infer<typeof clubSummarySchema>;
export type ClubDetail = z.infer<typeof clubDetailSchema>;
export type ClubPage = z.infer<typeof clubPageSchema>;
export type ClubListQuery = z.infer<typeof clubListQuerySchema>;

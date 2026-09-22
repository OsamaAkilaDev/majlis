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

/**
 * No `logoUrl`/`bannerUrl` here either, for the same reason as
 * createClubBodySchema: the server never stores a client-supplied image URL.
 * `logoUploaded`/`bannerUploaded` mean "I just uploaded one at the path you
 * gave me, go verify it". The service calls `verifyUpload` and stores what
 * that returns.
 */
export const patchClubBodySchema = z
  .object({
    departmentId: z.uuid(),
    description: z.string().trim().min(1).max(2000),
    category: z.string().trim().min(2).max(60),
    academicYear: academicYearSchema,
    membershipPolicy: membershipPolicySchema,
    logoUploaded: z.boolean(),
    bannerUploaded: z.boolean(),
    /** Required when an Admin holding no club role edits. Spec 6.1. */
    overrideReason: z.string().trim().min(1).max(500),
  })
  .partial();

export const patchClubStatusBodySchema = z.object({
  status: clubStatusSchema,
  reason: z.string().trim().min(1).max(500),
});

export const appointLeadBodySchema = z.object({ userId: z.uuid() });

/** The kinds an upload URL may be requested for. Mirrors IMAGE_KINDS below. */
export const imageKindSchema = z.enum(['club-logo', 'club-banner', 'event-poster']);

export type ImageKind = z.infer<typeof imageKindSchema>;

/**
 * Shared by the API (apps/api/src/storage/image-kinds.ts) and the browser
 * converter (apps/web/src/lib/image.ts). It lives here so the two cannot
 * drift: the browser encodes toward these numbers and the API verifies
 * against them.
 *
 * The box IS the ratio. Every upload is centre-cropped to it, so a banner is
 * 4:1 wherever it is stored and wherever it is drawn, and no screen has to
 * guess how tall the artwork it was handed will turn out to be. A `square`
 * flag used to say this for the logo alone and said nothing about the rest,
 * which is why a banner could arrive at any shape at all.
 */
export const IMAGE_KINDS = {
  'club-logo': { maxBytes: 256 * 1024, box: { w: 512, h: 512 } },
  'club-banner': { maxBytes: 512 * 1024, box: { w: 1600, h: 400 } },
  'event-poster': { maxBytes: 512 * 1024, box: { w: 1600, h: 900 } },
} as const satisfies Record<ImageKind, { maxBytes: number; box: { w: number; h: number } }>;

/** The CSS `aspect-ratio` a kind's artwork always has, for the box it reserves. */
export function imageAspectRatio(kind: ImageKind): string {
  const { box } = IMAGE_KINDS[kind];
  return `${box.w} / ${box.h}`;
}

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

export const committeeMemberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  role: clubRoleSchema,
  /** When the appointment was accepted. No address: the club page is open to
   *  every signed-in user and an address is directory data. */
  since: z.string().nullable(),
});


export const clubDetailSchema = clubSummarySchema.extend({
  description: z.string(),
  academicYear: z.string(),
  bannerUrl: z.string().nullable(),
  departmentId: z.uuid(),
  /** The viewer's own relationship to this club. Never another user's. */
  viewerMembershipStatus: membershipStatusSchema.nullable(),
  viewerClubRoles: z.array(clubRoleSchema),
  committee: z.array(committeeMemberSchema),
  /**
   * Null, never 0, for a viewer without `membership:decide` in this club:
   * "you may not see this" and "there are none" are different facts, and a
   * zero would let the Manage badge disappear for the wrong reason.
   */
  pendingMemberCount: z.number().int().nonnegative().nullable(),
  /** Events this club has actually run: COMPLETED or CERTIFIED. */
  eventsRun: z.number().int().nonnegative(),
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
export type CommitteeMember = z.infer<typeof committeeMemberSchema>;
export type ClubDetail = z.infer<typeof clubDetailSchema>;
export type ClubPage = z.infer<typeof clubPageSchema>;
export type ClubListQuery = z.infer<typeof clubListQuerySchema>;

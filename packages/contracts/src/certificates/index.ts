import { z } from 'zod';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination';

export const certificateStatusSchema = z.enum(['ACTIVE', 'REVOKED']);

/**
 * One issued certificate, as its holder and its club see it. The four
 * snapshot fields are what the row stored at issuance, never what the club
 * or the event is called today: renaming a club must not alter a certificate
 * somebody already has (spec 5.1).
 */
export const certificateSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  userId: z.uuid(),
  serialNumber: z.string(),
  verificationCode: z.string(),
  status: certificateStatusSchema,
  holderName: z.string(),
  eventTitle: z.string(),
  clubName: z.string(),
  clubLogoUrl: z.string(),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
});

export const certificatePageSchema = cursorPageSchema(certificateSchema);
export const certificateListQuerySchema = cursorPageQuerySchema;

/** What POST /events/:eventId/certificates/issue reports back. */
export const certificateIssueResultSchema = z.object({
  issued: z.number().int(),
  total: z.number().int(),
});

/**
 * Revocation and reissue are Admin-only and both require a reason: spec 7.6,
 * and an unexplained revocation is indistinguishable from a bug in the audit
 * log.
 */
export const revokeCertificateBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const reissueCertificateBodySchema = revokeCertificateBodySchema;

/** GET /certificates/:id/pdf. Rendered and uploaded on the first call. */
export const certificatePdfSchema = z.object({ pdfUrl: z.string() });

/**
 * GET /verify/{code}. Public and unauthenticated, so this is the exact and
 * complete list of what a certificate discloses to the world: holder name,
 * event, club, when it was issued, and whether it still stands. Nothing is
 * ever added to it: no email, no user id, no serial, no event id.
 *
 * A revoked certificate answers REVOKED with its revocation date rather than
 * vanishing: an employer holding a revoked document has to be able to learn
 * that it was revoked.
 */
export const verificationSchema = z.object({
  status: certificateStatusSchema,
  holderName: z.string(),
  eventTitle: z.string(),
  clubName: z.string(),
  issuedAt: z.string(),
  revokedAt: z.string().nullable(),
});

export type CertificateStatus = z.infer<typeof certificateStatusSchema>;
export type Certificate = z.infer<typeof certificateSchema>;
export type CertificatePage = z.infer<typeof certificatePageSchema>;
export type CertificateListQuery = z.infer<typeof certificateListQuerySchema>;
export type CertificateIssueResult = z.infer<typeof certificateIssueResultSchema>;
export type RevokeCertificateBody = z.infer<typeof revokeCertificateBodySchema>;
export type ReissueCertificateBody = z.infer<typeof reissueCertificateBodySchema>;
export type CertificatePdf = z.infer<typeof certificatePdfSchema>;
export type Verification = z.infer<typeof verificationSchema>;

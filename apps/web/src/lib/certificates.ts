import type {
  Certificate,
  CertificateIssueResult,
  CertificatePage,
  CertificatePdf,
  CursorPageQuery,
  ReissueCertificateBody,
  RevokeCertificateBody,
} from '@majlis/contracts';
import { apiFetch, json, qs } from './api';

const page = (query: CursorPageQuery) => qs({ cursor: query.cursor, limit: String(query.limit) });

/** Idempotent: a second press issues nothing and reports the same totals. */
export const issueCertificates = (eventId: string): Promise<CertificateIssueResult> =>
  apiFetch(`/events/${eventId}/certificates/issue`, { method: 'POST' });

export const eventCertificates = (
  eventId: string,
  query: CursorPageQuery,
): Promise<CertificatePage> => apiFetch(`/events/${eventId}/certificates${page(query)}`);

export const myCertificates = (query: CursorPageQuery): Promise<CertificatePage> =>
  apiFetch(`/me/certificates${page(query)}`);

/** Rendered and uploaded on the first call, so this can be slow exactly once. */
export const certificatePdf = (id: string): Promise<CertificatePdf> =>
  apiFetch(`/certificates/${id}/pdf`);

export const revokeCertificate = (id: string, body: RevokeCertificateBody): Promise<Certificate> =>
  apiFetch(`/certificates/${id}/revoke`, json(body));

export const reissueCertificate = (id: string, body: ReissueCertificateBody): Promise<Certificate> =>
  apiFetch(`/certificates/${id}/reissue`, json(body));

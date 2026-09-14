import type {
  AuditListQuery,
  AuditPage,
  ClubReport,
  OverviewReport,
} from '@majlis/contracts';
import { isCapped } from '@majlis/contracts/constants';
import { apiFetch, apiText, qs } from './api';

export const overviewReport = (): Promise<OverviewReport> => apiFetch('/reports/overview');

export const clubReport = (clubId: string): Promise<ClubReport> =>
  apiFetch(`/clubs/${clubId}/reports`);

const auditQs = (query: AuditListQuery) =>
  qs({
    entityType: query.entityType,
    actorUserId: query.actorUserId,
    cursor: query.cursor,
    limit: String(query.limit),
  });

export const listAudit = (query: AuditListQuery): Promise<AuditPage> =>
  apiFetch(`/audit${auditQs(query)}`);

export const listClubAudit = (clubId: string, query: AuditListQuery): Promise<AuditPage> =>
  apiFetch(`/clubs/${clubId}/audit${auditQs(query)}`);

/**
 * Fetches the CSV rather than pointing the browser at the URL, for two
 * reasons: the export answers 401 on a dead session and `apiText` is what
 * refreshes it, and the cap trailer is only readable from the body. Returns
 * whether the export stopped at the cap.
 */
export async function downloadCsv(path: string, filename: string): Promise<boolean> {
  const csv = await apiText(path);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // In the document, and revoked on the next turn rather than on this one: a
  // detached anchor does not start a download in every browser, and revoking
  // the object URL in the same tick can cancel the one that did start.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return isCapped(csv);
}

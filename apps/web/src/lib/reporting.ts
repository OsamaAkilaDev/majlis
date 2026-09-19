import type { AuditListQuery, AuditPage, ClubReport } from '@majlis/contracts';
import { apiFetch, qs } from './api';

export const clubReport = (clubId: string): Promise<ClubReport> =>
  apiFetch(`/clubs/${clubId}/reports`);

const auditQs = (query: AuditListQuery) =>
  qs({
    entityType: query.entityType,
    actorUserId: query.actorUserId,
    cursor: query.cursor,
    limit: query.limit,
  });

export const listAudit = (query: AuditListQuery): Promise<AuditPage> =>
  apiFetch(`/audit${auditQs(query)}`);

export const listClubAudit = (clubId: string, query: AuditListQuery): Promise<AuditPage> =>
  apiFetch(`/clubs/${clubId}/audit${auditQs(query)}`);

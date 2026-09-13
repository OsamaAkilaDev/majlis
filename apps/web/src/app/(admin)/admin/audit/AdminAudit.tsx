'use client';

import type { AuditPage } from '@majlis/contracts';
import { AuditTable } from '@/components/AuditTable';
import { listAudit } from '@/lib/reporting';

export function AdminAudit({ initial }: { initial: AuditPage | null }) {
  return <AuditTable initial={initial} fetchPage={listAudit} />;
}

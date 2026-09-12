'use client';

import type { ClubDetail as Club } from '@majlis/contracts';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { getClubBySlug } from '@/lib/clubs';
import { JoinControl } from './JoinControl';

export function ClubDetail({ slug }: { slug: string }) {
  const [club, setClub] = useState<Club | null>(null);
  const [missing, setMissing] = useState(false);

  // lib/api.ts fetches a relative path, which only resolves in the browser,
  // so this is a Client Component rather than an async Server Component.
  const load = useCallback(async () => {
    try {
      setClub(await getClubBySlug(slug));
    } catch (err) {
      if (err instanceof ProblemError && err.status === 404) setMissing(true);
      else throw err;
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) return <EmptyState title="No such club" />;
  if (!club) return <Skeleton className="h-64" />;

  return (
    <div className="flex flex-col gap-5">
      {club.bannerUrl ? (
        <img src={club.bannerUrl} alt="" className="aspect-[8/3] w-full max-w-full rounded-card object-cover" />
      ) : null}

      <div className="flex items-start gap-3">
        <img src={club.logoUrl} alt="" className="size-16 shrink-0 rounded-card object-cover" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-display text-display text-ink">{club.name}</h2>
          <p className="text-sm text-ink-2">
            {club.departmentName} · {club.category}
          </p>
          {club.status === 'ACTIVE' ? null : <StatusBadge status={club.status} />}
        </div>
      </div>

      <JoinControl club={club} onChanged={load} />

      <p className="whitespace-pre-line text-ink">{club.description}</p>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-2">Members</dt>
          <dd className="tabular-nums text-ink">{club.memberCount}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Academic year</dt>
          <dd className="tabular-nums text-ink">{club.academicYear}</dd>
        </div>
      </dl>
    </div>
  );
}

'use client';

import type { ClubPage, ClubSummary, Department } from '@majlis/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listClubs, listDepartments } from '@/lib/clubs';
import { PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import { useAsyncError } from '@/lib/use-async-error';

const ANY_DEPARTMENT = 'any';

function ClubCard({ club }: { club: ClubSummary }) {
  return (
    <Link
      href={`/clubs/${club.slug}`}
      className="flex h-full items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors duration-[--dur-fast] ease-[--ease-out] hover:bg-surface-2"
    >
      <img src={club.logoUrl} alt="" className="size-12 shrink-0 rounded-control object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{club.name}</span>
        <span className="block truncate text-sm text-ink-2">{club.category}</span>
      </span>
      <span className="shrink-0 text-sm tabular-nums text-ink-2">{club.memberCount}</span>
    </Link>
  );
}

export function ClubBrowser({
  initialClubs,
  initialDepartments,
}: {
  initialClubs: ClubPage | null;
  initialDepartments: Department[] | null;
}) {
  const [departments, setDepartments] = useState<Department[]>(initialDepartments ?? []);
  const [departmentId, setDepartmentId] = useState(ANY_DEPARTMENT);
  const [q, setQ] = useState('');
  const { items, cursor, show, append } = useCursorPage(initialClubs);
  const [loadingMore, setLoadingMore] = useState(false);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initialClubs !== null);

  const fail = useAsyncError();

  useEffect(() => {
    if (initialDepartments) return;
    listDepartments({ limit: 100 })
      .then((page) => setDepartments(page.items))
      .catch(fail);
  }, [initialDepartments]);

  // Refetches from the first page whenever a filter changes, so a stale
  // cursor from the previous filter can never paginate the new result set.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    let cancelled = false;
    show(null);
    listClubs({
      limit: PAGE,
      status: 'ACTIVE',
      ...(departmentId === ANY_DEPARTMENT ? {} : { departmentId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    })
      .then((page) => {
        if (!cancelled) show(page);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [departmentId, q, show]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const page = await listClubs({
      limit: PAGE,
      status: 'ACTIVE',
      cursor,
      ...(departmentId === ANY_DEPARTMENT ? {} : { departmentId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    });
    append(page);
    setLoadingMore(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          aria-label="Search clubs"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1"
        />
        <Select value={departmentId} onValueChange={setDepartmentId}>
          <SelectTrigger aria-label="Filter by department" className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_DEPARTMENT}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[4.5rem]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No clubs found" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((club) => (
            <li key={club.id}>
              <ClubCard club={club} />
            </li>
          ))}
        </ul>
      )}

      <LoadMore cursor={cursor} onClick={loadMore} busy={loadingMore} />
    </div>
  );
}

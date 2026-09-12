'use client';

import type { ClubSummary, Department } from '@majlis/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { listClubs, listDepartments } from '@/lib/clubs';

const PAGE = 20;
const ANY_DEPARTMENT = 'any';

function ClubCard({ club }: { club: ClubSummary }) {
  return (
    <Link
      href={`/clubs/${club.slug}`}
      className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors duration-[--dur-fast] ease-[--ease-out] hover:bg-surface-2"
    >
      <img src={club.logoUrl} alt="" className="size-12 shrink-0 rounded-control object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{club.name}</span>
        <span className="block truncate text-sm text-ink-muted">{club.category}</span>
      </span>
      <span className="shrink-0 text-sm tabular-nums text-ink-muted">{club.memberCount}</span>
    </Link>
  );
}

export function ClubBrowser() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState(ANY_DEPARTMENT);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ClubSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void listDepartments({ limit: 100 }).then((page) => setDepartments(page.items));
  }, []);

  // Refetches from the first page whenever a filter changes, so a stale
  // cursor from the previous filter can never paginate the new result set.
  useEffect(() => {
    let cancelled = false;
    setItems(null);
    void listClubs({
      limit: PAGE,
      status: 'ACTIVE',
      ...(departmentId === ANY_DEPARTMENT ? {} : { departmentId }),
      ...(q.trim() ? { q: q.trim() } : {}),
    }).then((page) => {
      if (cancelled) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    });
    return () => {
      cancelled = true;
    };
  }, [departmentId, q]);

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
    setItems((prev) => [...(prev ?? []), ...page.items]);
    setCursor(page.nextCursor);
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
        <div className="flex flex-col gap-2">
          <Skeleton className="h-[4.5rem]" />
          <Skeleton className="h-[4.5rem]" />
          <Skeleton className="h-[4.5rem]" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No clubs found" />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((club) => (
            <li key={club.id}>
              <ClubCard club={club} />
            </li>
          ))}
        </ul>
      )}

      {cursor ? (
        <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="self-center">
          Load more
        </Button>
      ) : null}
    </div>
  );
}

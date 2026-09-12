'use client';

import type { ClubStatus, ClubSummary, Department } from '@majlis/contracts';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listClubs, listDepartments } from '@/lib/clubs';

const STATUSES: ClubStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];

export function ClubsManager() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [items, setItems] = useState<ClubSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    listDepartments({ limit: 100 }).then((page) => setDepartments(page.items));
  }, []);

  async function load(reset: boolean) {
    const page = await listClubs({
      departmentId: departmentId || undefined,
      status: (status || undefined) as ClubStatus | undefined,
      limit: 20,
      cursor: reset ? undefined : (cursor ?? undefined),
    });
    setItems((prev) => (reset || !prev ? page.items : [...prev, ...page.items]));
    setCursor(page.nextCursor);
  }

  useEffect(() => {
    setItems(null);
    load(true);
  }, [departmentId, status]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Select value={departmentId || 'all'} onValueChange={(v) => setDepartmentId(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button asChild>
          <Link href="/admin/clubs/new">
            <Plus data-icon="inline-start" aria-hidden />
            New club
          </Link>
        </Button>
      </div>

      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No clubs" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Club</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/admin/clubs/${c.id}`} className="flex items-center gap-2 font-medium text-ink hover:underline">
                      <img src={c.logoUrl} alt="" className="size-6 shrink-0 rounded-control border border-border object-cover" />
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{c.departmentName}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="tabular">{c.memberCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {cursor ? (
            <Button variant="outline" onClick={() => load(false)} className="self-center">
              Load more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

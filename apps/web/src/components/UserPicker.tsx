'use client';

import type { UserSearchItem } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { listUsers, searchClubUsers } from '@/lib/clubs';
import { useAsyncError } from '@/lib/use-async-error';

/** Below this, the club-scoped route refuses the query outright. */
const MIN_QUERY = 2;

/**
 * Two sources, one list. With a `clubId` the search runs behind `user:search`,
 * which an officer holds; without one it reads `GET /users`, behind
 * `user:list`, which only an Admin holds. Pointing an officer's screen at the
 * Admin route rendered every club Lead's picker empty on a 403.
 */
export function UserPicker({
  value,
  onChange,
  exclude = [],
  clubId,
}: {
  value: UserSearchItem | null;
  onChange: (user: UserSearchItem) => void;
  exclude?: string[];
  clubId?: string;
}) {
  const [users, setUsers] = useState<UserSearchItem[]>([]);
  const [q, setQ] = useState('');
  const fail = useAsyncError();

  useEffect(() => {
    if (clubId) return;
    listUsers({ limit: 100 }).then((page) => setUsers(page.items)).catch(fail);
  }, [clubId, fail]);

  useEffect(() => {
    if (!clubId) return;
    const needle = q.trim();
    if (needle.length < MIN_QUERY) {
      setUsers([]);
      return;
    }
    // `live` drops the result of a query already typed past, rather than
    // letting it render over the newer one.
    let live = true;
    const timer = setTimeout(() => {
      searchClubUsers(clubId, needle)
        .then((page) => {
          if (live) setUsers(page.items);
        })
        .catch(fail);
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [clubId, q, fail]);

  const needle = q.trim().toLowerCase();
  const candidates = users.filter((u) => !exclude.includes(u.id));

  const filtered = needle
    ? candidates.filter(
        (u) => u.fullName.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle),
      )
    : candidates;

  return (
    <div className="flex flex-col gap-2">
      <Field label="Search">
        <Input value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      </Field>
      <ul className="max-h-40 overflow-y-auto rounded-control border border-border-control">
        {filtered.slice(0, 20).map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onChange(u)}
              aria-pressed={value?.id === u.id}
              className={cn(
                'flex w-full flex-col items-start gap-0 px-2.5 py-1.5 text-left text-sm hover:bg-surface-2',
                value?.id === u.id && 'bg-primary-soft text-primary-soft-fg',
              )}
            >
              <span>{u.fullName}</span>
              <span className="text-label text-ink-2">{u.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

'use client';

import type { UserListItem } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { Field } from '@/components/Field';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { listUsers } from '@/lib/clubs';

/**
 * GET /users has no server-side search param, so the first page (bounded at
 * 100, not unbounded) loads once and filtering is client-side. Fine at this
 * stage's user count; a growing directory needs a real search endpoint.
 */
export function UserPicker({
  value,
  onChange,
  exclude = [],
}: {
  value: UserListItem | null;
  onChange: (user: UserListItem) => void;
  exclude?: string[];
}) {
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    listUsers({ limit: 100 }).then((page) => setUsers(page.items));
  }, []);

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

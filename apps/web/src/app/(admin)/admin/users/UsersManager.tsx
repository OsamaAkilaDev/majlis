'use client';

import type { UserListItem, UserListPage, UserStatus } from '@majlis/contracts';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ProblemError } from '@/lib/api';
import { listUsers, updateUser, updateUserStatus } from '@/lib/clubs';
import { enumLabel } from '@/lib/enum-label';
import { formatDay } from '@/lib/event-time';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

const STATUSES: UserStatus[] = ['ACTIVE', 'SUSPENDED'];

/** The status the action on a row moves it to. */
const flip = (status: UserStatus): UserStatus => (status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE');

function StatusDialog({
  user,
  onClose,
  onChanged,
}: {
  user: UserListItem | null;
  onClose: () => void;
  onChanged: (id: string, status: UserStatus) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  // Keyed on the row, so reopening the dialog for a different account never
  // inherits the previous one's half-typed reason or its error.
  useEffect(() => {
    setReason('');
    setError(null);
  }, [user?.id]);

  if (!user) return null;
  const next = flip(user.status);

  async function submit() {
    if (!user) return;
    setPending(true);
    setError(null);
    try {
      const updated = await updateUserStatus(user.id, { status: next, reason });
      onChanged(user.id, updated.status);
      onClose();
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'} {user.fullName}
          </DialogTitle>
        </DialogHeader>

        <Field label="Reason" error={error?.fieldError('reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>

        {error && error.errors.length === 0 ? (
          <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !reason.trim()}>
            {next === 'SUSPENDED' ? 'Suspend' : 'Reactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROLES: UserListItem['platformRole'][] = ['STUDENT', 'ADMIN'];

function EditDialog({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: UserListItem | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (id: string, patch: Partial<UserListItem>) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [platformRole, setPlatformRole] = useState<UserListItem['platformRole']>('STUDENT');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  // Keyed on the row, so opening the dialog on a second account never shows
  // the first one's values or its error.
  useEffect(() => {
    setFullName(user?.fullName ?? '');
    setEmail(user?.email ?? '');
    setPlatformRole(user?.platformRole ?? 'STUDENT');
    setReason('');
    setError(null);
  }, [user?.id]);

  if (!user) return null;

  // Only what actually moved. Sending the whole form would write a
  // `user.updated` audit row for an admin who opened the dialog and saved
  // without typing, and would take the email column through a no-op update
  // that still revokes the person's sessions.
  const patch = {
    ...(fullName !== user.fullName ? { fullName } : {}),
    ...(email !== user.email ? { email } : {}),
    ...(platformRole !== user.platformRole ? { platformRole } : {}),
  };
  const dirty = Object.keys(patch).length > 0;

  async function submit() {
    if (!user) return;
    setPending(true);
    setError(null);
    try {
      const updated = await updateUser(user.id, { ...patch, reason });
      onSaved(user.id, {
        fullName: updated.fullName,
        email: updated.email,
        platformRole: updated.platformRole,
      });
      onClose();
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.fullName}</DialogTitle>
        </DialogHeader>

        <Field label="Full name" error={error?.fieldError('fullName')}>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>

        <Field label="Email" error={error?.fieldError('email')}>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Field label="Platform role" error={error?.fieldError('platformRole')}>
          <Select
            value={platformRole}
            onValueChange={(v) => setPlatformRole(v as UserListItem['platformRole'])}
            disabled={isSelf}
          >
            <SelectTrigger aria-label="Platform role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {enumLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Reason" error={error?.fieldError('reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>

        {error && error.errors.length === 0 ? (
          <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !dirty || !reason.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersManager({
  viewerId,
  initialUsers,
}: {
  viewerId: string;
  initialUsers: UserListPage | null;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [target, setTarget] = useState<UserListItem | null>(null);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const { items, setItems, cursor, show, append } = useCursorPage(initialUsers);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initialUsers !== null);

  const fail = useAsyncError();

  async function load(reset: boolean) {
    const page = await listUsers({
      q: q.trim() || undefined,
      status: (status || undefined) as UserStatus | undefined,
      limit: PAGE,
      cursor: reset ? undefined : (cursor ?? undefined),
    });
    (reset ? show : append)(page);
  }

  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    let cancelled = false;
    setItems(null);
    listUsers({
      q: q.trim() || undefined,
      status: (status || undefined) as UserStatus | undefined,
      limit: PAGE,
    })
      .then((page) => {
        if (!cancelled) show(page);
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [q, status, show, setItems]);

  /** Patches the one row in place: a refetch would lose the reader's scroll. */
  function applyPatch(id: string, patch: Partial<UserListItem>) {
    setItems((prev) => prev?.map((u) => (u.id === id ? { ...u, ...patch } : u)) ?? prev);
  }

  const applyStatus = (id: string, status: UserStatus) => applyPatch(id, { status });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Search users"
          placeholder="Name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full sm:w-64"
        />
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger aria-label="Filter by status" className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {enumLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {items === null ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <EmptyState title="No users found" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">{u.fullName}</span>
                      <span className="text-label text-ink-2">{u.email}</span>
                    </span>
                  </TableCell>
                  <TableCell>{enumLabel(u.platformRole)}</TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  {/* To the day and in UTC, like every other date this console
                      renders: a locale-formatted one differs between the
                      server and the browser, which React answers by throwing
                      the whole tree away. */}
                  <TableCell className="tabular">{formatDay(u.createdAt)}</TableCell>
                  <TableCell>
                    <span className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setEditing(u)}>
                        Edit
                      </Button>
                      {/* The API refuses an admin changing their own status
                          and their own role, both with a 422. Hiding the
                          control is presentation, never the protection; the
                          server rule is what holds. */}
                      {u.id === viewerId ? (
                        <span className="self-center text-sm text-ink-3">You</span>
                      ) : (
                        <Button variant="outline" onClick={() => setTarget(u)}>
                          {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        </Button>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <LoadMore cursor={cursor} onClick={() => load(false).catch(fail)} />
        </>
      )}

      <StatusDialog user={target} onClose={() => setTarget(null)} onChanged={applyStatus} />

      <EditDialog
        user={editing}
        isSelf={editing?.id === viewerId}
        onClose={() => setEditing(null)}
        onSaved={applyPatch}
      />
    </div>
  );
}

'use client';

import type { ClubDetail, Member, UserListItem } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserPicker } from '@/components/UserPicker';
import { ProblemError } from '@/lib/api';
import { addMember, decideMembership, getClub, listMembers, removeMember } from '@/lib/clubs';

function AddMemberDialog({ clubId, onAdded }: { clubId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<UserListItem | null>(null);
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await addMember(clubId, { userId: picked.id });
      onAdded();
      setOpen(false);
      setPicked(null);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setError(null);
          setPicked(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>Add member</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
        </DialogHeader>
        <UserPicker value={picked} onChange={setPicked} />
        {error ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !picked}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersManager({ clubId }: { clubId: string }) {
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [pending, setPending] = useState<Member[] | null>(null);
  const [active, setActive] = useState<Member[] | null>(null);

  async function load() {
    const [c, pendingPage, activePage] = await Promise.all([
      getClub(clubId),
      listMembers(clubId, { status: 'PENDING', limit: 100 }),
      listMembers(clubId, { status: 'ACTIVE', limit: 100 }),
    ]);
    setClub(c);
    setPending(pendingPage.items);
    setActive(activePage.items);
  }

  useEffect(() => {
    load();
  }, [clubId]);

  if (!club || pending === null || active === null) return <Skeleton className="h-64 w-full" />;

  const canDecide =
    club.viewerClubRoles.includes('LEAD') ||
    club.viewerClubRoles.includes('VICE_LEAD') ||
    club.viewerClubRoles.includes('OPERATIONS');

  async function decide(requestId: string, status: 'ACTIVE' | 'REJECTED', reason?: string) {
    await decideMembership(clubId, requestId, { status, reason });
    await load();
  }

  async function remove(userId: string) {
    await removeMember(clubId, userId);
    await load();
  }

  return (
    <div className="flex flex-col gap-8">
      {canDecide ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-h2 text-ink">Requests</h2>
          {pending.length === 0 ? (
            <EmptyState title="No pending requests" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">{m.userFullName}</span>
                        <span className="text-label text-ink-2">{m.userEmail}</span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular text-ink-2">{new Date(m.requestedAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => decide(m.id, 'ACTIVE')}>
                          Approve
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button variant="destructive" size="sm">
                              Reject
                            </Button>
                          }
                          title={`Reject ${m.userFullName}'s request?`}
                          confirmLabel="Reject"
                          destructive
                          reason="optional"
                          onConfirm={(reason) => decide(m.id, 'REJECTED', reason)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-h2 text-ink">Members</h2>
          {canDecide ? <AddMemberDialog clubId={clubId} onAdded={load} /> : null}
        </div>
        {active.length === 0 ? (
          <EmptyState title="No members" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-ink">{m.userFullName}</span>
                      <span className="text-label text-ink-2">{m.userEmail}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {canDecide ? (
                      <ConfirmDialog
                        trigger={
                          <Button variant="destructive" size="sm">
                            Remove
                          </Button>
                        }
                        title={`Remove ${m.userFullName}?`}
                        confirmLabel="Remove"
                        destructive
                        onConfirm={() => remove(m.userId)}
                      />
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}

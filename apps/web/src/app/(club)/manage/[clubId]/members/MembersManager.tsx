'use client';

import type { ClubDetail, MemberPage } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { UserPickerDialog } from '@/components/UserPickerDialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { addMember, decideMembership, getClub, listMembers, removeMember } from '@/lib/clubs';
import { CONSOLE_PAGE as PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import { useViewerZone } from '@/lib/use-viewer-zone';
import { useAsyncError } from '@/lib/use-async-error';

function AddMemberDialog({ clubId, onAdded }: { clubId: string; onAdded: () => void }) {
  return (
    <UserPickerDialog
      trigger={<Button>Add member</Button>}
      title="Add a member"
      confirmLabel="Add"
      onSubmit={async (user) => {
        await addMember(clubId, { userId: user.id });
        onAdded();
      }}
    />
  );
}

export function MembersManager({
  clubId,
  initialClub,
  initialPending,
  initialActive,
}: {
  clubId: string;
  initialClub: ClubDetail | null;
  initialPending: MemberPage | null;
  initialActive: MemberPage | null;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const {
    items: pending,
    cursor: pendingCursor,
    show: showPending,
    append: appendPending,
  } = useCursorPage(initialPending);
  const {
    items: active,
    cursor: activeCursor,
    show: showActive,
    append: appendActive,
  } = useCursorPage(initialActive);
  // toLocaleDateString reads the runtime locale and zone, which differ between
  // the server and the browser. Undefined until mounted, so the server renders
  // no date rather than one that regenerates the tree on hydration.
  const mounted = useViewerZone() !== undefined;

  async function load() {
    const [c, pendingPage, activePage] = await Promise.all([
      getClub(clubId),
      listMembers(clubId, { status: 'PENDING', limit: PAGE }),
      listMembers(clubId, { status: 'ACTIVE', limit: PAGE }),
    ]);
    setClub(c);
    showPending(pendingPage);
    showActive(activePage);
  }

  async function loadMorePending() {
    if (!pendingCursor) return;
    appendPending(await listMembers(clubId, { status: 'PENDING', limit: PAGE, cursor: pendingCursor }));
  }

  async function loadMoreActive() {
    if (!activeCursor) return;
    appendActive(await listMembers(clubId, { status: 'ACTIVE', limit: PAGE, cursor: activeCursor }));
  }

  const seeded = initialClub !== null && initialPending !== null && initialActive !== null;
  const fail = useAsyncError();

  useEffect(() => {
    if (!seeded) load().catch(fail);
  }, [clubId, seeded]);

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
                    <TableCell className="tabular text-ink-2">{mounted ? new Date(m.requestedAt).toLocaleDateString() : ''}</TableCell>
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
          <LoadMore cursor={pendingCursor} onClick={loadMorePending} />
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
        <LoadMore cursor={activeCursor} onClick={loadMoreActive} />
      </section>
    </div>
  );
}

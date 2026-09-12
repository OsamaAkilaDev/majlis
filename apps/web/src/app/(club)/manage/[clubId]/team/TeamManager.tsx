'use client';

import type { AppointmentPage, ClubDetail, ClubRole } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { UserPickerDialog } from '@/components/UserPickerDialog';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { endAppointment, getClub, inviteTeamMember, listTeam } from '@/lib/clubs';
import { enumLabel } from '@/lib/enum-label';
import { CONSOLE_PAGE as PAGE } from '@/lib/page-size';
import { useCursorPage } from '@/lib/use-cursor-page';
import { useViewerZone } from '@/lib/use-viewer-zone';
import { useAsyncError } from '@/lib/use-async-error';

type InvitableRole = 'VICE_LEAD' | 'MARKETING' | 'CTO' | 'OPERATIONS';
const INVITABLE_ROLES: ClubRole[] = ['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'];

function InviteDialog({ clubId, onInvited }: { clubId: string; onInvited: () => void }) {
  // The role outlives a close, same as before: only the picker and the error
  // reset, so reopening keeps what the officer had already chosen.
  const [role, setRole] = useState<ClubRole>('VICE_LEAD');

  return (
    <UserPickerDialog
      trigger={<Button>Invite</Button>}
      title="Invite a team member"
      confirmLabel="Send invitation"
      onSubmit={async (user) => {
        await inviteTeamMember(clubId, { userId: user.id, role: role as InvitableRole });
        onInvited();
      }}
    >
      <Field label="Role">
        <Select value={role} onValueChange={(v) => setRole(v as ClubRole)}>
          <SelectTrigger aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVITABLE_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {enumLabel(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </UserPickerDialog>
  );
}

export function TeamManager({
  clubId,
  viewerUserId,
  initialClub,
  initialTeam,
}: {
  clubId: string;
  viewerUserId: string;
  initialClub: ClubDetail | null;
  initialTeam: AppointmentPage | null;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const { items, cursor, show, append } = useCursorPage(initialTeam);
  // See MembersManager: a locale-formatted date cannot be server-rendered.
  const mounted = useViewerZone() !== undefined;

  async function load() {
    const [c, page] = await Promise.all([getClub(clubId), listTeam(clubId, { limit: PAGE })]);
    setClub(c);
    show(page);
  }

  async function loadMore() {
    if (!cursor) return;
    append(await listTeam(clubId, { limit: PAGE, cursor }));
  }

  const seeded = initialClub !== null && initialTeam !== null;
  const fail = useAsyncError();

  useEffect(() => {
    if (!seeded) load().catch(fail);
  }, [clubId, seeded]);

  if (!club || items === null) return <Skeleton className="h-64 w-full" />;

  const isLead = club.viewerClubRoles.includes('LEAD');

  return (
    <div className="flex flex-col gap-4">
      {isLead ? (
        <div className="flex justify-end">
          <InviteDialog clubId={clubId} onInvited={load} />
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title="No team appointments" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium text-ink">{a.userFullName}</span>
                    <span className="text-label text-ink-2">{a.userEmail}</span>
                  </div>
                </TableCell>
                <TableCell>{enumLabel(a.role)}</TableCell>
                <TableCell className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  {a.hasLeftClub ? <StatusBadge status="LEFT" className="opacity-70" /> : null}
                </TableCell>
                <TableCell className="tabular text-ink-2">
                  {mounted && a.invitationExpiresAt ? new Date(a.invitationExpiresAt).toLocaleDateString() : ''}
                </TableCell>
                <TableCell>
                  {isLead && a.status === 'ACTIVE' && a.userId !== viewerUserId ? (
                    <ConfirmDialog
                      trigger={
                        <Button variant="destructive" size="sm">
                          End
                        </Button>
                      }
                      title={`End ${a.userFullName}'s appointment?`}
                      confirmLabel="End appointment"
                      destructive
                      reason="required"
                      onConfirm={(reason) => endAppointment(clubId, a.id, { reason: reason ?? '' }).then(load)}
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <LoadMore cursor={cursor} onClick={loadMore} />
    </div>
  );
}

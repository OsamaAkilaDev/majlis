'use client';

import type { Appointment, ClubDetail, ClubRole, UserListItem } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/Field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserPicker } from '@/components/UserPicker';
import { ProblemError } from '@/lib/api';
import { endAppointment, getClub, inviteTeamMember, listTeam, roleLabel } from '@/lib/clubs';
import { useViewerZone } from '@/lib/use-viewer-zone';

const INVITABLE_ROLES: ClubRole[] = ['VICE_LEAD', 'MARKETING', 'CTO', 'OPERATIONS'];

function InviteDialog({ clubId, onInvited }: { clubId: string; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<UserListItem | null>(null);
  const [role, setRole] = useState<ClubRole>('VICE_LEAD');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      await inviteTeamMember(clubId, { userId: picked.id, role: role as 'VICE_LEAD' | 'MARKETING' | 'CTO' | 'OPERATIONS' });
      onInvited();
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
        <Button>Invite</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
        </DialogHeader>
        <UserPicker value={picked} onChange={setPicked} />
        <Field label="Role">
          <Select value={role} onValueChange={(v) => setRole(v as ClubRole)}>
            <SelectTrigger aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INVITABLE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {error ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !picked}>
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  initialTeam: Appointment[] | null;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const [items, setItems] = useState<Appointment[] | null>(initialTeam);
  // See MembersManager: a locale-formatted date cannot be server-rendered.
  const mounted = useViewerZone() !== undefined;

  async function load() {
    const [c, page] = await Promise.all([getClub(clubId), listTeam(clubId, { limit: 100 })]);
    setClub(c);
    setItems(page.items);
  }

  const seeded = initialClub !== null && initialTeam !== null;
  useEffect(() => {
    if (!seeded) load();
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
                <TableCell>{roleLabel(a.role)}</TableCell>
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
    </div>
  );
}

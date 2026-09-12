'use client';

import type { Appointment, ClubDetail, ClubStatus, UserListItem } from '@majlis/contracts';
import { useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { UserPicker } from '@/components/UserPicker';
import { ProblemError } from '@/lib/api';
import { appointLead, getClub, listTeam, updateClubStatus } from '@/lib/clubs';
import { useViewerZone } from '@/lib/use-viewer-zone';

/** Mirrors club-status.ts's ALLOWED table: ARCHIVED is terminal. */
const NEXT_STATUSES: Record<ClubStatus, ClubStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

function StatusControl({ club, onChanged }: { club: ClubDetail; onChanged: (c: ClubDetail) => void }) {
  const options = NEXT_STATUSES[club.status];
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<ClubStatus | ''>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  if (options.length === 0) return null;

  async function submit() {
    if (!next) return;
    setPending(true);
    setError(null);
    try {
      const updated = await updateClubStatus(club.id, { status: next, reason });
      onChanged(updated);
      setOpen(false);
      setReason('');
      setNext('');
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
          setReason('');
          setNext('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">Change status</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change club status</DialogTitle>
        </DialogHeader>
        <Field label="New status">
          <Select value={next} onValueChange={(v) => setNext(v as ClubStatus)}>
            <SelectTrigger aria-label="New status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Reason">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        {error ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !next || !reason.trim()}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadAppointment({
  clubId,
  currentLeadUserId,
  onAppointed,
}: {
  clubId: string;
  currentLeadUserId?: string;
  onAppointed: (a: Appointment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<UserListItem | null>(null);
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!picked) return;
    setPending(true);
    setError(null);
    try {
      const appointment = await appointLead(clubId, { userId: picked.id });
      onAppointed(appointment);
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
        <Button variant="outline">Appoint Lead</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Appoint Lead</DialogTitle>
        </DialogHeader>
        <UserPicker value={picked} onChange={setPicked} exclude={currentLeadUserId ? [currentLeadUserId] : []} />
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

/** Only the Lead rows the panel renders, from a full team page. */
function leadsOf(items: readonly Appointment[]): Appointment[] {
  return items.filter((a) => a.role === 'LEAD' && (a.status === 'ACTIVE' || a.status === 'INVITED'));
}

export function ClubDetailManager({
  clubId,
  initialClub,
  initialTeam,
}: {
  clubId: string;
  initialClub: ClubDetail | null;
  initialTeam: Appointment[] | null;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const [leadAppointments, setLeadAppointments] = useState<Appointment[]>(
    initialTeam ? leadsOf(initialTeam) : [],
  );

  async function loadTeam() {
    const page = await listTeam(clubId, { limit: 100 });
    setLeadAppointments(leadsOf(page.items));
  }

  // See MembersManager: a locale-formatted date cannot be server-rendered.
  const mounted = useViewerZone() !== undefined;
  const seeded = initialClub !== null && initialTeam !== null;
  useEffect(() => {
    if (seeded) return;
    getClub(clubId).then(setClub);
    loadTeam();
  }, [clubId, seeded]);

  if (!club) return <Skeleton className="h-64 w-full" />;

  const activeLead = leadAppointments.find((a) => a.status === 'ACTIVE');
  const invitedLead = leadAppointments.find((a) => a.status === 'INVITED');

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-start gap-4">
        <img src={club.logoUrl} alt="" className="size-16 shrink-0 rounded-card border border-border object-cover" />
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-h1 text-ink">{club.name}</h2>
          <StatusBadge status={club.status} />
        </div>
      </div>

      {club.bannerUrl ? (
        <img src={club.bannerUrl} alt="" className="h-32 w-full rounded-card border border-border object-cover" />
      ) : null}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-2">Department</dt>
          <dd className="text-ink">{club.departmentName}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Category</dt>
          <dd className="text-ink">{club.category}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Academic year</dt>
          <dd className="text-ink tabular">{club.academicYear}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Members</dt>
          <dd className="text-ink tabular">{club.memberCount}</dd>
        </div>
        <div>
          <dt className="text-ink-2">Membership policy</dt>
          <dd className="text-ink">{club.membershipPolicy.replace('_', ' ')}</dd>
        </div>
      </dl>

      <p className="text-sm text-ink">{club.description}</p>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="font-display text-h2 text-ink">Lead</h3>
        {activeLead ? (
          <p className="text-sm text-ink">
            {activeLead.userFullName} <span className="text-ink-2">{activeLead.userEmail}</span>
          </p>
        ) : (
          <p className="text-sm text-ink-2">No active Lead</p>
        )}
        {invitedLead ? (
          <p className="text-sm text-ink-2">
            Invited: {invitedLead.userFullName}, expires{' '}
            {mounted && invitedLead.invitationExpiresAt ? new Date(invitedLead.invitationExpiresAt).toLocaleString() : ''}
          </p>
        ) : null}
        <div>
          <LeadAppointment clubId={club.id} currentLeadUserId={activeLead?.userId} onAppointed={loadTeam} />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="font-display text-h2 text-ink">Status</h3>
        <div>
          <StatusControl club={club} onChanged={setClub} />
        </div>
      </div>
    </div>
  );
}

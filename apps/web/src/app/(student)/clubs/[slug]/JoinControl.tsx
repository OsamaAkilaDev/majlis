'use client';

import type { ClubDetail } from '@majlis/contracts';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ProblemError } from '@/lib/api';
import { leaveClub, requestMembership } from '@/lib/clubs';

/**
 * What a viewer can do, derived from the club's policy, its status, and the
 * viewer's own most recent membership row. The API refuses anything this
 * gets wrong; hiding a control is presentation, never protection.
 */
function decide(club: ClubDetail): { kind: 'join' | 'request' | 'leave' | 'pending' | 'none'; why?: string } {
  const status = club.viewerMembershipStatus;
  if (status === 'ACTIVE') return { kind: 'leave' };
  if (status === 'PENDING') return { kind: 'pending' };
  if (status === 'REMOVED') return { kind: 'none', why: 'You were removed from this club' };

  if (club.status === 'SUSPENDED') return { kind: 'none', why: 'This club is suspended' };
  if (club.status === 'ARCHIVED') return { kind: 'none', why: 'This club is archived' };

  switch (club.membershipPolicy) {
    case 'OPEN':
      return { kind: 'join' };
    case 'APPROVAL_REQUIRED':
      return { kind: 'request' };
    case 'INVITE_ONLY':
      return { kind: 'none', why: 'This club admits members by invitation only' };
    case 'CLOSED':
      return { kind: 'none', why: 'This club is not accepting members' };
  }
}

export function JoinControl({ club, onChanged }: { club: ClubDetail; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = decide(club);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {action.kind === 'join' ? (
        <Button onClick={() => run(() => requestMembership(club.id))} disabled={busy}>
          Join
        </Button>
      ) : null}

      {action.kind === 'request' ? (
        <Button onClick={() => run(() => requestMembership(club.id))} disabled={busy}>
          Request to join
        </Button>
      ) : null}

      {action.kind === 'pending' ? (
        <Button disabled aria-label="Your request is pending a decision">
          Request pending
        </Button>
      ) : null}

      {action.kind === 'leave' ? (
        <ConfirmDialog
          title={`Leave ${club.name}?`}
          confirmLabel="Leave"
          trigger={
            <Button variant="outline" disabled={busy}>
              Leave
            </Button>
          }
          onConfirm={() => run(() => leaveClub(club.id))}
        />
      ) : null}

      {/* A disabled control needs an accessible name carrying the reason, or
          the refusal exists only in the layout and a screen reader user
          learns nothing about why they cannot act. */}
      {action.kind === 'none' ? (
        <Button disabled aria-label={action.why}>
          Join
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

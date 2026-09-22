'use client';

import type { ClubDetail } from '@majlis/contracts';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { ProblemError } from '@/lib/api';
import { leaveClub, requestMembership } from '@/lib/clubs';

type Kind = 'join' | 'request' | 'withdraw' | 'leave' | 'blocked';

interface Decision {
  kind: Kind;
  label: string;
  /** Only on `blocked`: why the control cannot be pressed. The label alone is
   *  the reason for a sighted reader; this is the same reason for a screen
   *  reader, which never sees a disabled button's styling. */
  why?: string;
}

/**
 * One control carries the whole membership policy: its label states the
 * policy, its enabled state states whether this viewer can act. Nothing else
 * on the club page mentions joining.
 *
 * The API refuses anything this gets wrong; a control's appearance is
 * presentation, never protection.
 */
export function decide(club: ClubDetail): Decision {
  switch (club.viewerMembershipStatus) {
    case 'ACTIVE':
      return { kind: 'leave', label: 'Leave club' };
    case 'PENDING':
      return { kind: 'withdraw', label: 'Withdraw request' };
    case 'REMOVED':
      return { kind: 'blocked', label: 'Removed from club', why: 'You were removed from this club' };
    default:
      break;
  }

  // Students never reach a club that is not ACTIVE: the API answers 404. An
  // officer or an Admin does, and for them joining is still shut.
  if (club.status !== 'ACTIVE') {
    return { kind: 'blocked', label: 'Joining unavailable', why: `This club is ${club.status.toLowerCase()}` };
  }

  switch (club.membershipPolicy) {
    case 'OPEN':
      return { kind: 'join', label: 'Join club' };
    case 'APPROVAL_REQUIRED':
      return { kind: 'request', label: 'Request to join' };
    case 'INVITE_ONLY':
      return { kind: 'blocked', label: 'Invite only', why: 'This club admits members by invitation only' };
    case 'CLOSED':
      return { kind: 'blocked', label: 'Joining closed', why: 'This club is not accepting members' };
  }
}

export function JoinControl({
  club,
  onChanged,
  className,
}: {
  club: ClubDetail;
  onChanged: () => Promise<void>;
  className?: string;
}) {
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

  const wide = 'w-full sm:w-auto';

  return (
    <div className={className}>
      {action.kind === 'join' || action.kind === 'request' ? (
        <Button
          size="lg"
          className={wide}
          disabled={busy}
          onClick={() => run(() => requestMembership(club.id))}
        >
          {action.label}
        </Button>
      ) : null}

      {action.kind === 'withdraw' || action.kind === 'leave' ? (
        <ConfirmDialog
          title={action.kind === 'leave' ? `Leave ${club.name}?` : `Withdraw your request to join ${club.name}?`}
          confirmLabel={action.label}
          trigger={
            <Button variant="outline" size="lg" className={wide} disabled={busy}>
              {action.label}
            </Button>
          }
          onConfirm={() => run(() => leaveClub(club.id))}
        />
      ) : null}

      {action.kind === 'blocked' ? (
        <Button size="lg" className={wide} disabled aria-label={action.why}>
          {action.label}
        </Button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

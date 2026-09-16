'use client';

import type { Invitation, MyClub } from '@majlis/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { acceptInvitation, declineInvitation, leaveClub, myClubs, myInvitations } from '@/lib/clubs';
import { enumLabel } from '@/lib/enum-label';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-h1 text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function ProfileManager({
  initialClubs,
  initialInvitations,
}: {
  initialClubs: MyClub[] | null;
  initialInvitations: Invitation[] | null;
}) {
  const [clubs, setClubs] = useState<MyClub[] | null>(initialClubs);
  const [invitations, setInvitations] = useState<Invitation[] | null>(initialInvitations);
  const [busy, setBusy] = useState<string | null>(null);
  const seeded = initialClubs !== null && initialInvitations !== null;
  // Null is "still loading", which keeps the skeleton; only a loaded, empty
  // list drops the section.
  const showInvitations = invitations === null || invitations.length > 0;

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([myClubs({ limit: PAGE }), myInvitations({ limit: PAGE })]);
    setClubs(c.items);
    setInvitations(i.items);
  }, []);

  const fail = useAsyncError();

  useEffect(() => {
    if (!seeded) load().catch(fail);
  }, [seeded, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      // Accepting moves a club from one list into the other, so both are
      // refetched rather than patched locally.
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Two independent lists, so they sit side by side once there is room
          for both rather than making the viewer scroll past one to reach the
          other. Only when there are two: with no invitations the pair became a
          half-width clubs list beside a reserved empty column. */}
      <div
        className={cn(
          'flex flex-col gap-6',
          showInvitations && 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-8',
        )}
      >
      {/* An invitation expires and a club membership does not, so invitations
          lead. With none outstanding the section is gone rather than showing
          an empty card above the list the viewer actually came for. */}
      {showInvitations ? (
      <Section title="Invitations">
        {invitations === null ? (
          <Skeleton className="h-16" />
        ) : (
          <ul className="flex flex-col gap-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
              >
                <img src={inv.clubLogoUrl} alt="" className="size-10 shrink-0 rounded-control object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{inv.clubName}</span>
                  <span className="block text-sm text-ink-2">{enumLabel(inv.role)}</span>
                </span>
                <Button
                  size="sm"
                  disabled={busy === inv.id}
                  onClick={() => act(inv.id, () => acceptInvitation(inv.id))}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === inv.id}
                  onClick={() => act(inv.id, () => declineInvitation(inv.id))}
                >
                  Decline
                </Button>
              </li>
            ))}
          </ul>
        )}
        </Section>
      ) : null}

      <Section title="My clubs">
        {clubs === null ? (
          <Skeleton className="h-16" />
        ) : clubs.length === 0 ? (
          <EmptyState
            title="No clubs yet"
            action={
              <Button asChild>
                <Link href="/clubs">Browse clubs</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {clubs.map((club) => (
              <li
                key={club.clubId}
                className="flex items-center gap-3 rounded-card border border-border bg-surface p-3"
              >
                <img src={club.logoUrl} alt="" className="size-10 shrink-0 rounded-control object-cover" />
                <Link href={`/clubs/${club.slug}`} className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink">{club.name}</span>
                  <span className="block text-sm text-ink-2">
                    {club.clubRoles.length > 0 ? club.clubRoles.map(enumLabel).join(', ') : 'Member'}
                  </span>
                </Link>
                {club.status === 'PENDING' ? <StatusBadge status="PENDING" /> : null}
                {club.status === 'ACTIVE' ? (
                  <ConfirmDialog
                    title={`Leave ${club.name}?`}
                    confirmLabel="Leave"
                    trigger={
                      <Button size="sm" variant="outline" disabled={busy === club.clubId}>
                        Leave
                      </Button>
                    }
                    onConfirm={() => act(club.clubId, () => leaveClub(club.clubId))}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        </Section>
      </div>
    </div>
  );
}

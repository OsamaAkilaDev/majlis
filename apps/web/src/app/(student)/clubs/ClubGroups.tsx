'use client';

import type { Invitation, MyClub, MyClubPage } from '@majlis/contracts';
import { CaretRight } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { LoadMore } from '@/components/LoadMore';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { acceptInvitation, declineInvitation, myClubs, myInvitations } from '@/lib/clubs';
import { enumLabel, roleLabel } from '@/lib/enum-label';
import { ICON_WEIGHT } from '@/lib/icons';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

const ROW =
  'flex items-center gap-3 rounded-card border bg-surface p-2.5 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2';

function ClubRow({ club }: { club: MyClub }) {
  return (
    <Link href={`/clubs/${club.slug}`} className={`${ROW} border-border`}>
      <img src={club.logoUrl} alt="" className="size-12 shrink-0 rounded-control object-cover" />
      <span className="min-w-0 flex-1 truncate font-semibold text-ink">{club.name}</span>

      {/* The officer's own way in: a club they run is the one they came for. */}
      {club.clubRoles.length > 0 ? (
        <span className="flex shrink-0 gap-1">
          {club.clubRoles.map((role) => (
            <span
              key={role}
              className="rounded-control bg-primary-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap text-primary-soft-fg"
            >
              {roleLabel(role)}
            </span>
          ))}
        </span>
      ) : (
        <CaretRight size={18} weight={ICON_WEIGHT} className="shrink-0 text-ink-3" aria-hidden />
      )}
    </Link>
  );
}

/** Gone entirely when it holds nothing, rather than carrying an empty panel
 *  the viewer can do nothing with. */
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-h1 text-ink">{title}</h2>
        <span className="text-sm tabular-nums text-ink-3">{count}</span>
      </div>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

export function ClubGroups({
  initial,
  initialInvitations,
}: {
  initial: MyClubPage | null;
  initialInvitations: Invitation[] | null;
}) {
  const { items, cursor, show, append } = useCursorPage(initial);
  const [invitations, setInvitations] = useState<Invitation[] | null>(initialInvitations);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const seeded = initial !== null && initialInvitations !== null;
  // Null is "still loading", which keeps the skeleton; only a loaded, empty
  // list drops the section.
  const showInvitations = invitations === null || invitations.length > 0;
  const fail = useAsyncError();

  const load = useCallback(async () => {
    const [c, i] = await Promise.all([myClubs({ limit: PAGE }), myInvitations({ limit: PAGE })]);
    show(c);
    setInvitations(i.items);
  }, [show]);

  useEffect(() => {
    if (!seeded) load().catch(fail);
  }, [seeded, load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setActing(id);
    try {
      await fn();
      // Accepting moves a club from one list into the other, so both are
      // refetched rather than patched locally.
      await load();
    } finally {
      setActing(null);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    try {
      append(await myClubs({ limit: PAGE, cursor }));
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-[4.5rem]" />
        <Skeleton className="h-[4.5rem]" />
      </div>
    );
  }

  // /me/clubs returns these two statuses and no others.
  const active = items.filter((club) => club.status === 'ACTIVE');
  const pending = items.filter((club) => club.status === 'PENDING');

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="outline" size="sm" className="self-start">
        <Link href="/clubs/discover">Browse clubs</Link>
      </Button>

      {/* An invitation expires and a club membership does not, so invitations
          lead. With none outstanding the section is gone rather than showing
          an empty card above the list the viewer actually came for. */}
      {showInvitations ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-h1 text-ink">Invitations</h2>
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
                    disabled={acting === inv.id}
                    onClick={() => act(inv.id, () => acceptInvitation(inv.id))}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={acting === inv.id}
                    onClick={() => act(inv.id, () => declineInvitation(inv.id))}
                  >
                    Decline
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <Section title="Your clubs" count={active.length}>
        {active.map((club) => (
          <li key={club.clubId}>
            <ClubRow club={club} />
          </li>
        ))}
      </Section>

      <Section title="Requested" count={pending.length}>
        {pending.map((club) => (
          <li key={club.clubId}>
            <ClubRow club={club} />
          </li>
        ))}
      </Section>

      <LoadMore cursor={cursor} onClick={loadMore} busy={busy} />
    </div>
  );
}

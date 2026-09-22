'use client';

import type { MyClub, MyClubPage } from '@majlis/contracts';
import { CaretRight, MagnifyingGlass } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { LoadMore } from '@/components/LoadMore';
import { Skeleton } from '@/components/ui/skeleton';
import { myClubs } from '@/lib/clubs';
import { roleLabel } from '@/lib/enum-label';
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

export function ClubGroups({ initial }: { initial: MyClubPage | null }) {
  const { items, cursor, show, append } = useCursorPage(initial);
  const [busy, setBusy] = useState(false);
  const fail = useAsyncError();

  useEffect(() => {
    if (!initial) myClubs({ limit: PAGE }).then(show).catch(fail);
  }, [initial, show]);

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

      {/* Closes the list, and is the whole screen for a viewer who has joined
          nothing yet. */}
      <Link href="/clubs/discover" className={`${ROW} border-dashed border-border-control`}>
        <span className="grid size-12 shrink-0 place-items-center rounded-control bg-surface-2 text-ink-2">
          <MagnifyingGlass size={20} weight={ICON_WEIGHT} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">Browse all clubs</span>
        <CaretRight size={18} weight={ICON_WEIGHT} className="shrink-0 text-ink-3" aria-hidden />
      </Link>
    </div>
  );
}

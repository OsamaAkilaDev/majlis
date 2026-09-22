'use client';

import type { ClubDetail } from '@majlis/contracts';
import { CaretRight, ChartBar, PencilSimple, Users, UsersThree } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { ClubSection, ClubSectionKey } from '@/lib/club-sections';
import { ICON_WEIGHT } from '@/lib/icons';

const ICON: Record<ClubSectionKey, Icon> = {
  edit: PencilSimple,
  members: Users,
  team: UsersThree,
  reports: ChartBar,
};

/**
 * The club page is the same page for everybody until this button appears. A
 * fixed tab strip could not be, because the set of sections an officer reaches
 * is five different lists depending on their role.
 *
 * Presentation: `sections` is derived from `viewerClubRoles`, which the server
 * computed from the database for this request, and each destination re-derives
 * it again. The API refuses regardless.
 */
export function ManageSheet({ club, sections }: { club: ClubDetail; sections: ClubSection[] }) {
  // A number and not zero. `null` is "this viewer may not count them" and `0`
  // is "there are none": different facts, same absent badge.
  const pending = typeof club.pendingMemberCount === 'number' && club.pendingMemberCount > 0
    ? club.pendingMemberCount
    : null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="lg" className="h-11">
          Manage
          {pending ? (
            <span className="ml-1 rounded-control bg-primary-soft px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums text-primary-soft-fg">
              {pending}
              <span className="sr-only"> membership requests waiting</span>
            </span>
          ) : null}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="gap-3 rounded-t-sheet p-4 pb-[calc(1rem+var(--safe-b))]"
      >
        <div className="mx-auto h-1 w-10 shrink-0 rounded-full bg-border-control" aria-hidden />
        <SheetTitle className="font-display text-h1 text-ink">Manage</SheetTitle>

        <ul className="flex flex-col">
          {sections.map((section) => {
            const Glyph = ICON[section.key];
            return (
              <li key={section.key}>
                <SheetClose asChild>
                  <Link
                    href={`/clubs/${club.slug}/${section.path}`}
                    className="flex min-h-14 items-center gap-3 rounded-card px-1 py-2 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
                  >
                    <span className="grid size-[38px] shrink-0 place-items-center rounded-control bg-primary-soft text-primary-soft-fg">
                      <Glyph size={20} weight={ICON_WEIGHT} aria-hidden />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-ink">
                        {section.label}
                      </span>
                      {section.key === 'members' && pending ? (
                        <span className="block text-sm tabular-nums text-ink-2">
                          {pending} waiting
                        </span>
                      ) : null}
                    </span>

                    <CaretRight
                      size={18}
                      weight={ICON_WEIGHT}
                      className="shrink-0 text-ink-3"
                      aria-hidden
                    />
                  </Link>
                </SheetClose>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}

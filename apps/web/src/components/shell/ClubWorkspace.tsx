'use client';

import type { ClubDetail } from '@majlis/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/StatusBadge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { activeNavHref } from '@/lib/routing';
import { ProfileButton } from './ProfileButton';
import { useShellSession } from './shell-session';

export interface ClubSection {
  href: string;
  label: string;
}

/**
 * A club is a workspace inside the platform, not a replacement for it. The
 * rail beside this stays whatever the viewer's platform rail always is; the
 * club's own sections are tabs under a bar that says which club they belong
 * to and how to leave it.
 *
 * Deliberately not async, for the same reason ConsoleShell is not: this
 * header stays up through `loading.tsx`, and a suspending shell would put the
 * blocking navigation back.
 */
export function ClubWorkspace({
  clubId,
  club,
  sections,
  backHref,
  children,
}: {
  clubId: string;
  /** Null when the server could not read it; the shell still frames the page. */
  club: ClubDetail | null;
  sections: readonly ClubSection[];
  backHref: string;
  children: ReactNode;
}) {
  const { user } = useShellSession();
  const pathname = usePathname();
  // Prefix match, so an event editor under /events still lights Events.
  const current = activeNavHref(
    pathname,
    sections.map((s) => s.href),
  );

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-border bg-bg">
        {/* pl-14 below lg leaves room for the frame's hamburger. */}
        <div className="flex items-center gap-2 py-2 pr-3 pl-14 text-sm lg:px-8">
          <Link href={backHref} className="font-medium text-ink-2 hover:text-ink hover:underline">
            Clubs
          </Link>
          <span aria-hidden className="text-ink-3">
            /
          </span>
          <span className="min-w-0 flex-1 truncate text-ink-3">{club?.name ?? 'Club'}</span>
          <ThemeToggle />
          <ProfileButton user={user} />
        </div>

        <div className="flex items-center gap-3 px-4 lg:px-8">
          {club ? (
            <img src={club.logoUrl} alt="" className="size-10 shrink-0 rounded-control object-cover" />
          ) : null}

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-h1 text-ink">{club?.name ?? 'Club'}</h1>
            {club ? (
              <p className="truncate text-sm text-ink-2">
                {club.departmentName} · {club.memberCount}{' '}
                {club.memberCount === 1 ? 'member' : 'members'} · {club.academicYear}
              </p>
            ) : null}
          </div>

          {club && club.status !== 'ACTIVE' ? <StatusBadge status={club.status} /> : null}

          {club ? (
            <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
              <Link href={`/clubs/${club.slug}`}>View as student</Link>
            </Button>
          ) : null}
        </div>

        <nav aria-label="Club sections" className="mt-2 flex gap-1 overflow-x-auto px-2 lg:px-6">
          {sections.map(({ href, label }) => {
            const active = href === current;
            return (
              <Link
                key={href}
                href={href}
                // Seven fixed tabs the officer moves between constantly. See
                // TabBar: without this each one arrives on its skeleton.
                prefetch
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'border-b-2 px-2.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors duration-(--dur-fast) ease-(--ease-out)',
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-ink-3 hover:text-ink',
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Capped so a table does not run the full width of a 27-inch display. */}
      <main id="main" className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-5 lg:px-8 lg:py-6">
        {/* Keyed on the club, so nothing from the previous one survives a move
            between two workspaces through the platform rail. */}
        <div key={clubId}>{children}</div>
      </main>
    </>
  );
}

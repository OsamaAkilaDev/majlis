import type { ClubDetail } from '@majlis/contracts';
import Link from 'next/link';
import { Roster } from '@/components/Roster';

/**
 * No 'use client': the rail on the club page renders these inside a client
 * component, and `/clubs/[slug]/about` renders the same three on the server.
 */

function Heading({ children }: { children: string }) {
  return <h3 className="font-display text-h1 text-ink">{children}</h3>;
}

export function AboutBlock({ club }: { club: ClubDetail }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>About</Heading>
      <p className="rounded-card border border-border bg-surface p-3.5 text-sm leading-relaxed whitespace-pre-line text-ink">
        {club.description}
      </p>
    </section>
  );
}

/** A tenure, or nothing while the acceptance has not landed. */
function since(at: string | null): string | null {
  if (!at) return null;
  return `Since ${new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(at))}`;
}

export function CommitteeBlock({ club }: { club: ClubDetail }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>Committee</Heading>
      <Roster
        empty="No officers appointed"
        rows={club.committee.map((m) => ({
          key: m.userId,
          name: m.fullName,
          role: m.role,
          meta: since(m.since),
        }))}
      />
    </section>
  );
}

export function DepartmentBlock({ club }: { club: ClubDetail }) {
  return (
    <section className="flex flex-col gap-2">
      <Heading>Department</Heading>
      <div className="flex flex-col items-start gap-1 rounded-card border border-border bg-surface p-3.5">
        <span className="text-sm font-semibold text-ink">{club.departmentName}</span>
        <Link
          href={`/clubs/discover?department=${club.departmentId}`}
          className="text-sm font-semibold text-primary hover:underline"
        >
          Other clubs here
        </Link>
      </div>
    </section>
  );
}

export function ClubAboutSections({ club }: { club: ClubDetail }) {
  return (
    <>
      <AboutBlock club={club} />
      <CommitteeBlock club={club} />
      <DepartmentBlock club={club} />
    </>
  );
}

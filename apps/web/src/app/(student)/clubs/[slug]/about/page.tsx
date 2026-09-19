import type { ClubDetail } from '@majlis/contracts';
import { CaretLeft } from '@phosphor-icons/react/ssr';
import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { StudentShell } from '@/components/shell/StudentShell';
import { ICON_WEIGHT } from '@/lib/icons';
import { serverFetch } from '@/lib/server-api';
import { ClubAboutSections } from '../ClubAbout';

export const metadata: Metadata = { title: 'About' };

/**
 * The phone's About destination. From lg up the club page carries all three
 * of these in its rail, so this screen exists for the widths that have no
 * rail; reaching it on a desktop still works and still reads.
 */
export default async function ClubAboutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const club = await serverFetch<ClubDetail>(`/clubs/by-slug/${encodeURIComponent(slug)}`);

  return (
    <StudentShell title="About">
      {club ? (
        <div className="flex flex-col gap-5">
          <Link
            href={`/clubs/${slug}`}
            className="flex items-center gap-1.5 self-start text-sm font-semibold text-ink-2 hover:text-ink"
          >
            <CaretLeft size={16} weight={ICON_WEIGHT} aria-hidden />
            {club.name}
          </Link>

          <div className="flex flex-col gap-6 lg:max-w-2xl">
            <ClubAboutSections club={club} />
          </div>
        </div>
      ) : (
        <EmptyState title="No such club" />
      )}
    </StudentShell>
  );
}

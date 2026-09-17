/* MOCKUP — every value below is hardcoded. Nothing here calls the API.
   This exists to judge the layout of /home against the real tokens and the
   real shell. Revert with `git checkout` on this file. */
import type { Metadata } from 'next';
import {
  ArrowRight,
  CalendarBlank,
  CaretRight,
  Certificate,
  Envelope,
  MapPin,
  QrCode,
} from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { StatusBadge, type StatusKey } from '@/components/StatusBadge';
import { StudentShell } from '@/components/shell/StudentShell';
import { formatRange } from '@/lib/event-time';
import { ICON_WEIGHT } from '@/lib/icons';

export const metadata: Metadata = { title: 'Home' };

const ZONE = 'Asia/Dubai';

/** Dummy data only: keeps the mockup's dates ahead of whenever it is opened. */
function at(days: number, hour: number, minutes = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour - 4, minutes, 0, 0);
  return d.toISOString();
}

const NEXT = {
  id: 'e1',
  title: 'Intro to Embedded Rust',
  club: 'Robotics Society',
  venue: 'Engineering Lab B2-114',
  startsAt: at(0, 18),
  endsAt: at(0, 21),
};

const UPCOMING: {
  id: string;
  title: string;
  club: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  status: StatusKey;
  note: string | null;
}[] = [
  {
    id: 'e2',
    title: 'Founders Night: pitching to a room',
    club: 'Entrepreneurship Club',
    venue: 'Innovation Hall',
    startsAt: at(3, 19),
    endsAt: at(3, 21, 30),
    status: 'CONFIRMED',
    note: null,
  },
  {
    id: 'e3',
    title: 'Desert Astrophotography Night',
    club: 'Astronomy Club',
    venue: 'Al Qudra Observatory',
    startsAt: at(6, 20),
    endsAt: at(7, 1),
    status: 'WAITLISTED',
    note: 'Position 4',
  },
  {
    id: 'e4',
    title: 'Model UN opening session',
    club: 'Debate Union',
    venue: 'Auditorium A',
    startsAt: at(11, 9),
    endsAt: at(11, 17),
    status: 'CONFIRMED',
    note: null,
  },
];

const TASKS = [
  {
    href: '/profile',
    icon: Envelope,
    label: 'Photography Club invited you to the committee',
    meta: 'Officer · expires in 5 days',
  },
  {
    href: '/profile/certificates',
    icon: Certificate,
    label: 'Certificate ready: Hackathon 2026',
    meta: 'Issued 2 days ago',
  },
];

const DISCOVER = [
  {
    id: 'e5',
    title: 'Arabic Calligraphy Workshop',
    club: 'Heritage Society',
    startsAt: at(4, 16),
    endsAt: at(4, 18),
    left: 6,
  },
  {
    id: 'e6',
    title: 'CTF Qualifiers',
    club: 'Cybersecurity Club',
    startsAt: at(8, 14),
    endsAt: at(8, 20),
    left: 0,
  },
  {
    id: 'e7',
    title: 'Campus Clean-up Drive',
    club: 'Environment Society',
    startsAt: at(9, 7, 30),
    endsAt: at(9, 11),
    left: 18,
  },
];

function Section({
  title,
  href,
  children,
}: {
  title: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-h1 text-ink">{title}</h2>
        {href ? (
          <Link href={href} className="text-sm font-medium text-primary hover:underline">
            See all
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function HomePage() {
  return (
    <StudentShell title="Home">
      <div className="flex flex-col gap-7">
        {/* The one job this screen has: get the viewer into the next room they
            are expected in, and hand them the pass that opens it. */}
        <section className="lattice relative overflow-hidden rounded-sheet bg-primary-soft p-4 text-primary-soft-fg sm:p-5">
          <span className="text-label font-semibold uppercase opacity-80">Next up · today</span>

          <h2 className="mt-2 font-display text-title">{NEXT.title}</h2>
          <p className="mt-0.5 text-sm opacity-85">{NEXT.club}</p>

          <dl className="mt-4 flex flex-col gap-1.5 text-sm">
            <div className="flex items-center gap-2">
              <dt className="sr-only">Time</dt>
              <CalendarBlank size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
              <dd className="tabular">{formatRange(NEXT.startsAt, NEXT.endsAt, ZONE)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="sr-only">Venue</dt>
              <MapPin size={16} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
              <dd className="min-w-0 truncate">{NEXT.venue}</dd>
            </div>
          </dl>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link
              href="/profile/qr"
              className="inline-flex h-11 items-center gap-2 rounded-control bg-primary px-4 font-semibold text-primary-fg transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-primary-hover"
            >
              <QrCode size={18} weight={ICON_WEIGHT} aria-hidden />
              Show my pass
            </Link>
            <Link
              href={`/events/${NEXT.id}`}
              className="inline-flex h-11 items-center gap-1.5 rounded-control border border-primary/25 px-4 font-semibold hover:bg-primary/10"
            >
              Event details
              <CaretRight size={15} weight={ICON_WEIGHT} aria-hidden />
            </Link>
          </div>
        </section>

        {/* Renders only when something is actually waiting on the viewer. */}
        {TASKS.length > 0 ? (
          <Section title="Waiting on you">
            <ul className="flex flex-col gap-2">
              {TASKS.map(({ href, icon: Icon, label, meta }) => (
                <li key={label}>
                  <Link
                    href={href}
                    className="flex items-center gap-3 rounded-card border border-border bg-surface p-3 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary-soft-fg">
                      <Icon size={18} weight={ICON_WEIGHT} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{label}</span>
                      <span className="block truncate text-sm text-ink-2">{meta}</span>
                    </span>
                    <CaretRight
                      size={16}
                      weight={ICON_WEIGHT}
                      className="shrink-0 text-ink-3"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <Section title="Your registrations" href="/profile/registrations">
          <ul className="grid gap-2 sm:grid-cols-2">
            {UPCOMING.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/events/${e.id}`}
                  className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-ink-2">{e.club}</span>
                    <StatusBadge status={e.status} />
                  </span>
                  <span className="font-semibold text-ink">{e.title}</span>
                  <span className="tabular text-sm text-ink-2">
                    {formatRange(e.startsAt, e.endsAt, ZONE)}
                  </span>
                  <span className="mt-auto flex items-center justify-between gap-3 pt-0.5 text-sm">
                    <span className="min-w-0 truncate text-ink-2">{e.venue}</span>
                    {e.note ? <span className="shrink-0 tabular text-warn-fg">{e.note}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="From your clubs" href="/events">
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {DISCOVER.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/events/${e.id}`}
                  className="flex items-center gap-3 p-3 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-ink">{e.title}</span>
                    <span className="block truncate text-sm text-ink-2">
                      {e.club} ·{' '}
                      <span className="tabular">{formatRange(e.startsAt, e.endsAt, ZONE)}</span>
                    </span>
                  </span>
                  <span
                    className={
                      e.left === 0
                        ? 'shrink-0 tabular text-sm text-warn-fg'
                        : 'shrink-0 tabular text-sm text-ink-2'
                    }
                  >
                    {e.left === 0 ? 'Full' : `${e.left} left`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-primary hover:underline"
          >
            Browse all events
            <ArrowRight size={15} weight={ICON_WEIGHT} aria-hidden />
          </Link>
        </Section>
      </div>
    </StudentShell>
  );
}

'use client';

import type { EventSummary } from '@majlis/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatChip, formatClock } from '@/lib/event-time';
import { useViewerZone } from '@/lib/use-viewer-zone';

/** A non-breaking space holds each line's height for the one frame before the
 *  zone is known, so a list does not resize under the reader. */
const HOLD = ' ';

/**
 * The event line every student screen is built from: a date chip, who it
 * belongs to, and one trailing fact chosen by the list it sits in. The
 * trailing slot is the point of the row, so it is the caller's.
 */
export function EventRow({
  event,
  trailing,
  club = true,
}: {
  event: EventSummary;
  trailing?: ReactNode;
  /** Off on a club's own page, where every row would name the same club. */
  club?: boolean;
}) {
  const zone = useViewerZone();
  const chip = zone ? formatChip(event.startsAt, zone) : null;

  return (
    <Link
      href={`/events/${event.id}`}
      className="flex items-center gap-3 rounded-card border border-border bg-surface p-2.5 transition-colors duration-(--dur-fast) ease-(--ease-out) hover:bg-surface-2"
    >
      <span className="w-11 shrink-0 overflow-hidden rounded-control border border-border bg-surface-2 text-center">
        <span className="block bg-primary py-0.5 text-[0.5625rem] font-bold tracking-[0.06em] text-primary-fg uppercase">
          {chip ? chip.month : HOLD}
        </span>
        <span className="block py-0.5 text-[1.0625rem] font-bold tabular-nums text-ink">
          {chip ? chip.day : HOLD}
        </span>
      </span>

      <span className="min-w-0 flex-1">
        {club ? <span className="block truncate text-xs text-ink-2">{event.clubName}</span> : null}
        <span className="block truncate font-semibold text-ink">{event.title}</span>
        <span className="block truncate text-[0.8125rem] tabular-nums text-ink-2">
          {zone ? `${formatClock(event.startsAt, zone)} · ${event.venue ?? 'Online'}` : HOLD}
        </span>
      </span>

      {trailing}
    </Link>
  );
}

'use client';

import { formatMoment, formatRange } from '@/lib/event-time';
import { useViewerZone } from '@/lib/use-viewer-zone';

/**
 * Every rendered time in the product, on the viewer's own clock.
 *
 * The zone cannot be known on the server, and rendering the server's and then
 * the viewer's is a hydration mismatch, which React answers by throwing the
 * tree away. `useViewerZone` is undefined until mounted for exactly that
 * reason, so the guard belongs here rather than at each call site: a caller
 * that forgets it does not fail loudly, it quietly renders Vercel's UTC to
 * everyone.
 *
 * A non-breaking space holds the line's height for the one frame before the
 * effect runs, so a card does not resize under the reader.
 */
const HOLD = ' ';

export function TimeRange({
  startsAt,
  endsAt,
  className,
}: {
  startsAt: string;
  endsAt: string;
  className?: string;
}) {
  const zone = useViewerZone();
  return <span className={className}>{zone ? formatRange(startsAt, endsAt, zone) : HOLD}</span>;
}

export function Moment({ at, className }: { at: string; className?: string }) {
  const zone = useViewerZone();
  return <span className={className}>{zone ? formatMoment(at, zone) : HOLD}</span>;
}

import { cn } from '@/lib/cn';

/**
 * The shapes every route's `loading.tsx` is built from.
 *
 * A skeleton earns its place only by matching the screen it stands in for. If
 * a row is a different height or a grid a different shape, the real content
 * arriving makes the page jump, which reads worse than having shown nothing.
 * Each of these is sized from the component it mirrors, named in its comment.
 *
 * The standing risk: change one of those components and the shape here has to
 * follow, and nothing in the suite will notice if it does not.
 */
export function Bar({ className }: { className?: string }) {
  return <span className={cn('block animate-pulse rounded bg-surface-2', className)} />;
}

/** Mirrors the bordered row shared by My clubs, Invitations and the inbox:
 *  40px media, two lines of text, an optional control on the right. */
export function RowSkeleton({ action = true }: { action?: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-card border border-border bg-surface p-3">
      <Bar className="size-10 shrink-0 rounded-control" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Bar className="h-4 w-2/5" />
        <Bar className="h-3 w-1/4" />
      </span>
      {action ? <Bar className="h-7 w-16 shrink-0 rounded-control" /> : null}
    </li>
  );
}

export function RowsSkeleton({ count, action = true }: { count: number; action?: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <RowSkeleton key={i} action={action} />
      ))}
    </ul>
  );
}

/** Mirrors `Section`: a display-face heading over its content. */
export function SectionSkeleton({
  width = 'w-32',
  children,
}: {
  width?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <Bar className={cn('h-6', width)} />
      {children}
    </section>
  );
}

/** Mirrors the filter row above both browsers: a search field and two selects
 *  that stack on a phone and sit in a row from sm up. */
export function FiltersSkeleton({ selects = 1 }: { selects?: number }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Bar className="h-9 flex-1 rounded-control" />
      {Array.from({ length: selects }, (_, i) => (
        <Bar key={i} className="h-9 rounded-control sm:w-48" />
      ))}
    </div>
  );
}

/** Mirrors `ClubCard`: 48px logo, name over category, member count. */
export function ClubGridSkeleton({ count }: { count: number }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex h-full items-center gap-3 rounded-card border border-border bg-surface p-3"
        >
          <Bar className="size-12 shrink-0 rounded-control" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Bar className="h-4 w-3/5" />
            <Bar className="h-3 w-2/5" />
          </span>
          <Bar className="h-4 w-6 shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** Mirrors `EventCard`: club strip, title, times, then a footer pinned to the
 *  card's foot so seat counts line up across a grid row. */
export function EventGridSkeleton({ count }: { count: number }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3"
        >
          <span className="flex items-center gap-2">
            <Bar className="size-5 shrink-0 rounded-control" />
            <Bar className="h-3 w-1/3" />
          </span>
          <Bar className="h-4 w-4/5" />
          <Bar className="h-3.5 w-3/5" />
          <span className="mt-auto flex items-center justify-between gap-3 pt-1">
            <Bar className="h-3.5 w-1/3" />
            <Bar className="h-3.5 w-1/4" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Mirrors a console table: a header rule and evenly spaced rows. */
export function TableSkeleton({ rows, cols = 4 }: { rows: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex gap-4 border-b border-border px-4 py-3">
        {Array.from({ length: cols }, (_, i) => (
          <Bar key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0"
        >
          {Array.from({ length: cols }, (_, c) => (
            <Bar key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

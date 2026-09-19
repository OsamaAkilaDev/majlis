import type { ClubRole } from '@majlis/contracts';
import { cn } from '@/lib/cn';
import { roleLabel } from '@/lib/enum-label';
import { initials } from '@/lib/initials';

export interface RosterRow {
  /** Stable across renders: a user id, or an appointment id where one person
   *  can appear twice. */
  key: string;
  name: string;
  role: ClubRole;
  /** The second line: a tenure on the club page, an address or an invitation
   *  state in the console. */
  meta?: string | null;
  /** An appointment that has not been accepted yet. */
  provisional?: boolean;
}

/**
 * A club's officers as a list, not a row of pills: every officer carries a
 * second line, and a pill has nowhere to put one. The Lead row is tinted
 * rather than reordered, so the hierarchy survives a sighted skim and a
 * screen reader's sequential read alike.
 */
export function Roster({ rows, empty }: { rows: RosterRow[]; empty: string }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border-control px-4 py-6 text-center text-sm text-ink-2">
        {empty}
      </p>
    );
  }

  return (
    <ul className="overflow-hidden rounded-card border border-border bg-surface">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cn(
            'grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-border px-3 py-2.5 not-first:border-t',
            row.role === 'LEAD' && 'bg-primary-soft',
            row.provisional && 'opacity-70',
          )}
        >
          <span
            aria-hidden
            className={cn(
              'grid size-8 place-items-center rounded-full text-xs font-semibold',
              row.role === 'LEAD' ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-ink-2',
            )}
          >
            {initials(row.name)}
          </span>

          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
            {row.meta ? <span className="block truncate text-xs text-ink-3">{row.meta}</span> : null}
          </span>

          <span
            className={cn(
              'text-label font-bold tracking-[0.06em] uppercase',
              row.role === 'LEAD' ? 'text-primary-soft-fg' : 'text-ink-3',
            )}
          >
            {roleLabel(row.role)}
          </span>
        </li>
      ))}
    </ul>
  );
}

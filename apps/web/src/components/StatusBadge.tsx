import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  Certificate,
  Check,
  Checks,
  Clock,
  Envelope,
  Eye,
  FileText,
  Hourglass,
  Lock,
  Play,
  Prohibit,
  ProhibitInset,
  SealCheck,
  SignOut,
  UserCircleDashed,
  UserMinus,
  WarningCircle,
  X,
} from '@phosphor-icons/react/ssr';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'mute';
type Entry = { label: string; tone: Tone; icon: Icon };

/**
 * Every value of every status enum in `apps/api/prisma/schema.prisma` that a
 * screen renders. One entry per value, not three parallel maps, so a value
 * cannot arrive with a tone and no word.
 */
export const STATUS = {
  // RegistrationStatus
  CONFIRMED: { label: 'Confirmed', tone: 'ok', icon: Check },
  WAITLISTED: { label: 'Waitlisted', tone: 'warn', icon: Clock },
  CANCELLED: { label: 'Cancelled', tone: 'bad', icon: X },
  CHECKED_IN: { label: 'Checked in', tone: 'ok', icon: Checks },
  ATTENDED: { label: 'Attended', tone: 'ok', icon: SealCheck },
  NO_SHOW: { label: 'No show', tone: 'bad', icon: UserCircleDashed },
  REMOVED: { label: 'Removed', tone: 'bad', icon: UserMinus },

  // EventStatus
  DRAFT: { label: 'Draft', tone: 'mute', icon: FileText },
  PUBLISHED: { label: 'Published', tone: 'brand', icon: Eye },
  REGISTRATION_CLOSED: { label: 'Registration closed', tone: 'warn', icon: Lock },
  ONGOING: { label: 'Ongoing', tone: 'info', icon: Play },
  COMPLETED: { label: 'Completed', tone: 'mute', icon: Check },
  CERTIFIED: { label: 'Certified', tone: 'ok', icon: Certificate },

  // ClubStatus, MembershipStatus, CertificateStatus, AppointmentStatus
  ACTIVE: { label: 'Active', tone: 'ok', icon: Check },
  SUSPENDED: { label: 'Suspended', tone: 'bad', icon: WarningCircle },
  ARCHIVED: { label: 'Archived', tone: 'mute', icon: Archive },
  PENDING: { label: 'Pending', tone: 'warn', icon: Clock },
  REJECTED: { label: 'Rejected', tone: 'bad', icon: X },
  LEFT: { label: 'Left', tone: 'mute', icon: SignOut },
  REVOKED: { label: 'Revoked', tone: 'bad', icon: Prohibit },
  INVITED: { label: 'Invited', tone: 'info', icon: Envelope },
  DECLINED: { label: 'Declined', tone: 'mute', icon: X },
  EXPIRED: { label: 'Expired', tone: 'mute', icon: Hourglass },
  ENDED: { label: 'Ended', tone: 'mute', icon: ProhibitInset },
} as const satisfies Record<string, Entry>;

export type StatusKey = keyof typeof STATUS;

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-fg',
  warn: 'bg-warn-soft text-warn-fg',
  bad: 'bg-bad-soft text-bad-fg',
  info: 'bg-info-soft text-info-fg',
  brand: 'bg-primary-soft text-primary-soft-fg',
  mute: 'bg-mute-soft text-mute-fg',
};

/**
 * The tone pill `StatusBadge` renders, without the enum lookup, for the rare
 * label that is not a schema status word (a derived flag like "Joined").
 * `compact` drops the word and keeps the icon, for a row that has to hold a
 * date, a title, a venue and a state inside 320px. The label does not vanish:
 * it moves to the accessible name, so a screen reader reads "Completed" either
 * way and a pointer gets it back on hover.
 */
export function Badge({
  tone,
  label,
  icon: Icon,
  compact,
  className,
}: {
  tone: Tone;
  label: string;
  icon: Icon;
  compact?: boolean;
  className?: string;
}) {
  if (compact) {
    return (
      <span
        title={label}
        aria-label={label}
        className={cn(
          'inline-grid size-6 shrink-0 place-items-center rounded-control',
          TONE_CLASS[tone],
          className,
        )}
      >
        <Icon size={14} weight={ICON_WEIGHT} aria-hidden />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-control px-1.5 py-0.5 text-[0.6875rem] font-semibold whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon size={12} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
      {label}
    </span>
  );
}

/** Every value of every status enum, looked up by `STATUS` and handed to
 *  `Badge`. Kept separate so `STATUS_ENUMS` in the test file stays an exact
 *  match against the schema, not a superset padded with derived flags. */
export function StatusBadge({
  status,
  compact,
  className,
}: {
  status: StatusKey;
  compact?: boolean;
  className?: string;
}) {
  const { label, tone, icon } = STATUS[status];
  return <Badge tone={tone} label={label} icon={icon} compact={compact} className={className} />;
}

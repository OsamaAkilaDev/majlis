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

export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const { label, tone, icon: Icon } = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-label font-semibold',
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon size={14} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
      {label}
    </span>
  );
}

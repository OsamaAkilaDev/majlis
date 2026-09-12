import {
  Archive,
  Award,
  BadgeCheck,
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  CircleSlash,
  Clock,
  Eye,
  FileText,
  Hourglass,
  Lock,
  LogOut,
  Mail,
  Play,
  UserMinus,
  UserX,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'mute';
type Entry = { label: string; tone: Tone; icon: ComponentType<{ className?: string }> };

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
  CHECKED_IN: { label: 'Checked in', tone: 'ok', icon: CheckCheck },
  ATTENDED: { label: 'Attended', tone: 'ok', icon: BadgeCheck },
  NO_SHOW: { label: 'No show', tone: 'bad', icon: UserX },
  REMOVED: { label: 'Removed', tone: 'bad', icon: UserMinus },

  // EventStatus
  DRAFT: { label: 'Draft', tone: 'mute', icon: FileText },
  PUBLISHED: { label: 'Published', tone: 'brand', icon: Eye },
  REGISTRATION_CLOSED: { label: 'Registration closed', tone: 'warn', icon: Lock },
  ONGOING: { label: 'Ongoing', tone: 'info', icon: Play },
  COMPLETED: { label: 'Completed', tone: 'mute', icon: Check },
  CERTIFIED: { label: 'Certified', tone: 'ok', icon: Award },

  // ClubStatus, MembershipStatus, CertificateStatus, AppointmentStatus
  ACTIVE: { label: 'Active', tone: 'ok', icon: Check },
  SUSPENDED: { label: 'Suspended', tone: 'bad', icon: CircleAlert },
  ARCHIVED: { label: 'Archived', tone: 'mute', icon: Archive },
  PENDING: { label: 'Pending', tone: 'warn', icon: Clock },
  REJECTED: { label: 'Rejected', tone: 'bad', icon: X },
  LEFT: { label: 'Left', tone: 'mute', icon: LogOut },
  REVOKED: { label: 'Revoked', tone: 'bad', icon: Ban },
  INVITED: { label: 'Invited', tone: 'info', icon: Mail },
  DECLINED: { label: 'Declined', tone: 'mute', icon: X },
  EXPIRED: { label: 'Expired', tone: 'mute', icon: Hourglass },
  ENDED: { label: 'Ended', tone: 'mute', icon: CircleSlash },
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
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}

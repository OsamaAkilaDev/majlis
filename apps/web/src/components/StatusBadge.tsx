import { BadgeCheck, Check, CircleAlert, Clock, FileText, KeyRound, X } from 'lucide-react';
import type { ComponentType } from 'react';
import { cn } from '@/lib/cn';

export const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  WAITLISTED: 'Waitlisted',
  CANCELLED: 'Cancelled',
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  LIVE: 'Live now',
  COMPLETED: 'Completed',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INVITED: 'Invited',
  REQUESTED: 'Requested',
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
} as const;

export type StatusKey = keyof typeof STATUS_LABEL;
type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'mute';

export const STATUS_TONE: Record<StatusKey, Tone> = {
  CONFIRMED: 'ok',
  WAITLISTED: 'warn',
  CANCELLED: 'bad',
  DRAFT: 'mute',
  PUBLISHED: 'brand',
  LIVE: 'info',
  COMPLETED: 'mute',
  ACTIVE: 'ok',
  SUSPENDED: 'bad',
  INVITED: 'info',
  REQUESTED: 'warn',
  ISSUED: 'ok',
  REVOKED: 'bad',
};

const ICON: Record<StatusKey, ComponentType<{ className?: string }>> = {
  CONFIRMED: Check,
  WAITLISTED: Clock,
  CANCELLED: X,
  DRAFT: FileText,
  PUBLISHED: Check,
  LIVE: Clock,
  COMPLETED: Check,
  ACTIVE: Check,
  SUSPENDED: CircleAlert,
  INVITED: KeyRound,
  REQUESTED: Clock,
  ISSUED: BadgeCheck,
  REVOKED: X,
};

const TONE_CLASS: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-fg',
  warn: 'bg-warn-soft text-warn-fg',
  bad: 'bg-bad-soft text-bad-fg',
  info: 'bg-info-soft text-info-fg',
  brand: 'bg-primary-soft text-primary-soft-fg',
  mute: 'bg-mute-soft text-mute-fg',
};

export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const Icon = ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-2.5 text-label font-semibold',
        TONE_CLASS[STATUS_TONE[status]],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

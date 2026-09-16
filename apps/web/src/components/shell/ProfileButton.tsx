'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/initials';
import { activeNavHref } from '@/lib/routing';
import type { SessionUser } from '@majlis/contracts';

/** The two screens under /profile that have their own lit control elsewhere in
 *  the header or the tab bar, and so must not also light the avatar. */
const CLAIMED_ELSEWHERE = ['/profile/qr', '/profile/notifications'];

/**
 * The only way into /profile. It replaced a dropdown carrying sign-out and the
 * shell switcher, both of which moved onto the screen itself: a menu that was
 * the sole route to a full screen made the screen feel like a submenu, and put
 * the theme switch two taps deep on a phone.
 *
 * The lit state is derived here rather than passed in, so a profile screen
 * cannot forget to declare itself and end up lighting nothing at all.
 */
export function ProfileButton({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const current =
    activeNavHref(pathname, ['/profile']) !== null &&
    activeNavHref(pathname, CLAIMED_ELSEWHERE) === null;

  return (
    <Link
      href="/profile"
      aria-label="Profile"
      aria-current={current ? 'page' : undefined}
      className={cn(
        'grid size-11 place-items-center rounded-full text-ink-2 transition-colors duration-(--dur)',
        !current && 'hover:bg-surface-2',
      )}
    >
      {/* The halo is a 2px collar on its own element rather than the whole
          44px button's ground, so it hugs the avatar instead of filling the
          touch target. The fallback goes deep teal with it: initials on
          surface-2 against primary-soft is barely a step, and the collar
          disappears against them. */}
      <span
        className={cn(
          'grid place-items-center rounded-full transition-colors duration-(--dur)',
          current && 'bg-primary-soft p-0.5',
        )}
      >
        <Avatar>
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback className={cn(current && 'bg-primary text-primary-fg')}>
            {initials(user.fullName)}
          </AvatarFallback>
        </Avatar>
      </span>
    </Link>
  );
}

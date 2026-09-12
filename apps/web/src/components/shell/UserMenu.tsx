'use client';

import { SignOut } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiFetch } from '@/lib/api';
import { ICON_WEIGHT } from '@/lib/icons';
import { shellDestinations } from '@/lib/routing';
import type { SessionUser } from '@majlis/contracts';

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter();
  const destinations = shellDestinations(user);

  async function signOut() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // The server revokes the family regardless; never leave the browser
      // sitting on a signed-in page because the response did not arrive.
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    // Not modal: Radix would mark the whole shell aria-hidden while leaving the
    // tab bar focusable, which is a real WCAG 4.1.2 failure the axe scan catches.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label="Account"
        className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
      >
        <Avatar>
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initials(user.fullName)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-ink">
          <span className="block truncate font-semibold">{user.fullName}</span>
          <span className="block truncate font-normal text-ink-2">{user.email}</span>
        </DropdownMenuLabel>

        {destinations.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Switch to</DropdownMenuLabel>
            {destinations.map(({ href, label }) => (
              <DropdownMenuItem key={href} asChild>
                <Link href={href}>{label}</Link>
              </DropdownMenuItem>
            ))}
          </>
        ) : null}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <SignOut size={16} weight={ICON_WEIGHT} aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

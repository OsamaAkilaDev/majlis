'use client';

import { Desktop, Moon, SignOut, Sun } from '@phosphor-icons/react/ssr';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';

const CHOICES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Desktop },
] as const;

/**
 * Three choices, not the header's two-state toggle. next-themes has always
 * carried `system` and defaults to it, so a binary toggle could put a viewer
 * into an explicit theme with no way back to following their device.
 *
 * `theme` is the stored preference, not `resolvedTheme`: the point of the
 * control is which of the three is selected, and on `system` those two differ.
 */
function ThemeChoice() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Theme"
      className="grid grid-cols-3 gap-1 rounded-card border border-border bg-surface-2 p-1"
    >
      {CHOICES.map(({ value, label, icon: Icon }) => {
        // Before mount there is no stored preference to read, so nothing is
        // pressed. Claiming one would render a selection the server never
        // sent and flip it on hydration.
        const selected = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-9 items-center justify-center gap-1.5 rounded-control border border-transparent text-sm',
              selected
                ? 'border-border bg-surface font-semibold text-ink shadow-sm'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon size={16} weight={ICON_WEIGHT} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SignOutButton() {
  const router = useRouter();

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
    <Button variant="destructive" size="lg" className="w-full" onClick={signOut}>
      <SignOut size={16} weight={ICON_WEIGHT} aria-hidden />
      Sign out
    </Button>
  );
}

export { SignOutButton, ThemeChoice };

'use client';

import { Moon, Sun } from '@phosphor-icons/react/ssr';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { ICON_WEIGHT } from '@/lib/icons';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      className="grid size-11 place-items-center rounded-control text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {dark ? <Sun size={20} weight={ICON_WEIGHT} aria-hidden /> : <Moon size={20} weight={ICON_WEIGHT} aria-hidden />}
    </button>
  );
}

'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionUser } from '@majlis/contracts';

export type ShellSession = { user: SessionUser; unread: number };

const Ctx = createContext<ShellSession | null>(null);

/**
 * The viewer and their unread count, fetched once by the layout and read by
 * the header from here.
 *
 * This exists so the header can render without awaiting anything. A
 * `loading.tsx` is a Suspense fallback: if the shell it renders has to await
 * `/auth/me` first, the fallback suspends too and the navigation goes back to
 * blocking, which is the whole problem the skeletons were added to solve.
 * Layouts do not re-render when you move between their children, so the fetch
 * happens once per shell mount rather than once per navigation.
 */
export function ShellSessionProvider({
  value,
  children,
}: {
  value: ShellSession;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShellSession(): ShellSession {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error('useShellSession must be rendered inside the shell layout.');
  }
  return value;
}

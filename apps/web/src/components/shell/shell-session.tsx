'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { SessionUser } from '@majlis/contracts';

/** `unread` is student-only: a console header has no bell, so its layout
 *  supplies no count rather than a zero standing in for one. */
export type ShellSession = { user: SessionUser; unread?: number };

const Ctx = createContext<ShellSession | null>(null);

/**
 * Lets the header render without awaiting anything. `loading.tsx` is a
 * Suspense fallback, so a shell that awaited `/auth/me` would suspend inside
 * the fallback and put the blocking navigation back.
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

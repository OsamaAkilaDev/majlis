'use client';

import { useCallback, useState } from 'react';

/**
 * Rethrows an async failure during render, which is the only place the nearest
 * `error.tsx` can catch one: a promise rejected inside an effect reaches no
 * error boundary at all, and every screen's first `load()` runs in one.
 *
 * Without this the boundaries exist and never fire, and a revoked session or a
 * 500 leaves the screen on its skeleton forever (the gap the Stage 5 handoff
 * names first).
 */
export function useAsyncError(): (error: unknown) => void {
  const [, raise] = useState<unknown>();
  return useCallback((error: unknown) => {
    raise(() => {
      throw error;
    });
  }, []);
}

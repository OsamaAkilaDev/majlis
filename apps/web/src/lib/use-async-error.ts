'use client';

import { useCallback, useState } from 'react';

/**
 * Rethrows during render, the only place `error.tsx` can catch an async
 * failure: a promise rejected inside an effect reaches no boundary at all, and
 * every screen's first `load()` runs in one. Without this the boundaries exist
 * and never fire.
 */
export function useAsyncError(): (error: unknown) => void {
  const [, raise] = useState<unknown>();
  return useCallback((error: unknown) => {
    raise(() => {
      throw error;
    });
  }, []);
}

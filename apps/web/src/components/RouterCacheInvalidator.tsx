'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { onMutation } from '@/lib/api';

/** Hands lib/api.ts a router.refresh(), once, for the whole app. There is one
 *  Router Cache and it is dropped whole, so this belongs in the root layout. */
export function RouterCacheInvalidator() {
  const router = useRouter();
  useEffect(() => onMutation(() => router.refresh()), [router]);
  return null;
}

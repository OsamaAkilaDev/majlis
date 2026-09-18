'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { onMutation } from '@/lib/api';

/**
 * Hands lib/api.ts a router.refresh(), once, for the whole app. Lives in the
 * root layout because there is exactly one Router Cache and it is dropped
 * whole; a per-screen version would be a dozen copies of the same call, each
 * one able to be forgotten on the screen where it mattered.
 */
export function RouterCacheInvalidator() {
  const router = useRouter();
  useEffect(() => onMutation(() => router.refresh()), [router]);
  return null;
}

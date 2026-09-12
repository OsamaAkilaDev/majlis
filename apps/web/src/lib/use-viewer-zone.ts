'use client';

import { useEffect, useState } from 'react';
import { viewerTimeZone } from '@/lib/event-time';

/**
 * The viewer's IANA zone, undefined until mounted. The server cannot know it,
 * so anything derived from it must be absent from the first paint: rendering a
 * time in the server's zone and then the viewer's is a hydration mismatch, and
 * React answers one by regenerating the entire tree on the client.
 */
export function useViewerZone(): string | undefined {
  const [zone, setZone] = useState<string>();
  useEffect(() => setZone(viewerTimeZone()), []);
  return zone;
}

'use client';

import { useEffect, useState } from 'react';
import { viewerTimeZone } from '@/lib/event-time';

/** Undefined until mounted, deliberately: the server cannot know the zone, and
 *  rendering the server's then the viewer's is a hydration mismatch. */
export function useViewerZone(): string | undefined {
  const [zone, setZone] = useState<string>();
  useEffect(() => setZone(viewerTimeZone()), []);
  return zone;
}

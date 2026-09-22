'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function ClubError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // No club id here: this boundary sits above [clubId], so the way out is the
  // one destination every officer can reach.
  return <ErrorPanel {...props} home={{ href: '/events', label: 'Events' }} />;
}

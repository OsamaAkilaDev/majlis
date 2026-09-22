'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function ClubError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // (club) is Admin-only as of Stage 9, so whoever lands here is an Admin;
  // the way out is their shell, not the student one.
  return <ErrorPanel {...props} home={{ href: '/admin', label: 'Admin' }} />;
}

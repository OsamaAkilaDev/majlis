'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function StudentError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel {...props} home={{ href: '/events', label: 'Events' }} />;
}

'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function AdminError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel {...props} home={{ href: '/admin', label: 'Admin' }} />;
}

'use client';

import { ErrorPanel } from '@/components/ErrorPanel';

export default function AuthError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // landmark={false}: (auth)/layout.tsx already renders this page's <main>.
  return <ErrorPanel {...props} landmark={false} home={{ href: '/login', label: 'Sign in' }} />;
}

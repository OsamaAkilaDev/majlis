import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/AuthForm';
import { needsAdmin } from '@/lib/bootstrap';
import { bounceIfSignedIn } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  await bounceIfSignedIn();
  // A deployment with no admin has one screen, and it is not this one.
  if (await needsAdmin()) redirect('/setup');
  return <AuthForm mode="login" />;
}

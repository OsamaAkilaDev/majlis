import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/AuthForm';
import { needsAdmin } from '@/lib/bootstrap';
import { bounceIfSignedIn } from '@/lib/session';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage() {
  await bounceIfSignedIn();
  // A deployment with no admin has one screen, and it is not this one.
  if (await needsAdmin()) redirect('/setup');
  return <AuthForm mode="signup" />;
}

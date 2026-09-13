import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';
import { bounceIfSignedIn } from '@/lib/session';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage() {
  await bounceIfSignedIn();
  return <AuthForm mode="signup" />;
}

import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';
import { bounceIfSignedIn } from '@/lib/session';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage() {
  await bounceIfSignedIn();
  return <AuthForm mode="login" />;
}

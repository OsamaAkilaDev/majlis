import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { needsAdmin } from '@/lib/bootstrap';
import { bounceIfSignedIn } from '@/lib/session';
import { SetupAdminForm } from './SetupAdminForm';

export const metadata: Metadata = { title: 'Create admin account' };

/**
 * Open only while the platform has no admin. Checked here rather than in
 * middleware: middleware runs on every navigation and reads cookies only,
 * and adding an API round trip there to serve a screen shown once in the
 * life of a deployment would tax every request forever.
 */
export default async function SetupPage() {
  await bounceIfSignedIn();
  if (!(await needsAdmin())) redirect('/login');
  return <SetupAdminForm />;
}

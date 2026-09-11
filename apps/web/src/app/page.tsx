import { redirect } from 'next/navigation';
import { landingFor } from '@/lib/routing';
import { getSessionUser } from '@/lib/session';

export default async function RootPage() {
  const user = await getSessionUser();
  redirect(user ? landingFor(user) : '/login');
}

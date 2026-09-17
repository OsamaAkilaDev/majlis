import { redirect } from 'next/navigation';

/** The first entry of ADMIN_NAV. Was /admin/metrics until that screen was removed. */
export default function AdminIndex() {
  redirect('/admin/users');
}

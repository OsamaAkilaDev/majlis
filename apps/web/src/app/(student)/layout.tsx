import type { ReactNode } from 'react';
import { requireUser } from '@/lib/session';

export default async function StudentLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}

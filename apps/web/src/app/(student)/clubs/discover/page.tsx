import type { ClubPage, DepartmentPage } from '@majlis/contracts';
import type { Metadata } from 'next';
import { StudentShell } from '@/components/shell/StudentShell';
import { PAGE } from '@/lib/page-size';
import { serverFetch } from '@/lib/server-api';
import { ClubBrowser } from './ClubBrowser';

export const metadata: Metadata = { title: 'Discover clubs' };

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  // A club page links here to show the rest of its department, so the filter
  // is a URL, not a control the visitor has to find again.
  const { department } = await searchParams;
  const filter = department ? `&departmentId=${encodeURIComponent(department)}` : '';

  // The first render has no search term, so it is the "browsing" case: hide
  // clubs the viewer already belongs to, same as the client-side refetch.
  const [clubs, departments] = await Promise.all([
    serverFetch<ClubPage>(`/clubs?status=ACTIVE&joinable=true&limit=${PAGE}${filter}`),
    serverFetch<DepartmentPage>('/departments?limit=100'),
  ]);

  return (
    <StudentShell title="Discover">
      <ClubBrowser
        initialClubs={clubs}
        initialDepartments={departments?.items ?? null}
        initialDepartmentId={department}
      />
    </StudentShell>
  );
}

import { redirect } from 'next/navigation';

/**
 * There is one club screen now, not two. The workspace at /manage/[clubId]
 * carries everything this page used to: the profile, the committee, the Lead
 * appointment and the status transitions, all gated on the same platform role
 * the admin console checks. The route stays so existing links still land.
 */
export default async function AdminClubDetailPage({
  params,
}: {
  params: Promise<{ clubId: string }>;
}) {
  const { clubId } = await params;
  redirect(`/manage/${clubId}/overview`);
}

import { redirect } from 'next/navigation';

export default async function ManageIndex({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  redirect(`/manage/${clubId}/overview`);
}

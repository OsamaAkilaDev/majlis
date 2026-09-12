'use client';

import type { ClubDetail, MembershipPolicy } from '@majlis/contracts';
import { useEffect, useState } from 'react';
import { Field } from '@/components/Field';
import { ImageUpload } from '@/components/ImageUpload';
import { OverrideReason } from '@/components/OverrideReason';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ProblemError } from '@/lib/api';
import { getClub, listDepartments, updateClub } from '@/lib/clubs';
import { needsOverrideReason } from '@/lib/override';
import { useAsyncError } from '@/lib/use-async-error';

const POLICIES: MembershipPolicy[] = ['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED'];

export function OverviewManager({
  clubId,
  platformRole,
  initialClub,
  initialDepartments,
}: {
  clubId: string;
  platformRole: 'STUDENT' | 'ADMIN';
  initialClub: ClubDetail | null;
  initialDepartments: { id: string; name: string }[] | null;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>(
    initialDepartments ?? [],
  );

  const [departmentId, setDepartmentId] = useState(initialClub?.departmentId ?? '');
  const [category, setCategory] = useState(initialClub?.category ?? '');
  const [academicYear, setAcademicYear] = useState(initialClub?.academicYear ?? '');
  const [membershipPolicy, setMembershipPolicy] = useState<MembershipPolicy>(
    initialClub?.membershipPolicy ?? 'OPEN',
  );
  const [description, setDescription] = useState(initialClub?.description ?? '');

  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  const fail = useAsyncError();

  useEffect(() => {
    if (initialClub) return;
    getClub(clubId).then((c) => {
      setClub(c);
      setDepartmentId(c.departmentId);
      setCategory(c.category);
      setAcademicYear(c.academicYear);
      setMembershipPolicy(c.membershipPolicy);
      setDescription(c.description);
    }).catch(fail);
  }, [clubId, initialClub]);

  useEffect(() => {
    if (initialDepartments) return;
    listDepartments({ limit: 100 })
      .then((page) => setDepartments(page.items))
      .catch(fail);
  }, [initialDepartments]);

  if (!club) return <Skeleton className="h-64 w-full" />;

  // Spec 6.1: an Admin holding no role in this club is overriding, so every
  // save from this screen has to carry why.
  const override = needsOverrideReason(platformRole, club.viewerClubRoles);
  const overrideReason = override ? reason.trim() || undefined : undefined;

  const canEdit =
    club.status !== 'ARCHIVED' &&
    (platformRole === 'ADMIN' || club.viewerClubRoles.includes('LEAD') || club.viewerClubRoles.includes('VICE_LEAD'));

  async function refresh(next: ClubDetail) {
    setClub(next);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const updated = await updateClub(clubId, {
        departmentId,
        category,
        academicYear,
        membershipPolicy,
        description,
        overrideReason,
      });
      await refresh(updated);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  async function onImageUploaded(kind: 'club-logo' | 'club-banner') {
    const updated = await updateClub(
      clubId,
      kind === 'club-logo'
        ? { logoUploaded: true, overrideReason }
        : { bannerUploaded: true, overrideReason },
    );
    await refresh(updated);
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-h1 text-ink">{club.name}</h2>
        <StatusBadge status={club.status} />
      </div>

      <div className="flex gap-4">
        <Field label="Logo">
          {canEdit ? (
            <ImageUpload kind="club-logo" clubId={clubId} currentUrl={club.logoUrl} onUploaded={() => onImageUploaded('club-logo')} />
          ) : (
            <img src={club.logoUrl} alt="" className="size-20 rounded-card border border-border object-cover" />
          )}
        </Field>
        {canEdit ? (
          <Field label="Banner">
            <ImageUpload kind="club-banner" clubId={clubId} currentUrl={club.bannerUrl} onUploaded={() => onImageUploaded('club-banner')} />
          </Field>
        ) : club.bannerUrl ? (
          <Field label="Banner">
            <img src={club.bannerUrl} alt="" className="h-20 w-full rounded-card border border-border object-cover" />
          </Field>
        ) : null}
      </div>

      {canEdit ? (
        <>
          {/* Paired once there is room: a single column of six short fields
              leaves half a console screen empty. */}
          <div className="grid gap-5 md:grid-cols-2">
          <Field label="Department" error={error?.fieldError('departmentId')}>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Category" error={error?.fieldError('category')}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} required />
          </Field>

          <Field label="Academic year" error={error?.fieldError('academicYear')}>
            <Input value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} required />
          </Field>

          <Field label="Membership policy" error={error?.fieldError('membershipPolicy')}>
            <Select value={membershipPolicy} onValueChange={(v) => setMembershipPolicy(v as MembershipPolicy)}>
              <SelectTrigger aria-label="Membership policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p.replace('_', ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="md:col-span-2">
            <Field label="Description" error={error?.fieldError('description')}>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required />
            </Field>
          </div>
          </div>

          {override ? <OverrideReason value={reason} onChange={setReason} /> : null}

          {error && error.errors.length === 0 ? (
            <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p>
          ) : null}

          <Button onClick={save} disabled={pending} className="self-start">
            Save
          </Button>
        </>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-ink-2">Department</dt>
            <dd className="text-ink">{club.departmentName}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Category</dt>
            <dd className="text-ink">{club.category}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Academic year</dt>
            <dd className="text-ink tabular">{club.academicYear}</dd>
          </div>
          <div>
            <dt className="text-ink-2">Membership policy</dt>
            <dd className="text-ink">{club.membershipPolicy.replace('_', ' ')}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-ink-2">Description</dt>
            <dd className="text-ink">{club.description}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

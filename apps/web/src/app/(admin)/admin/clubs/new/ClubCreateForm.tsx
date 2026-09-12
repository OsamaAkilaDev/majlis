'use client';

import type { Department, MembershipPolicy } from '@majlis/contracts';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field } from '@/components/Field';
import { ImageUpload } from '@/components/ImageUpload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ProblemError } from '@/lib/api';
import { createClub, listDepartments } from '@/lib/clubs';

const POLICIES: MembershipPolicy[] = ['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED'];

export function ClubCreateForm({ initialDepartments }: { initialDepartments: Department[] | null }) {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>(initialDepartments ?? []);
  const [clubId, setClubId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [category, setCategory] = useState('');
  const [academicYear, setAcademicYear] = useState('');
  const [membershipPolicy, setMembershipPolicy] = useState<MembershipPolicy>('OPEN');
  const [description, setDescription] = useState('');

  const [error, setError] = useState<ProblemError | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (initialDepartments) return;
    listDepartments({ limit: 100 }).then((page) => setDepartments(page.items));
  }, [initialDepartments]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!clubId) return;
    setPending(true);
    setError(null);
    try {
      const club = await createClub({
        clubId,
        departmentId,
        name,
        description,
        category,
        academicYear,
        membershipPolicy,
      });
      router.push(`/admin/clubs/${club.id}`);
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-lg flex-col gap-5">
      <Field label="Logo">
        <ImageUpload kind="club-logo" onUploaded={(_url, id) => setClubId(id)} />
      </Field>

      <fieldset disabled={!clubId} className="flex flex-col gap-5 disabled:opacity-50">
        <Field label="Name" error={error?.fieldError('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field label="Department" error={error?.fieldError('departmentId')}>
          <Select value={departmentId} onValueChange={setDepartmentId}>
            <SelectTrigger aria-label="Department">
              <SelectValue placeholder="Department" />
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

        <Field label="Description" error={error?.fieldError('description')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} required />
        </Field>

        {error && error.errors.length === 0 ? <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p> : null}

        <Button type="submit" disabled={pending || !departmentId}>
          Create club
        </Button>
      </fieldset>
    </form>
  );
}

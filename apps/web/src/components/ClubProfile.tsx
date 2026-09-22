'use client';

import type { ClubDetail, MembershipPolicy } from '@majlis/contracts';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClubBanner } from '@/components/ClubBanner';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImageUpload } from '@/components/ImageUpload';
import { InlineEdit, type Option } from '@/components/InlineEdit';
import { Roster } from '@/components/Roster';
import { SaveBar } from '@/components/SaveBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { UserPickerDialog } from '@/components/UserPickerDialog';
import { ProblemError } from '@/lib/api';
import { canEditClubField, type ClubField } from '@/lib/club-fields';
import { clubSectionsFor } from '@/lib/club-sections';
import { appointLead, getClub, listDepartments, updateClub, updateClubStatus } from '@/lib/clubs';
import { enumLabel } from '@/lib/enum-label';
import { needsOverrideReason } from '@/lib/override';
import { useAsyncError } from '@/lib/use-async-error';

const POLICIES: MembershipPolicy[] = ['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY', 'CLOSED'];

/** The five columns this screen writes. Images save on upload, not from the bar. */
const EDITED = ['departmentId', 'category', 'academicYear', 'membershipPolicy', 'description'] as const;
type Edited = (typeof EDITED)[number];
type Draft = Record<Edited, string>;

function draftOf(club: ClubDetail): Draft {
  return {
    departmentId: club.departmentId,
    category: club.category,
    academicYear: club.academicYear,
    membershipPolicy: club.membershipPolicy,
    description: club.description,
  };
}

/**
 * The club as a student sees it, with every field this viewer may write turned
 * into the control it always was. One screen, not a read view and an edit form
 * to keep in agreement.
 *
 * Shared by nothing: the officer console and the admin console are the same
 * workspace now, so the admin-only panels at the foot are gated on the role
 * rather than living on a second screen.
 */
export function ClubProfile({
  clubId,
  platformRole,
  initialClub,
  initialDepartments,
  teamHref,
}: {
  clubId: string;
  platformRole: 'STUDENT' | 'ADMIN';
  initialClub: ClubDetail | null;
  initialDepartments: { id: string; name: string }[] | null;
  /** Where the Committee panel's Manage link goes. This screen is rendered in
   *  two shells and each knows its own href scheme; the default is the student
   *  one, which is where an officer works. */
  teamHref?: string;
}) {
  const [club, setClub] = useState<ClubDetail | null>(initialClub);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>(
    initialDepartments ?? [],
  );
  const [draft, setDraft] = useState<Draft | null>(initialClub ? draftOf(initialClub) : null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ProblemError | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const fail = useAsyncError();

  useEffect(() => {
    if (initialClub) return;
    getClub(clubId)
      .then((c) => {
        setClub(c);
        setDraft(draftOf(c));
      })
      .catch(fail);
  }, [clubId, initialClub]);

  useEffect(() => {
    if (initialDepartments) return;
    listDepartments({ limit: 100 })
      .then((page) => setDepartments(page.items))
      .catch(fail);
  }, [initialDepartments]);

  const dirty = useMemo(() => {
    if (!club || !draft) return [] as Edited[];
    const base = draftOf(club);
    return EDITED.filter((key) => draft[key] !== base[key]);
  }, [club, draft]);

  if (!club || !draft) return <Skeleton className="h-96 w-full" />;

  // Spec 6.1: an Admin holding no role in this club is overriding, so every
  // save from this screen has to carry why.
  const override = needsOverrideReason(platformRole, club.viewerClubRoles);
  const overrideReason = override ? reason.trim() || undefined : undefined;

  // Frozen, not merely refused: an archived club accepts no edits at all, and
  // every control on the page would otherwise invite one.
  const live = club.status !== 'ARCHIVED';
  const can = (field: ClubField) =>
    live && canEditClubField(field, club.viewerClubRoles, platformRole);
  const canManageTeam = clubSectionsFor(club.viewerClubRoles, platformRole).some(
    (s) => s.key === 'team',
  );

  function set(key: Edited, value: string) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function land(next: ClubDetail) {
    setClub(next);
    setDraft(draftOf(next));
    setError(null);
    setReason('');
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = {};
      for (const key of dirty) body[key] = draft![key];
      land(await updateClub(clubId, { ...body, overrideReason }));
    } catch (err) {
      if (err instanceof ProblemError) setError(err);
      else throw err;
    } finally {
      setBusy(false);
    }
  }

  async function onImageUploaded(kind: 'club-logo' | 'club-banner') {
    // An upload has already written bytes, so it is saved on arrival rather
    // than held in the draft the bar sends.
    land(
      await updateClub(
        clubId,
        kind === 'club-logo'
          ? { logoUploaded: true, overrideReason }
          : { bannerUploaded: true, overrideReason },
      ),
    );
  }

  const departmentOptions: Option[] = departments.map((d) => ({ value: d.id, label: d.name }));
  const policyOptions: Option[] = POLICIES.map((p) => ({ value: p, label: enumLabel(p) }));
  const departmentName =
    departments.find((d) => d.id === draft.departmentId)?.name ?? club.departmentName;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col">
        <div className="relative">
          <ClubBanner clubId={club.id} bannerUrl={club.bannerUrl} className="rounded-card" />
          {can('bannerUploaded') ? (
            // Top right, not bottom: the crest and the name occupy the banner's
            // foot. No `currentUrl` either, because the banner behind it is
            // already the preview.
            <div className="absolute top-2 right-2">
              <ImageUpload
                kind="club-banner"
                clubId={clubId}
                compact
                onUploaded={() => onImageUploaded('club-banner')}
              />
            </div>
          ) : null}
        </div>

        {/* `relative` is load-bearing: the banner above is positioned, so
            without a stacking position of its own this row paints under it.
            Stacked below sm, side by side above it: see ClubDetail. On a
            narrow screen the banner is 112px tall, so a name beside the crest
            lands inside the artwork. */}
        <div className="relative z-10 -mt-8 flex flex-col gap-2 px-3 sm:-mt-11 sm:flex-row sm:items-end sm:gap-4 sm:px-5">
          <div className="relative shrink-0">
            <img
              src={club.logoUrl}
              alt=""
              className="size-16 rounded-card border-[3px] border-bg bg-surface object-cover shadow-[var(--shadow-md)] sm:size-22 lg:size-24"
            />
            {can('logoUploaded') ? (
              <div className="absolute -right-1.5 -bottom-1.5">
                <ImageUpload
                  kind="club-logo"
                  clubId={clubId}
                  compact
                  onUploaded={() => onImageUploaded('club-logo')}
                />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 flex-1 sm:pb-1">
            {/* The name is not patchable: it is what the slug was derived
                from, so renaming a club is not an edit to this field. */}
            <h2 className="font-display text-h1 text-ink text-balance sm:text-title">{club.name}</h2>
            <div className="-ml-1.5 flex flex-wrap items-center gap-x-1 text-sm text-ink-2">
              <InlineEdit
                label="Department"
                mode="select"
                value={draft.departmentId}
                display={departmentName}
                options={departmentOptions}
                editable={can('departmentId')}
                dirty={dirty.includes('departmentId')}
                error={error?.fieldError('departmentId')}
                onCommit={(v) => set('departmentId', v)}
              />
              <span aria-hidden>·</span>
              <InlineEdit
                label="Category"
                value={draft.category}
                editable={can('category')}
                dirty={dirty.includes('category')}
                error={error?.fieldError('category')}
                onCommit={(v) => set('category', v)}
              />
            </div>
          </div>
        </div>
      </header>

      <dl className="flex flex-wrap border-y border-border">
        <Fact label="Members" value={String(club.memberCount)} />
        <Fact label="Events run" value={String(club.eventsRun)} />
        <Fact label="Academic year">
          <InlineEdit
            label="Academic year"
            value={draft.academicYear}
            editable={can('academicYear')}
            dirty={dirty.includes('academicYear')}
            error={error?.fieldError('academicYear')}
            onCommit={(v) => set('academicYear', v)}
          />
        </Fact>
        <Fact label="Joining">
          <InlineEdit
            label="Joining"
            mode="select"
            value={draft.membershipPolicy}
            display={enumLabel(draft.membershipPolicy)}
            options={policyOptions}
            editable={can('membershipPolicy')}
            dirty={dirty.includes('membershipPolicy')}
            error={error?.fieldError('membershipPolicy')}
            onCommit={(v) => set('membershipPolicy', v)}
          />
        </Fact>
      </dl>

      {/* grid-cols-1 below lg: see ClubDetail. An implicit `auto` column
          sizes to max-content and clips the page on a narrow screen. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="font-display text-h1 text-ink">About</h3>
            <div className="-ml-1.5 text-body leading-relaxed text-ink">
              <InlineEdit
                label="About"
                mode="area"
                value={draft.description}
                editable={can('description')}
                dirty={dirty.includes('description')}
                error={error?.fieldError('description')}
                onCommit={(v) => set('description', v)}
              />
            </div>
          </section>

          {platformRole === 'ADMIN' ? (
            <StatusPanel club={club} onChanged={land} />
          ) : null}
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-display text-h1 text-ink">Committee</h3>
              {/* Only a viewer who holds the Team section: `club:edit` reaches
                  this screen and `club:team-manage` is narrower, so Marketing
                  would otherwise be offered a destination that refuses them. */}
              {canManageTeam ? (
                <Link
                  href={teamHref ?? `/clubs/${club.slug}/team`}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  Manage
                </Link>
              ) : null}
            </div>
            <Roster
              empty="No officers appointed"
              rows={club.committee.map((m) => ({
                key: m.userId,
                name: m.fullName,
                role: m.role,
              }))}
            />

            {platformRole === 'ADMIN' && live ? (
              <UserPickerDialog
                trigger={
                  <Button variant="outline" size="sm" className="w-full border-dashed">
                    Appoint Lead
                  </Button>
                }
                title="Appoint Lead"
                confirmLabel="Send invitation"
                exclude={club.committee.filter((m) => m.role === 'LEAD').map((m) => m.userId)}
                onSubmit={async (user) => {
                  await appointLead(clubId, { userId: user.id });
                  setNote(`Invitation sent to ${user.fullName}.`);
                }}
              />
            ) : null}

            {note ? (
              <p role="status" className="text-sm text-ink-2">
                {note}
              </p>
            ) : null}
          </section>
        </aside>
      </div>

      {error && error.errors.length === 0 ? (
        <p className="text-sm text-bad-fg">{error.detail ?? error.title}</p>
      ) : null}

      <SaveBar
        count={dirty.length}
        busy={busy}
        blocked={override && reason.trim().length === 0}
        onDiscard={() => land(club)}
        onSave={save}
      >
        {override ? (
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Override reason"
            placeholder="Override reason"
            maxLength={500}
            className="w-full sm:w-72"
          />
        ) : null}
      </SaveBar>
    </div>
  );
}

function Fact({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-0.5 border-border px-3.5 py-2.5 not-first:border-l">
      <dt className="text-label font-semibold tracking-[0.08em] text-ink-3 uppercase">{label}</dt>
      <dd className="-ml-1.5 text-h2 font-semibold tabular-nums text-ink">{children ?? value}</dd>
    </div>
  );
}

/** Mirrors club-status.ts's ALLOWED table: every status reaches every other. */
const NEXT_STATUSES: Record<ClubDetail['status'], ClubDetail['status'][]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE', 'SUSPENDED'],
};

/** The action, not the state it lands on: a button says what pressing it does. */
const STATUS_ACTION: Record<ClubDetail['status'], string> = {
  ACTIVE: 'Reactivate club',
  SUSPENDED: 'Suspend club',
  ARCHIVED: 'Archive club',
};

function StatusPanel({
  club,
  onChanged,
}: {
  club: ClubDetail;
  onChanged: (club: ClubDetail) => void;
}) {
  return (
    <section className="flex flex-wrap gap-2 border-t border-border pt-4">
      {NEXT_STATUSES[club.status].map((next) => (
        <ConfirmDialog
          key={next}
          title={`Move ${club.name} to ${next.toLowerCase()}?`}
          confirmLabel={enumLabel(next)}
          destructive={next === 'ARCHIVED'}
          reason="required"
          trigger={
            <Button variant={next === 'ARCHIVED' ? 'destructive' : 'outline'} size="sm">
              {STATUS_ACTION[next]}
            </Button>
          }
          onConfirm={async (reason) => {
            onChanged(await updateClubStatus(club.id, { status: next, reason: reason ?? '' }));
          }}
        />
      ))}
    </section>
  );
}

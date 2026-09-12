import type {
  AddMemberBody,
  Appointment,
  AppointmentPage,
  AppointLeadBody,
  ClubDetail,
  ClubListQuery,
  ClubPage,
  CreateClubBody,
  CreateDepartmentBody,
  CursorPageQuery,
  DecideMembershipBody,
  Department,
  DepartmentPage,
  EndAppointmentBody,
  ImageKind,
  InvitationPage,
  InviteTeamMemberBody,
  Member,
  MemberListQuery,
  MemberPage,
  MyClubPage,
  NewClubUpload,
  PatchClubBody,
  PatchClubStatusBody,
  PatchDepartmentBody,
  SignedUpload,
  UserListPage,
} from '@majlis/contracts';
import { apiFetch } from './api';

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

function qs(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

// -- Uploads and club creation/editing --------------------------------------

export const mintClubLogoUpload = (): Promise<NewClubUpload> =>
  apiFetch('/uploads/club-logo', { method: 'POST' });

export const mintClubEditUpload = (clubId: string, kind: ImageKind): Promise<SignedUpload> =>
  apiFetch(`/clubs/${clubId}/${kind === 'club-logo' ? 'logo-upload-url' : 'banner-upload-url'}`, {
    method: 'POST',
  });

export const createClub = (body: CreateClubBody): Promise<ClubDetail> => apiFetch('/clubs', json(body));

export const updateClub = (clubId: string, body: PatchClubBody): Promise<ClubDetail> =>
  apiFetch(`/clubs/${clubId}`, { ...json(body), method: 'PATCH' });

export const updateClubStatus = (clubId: string, body: PatchClubStatusBody): Promise<ClubDetail> =>
  apiFetch(`/clubs/${clubId}/status`, { ...json(body), method: 'PATCH' });

export const listClubs = (query: ClubListQuery): Promise<ClubPage> =>
  apiFetch(
    `/clubs${qs({
      departmentId: query.departmentId,
      status: query.status,
      q: query.q,
      cursor: query.cursor,
      limit: String(query.limit),
    })}`,
  );

export const getClub = (clubId: string): Promise<ClubDetail> => apiFetch(`/clubs/${clubId}`);

/** The slug is the club's public identifier, so student URLs resolve by it. */
export const getClubBySlug = (slug: string): Promise<ClubDetail> =>
  apiFetch(`/clubs/by-slug/${encodeURIComponent(slug)}`);

// -- Team ---------------------------------------------------------------

export const appointLead = (clubId: string, body: AppointLeadBody): Promise<Appointment> =>
  apiFetch(`/clubs/${clubId}/lead`, json(body));

export const listTeam = (clubId: string, query: CursorPageQuery): Promise<AppointmentPage> =>
  apiFetch(`/clubs/${clubId}/team${qs({ cursor: query.cursor, limit: String(query.limit) })}`);

export const inviteTeamMember = (clubId: string, body: InviteTeamMemberBody): Promise<Appointment> =>
  apiFetch(`/clubs/${clubId}/team`, json(body));

export const endAppointment = (
  clubId: string,
  appointmentId: string,
  body: EndAppointmentBody,
): Promise<void> => apiFetch(`/clubs/${clubId}/team/${appointmentId}`, { ...json(body), method: 'DELETE' });

export const myInvitations = (query: CursorPageQuery): Promise<InvitationPage> =>
  apiFetch(`/me/invitations${qs({ cursor: query.cursor, limit: String(query.limit) })}`);

export const acceptInvitation = (appointmentId: string): Promise<Appointment> =>
  apiFetch(`/appointments/${appointmentId}/accept`, { method: 'POST' });

export const declineInvitation = (appointmentId: string): Promise<Appointment> =>
  apiFetch(`/appointments/${appointmentId}/decline`, { method: 'POST' });

// -- Membership -----------------------------------------------------------

export const listMembers = (clubId: string, query: MemberListQuery): Promise<MemberPage> =>
  apiFetch(
    `/clubs/${clubId}/members${qs({ status: query.status, cursor: query.cursor, limit: String(query.limit) })}`,
  );

export const addMember = (clubId: string, body: AddMemberBody): Promise<Member> =>
  apiFetch(`/clubs/${clubId}/members`, json(body));

export const requestMembership = (clubId: string): Promise<Member> =>
  apiFetch(`/clubs/${clubId}/membership-requests`, { method: 'POST' });

export const decideMembership = (
  clubId: string,
  requestId: string,
  body: DecideMembershipBody,
): Promise<Member> => apiFetch(`/clubs/${clubId}/membership-requests/${requestId}`, { ...json(body), method: 'PATCH' });

export const leaveClub = (clubId: string): Promise<void> =>
  apiFetch(`/clubs/${clubId}/membership`, { method: 'DELETE' });

export const removeMember = (clubId: string, userId: string): Promise<void> =>
  apiFetch(`/clubs/${clubId}/members/${userId}`, { method: 'DELETE' });

export const myClubs = (query: CursorPageQuery): Promise<MyClubPage> =>
  apiFetch(`/me/clubs${qs({ cursor: query.cursor, limit: String(query.limit) })}`);

// -- Departments ------------------------------------------------------------

export const listDepartments = (query: CursorPageQuery): Promise<DepartmentPage> =>
  apiFetch(`/departments${qs({ cursor: query.cursor, limit: String(query.limit) })}`);

export const createDepartment = (body: CreateDepartmentBody): Promise<Department> =>
  apiFetch('/departments', json(body));

export const updateDepartment = (id: string, body: PatchDepartmentBody): Promise<Department> =>
  apiFetch(`/departments/${id}`, { ...json(body), method: 'PATCH' });

export const removeDepartment = (id: string): Promise<void> =>
  apiFetch(`/departments/${id}`, { method: 'DELETE' });

// -- Users (search, for Lead appointment and team invitations) --------------

export const listUsers = (query: CursorPageQuery): Promise<UserListPage> =>
  apiFetch(`/users${qs({ cursor: query.cursor, limit: String(query.limit) })}`);

/** "VICE_LEAD" -> "Vice Lead". Shared by every screen that renders a ClubRole. */
export function roleLabel(role: string): string {
  return role
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

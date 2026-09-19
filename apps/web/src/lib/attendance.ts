import type {
  AttendancePage,
  CheckInResult,
  CorrectAttendanceBody,
  CursorPageQuery,
  ManualCheckInBody,
  QrPass,
  ScanBody,
} from '@majlis/contracts';
import { apiFetch, json, qs } from './api';

/**
 * GET /me/qr-pass is read on the server, where the SVG is drawn, so it has no
 * client twin. Rotation is an action, and every previously issued image dies
 * with it.
 */
export const rotateQrPass = (): Promise<QrPass> =>
  apiFetch('/me/qr-pass/rotate', { method: 'POST' });

/** The token is the whole credential, so it travels in a body, never a query. */
export const scanPass = (eventId: string, body: ScanBody): Promise<CheckInResult> =>
  apiFetch(`/events/${eventId}/check-in/scan`, json(body));

export const manualCheckIn = (eventId: string, body: ManualCheckInBody): Promise<CheckInResult> =>
  apiFetch(`/events/${eventId}/check-in/manual`, json(body));

export const listAttendance = (eventId: string, query: CursorPageQuery): Promise<AttendancePage> =>
  apiFetch(
    `/events/${eventId}/attendance${qs({ cursor: query.cursor, limit: query.limit })}`,
  );

export const correctAttendance = (
  eventId: string,
  registrationId: string,
  body: CorrectAttendanceBody,
): Promise<void> =>
  apiFetch(`/events/${eventId}/attendance/${registrationId}`, { ...json(body), method: 'PATCH' });

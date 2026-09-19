import type { Notification, NotificationListQuery, NotificationPage } from '@majlis/contracts';
import { apiFetch, qs } from './api';

export const listNotifications = (query: NotificationListQuery): Promise<NotificationPage> =>
  apiFetch(
    `/me/notifications${qs({
      unread: query.unread,
      cursor: query.cursor,
      limit: query.limit,
    })}`,
  );

/** Idempotent, so a second press on a row already read answers the same row. */
export const markNotificationRead = (id: string): Promise<Notification> =>
  apiFetch(`/me/notifications/${id}/read`, { method: 'POST' });

'use client';

import type { Notification, NotificationPage } from '@majlis/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { formatMoment } from '@/lib/event-time';
import { notificationLine } from '@/lib/notification-line';
import { listNotifications, markNotificationRead } from '@/lib/notifications';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';
import { useViewerZone } from '@/lib/use-viewer-zone';

export function Inbox({ initial }: { initial: NotificationPage | null }) {
  const router = useRouter();
  const { items, setItems, cursor, show, append } = useCursorPage(initial);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server rendered the unfiltered first page, so the mount run of the
  // filter effect would refetch exactly what is already on screen.
  const seeded = useRef(initial !== null);
  const zone = useViewerZone();
  const fail = useAsyncError();

  const load = useCallback(async () => {
    show(await listNotifications({ limit: PAGE, unread: unreadOnly ? true : undefined }));
  }, [show, unreadOnly]);

  // Refetches from the first page whenever the filter changes, so a cursor
  // from the previous filter can never paginate the new result set.
  useEffect(() => {
    if (seeded.current) {
      seeded.current = false;
      return;
    }
    setItems(null);
    load().catch(fail);
  }, [unreadOnly]);

  async function loadMore() {
    if (!cursor) return;
    append(await listNotifications({ limit: PAGE, cursor, unread: unreadOnly ? true : undefined }));
  }

  /**
   * Optimistic, with a rollback: the row is the only feedback the press has,
   * and waiting a round trip to dim it reads as a dead control. A failure puts
   * the previous list back rather than leaving a row that looks read and is
   * not.
   */
  async function markRead(notification: Notification) {
    const previous = items;
    setError(null);
    setItems(
      (rows) =>
        rows?.map((row) =>
          row.id === notification.id ? { ...row, readAt: new Date().toISOString() } : row,
        ) ?? null,
    );

    try {
      await markNotificationRead(notification.id);
      // Re-renders StudentShell, which is where the tab-bar badge is counted.
      router.refresh();
    } catch (err) {
      setItems(previous);
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That did not save.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant={unreadOnly ? 'default' : 'outline'}
          aria-pressed={unreadOnly}
          onClick={() => setUnreadOnly((on) => !on)}
        >
          Unread
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}

      {items === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={unreadOnly ? 'Nothing unread' : 'Nothing yet'} />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((notification) => {
              const { title, detail, href } = notificationLine(notification);
              const unread = notification.readAt === null;

              return (
                <li
                  key={notification.id}
                  className={
                    unread
                      ? 'flex items-start gap-3 rounded-card border border-border border-l-[3px] border-l-primary bg-surface p-3'
                      : 'flex items-start gap-3 rounded-card border border-border bg-bg p-3'
                  }
                >
                  {/* A filled disc, not only a colour: the unread state has to
                      survive a monochrome rendering and a colour-blind reader. */}
                  <span
                    aria-hidden
                    className={
                      unread
                        ? 'mt-1.5 size-2 shrink-0 rounded-full bg-primary'
                        : 'mt-1.5 size-2 shrink-0 rounded-full border border-border-control'
                    }
                  />

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className={
                        unread
                          ? 'truncate font-semibold text-ink'
                          : 'truncate font-normal text-ink-2'
                      }
                    >
                      {unread ? <span className="sr-only">Unread. </span> : null}
                      {href ? (
                        <Link href={href} className="hover:underline">
                          {title}
                        </Link>
                      ) : (
                        title
                      )}
                    </span>
                    <span className="text-sm text-ink-2">{detail}</span>
                    <span className="tabular text-label text-ink-3">
                      {zone ? formatMoment(notification.createdAt, zone) : null}
                    </span>
                  </div>

                  {unread ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => markRead(notification)}
                      aria-label={`Mark ${title} read`}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <LoadMore cursor={cursor} onClick={loadMore} />
        </>
      )}
    </div>
  );
}

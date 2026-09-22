'use client';

import type { Certificate, CertificatePage } from '@majlis/contracts';
import { DownloadSimple } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { LoadMore } from '@/components/LoadMore';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ProblemError } from '@/lib/api';
import { certificatePdf, myCertificates } from '@/lib/certificates';
import { formatDay } from '@/lib/event-time';
import { ICON_WEIGHT } from '@/lib/icons';
import { PAGE } from '@/lib/page-size';
import { useAsyncError } from '@/lib/use-async-error';
import { useCursorPage } from '@/lib/use-cursor-page';

export function MyCertificates({ initial }: { initial: CertificatePage | null }) {
  const { items, cursor, show, append } = useCursorPage(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = useAsyncError();

  const load = useCallback(async () => {
    show(await myCertificates({ limit: PAGE }));
  }, [show]);

  useEffect(() => {
    if (!initial) load().catch(fail);
  }, [initial, load, fail]);

  async function download(certificate: Certificate) {
    // Opened synchronously inside the click and only then sent somewhere:
    // opening it after the await is a popup as far as the browser is
    // concerned, and it is blocked without telling anyone.
    //
    // Deliberately without 'noopener', which makes window.open return null
    // and leaves nothing to point at the URL. What it opens is a PDF on the
    // storage origin, which runs no script and so has nothing to reach back
    // through window.opener with.
    const tab = window.open('', '_blank');
    setBusy(certificate.id);
    setError(null);
    try {
      // Rendered and uploaded on the first call, so this is slow exactly once
      // per certificate.
      const { pdfUrl } = await certificatePdf(certificate.id);
      if (tab) tab.location.href = pdfUrl;
      else window.location.href = pdfUrl;
    } catch (err) {
      tab?.close();
      setError(err instanceof ProblemError ? (err.detail ?? err.title) : 'That download failed.');
    } finally {
      setBusy(null);
    }
  }

  if (items === null) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No certificates yet"
        action={
          <Button asChild>
            <Link href="/events/discover">Browse events</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-bad-fg">
          {error}
        </p>
      ) : null}

      <ul className="grid gap-2 lg:grid-cols-2">
        {items.map((certificate) => (
          <li
            key={certificate.id}
            className="flex h-full flex-col gap-2 rounded-card border border-border bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {/* The snapshot, not the club's name today: renaming a club
                    must not alter a certificate somebody already holds. */}
                <span className="block truncate font-semibold text-ink">
                  {certificate.eventTitle}
                </span>
                <span className="block truncate text-sm text-ink-2">{certificate.clubName}</span>
              </div>
              <StatusBadge status={certificate.status} />
            </div>

            <p className="tabular text-sm text-ink-2">{formatDay(certificate.issuedAt)}</p>

            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="tabular text-label text-ink-3">{certificate.serialNumber}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === certificate.id}
                onClick={() => download(certificate)}
              >
                <DownloadSimple size={14} weight={ICON_WEIGHT} aria-hidden />
                Download
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <LoadMore cursor={cursor} onClick={async () => {
        if (!cursor) return;
        append(await myCertificates({ limit: PAGE, cursor }));
      }} />
    </div>
  );
}

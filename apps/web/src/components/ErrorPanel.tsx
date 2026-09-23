'use client';

import { ArrowClockwise } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ProblemError } from '@/lib/api';
import { ICON_WEIGHT } from '@/lib/icons';

/**
 * The body of every `error.tsx`. A 401 is not retryable: the session is gone,
 * so this takes them to sign in rather than leaving them pressing a button
 * that will keep failing.
 */
export function ErrorPanel({
  error,
  retry,
  home,
  landmark = true,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Where "back" leads in the shell this boundary sits in. */
  home?: { href: string; label: string };
  /**
   * False under `(auth)`, whose layout already renders the page's `<main>`.
   * A second one inside it is a nested landmark, which axe fails.
   */
  landmark?: boolean;
}) {
  const router = useRouter();
  const status = error instanceof ProblemError ? error.status : undefined;

  useEffect(() => {
    if (status === 401) router.replace('/login');
  }, [status, router]);

  // The API's own words: a rewritten message drifts the moment either side is.
  const detail = error instanceof ProblemError ? (error.detail ?? error.title) : null;
  const trace = (error instanceof ProblemError ? error.requestId : undefined) ?? error.digest;

  const body = (
    <div className="flex max-w-md flex-col items-center gap-5 text-center">
      <h1 className="font-display text-title text-balance text-ink">
        {status === 401 ? 'Your session has ended' : 'Something went wrong'}
      </h1>

      {detail ? <p className="text-sm text-ink-2">{detail}</p> : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={retry}>
          <ArrowClockwise size={16} weight={ICON_WEIGHT} aria-hidden />
          Try again
        </Button>
        {home ? (
          <Button asChild variant="outline">
            <Link href={home.href}>{home.label}</Link>
          </Button>
        ) : null}
      </div>

      {trace ? <p className="tabular selectable text-label text-ink-3">{trace}</p> : null}
    </div>
  );

  if (!landmark) return body;
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-6 py-16">
      {body}
    </main>
  );
}

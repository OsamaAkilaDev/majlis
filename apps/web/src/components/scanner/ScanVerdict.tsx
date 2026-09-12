'use client';

import { CheckCircle, Clock, XCircle } from '@phosphor-icons/react/ssr';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ICON_WEIGHT } from '@/lib/icons';
import type { Verdict, VerdictTone } from '@/lib/scan-verdict';

const TONE = {
  ok: { surface: 'bg-ok-soft text-ok-fg', icon: CheckCircle },
  warn: { surface: 'bg-warn-soft text-warn-fg', icon: Clock },
  bad: { surface: 'bg-bad-soft text-bad-fg', icon: XCircle },
} as const satisfies Record<VerdictTone, unknown>;

/** A success clears itself so a queue keeps moving; a refusal waits to be read. */
const AUTOCLEAR_MS = 2500;

/**
 * Not a card in a list. It takes the lower half of the screen at display scale,
 * because the operator reads it at arm's length while looking at a person.
 *
 * Colour, a drawn icon and words, never colour alone. The name and the email
 * sit directly under the verdict at body scale: eyeballing the person against
 * them is the actual task, not a detail.
 */
export function ScanVerdict({ verdict, onClear }: { verdict: Verdict; onClear: () => void }) {
  const { surface, icon: Icon } = TONE[verdict.tone];

  useEffect(() => {
    if (verdict.tone !== 'ok') return;
    const timer = setTimeout(onClear, AUTOCLEAR_MS);
    return () => clearTimeout(timer);
  }, [verdict, onClear]);

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`mt-auto flex min-h-[45svh] flex-col gap-3 rounded-t-sheet px-5 pb-[calc(1rem+var(--safe-b))] pt-6 ${surface}`}
    >
      <div className="flex items-center gap-3">
        <Icon size={44} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
        <p className="font-display text-display leading-none text-balance">{verdict.headline}</p>
      </div>

      {verdict.detail ? <p className="tabular text-h2 opacity-80">{verdict.detail}</p> : null}

      {verdict.person ? (
        <div className="flex flex-col">
          <span className="text-h1 font-semibold">{verdict.person.fullName}</span>
          <span className="text-body opacity-80">{verdict.person.email}</span>
        </div>
      ) : null}

      <Button variant="outline" onClick={onClear} className="mt-auto h-12 w-full text-base">
        Next
      </Button>
    </div>
  );
}

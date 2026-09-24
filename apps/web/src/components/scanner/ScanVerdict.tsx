'use client';

import { CheckCircle, Clock, XCircle } from '@phosphor-icons/react/ssr';
import { useEffect } from 'react';
import type { Verdict, VerdictTone } from '@/lib/scan-verdict';

/**
 * The `-fg` tones as fills, with the page's darkest colour as ink. The scanner
 * is dark in both themes, where those are the bright values: a solid block of
 * them reads from across a desk, which a soft tint on a dark room never did.
 *
 * Every verdict returns to scanning on its own, a refusal only later, because
 * a queue does not wait for the operator to find a button.
 */
const TONE = {
  ok: { surface: 'bg-ok-fg', icon: CheckCircle, holdMs: 2000 },
  warn: { surface: 'bg-warn-fg', icon: Clock, holdMs: 3500 },
  bad: { surface: 'bg-bad-fg', icon: XCircle, holdMs: 3500 },
} as const satisfies Record<VerdictTone, unknown>;

/**
 * A card over the paused viewfinder, not a panel under it. Colour, a drawn icon
 * and words, never colour alone. The name and the email sit directly under the
 * verdict: eyeballing the person against them is the actual task.
 */
export function ScanVerdict({ verdict, onClear }: { verdict: Verdict; onClear: () => void }) {
  const { surface, icon: Icon, holdMs } = TONE[verdict.tone];

  useEffect(() => {
    const timer = setTimeout(onClear, holdMs);
    return () => clearTimeout(timer);
  }, [verdict, onClear, holdMs]);

  return (
    <div className="absolute inset-0 z-10 grid place-items-center p-5">
      {/* The scrim is the tap target for "skip": anywhere off the card. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={onClear}
        className="absolute inset-0 animate-[overlay-in_var(--dur)_var(--ease-out)] bg-black/55"
      />

      <div
        role="status"
        aria-live="assertive"
        className={`relative flex w-full max-w-sm animate-[verdict-in_var(--dur)_var(--ease-out)] flex-col items-center overflow-hidden rounded-sheet text-center text-bg shadow-[0_18px_48px_-12px_rgb(0_0_0/0.6)] ${surface}`}
      >
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-6">
          <span className="grid size-20 place-items-center rounded-full bg-bg/12">
            <Icon size={52} weight="fill" aria-hidden />
          </span>

          <p className="font-display text-display leading-none text-balance">{verdict.headline}</p>

          {verdict.detail ? <p className="tabular text-h2 font-semibold">{verdict.detail}</p> : null}

          {verdict.person ? (
            <div className="mt-1 flex min-w-0 max-w-full flex-col">
              <span className="truncate text-h1 font-bold">{verdict.person.fullName}</span>
              <span className="selectable truncate text-body opacity-80">{verdict.person.email}</span>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClear}
          className="relative h-14 w-full border-t border-bg/15 text-base font-semibold hover:bg-bg/8 focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-bg"
        >
          Scan next
          {/* Drains over exactly the hold, so the operator can see the screen
              is about to go back to the camera. The session remounts this
              component per verdict, which is what restarts it. */}
          <span
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-1 origin-left bg-bg/35"
            style={{ animation: `verdict-drain ${holdMs}ms linear forwards` }}
          />
        </button>
      </div>
    </div>
  );
}

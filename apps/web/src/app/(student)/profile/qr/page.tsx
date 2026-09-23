import type { QrPass } from '@majlis/contracts';
import type { Metadata } from 'next';
import { toString as qrSvg } from 'qrcode';
import { StudentShell } from '@/components/shell/StudentShell';
import { BRAND } from '@/lib/brand';
import { initials } from '@/lib/initials';
import { serverFetch } from '@/lib/server-api';
import { requireUser } from '@/lib/session';
import { RotatePass } from './RotatePass';

export const metadata: Metadata = { title: 'My QR' };

export default async function MyQrPage() {
  const [user, pass] = await Promise.all([requireUser(), serverFetch<QrPass>('/me/qr-pass')]);
  // Thrown rather than rendered empty: the image cannot be drawn in the
  // browser, so there is nothing for a client component to refetch and the
  // shell's error boundary is the only thing that can offer a retry.
  if (!pass) throw new Error('Could not load your pass.');

  // Drawn here and only here. The page ships no QR library to the browser,
  // and the token itself reaches no client module at all.
  const svg = await qrSvg(pass.token, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });

  return (
    <StudentShell title="My QR">
      {/* Sized to fit, not trimmed until it happened to: the pass, the control
          under it and the dock all sit inside one viewport down to a 667px
          screen, so this is the one student route that never scrolls. */}
      <div className="mx-auto flex h-full w-full max-w-sm flex-col items-center justify-center gap-4">
        <div className="w-full overflow-hidden rounded-sheet border border-border bg-surface shadow-[var(--shadow-float)]">
          <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-fg">
              {initials(user.fullName)}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-display text-h2 text-ink">{user.fullName}</span>
              <span className="selectable truncate text-sm text-ink-2">{user.email}</span>
            </span>
          </div>

          {/* The tear. Two notches bitten out of the card's sides with the page
              behind them, and a dashed rule between: one pass, holder above
              the perforation and credential below it. */}
          <div className="relative h-px">
            <span
              aria-hidden
              className="absolute -left-2.5 -top-2.5 size-5 rounded-full bg-bg shadow-[inset_-1px_0_0_var(--color-border)]"
            />
            <span
              aria-hidden
              className="absolute -right-2.5 -top-2.5 size-5 rounded-full bg-bg shadow-[inset_1px_0_0_var(--color-border)]"
            />
            <hr className="mx-4 border-t border-dashed border-border" />
          </div>

          <div className="flex flex-col gap-2.5 px-4 pb-3.5 pt-4">
            {/* The ring sits OUTSIDE the white, never in it. A code is read off
                a blank quiet zone, and this one is drawn with a 2-module margin
                where the spec asks for 4, so the plate's white padding is what
                makes up the difference. Anything animated inside it is a scan
                that fails at a door.

                Width is clamped rather than fixed: 252px is the size chosen for
                a normal phone, and a 667px screen has to shrink it instead of
                growing a scrollbar. */}
            <div className="qr-ring mx-auto w-[clamp(11rem,32svh,15.75rem)] rounded-[20px] bg-border p-[9px]">
              <div
                role="img"
                aria-label="Your check-in pass"
                className="relative z-10 rounded-card bg-white p-3 [&>svg]:block [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>

            <div className="tabular flex items-center justify-between gap-2 font-mono text-label text-ink-3">
              <span>
                <span className="text-ink-2">PASS</span> v{pass.tokenVersion}
              </span>
              <span>{BRAND.product}</span>
            </div>
          </div>
        </div>

        <RotatePass />
      </div>
    </StudentShell>
  );
}

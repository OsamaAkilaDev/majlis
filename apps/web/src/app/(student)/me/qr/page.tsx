import type { QrPass } from '@majlis/contracts';
import type { Metadata } from 'next';
import { toString as qrSvg } from 'qrcode';
import { StudentShell } from '@/components/shell/StudentShell';
import { serverFetch } from '@/lib/server-api';
import { RotatePass } from './RotatePass';

export const metadata: Metadata = { title: 'My QR' };

export default async function MyQrPage() {
  const pass = await serverFetch<QrPass>('/me/qr-pass');
  // Thrown rather than rendered empty: the image cannot be drawn in the
  // browser, so there is nothing for a client component to refetch and the
  // shell's error boundary is the only thing that can offer a retry.
  if (!pass) throw new Error('Could not load your pass.');

  // Drawn here and only here. The page ships no QR library to the browser,
  // and the token itself reaches no client module at all.
  const svg = await qrSvg(pass.token, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });

  return (
    <StudentShell title="My QR">
      {/* Optically centred rather than pinned to the top: on a phone the pass
          is the whole screen, and a code sitting under the header with half a
          viewport of nothing below it reads as a page that failed to finish. */}
      <div className="mx-auto flex min-h-[65svh] w-full max-w-xs flex-col items-center justify-center gap-6">
        {/* White plate in both themes: the code is scanned off the glass, and
            a dark surround under a light quiet zone is what a phone camera
            hunts for. */}
        <div
          role="img"
          aria-label="Your check-in pass"
          className="w-full rounded-card bg-white p-3 shadow-[var(--shadow-md)] [&>svg]:block [&>svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <RotatePass />
      </div>
    </StudentShell>
  );
}

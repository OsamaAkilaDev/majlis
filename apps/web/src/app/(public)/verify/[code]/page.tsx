import { verificationSchema, type Verification } from '@majlis/contracts';
import { Prohibit, SealCheck, Question } from '@phosphor-icons/react/ssr';
import type { Metadata } from 'next';
import { API_ORIGIN } from '@/lib/api-origin';
import { formatDay } from '@/lib/event-time';
import { ICON_WEIGHT } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'Verify',
  // A verification page names a real person. Nothing here belongs in a search
  // index, and the code is the only thing that should ever lead to it.
  robots: { index: false, follow: false },
};

/**
 * The one anonymous read in the product. No cookie is sent: this route takes no
 * session and must behave identically for everybody.
 *
 * A 404 is an answer, and anything else is this service failing. They are kept
 * apart deliberately: telling an employer that a real certificate is not real
 * because the API was briefly down is the one mistake this page must not make.
 */
async function verify(code: string): Promise<Verification | null> {
  const res = await fetch(`${API_ORIGIN}/api/v1/verify/${encodeURIComponent(code)}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Verification is unavailable.');
  return verificationSchema.parse(await res.json());
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-border pt-3">
      <dt className="text-label font-semibold uppercase tracking-wide text-ink-3">{term}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}

export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const certificate = await verify(code);

  if (certificate === null) {
    return (
      <section className="flex w-full flex-col items-center gap-4 rounded-card border border-border bg-surface p-6 text-center">
        <Question size={40} weight={ICON_WEIGHT} className="text-ink-3" aria-hidden />
        <h1 className="font-display text-title text-balance text-ink">
          No certificate matches this code
        </h1>
        <p className="tabular break-all text-sm text-ink-2">{code}</p>
      </section>
    );
  }

  // Revoked answers REVOKED with its date rather than vanishing: an employer
  // holding a revoked document has to be able to learn that it was revoked.
  const revoked = certificate.status === 'REVOKED';

  return (
    <section className="w-full overflow-hidden rounded-card border border-border bg-surface">
      {/* The verdict first and at scale, because it is the whole question.
          Colour, a drawn seal and the word, never colour alone. */}
      <h1
        className={`flex items-center gap-3 px-6 py-5 font-display text-title ${
          revoked ? 'bg-bad-soft text-bad-fg' : 'bg-ok-soft text-ok-fg'
        }`}
      >
        {revoked ? (
          <Prohibit size={32} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
        ) : (
          <SealCheck size={32} weight={ICON_WEIGHT} className="shrink-0" aria-hidden />
        )}
        {revoked ? 'Revoked' : 'Valid certificate'}
      </h1>

      <dl className="flex flex-col gap-3 p-6">
        <Fact term="Holder">{certificate.holderName}</Fact>
        <Fact term="Event">{certificate.eventTitle}</Fact>
        <Fact term="Club">{certificate.clubName}</Fact>
        <Fact term="Issued">
          <span className="tabular">{formatDay(certificate.issuedAt)}</span>
        </Fact>
        {certificate.revokedAt ? (
          <Fact term="Revoked">
            <span className="tabular">{formatDay(certificate.revokedAt)}</span>
          </Fact>
        ) : null}
      </dl>
    </section>
  );
}

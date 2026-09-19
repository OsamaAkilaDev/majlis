'use client';

import type { ImageKind } from '@majlis/contracts';
import { UploadSimple } from '@phosphor-icons/react/ssr';
import { useId, useState } from 'react';
import { convertToWebp } from '@/lib/image';
import { mintClubEditUpload, mintClubLogoUpload } from '@/lib/clubs';
import { cn } from '@/lib/cn';
import { ICON_WEIGHT } from '@/lib/icons';

type State = 'idle' | 'converting' | 'uploading' | 'done' | 'refused';

const LABELS: Record<ImageKind, string> = {
  'club-logo': 'Logo',
  'club-banner': 'Banner',
  'event-poster': 'Poster',
};

/**
 * Uploads an image: convert to WebP in the browser, mint a signed URL, PUT the
 * blob there (Content-Type only, no auth header: the token in the URL's query
 * string is the sole credential), then report the public URL up.
 *
 * `mint` names the route that issues the signed URL and, for a resource that
 * does not exist yet, the id it will be created with. It defaults to the club
 * routes; the event poster passes its own.
 */
export function ImageUpload({
  kind,
  clubId,
  currentUrl,
  mint,
  compact,
  onUploaded,
}: {
  kind: ImageKind;
  clubId?: string;
  currentUrl?: string | null;
  mint?: () => Promise<{ signedUrl: string; publicUrl: string; id: string }>;
  /** An icon the size of a control, for sitting on the artwork it replaces
   *  rather than beside it. The word moves to the accessible name. */
  compact?: boolean;
  onUploaded: (publicUrl: string, id: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const inputId = useId();
  const label = LABELS[kind];

  async function mintFor(): Promise<{ signedUrl: string; publicUrl: string; id: string }> {
    if (mint) return mint();
    if (clubId) return { ...(await mintClubEditUpload(clubId, kind)), id: clubId };
    const { clubId: id, ...rest } = await mintClubLogoUpload();
    return { ...rest, id };
  }

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setState('converting');
    setMessage('');
    try {
      const blob = await convertToWebp(file, kind);

      setState('uploading');
      const { signedUrl, publicUrl, id } = await mintFor();

      const res = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
      });
      if (!res.ok) throw new Error('The upload was refused. Try again.');

      setPreview(publicUrl);
      setState('done');
      onUploaded(publicUrl, id);
    } catch (err) {
      setState('refused');
      setMessage(err instanceof Error ? err.message : 'That upload failed. Try again.');
    } finally {
      event.target.value = '';
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {preview ? (
        <img
          src={preview}
          alt=""
          className={cn(
            'border border-border bg-surface-2 object-cover',
            kind === 'club-logo' ? 'size-20 rounded-card' : 'h-24 w-full rounded-card',
          )}
        />
      ) : null}

      <div className="flex items-center gap-2">
        <label
          htmlFor={inputId}
          aria-label={compact ? `Replace ${label.toLowerCase()}` : undefined}
          title={compact ? `Replace ${label.toLowerCase()}` : undefined}
          className={
            compact
              ? 'grid size-7 cursor-pointer place-items-center rounded-control border border-border bg-surface text-ink shadow-[var(--shadow-sm)] hover:bg-surface-2'
              : 'inline-flex h-8 cursor-pointer items-center rounded-control border border-border-control px-2.5 text-sm font-medium text-ink hover:bg-surface-2'
          }
        >
          {compact ? <UploadSimple size={14} weight={ICON_WEIGHT} aria-hidden /> : label}
        </label>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          onChange={onChange}
          disabled={state === 'converting' || state === 'uploading'}
          className="sr-only"
        />
      </div>

      <p aria-live="polite" className="text-sm text-ink-2 empty:hidden">
        {state === 'converting' ? 'Converting...' : state === 'uploading' ? 'Uploading...' : ''}
      </p>
      {state === 'refused' ? <p className="text-sm text-bad-fg">{message}</p> : null}
    </div>
  );
}

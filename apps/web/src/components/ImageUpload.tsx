'use client';

import type { ImageKind } from '@majlis/contracts';
import { useId, useState } from 'react';
import { convertToWebp } from '@/lib/image';
import { mintClubEditUpload, mintClubLogoUpload } from '@/lib/clubs';
import { cn } from '@/lib/cn';

type State = 'idle' | 'converting' | 'uploading' | 'done' | 'refused';

/**
 * Uploads a club logo or banner: convert to WebP in the browser, mint a
 * signed URL, PUT the blob there (Content-Type only, no auth header: the
 * token in the URL's query string is the sole credential), then report the
 * public URL up. `clubId` absent means "minting a new club"; present means
 * "replacing an existing club's image".
 */
export function ImageUpload({
  kind,
  clubId,
  currentUrl,
  onUploaded,
}: {
  kind: ImageKind;
  clubId?: string;
  currentUrl?: string | null;
  onUploaded: (publicUrl: string, clubId: string) => void;
}) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<string | null>(currentUrl ?? null);
  const inputId = useId();
  const label = kind === 'club-logo' ? 'Logo' : 'Banner';

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setState('converting');
    setMessage('');
    try {
      const blob = await convertToWebp(file, kind);

      setState('uploading');
      let signedUrl: string;
      let publicUrl: string;
      let resolvedClubId: string;
      if (clubId) {
        const minted = await mintClubEditUpload(clubId, kind);
        ({ signedUrl, publicUrl } = minted);
        resolvedClubId = clubId;
      } else {
        const minted = await mintClubLogoUpload();
        ({ signedUrl, publicUrl, clubId: resolvedClubId } = minted);
      }

      const res = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/webp' },
        body: blob,
      });
      if (!res.ok) throw new Error('The upload was refused. Try again.');

      setPreview(publicUrl);
      setState('done');
      onUploaded(publicUrl, resolvedClubId);
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
          className="inline-flex h-8 cursor-pointer items-center rounded-control border border-border-control px-2.5 text-sm font-medium text-ink hover:bg-surface-2"
        >
          {label}
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

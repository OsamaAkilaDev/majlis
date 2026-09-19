import { cn } from '@/lib/cn';

/**
 * A hue in [0, 360), derived from the club id. FNV-1a, so two clubs whose ids
 * differ by one character land far apart rather than next to each other.
 */
export function clubHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/**
 * The banner always draws. Most clubs have never uploaded artwork, and the
 * page opened on a bare heading whenever they had not; the generated ground
 * is derived from the club id, so a club keeps the same face everywhere.
 *
 * Fixed lightness rather than theme tokens, like `--auth-ground`: the scrim
 * and the crest sitting on it are white in both themes.
 */
export function ClubBanner({
  clubId,
  bannerUrl,
  className,
}: {
  clubId: string;
  bannerUrl: string | null;
  className?: string;
}) {
  const box = cn('relative aspect-[8/3] w-full overflow-hidden bg-surface-2', className);

  if (bannerUrl) {
    return (
      <div className={box}>
        <img src={bannerUrl} alt="" className="size-full object-cover" />
        <Scrim />
      </div>
    );
  }

  const a = clubHue(clubId);
  return (
    <div
      className={box}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${a} 36% 20%), hsl(${(a + 38) % 360} 44% 34%))`,
      }}
    >
      <span aria-hidden className="lattice absolute inset-0 [--lattice:255_255_255] [--lattice-alpha:.07]" />
      <Scrim />
    </div>
  );
}

/** Carries the crest and the name that overlap the banner's foot. */
function Scrim() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-[rgba(10,30,27,.72)] to-transparent"
    />
  );
}

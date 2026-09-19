import { imageAspectRatio } from '@majlis/contracts';
import { cn } from '@/lib/cn';

/** Whatever `club-banner` uploads are cropped to, so the box a page reserves
 *  and the bytes that land in it are the same shape. */
const RATIO = imageAspectRatio('club-banner');

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
  // A floor, not a second ratio: the artwork is still 4:1 and still validated
  // at 4:1, but 4:1 of a 288px column is 72px, which is shorter than the crest
  // that sits on it. Below sm the box keeps a usable height and `object-cover`
  // shows the middle of the same image.
  const box = cn('relative min-h-28 w-full overflow-hidden bg-surface-2 sm:min-h-0', className);

  if (bannerUrl) {
    return (
      <div className={box} style={{ aspectRatio: RATIO }}>
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
        aspectRatio: RATIO,
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

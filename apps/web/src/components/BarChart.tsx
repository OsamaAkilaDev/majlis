import { barPercents } from '@/lib/chart';

export interface Bar {
  label: string;
  value: number;
}

const ROW = 34;
const BASELINE = 10;
const TRACK_Y = 16;
const TRACK_H = 8;

/**
 * Inline SVG, no charting dependency: a handful of counts would cost more
 * bundle in a library than the whole page.
 *
 * Nothing is encoded by colour alone, and status colours stay reserved for
 * state rather than becoming series colours. Widths are percentages so the
 * chart reflows without scaling the type down with it.
 */
export function BarChart({ title, bars }: { title: string; bars: Bar[] }) {
  const percents = barPercents(bars.map((b) => b.value));
  const summary = bars.map((b) => `${b.label} ${b.value}`).join(', ');

  return (
    <section className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
      <h2 className="font-display text-h2 text-ink">{title}</h2>

      {bars.length === 0 ? (
        <p className="text-sm text-ink-3">No data</p>
      ) : (
        <svg
          role="img"
          aria-label={`${title}. ${summary}.`}
          width="100%"
          height={bars.length * ROW}
          className="block"
        >
          {bars.map((bar, i) => {
            const y = i * ROW;
            return (
              <g key={bar.label}>
                <text x="0" y={y + BASELINE} fontSize="12" fill="var(--ink-2)">
                  {bar.label}
                </text>
                <text
                  x="100%"
                  y={y + BASELINE}
                  fontSize="12"
                  textAnchor="end"
                  fill="var(--ink)"
                  className="tabular"
                >
                  {bar.value}
                </text>
                <rect x="0" y={y + TRACK_Y} width="100%" height={TRACK_H} rx={TRACK_H / 2} fill="var(--surface-2)" />
                <rect
                  x="0"
                  y={y + TRACK_Y}
                  width={`${percents[i] ?? 0}%`}
                  height={TRACK_H}
                  rx={TRACK_H / 2}
                  fill="var(--s1)"
                />
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}

/** A single figure, beside the charts that break it down. */
export function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border bg-surface p-4">
      <span className="text-label font-semibold uppercase text-ink-3">{label}</span>
      <span className="tabular font-display text-title text-ink">{value}</span>
    </div>
  );
}

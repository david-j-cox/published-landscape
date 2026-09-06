/**
 * Citations received per year: one bar per year, one series.
 *
 * A bar rather than a line because the quantity is a count of events in a
 * year, not a level that existed between the years. No legend: with one
 * series the caption names it, and a colored key beside a single color says
 * nothing. The only direct labels are the tallest year and the last one --
 * a number over every bar is noise at this size, and those two are the ones
 * a reader is looking for.
 *
 * The ink is the same sky the For Nerds figures use, through Tailwind's
 * dark-mode classes, so the chart follows the theme without measuring it.
 */
export function CitationHistory({
  points,
  height = 56,
  className = "",
  unit = "citation",
  unitPlural,
}: {
  points: { year: number; count: number }[];
  height?: number;
  className?: string;
  /** What one bar counts, for the tooltip and the screen-reader summary. */
  unit?: string;
  unitPlural?: string;
}) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.count), 1);
  const peak = points.reduce((best, p) => (p.count > best.count ? p : best), points[0]);
  const last = points[points.length - 1];

  // A 2px gap between bars, as a share of the slot, so the bars stay thin at
  // any count of years and never touch.
  const slot = 100 / points.length;
  const gap = Math.min(slot * 0.25, 2);
  const barW = slot - gap;
  // Room above the bars for the two labels, and below for the year axis.
  const top = 12;
  const bottom = 12;
  const plot = height - top - bottom;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      role="img"
      aria-label={`${unitPlural ?? `${unit}s`} per year, ${points[0].year} to ${last.year}, peaking at ${peak.count} in ${peak.year}.`}
    >
      {points.map((p, i) => {
        const h = (p.count / max) * plot;
        const x = i * slot + gap / 2;
        return (
          <g key={p.year}>
            <rect
              x={x}
              y={top + plot - h}
              width={barW}
              height={Math.max(h, p.count > 0 ? 0.75 : 0)}
              rx={0.6}
              className="fill-sky-600 dark:fill-sky-400"
            >
              <title>{`${p.year}: ${p.count} ${p.count === 1 ? unit : (unitPlural ?? `${unit}s`)}`}</title>
            </rect>
          </g>
        );
      })}
      {/* The baseline, recessive: the bars are the data, this only anchors them. */}
      <line
        x1={0}
        x2={100}
        y1={top + plot}
        y2={top + plot}
        stroke="currentColor"
        strokeWidth={0.3}
        className="text-neutral-300 dark:text-neutral-700"
      />
    </svg>
  );
}

/**
 * The years under a CitationHistory, as text rather than SVG.
 *
 * The chart is drawn with preserveAspectRatio="none" so it fills whatever
 * width it is given, which would stretch any text inside it. Labels live
 * outside for that reason.
 */
export function CitationHistoryAxis({
  points,
  peakLabel = true,
}: {
  points: { year: number; count: number }[];
  peakLabel?: boolean;
}) {
  if (points.length === 0) return null;
  const peak = points.reduce((best, p) => (p.count > best.count ? p : best), points[0]);
  const last = points[points.length - 1];
  return (
    <div className="flex justify-between text-[11px] text-neutral-400">
      <span>{points[0].year}</span>
      {peakLabel && (
        <span>
          peak {peak.count} in {peak.year}
        </span>
      )}
      <span>{last.year}</span>
    </div>
  );
}

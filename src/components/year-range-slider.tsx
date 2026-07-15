"use client";

// Dual-thumb year range for the topic map. Two overlaid native range inputs
// (transparent tracks, only their thumbs catch pointer events) sit on top of a
// shared track with a highlighted selected span, so it reads as one slider.
export function YearRangeSlider({
  min,
  max,
  value,
  onChange,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
}) {
  const [lo, hi] = value;
  const span = max - min || 1;
  const pct = (v: number) => ((v - min) / span) * 100;

  return (
    <div className="year-range">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-semibold text-neutral-500">Years</span>
        <span className="tabular-nums text-neutral-600 dark:text-neutral-300">
          {lo}–{hi}
        </span>
      </div>
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-neutral-800 dark:bg-neutral-300"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={lo}
          aria-label="Earliest year"
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className="year-thumb"
          // When both thumbs coincide at the top end, keep the min thumb on top
          // so it can still be dragged back down.
          style={{ zIndex: lo >= max ? 4 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={hi}
          aria-label="Latest year"
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className="year-thumb"
        />
      </div>
      <style jsx>{`
        .year-thumb {
          position: absolute;
          inset: 0;
          width: 100%;
          margin: 0;
          background: transparent;
          -webkit-appearance: none;
          appearance: none;
          pointer-events: none;
        }
        .year-thumb::-webkit-slider-thumb {
          -webkit-appearance: none;
          pointer-events: auto;
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          background: #ffffff;
          border: 2px solid #525252;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
        .year-thumb::-moz-range-thumb {
          pointer-events: auto;
          height: 13px;
          width: 13px;
          border-radius: 9999px;
          background: #ffffff;
          border: 2px solid #525252;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </div>
  );
}

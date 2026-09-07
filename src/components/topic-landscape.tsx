"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REACH_DARK,
  REACH_LIGHT,
  REACH_UNKNOWN,
  reachBand,
  type ColorMode,
} from "@/lib/map-colors";

export type Cone = {
  clusterId: number;
  label: string;
  cx: number;
  cy: number;
  radius: number;
  count: number;
};

/** A cone's radius at its mouth, and at any year between. */
const mouthRadius = (c: Cone) => c.radius * WIDTH;
const radiusAt = (c: Cone, t: number) => (mouthRadius(c) / TAPER) * (1 + (TAPER - 1) * t);
export type Spot = {
  cone: number;
  angle: number;
  /** Distance from the cone's axis, as a fraction of its radius. */
  spread: number;
  year: number;
  isReview: boolean;
  reviewedBy: number;
  journalId: number;
  reach: number;
};

/** Top radius over bottom, as in the single cone, so the two read alike. */
const TAPER = 2.2;
/*
 * How wide a cone stands against its cluster's disc on the map.
 *
 * At 1 the mouth is exactly the cluster's own footprint, which is what
 * guaranteed no two cones touched -- 946 pairs measured, the tightest
 * separated by 1.02. At 1.5 the closest few do overlap a little, and that is
 * the trade for cones that read as volumes rather than tubes now that the
 * height has come down.
 */
const WIDTH = 1.5;
const TURN_SECONDS = 90;
const START_PITCH = -0.45;
const START_YAW = 0.6;

/**
 * The field of cones.
 *
 * The flat map shows what is near what. A cone shows when a topic happened.
 * This is both at once: every topic standing at its own place on the map, each
 * rising through the same year axis, so the shape of the field over time is
 * one picture rather than forty-four.
 *
 * The projection is the single cone's, with a per-cone offset: model space is
 * the map's x and y with one unit per year as z, rotated by yaw and pitch and
 * divided for perspective. Hand-rolled, no 3D library, for the same reason as
 * before -- it is a few thousand points and some rings.
 *
 * Citations are deliberately absent here. All 13,062 of them at ten segments
 * each is 130,000 segments a frame, five times what already had to be cut back
 * to stop the single cone stuttering. At this distance the question is shape
 * and time; who cites whom is a question for one topic, and clicking a cone
 * goes there.
 */
export function TopicLandscape({
  cones,
  points,
  minYear,
  maxYear,
  colorMode,
  hiddenClusters,
  hiddenJournals,
  yearRange,
  journalColor,
  resetRef,
}: {
  cones: Cone[];
  points: Spot[];
  minYear: number;
  maxYear: number;
  /** Shared with the flat map, so the legend means the same thing in both. */
  colorMode: ColorMode;
  hiddenClusters: Set<number>;
  hiddenJournals: Set<number>;
  yearRange: [number, number];
  journalColor: (journalId: number) => string;
  /**
   * Somewhere for the map's own Reset view to reach the camera.
   *
   * That button lives in the aside, which belongs to the map, and in the field
   * it was calling a method on a canvas that is not mounted -- so it silently
   * did nothing. Which mattered: scrolling far enough in puts the camera
   * inside the geometry and the screen goes dark, and Reset view is the way
   * out. Without it the only way back was a reload.
   */
  resetRef?: { current: (() => void) | null };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [spinning, setSpinning] = useState(true);
  const [hover, setHover] = useState<{ label: string; count: number; x: number; y: number } | null>(
    null,
  );

  const yaw = useRef(START_YAW);
  const pitch = useRef(START_PITCH);
  const zoom = useRef(1);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const frame = useRef<number | null>(null);
  const spinRef = useRef(true);
  useEffect(() => {
    spinRef.current = spinning;
  }, [spinning]);

  /** Where each cone's mouth landed, for hit-testing. */
  const mouthsRef = useRef<
    { sx: number; sy: number; r: number; bx: number; by: number; br: number; cone: Cone }[]
  >([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    /*
     * Half resolution and a coarser scene while moving, for the reason the
     * single cone learned the hard way: this drawing is fill-bound, and
     * devicePixelRatio squares the pixel count.
     */
    const moving = spinRef.current || drag.current !== null;
    const ratio = moving ? 1 : window.devicePixelRatio || 1;
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (cones.length === 0) return;

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const wallInk = isDark ? "rgba(150,180,220,0.13)" : "rgba(70,110,160,0.16)";
    const dotInk = isDark ? "#8b96a3" : "#6b7480";
    const citedInk = isDark ? "#4d7398" : "#5a7fa6";
    const reviewInk = "#2f9bff";
    const labelInk = isDark ? "rgba(230,237,245,0.9)" : "rgba(25,30,40,0.9)";
    const labelHalo = isDark ? "rgba(10,10,10,0.85)" : "rgba(250,250,250,0.9)";

    const span = Math.max(1, maxYear - minYear);
    const midYear = (minYear + maxYear) / 2;

    // The field's own extent, so the height reads against the width.
    let widest = 0;
    for (const c of cones) widest = Math.max(widest, Math.hypot(c.cx, c.cy) + mouthRadius(c));
    /*
     * How tall a cone stands.
     *
     * Was 0.55 of the field's own width over the year span, which drew tubes
     * far taller than they were wide with a lot of empty height between the
     * years. A quarter puts the field at something closer to a table of
     * objects than a forest of poles, which is what a reader is looking down
     * at from above.
     */
    const zScale = (widest * 0.26) / span;

    const cy0 = Math.cos(yaw.current);
    const sy0 = Math.sin(yaw.current);
    const cp0 = Math.cos(pitch.current);
    const sp0 = Math.sin(pitch.current);
    const half = Math.max(widest, (span * zScale) / 2);
    const cam = half * 3.4;
    const halfW = w / 2;
    const halfH = h / 2;

    // Fitted from the field's corners so the scene fills the box at any angle.
    let maxU = 1e-6;
    let maxV = 1e-6;
    const rawU = (mx: number, my: number, mz: number) => {
      const x1 = mx * cy0 - my * sy0;
      const z1 = mx * sy0 + my * cy0;
      const z2 = mz * sp0 + z1 * cp0;
      return x1 * (cam / Math.max(cam * 0.55, cam + z2));
    };
    const rawV = (mx: number, my: number, mz: number) => {
      const z1 = mx * sy0 + my * cy0;
      const y2 = mz * cp0 - z1 * sp0;
      const z2 = mz * sp0 + z1 * cp0;
      return -y2 * (cam / Math.max(cam * 0.55, cam + z2));
    };
    for (const c of cones) {
      for (const at of [0, 1]) {
        const rr = radiusAt(c, at);
        const mz = ((at ? maxYear : minYear) - midYear) * zScale;
        for (let k = 0; k < 8; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          maxU = Math.max(maxU, Math.abs(rawU(c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr, mz)));
          maxV = Math.max(maxV, Math.abs(rawV(c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr, mz)));
        }
      }
    }
    /*
     * Fill the height, not just the width.
     *
     * The field is wide and flat now that the cones have been shortened, and
     * the box it sits in is tall, so fitting to whichever side binds meant
     * fitting to the width and leaving a third of the height empty above and
     * below. The scene looked small in a large frame.
     *
     * Fitted to the height instead, and the width allowed to run well past the
     * edges: at a tenth the width still bound and the field only grew by 1.17,
     * where the ask was half again. At 1.4 it grows by about 1.5 and the
     * outermost cone or two -- the far outliers, not the body of the field --
     * reach past the sides at full zoom. Scrolling zooms back out.
     */
    const scale =
      Math.min((halfH / maxV) * 0.98, (halfW / maxU) * 1.4) * zoom.current;

    const px = (mx: number, my: number, mz: number) => halfW + rawU(mx, my, mz) * scale;
    const py = (mx: number, my: number, mz: number) => halfH + rawV(mx, my, mz) * scale;
    const depthAt = (mx: number, my: number, mz: number) => {
      const z1 = mx * sy0 + my * cy0;
      return mz * sp0 + z1 * cp0;
    };

    /*
     * The walls: two rings and a few ribs per cone, no more.
     *
     * Forty-four cones at the single view's detail would be fourteen thousand
     * segments before a single article is drawn. Two rings and six ribs is
     * enough to read a funnel at this distance, and it is what keeps the whole
     * field inside the budget one cone used to take.
     */
    const RING = moving ? 14 : 22;
    const visible = cones.filter((c) => !hiddenClusters.has(c.clusterId));
    const walls = new Path2D();
    for (const c of visible) {
      for (const at of [0, 1]) {
        const rr = radiusAt(c, at);
        const mz = ((at ? maxYear : minYear) - midYear) * zScale;
        for (let k = 0; k <= RING; k += 1) {
          const a = (k / RING) * Math.PI * 2;
          const x = px(c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr, mz);
          const y = py(c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr, mz);
          if (k === 0) walls.moveTo(x, y);
          else walls.lineTo(x, y);
        }
      }
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2;
        const lo = radiusAt(c, 0);
        walls.moveTo(
          px(c.cx + Math.cos(a) * lo, c.cy + Math.sin(a) * lo, (minYear - midYear) * zScale),
          py(c.cx + Math.cos(a) * lo, c.cy + Math.sin(a) * lo, (minYear - midYear) * zScale),
        );
        walls.lineTo(
          px(c.cx + Math.cos(a) * mouthRadius(c), c.cy + Math.sin(a) * mouthRadius(c), (maxYear - midYear) * zScale),
          py(c.cx + Math.cos(a) * mouthRadius(c), c.cy + Math.sin(a) * mouthRadius(c), (maxYear - midYear) * zScale),
        );
      }
    }
    ctx.strokeStyle = wallInk;
    ctx.lineWidth = 0.7;
    ctx.stroke(walls);

    /*
     * The articles, batched by depth into a few paths, as the single cone
     * batches its cloud: one fill per band rather than one per article.
     */
    const BANDS = 6;
    /*
     * In topic mode the cloud is batched by depth, as before. In journal and
     * reach mode a point's colour is its own, so the batching is by colour
     * instead and depth is carried by the alpha of each pass. Either way it is
     * a handful of fills rather than nine thousand.
     */
    const byColour = new Map<string, Path2D>();
    const bulk = Array.from({ length: BANDS }, () => new Path2D());
    const cited = Array.from({ length: BANDS }, () => new Path2D());
    const reviews = new Path2D();
    const [loYear, hiYear] = yearRange;
    const filtered = loYear > minYear || hiYear < maxYear;
    for (const p of points) {
      const c = cones[p.cone];
      if (hiddenClusters.has(c.clusterId) || hiddenJournals.has(p.journalId)) continue;
      if (filtered && (p.year < loYear || p.year > hiYear)) continue;
      const t = (p.year - minYear) / span;
      /*
       * The wall at this article's year, times how far out it sits on the map.
       *
       * Both halves of its map position are kept: the bearing, and the
       * distance from the middle of its topic. So the cone is a volume with
       * the map inside it rather than a shell with the map wrapped round it --
       * an article at the centre of its topic is on the axis, one at the edge
       * is against the wall, and the taper carries the year.
       */
      const rr = radiusAt(c, t) * p.spread;
      const mx = c.cx + Math.cos(p.angle) * rr;
      const my = c.cy + Math.sin(p.angle) * rr;
      const mz = (p.year - midYear) * zScale;
      const x = px(mx, my, mz);
      const y = py(mx, my, mz);
      if (colorMode !== "topic") {
        const ink =
          colorMode === "journal"
            ? journalColor(p.journalId)
            : (() => {
                const band = reachBand(p.reach);
                if (band === null) return REACH_UNKNOWN;
                return (isDark ? REACH_DARK : REACH_LIGHT)[band];
              })();
        let path = byColour.get(ink);
        if (!path) byColour.set(ink, (path = new Path2D()));
        path.moveTo(x + 1.3, y);
        path.arc(x, y, 1.3, 0, Math.PI * 2);
        continue;
      }
      if (p.isReview) {
        reviews.moveTo(x + 1.7, y);
        reviews.arc(x, y, 1.7, 0, Math.PI * 2);
        continue;
      }
      const near = (depthAt(mx, my, mz) + half) / (half * 2);
      const band = Math.min(BANDS - 1, Math.max(0, Math.round(near * (BANDS - 1))));
      const into = p.reviewedBy > 0 ? cited : bulk;
      into[band].moveTo(x + 1.1, y);
      into[band].arc(x, y, 1.1, 0, Math.PI * 2);
    }
    if (colorMode !== "topic") {
      ctx.globalAlpha = 0.75;
      for (const [ink, path] of byColour) {
        ctx.fillStyle = ink;
        ctx.fill(path);
      }
      ctx.globalAlpha = 1;
    }
    if (colorMode === "topic") {
      ctx.fillStyle = dotInk;
      bulk.forEach((path, band) => {
        ctx.globalAlpha = 0.25 + (band / (BANDS - 1)) * 0.5;
        ctx.fill(path);
      });
      ctx.fillStyle = citedInk;
      cited.forEach((path, band) => {
        ctx.globalAlpha = 0.35 + (band / (BANDS - 1)) * 0.5;
        ctx.fill(path);
      });
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = reviewInk;
      ctx.fill(reviews);
      ctx.globalAlpha = 1;
    }

    /*
     * Labels on the mouth of each cone, nearest last, and anything that would
     * land on a name already placed is skipped. Same rule the flat map uses:
     * forty-four names at this size cover the thing they are naming.
     */
    const mouths = visible
      .map((c) => {
        const topZ = (maxYear - midYear) * zScale;
        const baseZ = (minYear - midYear) * zScale;
        return {
          cone: c,
          sx: px(c.cx, c.cy, topZ),
          sy: py(c.cx, c.cy, topZ),
          r: Math.abs(px(c.cx + mouthRadius(c), c.cy, topZ) - px(c.cx, c.cy, topZ)),
          bx: px(c.cx, c.cy, baseZ),
          by: py(c.cx, c.cy, baseZ),
          br: Math.abs(px(c.cx + radiusAt(c, 0), c.cy, baseZ) - px(c.cx, c.cy, baseZ)),
          depth: depthAt(c.cx, c.cy, topZ),
        };
      })
      .sort((a, b) => a.depth - b.depth);
    /*
     * The whole silhouette is the target, not the middle of the top disc.
     *
     * It was the top disc's centre within its own radius, so everything below
     * the mouth -- the wall, the articles, most of what anyone would point at
     * -- was not clickable at all, and a click landed on nothing. A cone is a
     * tapered body between two centres, so the test is distance to that axis
     * against the radius at whatever height the pointer is level with.
     */
    mouthsRef.current = mouths.map((m) => ({
      sx: m.sx,
      sy: m.sy,
      r: m.r,
      bx: m.bx,
      by: m.by,
      br: m.br,
      cone: m.cone,
    }));

    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    const placed: { x: number; y: number; w: number }[] = [];
    for (const m of [...mouths].reverse()) {
      const words = m.cone.label.split(", ").slice(0, 2).join(", ");
      const wide = ctx.measureText(words).width;
      /*
       * Clamped, because m.r is a projected radius and perspective makes it
       * enormous for a cone close to the camera -- which is how one label
       * ended up floating half a screen above the field with nothing under
       * it. The label only needs to clear the rim, and past forty pixels it
       * is no longer clearing anything, just leaving.
       */
      const y = m.sy - Math.min(m.r, 40) - 6;
      if (placed.some((q) => Math.abs(q.x - m.sx) < (q.w + wide) / 2 + 6 && Math.abs(q.y - y) < 13))
        continue;
      placed.push({ x: m.sx, y, w: wide });
      ctx.lineWidth = 3;
      ctx.strokeStyle = labelHalo;
      ctx.strokeText(words, m.sx, y);
      ctx.fillStyle = labelInk;
      ctx.fillText(words, m.sx, y);
    }
  }, [cones, points, minYear, maxYear, colorMode, hiddenClusters, hiddenJournals, yearRange, journalColor]);

  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      drawRef.current();
    });
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let painted = 0;
    const MIN_FRAME_MS = 1000 / 30;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (spinRef.current && !drag.current) {
        yaw.current += (Math.PI * 2 * dt) / TURN_SECONDS;
        if (now - painted >= MIN_FRAME_MS) {
          painted = now;
          drawRef.current();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    schedule();
  }, [schedule, draw]);
  useEffect(() => {
    if (!spinning) schedule();
  }, [spinning, schedule]);

  const reset = useCallback(() => {
    yaw.current = START_YAW;
    pitch.current = START_PITCH;
    zoom.current = 1;
    setHover(null);
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (!resetRef) return;
    resetRef.current = reset;
    return () => {
      resetRef.current = null;
    };
  }, [resetRef, reset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(() => schedule());
    obs.observe(canvas);
    return () => obs.disconnect();
  }, [schedule]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const nearest = (mx: number, my: number) => {
      let best: { cone: Cone; d: number } | null = null;
      for (const m of mouthsRef.current) {
        // Where along the axis the pointer sits, clamped to the two ends.
        const ax = m.bx - m.sx;
        const ay = m.by - m.sy;
        const len = ax * ax + ay * ay;
        const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((mx - m.sx) * ax + (my - m.sy) * ay) / len));
        const nx = m.sx + ax * t;
        const ny = m.sy + ay * t;
        const d = (nx - mx) ** 2 + (ny - my) ** 2;
        const reach = Math.max(m.r + (m.br - m.r) * t, 10);
        if (d < reach ** 2 && (!best || d < best.d)) best = { cone: m.cone, d };
      }
      return best?.cone ?? null;
    };
    const onDown = (e: MouseEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, yaw: yaw.current, pitch: pitch.current };
      setHover(null);
      if (spinRef.current) setSpinning(false);
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      schedule();
    };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (drag.current) {
        yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * 0.008;
        pitch.current = Math.max(
          -1.3,
          Math.min(1.3, drag.current.pitch + (e.clientY - drag.current.y) * 0.006),
        );
        schedule();
        return;
      }
      const c = nearest(mx, my);
      setHover((prev) => {
        if (!c) return prev === null ? prev : null;
        if (prev && prev.label === c.label) return prev;
        return { label: c.label, count: c.count, x: mx + 12, y: my + 12 };
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = Math.min(8, Math.max(0.4, zoom.current * (e.deltaY < 0 ? 1.1 : 0.91)));
      schedule();
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [schedule]);

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-3 text-[0.7rem] text-neutral-500 dark:text-neutral-400">
        <span>
          {cones.length} topics, {points.length.toLocaleString()} articles, {minYear}&ndash;
          {maxYear}
        </span>
        <button
          type="button"
          onClick={() => setSpinning(!spinning)}
          className="underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          {spinning ? "Stop" : "Spin"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Reset view
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="h-[calc(100vh-190px)] w-full cursor-grab active:cursor-grabbing"
        aria-label="Every topic as a cone, standing on the map, with height as the year"
      />
      {hover && (
        <span
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1 text-[0.7rem] leading-snug shadow dark:border-neutral-700 dark:bg-neutral-900"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.label} &middot; {hover.count}
        </span>
      )}
      <p className="mt-1.5 text-[0.7rem] text-neutral-500 dark:text-neutral-400">
        Height is the year, so a stump is a topic that stopped and a funnel is one still
        being published. Drag to turn, scroll to zoom. Pick a topic in the legend to open
        its citations.
      </p>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
export interface Point {
  x: number;
  y: number;
  y0: number | null;
  t: string;
  r: number;
  /** DOI without the resolver prefix, so a clicked article can be opened. */
  d?: string | null;
  /**
   * Reviews in this corpus that cite it. Absent means none, which is most.
   *
   * "Cited by", not "covered by": a synthesis cites what it synthesised and
   * what it read to write its introduction, and nothing separates the two.
   */
  n?: number;
}

/** Cited by at least one review here. */
function gathered(p: Point): boolean {
  return (p.n ?? 0) > 0;
}

/**
 * How far above the cone the camera sits.
 *
 * Negative: the camera sits a little *below* the mouth, looking up into the
 * funnel. Chosen by hand in the Trellis view rather than inferred from
 * screenshots, which never once got the sign right -- two screenshots of the
 * same topic differ by zoom and by wherever the spin had reached as well as
 * by the angle.
 */
const START_PITCH = -0.316;

/**
 * Where the same fit put the turn.
 *
 * It matters less than the pitch, since the view turns on its own and this is
 * only the first frame, but it is what keeps the year labels clear of the
 * article cloud: they are drawn at (0, r), which projects to -r*sin(yaw), so
 * at yaw zero and at half a turn the whole column of years lands down the
 * middle of the cloud.
 */
const START_YAW = 4.375 - Math.PI * 2;
/** A full turn every this many seconds while nobody is dragging. */
const TURN_SECONDS = 40;

/**
 * Top radius over bottom radius.
 *
 * The rings were all one size, which drew a cylinder and cut through the
 * cloud at odd angles -- the shape read as off kilter because it was
 * describing a volume the articles do not occupy. A literature starts narrow
 * and widens as more of it is published, so the surface should too. As in the
 * historyBehaviorAnalysis landscape this is not fitted to the data, which does
 * not widen monotonically; it is the narrowest cone of a fixed taper that
 * still contains every article, plus a margin.
 */
const TAPER = 2.2;
const MARGIN = 1.06;

/**
 * Where to put a tooltip for a point at (x, y) in a box `w` wide.
 *
 * Offset from the cursor so it does not cover the article it describes, and
 * flipped to the left of the cursor near the right edge, where it would
 * otherwise run under the panel beside the box.
 */
function place(x: number, y: number, w: number, tip: number) {
  return { x: x + 12 + tip > w ? Math.max(4, x - 12 - tip) : x + 12, y: y + 12 };
}

/**
 * One topic, with time as the third dimension.
 *
 * The flat map answers "what is near what". It cannot answer "when did this
 * happen", and for an editor judging whether a literature is live that is
 * half the question -- a topic that stopped years ago and one still being
 * published are the same dot cloud from above.
 *
 * The projection is ported from the historyBehaviorAnalysis landscape: model
 * space is x and y from the topic layout with z one unit per year, rotated by
 * yaw and pitch, then divided for perspective. Hand-rolled rather than a 3D
 * library, because the whole scene is a few thousand points and some rings,
 * and a library would be more bytes than the corpus page it sits on.
 */
export default function TopicCone({
  points,
  label,
  onClose,
}: {
  points: Point[];
  label: string;
  onClose: () => void;
}) {
  /*
   * Which way the cone faces when it opens. Fixed here rather than stored:
   * these angles were chosen by hand and they suit this corpus, and the
   * "Save this angle" button they arrived with was backed by an editable-copy
   * table this app has no access to.
   */
  const openYaw = START_YAW;
  const openPitch = START_PITCH;
  const openZoom = 1;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ title: string; x: number; y: number } | null>(null);
  /** A clicked article, held until dismissed, so its link can be followed. */
  const [picked, setPicked] = useState<
    { title: string; doi: string | null; x: number; y: number } | null
  >(null);
  const [spinning, setSpinning] = useState(true);
  /**
   * Which kind of article to show.
   *
   * Reviews alone is the useful one: a few dozen among a thousand is a needle
   * in a haystack even colored, and "has anybody reviewed this, and when" is
   * a question the whole cloud actively obscures.
   */
  const [kind, setKind] = useState<"all" | "reviews" | "articles" | "open">("all");

  const yaw = useRef(openYaw);
  const pitch = useRef(openPitch);
  const zoom = useRef(openZoom);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const frame = useRef<number | null>(null);
  const spinRef = useRef(true);
  // Mirrored into a ref for the animation loop and the pointer handlers,
  // which are bound once and would otherwise close over the first value.
  // Written in an effect rather than during render: this project's lint
  // forbids the latter, and after commit is soon enough for both readers.
  useEffect(() => {
    spinRef.current = spinning;
  }, [spinning]);

  /*
   * Memoised, and it matters more than it looks.
   *
   * These were plain filters, so both arrays were new objects on every
   * render, so draw() was a new function on every render, so every effect
   * keyed on it tore itself down and rebuilt: the spin loop, the canvas
   * listeners, the resize observer. On a topic with a couple of thousand
   * articles that is a lot of work to do because a tooltip appeared.
   */
  const dated = useMemo(
    () =>
      points.filter(
        (p) =>
          p.y0 !== null &&
          (kind === "all"
            ? true
            : kind === "reviews"
              ? p.r === 1
              : kind === "open"
                ? // The ground nobody has gathered up: an article no review
                  // here cites, and not itself a review.
                  p.r !== 1 && !gathered(p)
                : p.r !== 1),
      ),
    [points, kind],
  );
  // The cone itself is sized from every article, so switching the filter does
  // not resize the funnel underneath. A reviews-only view of the same topic
  // should sit in the same shape, or the years stop being comparable.
  const all = useMemo(() => points.filter((p) => p.y0 !== null), [points]);
  /** Whether this corpus knows about citations at all. */
  const anyCited = useMemo(() => points.some(gathered), [points]);
  /** Where each article landed on screen, for hit-testing the hover. */
  const projectedRef = useRef<
    { sx: number; sy: number; title: string; doi: string | null; review: boolean }[]
  >([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    /*
     * The rings and their labels were drawn in a pale blue chosen against a
     * near-black canvas. This app's canvas is near-white in light mode, where
     * that reads as nothing at all, so the structural ink is picked against
     * the ground the same way the topic map picks its own.
     */
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const planeFill = isDark ? "rgba(124,168,214,0.055)" : "rgba(70,110,160,0.05)";
    const planeEdge = isDark ? "rgba(150,180,220,0.16)" : "rgba(70,110,160,0.22)";
    const ribs = isDark ? "rgba(150,180,220,0.07)" : "rgba(70,110,160,0.12)";
    const yearInk = isDark ? "rgba(160,190,225,0.65)" : "rgba(60,90,130,0.75)";
    const bulkInk = isDark ? "#8b96a3" : "#6b7480";
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Cleared and then nothing: the shape is derived from these, and an
    // average over none of them is NaN, which draws as a blank canvas full of
    // silent errors rather than as an empty one.
    if (all.length === 0) return;

    const years = all.map((p) => p.y0 as number);
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const midYear = (minYear + maxYear) / 2;
    const span = Math.max(1, maxYear - minYear);
    const meanX = all.reduce((s, p) => s + p.x, 0) / all.length;
    const meanY = all.reduce((s, p) => s + p.y, 0) / all.length;

    // Time reads as the vertical, so a year is a height and the spread at that
    // height is how varied the work was. Scaled so the cloud is about as tall
    // as it is wide, whatever the topic's date range happens to be.
    let widest = 0;
    for (const p of all) widest = Math.max(widest, Math.hypot(p.x - meanX, p.y - meanY));
    widest = Math.max(widest, 1e-6);
    const zScale = (widest * 2.2) / span;

    // The narrowest cone of this taper that still holds every article.
    let baseRadius = 0;
    for (const p of all) {
      const rr = Math.hypot(p.x - meanX, p.y - meanY);
      const at = ((p.y0 as number) - minYear) / span;
      baseRadius = Math.max(baseRadius, rr / (1 + (TAPER - 1) * at));
    }
    baseRadius *= MARGIN;
    const radiusAt = (year: number) =>
      baseRadius * (1 + (TAPER - 1) * ((year - minYear) / span));
    const radius = radiusAt(maxYear);

    const cy = Math.cos(yaw.current);
    const sy = Math.sin(yaw.current);
    const cp = Math.cos(pitch.current);
    const sp = Math.sin(pitch.current);

    const half = Math.max(radius, (span * zScale) / 2);
    const cam = half * 3.2;

    // The unscaled projection: model space to a camera-relative offset from
    // the middle of the box, in the same units the model uses.
    const raw = (mx: number, my: number, mz: number) => {
      const x1 = mx * cy - my * sy;
      const z1 = mx * sy + my * cy;
      const y2 = mz * cp - z1 * sp;
      const z2 = mz * sp + z1 * cp;
      // Guarded so a point level with the camera cannot divide by zero and
      // fling itself off screen.
      const q = cam / Math.max(cam * 0.55, cam + z2);
      return { u: x1 * q, v: -y2 * q, depth: z2, q };
    };

    /*
     * Fitted to what the scene actually projects to, rather than to the
     * shorter side of the box.
     *
     * The box is whatever shape the column leaves it -- 361 by 718 on a
     * window with the inspector open -- and scaling by min(w, h) meant a
     * narrow column drew a small cone stranded in half a screen of empty
     * space. It also made the cone shrink as it was tilted, because tilting
     * foreshortens the vertical, which made choosing an angle feel like
     * choosing a size. Measuring the rim and fitting both axes fixes both.
     */
    let maxU = 1e-6;
    let maxV = 1e-6;
    for (let year = minYear; year <= maxYear; year += Math.max(1, span / 12)) {
      // 1.06 so the year labels, drawn just outside the rim, stay inside.
      const rr = radiusAt(year) * 1.06;
      const mz = (year - midYear) * zScale;
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const at = raw(Math.cos(a) * rr, Math.sin(a) * rr, mz);
        maxU = Math.max(maxU, Math.abs(at.u));
        maxV = Math.max(maxV, Math.abs(at.v));
      }
    }
    const scale =
      Math.min(w / 2 / maxU, h / 2 / maxV) * 0.97 * zoom.current;

    const project = (mx: number, my: number, mz: number) => {
      const { u, v, depth, q } = raw(mx, my, mz);
      return { sx: w / 2 + u * scale, sy: h / 2 + v * scale, depth, q };
    };

    /*
     * Decade markers as filled discs, not outlines.
     *
     * A ring is only its own edge, so from a shallow angle it reads as two
     * arcs floating in the cloud and the eye cannot tell which articles are
     * above a given year and which below. A translucent plane is a surface the
     * points visibly sit on or under, which is the whole question being asked
     * of the vertical axis.
     */
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    /*
     * Every five years rather than every ten. Over the window this app
     * shows, a
     * ten-year step draws exactly one plane, which gives the eye a single
     * height to read everything against and no sense of the scale between.
     */
    const YEAR_STEP = 5;
    for (
      let mark = Math.ceil(minYear / YEAR_STEP) * YEAR_STEP;
      mark <= maxYear;
      mark += YEAR_STEP
    ) {
      const mz = (mark - midYear) * zScale;
      const rr = radiusAt(mark);
      const rim: { sx: number; sy: number }[] = [];
      for (let k = 0; k <= 64; k++) {
        const a = (k / 64) * Math.PI * 2;
        rim.push(project(Math.cos(a) * rr, Math.sin(a) * rr, mz));
      }
      ctx.beginPath();
      rim.forEach((pt, k) => (k ? ctx.lineTo(pt.sx, pt.sy) : ctx.moveTo(pt.sx, pt.sy)));
      ctx.closePath();
      // Faint enough that a thousand articles still read through it, and the
      // edge kept so the plane has a defined boundary rather than a smudge.
      ctx.fillStyle = planeFill;
      ctx.fill();
      ctx.strokeStyle = planeEdge;
      ctx.lineWidth = 0.7;
      ctx.stroke();

      const lab = project(0, rr * 1.04, mz);
      ctx.fillStyle = yearInk;
      ctx.fillText(String(mark), lab.sx, lab.sy);
    }

    // Ribs between the rings, so the cone reads as a surface rather than as
    // hoops floating at each marked year.
    ctx.strokeStyle = ribs;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const lo = project(
        Math.cos(a) * radiusAt(minYear),
        Math.sin(a) * radiusAt(minYear),
        (minYear - midYear) * zScale,
      );
      const hi = project(
        Math.cos(a) * radiusAt(maxYear),
        Math.sin(a) * radiusAt(maxYear),
        (maxYear - midYear) * zScale,
      );
      ctx.beginPath();
      ctx.moveTo(lo.sx, lo.sy);
      ctx.lineTo(hi.sx, hi.sy);
      ctx.stroke();
    }

    // Painter's algorithm: furthest first, so nearer articles overlap them.
    const projected = dated
      .map((p) => ({
        p,
        ...project(p.x - meanX, p.y - meanY, ((p.y0 as number) - midYear) * zScale),
      }))
      .sort((a, b) => a.depth - b.depth);

    /*
     * Three tiers, drawn in two ways.
     *
     * The ordinary articles are the bulk -- eight thousand of them when the
     * cone is showing every group a topic reaches into -- and one path per
     * article means eight thousand begin/arc/fill cycles a frame. They are
     * batched instead: opacity is quantised into a few bands and each band is
     * one path, which keeps the depth cue and costs a handful of fills. The
     * reviews and the matched articles are few and are drawn individually,
     * because each carries a halo and a size that batching would flatten.
     */
    const BANDS = 8;
    const bulk: Path2D[] = Array.from({ length: BANDS }, () => new Path2D());
    /*
     * The same bands again, for articles a review here has already cited.
     *
     * Two passes rather than a color per point, for the reason the bands exist
     * at all: a fillStyle change costs a state flush, and this is redrawn
     * every frame while the cone turns. Two colors is sixteen fills where one
     * color was eight, and a color per point would be eight thousand.
     */
    const cited: Path2D[] = Array.from({ length: BANDS }, () => new Path2D());
    const marked: typeof projected = [];
    for (const item of projected) {
      const review = item.p.r === 1;
      if (review) {
        marked.push(item);
        continue;
      }
      const near = (item.depth + half) / (half * 2);
      const band = Math.min(BANDS - 1, Math.max(0, Math.round(near * (BANDS - 1))));
      /*
       * Raised from 1.6 on 2026-09-06. Over this window a topic is a few
       * hundred articles rather than the few thousand this was tuned against
       * in the Trellis corpus, and the cloud read as a scatter of specks with
       * a lot of black between them. Still well under the 4.2 a review gets,
       * so the thing being hunted for stays the biggest mark on the screen.
       */
      const r = Math.max(1.2, 2.4 * item.q * zoom.current);
      const into = gathered(item.p) ? cited : bulk;
      into[band].moveTo(item.sx + r, item.sy);
      into[band].arc(item.sx, item.sy, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = bulkInk;
    bulk.forEach((path, band) => {
      ctx.globalAlpha = 0.2 + (band / (BANDS - 1)) * 0.5;
      ctx.fill(path);
    });
    /*
     * A muted version of the review blue, because that is what these are: the
     * papers the blue dots have already reached. Reading them as "in the
     * reviews' orbit" is the whole point of the color, and a new hue would
     * have said "a third kind of thing" instead.
     */
    ctx.fillStyle = "#4d7398";
    cited.forEach((path, band) => {
      ctx.globalAlpha = 0.3 + (band / (BANDS - 1)) * 0.55;
      ctx.fill(path);
    });

    for (const item of marked) {
      // Depth reads as size and opacity together, which is what makes the
      // cloud legible as a volume rather than as a flat scatter.
      const near = (item.depth + half) / (half * 2);
      // Reviews are what an editor is hunting for, so they are held at a floor
      // of opacity that the ordinary articles never reach: depth should not be
      // able to bury the thing the screen is for. A matched article is held at
      // the same floor for the same reason.
      ctx.globalAlpha = 0.75 + near * 0.25;
      // Chartreuse against the blue: a match is a different kind of thing from
      // a review, and the two have to be told apart at a glance in a cloud
      // where they sit on top of each other.
      ctx.fillStyle = "#2f9bff";
      const r = 4.2 * item.q * zoom.current;
      ctx.beginPath();
      ctx.arc(item.sx, item.sy, Math.max(0.8, r), 0, Math.PI * 2);
      ctx.fill();
      // A thin halo, so a picked-out article still reads as one where the
      // cloud is densest and everything overlaps.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(180,225,255,0.9)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    projectedRef.current = projected.map((i) => ({
      sx: i.sx,
      sy: i.sy,
      title: i.p.t,
      doi: i.p.d ?? null,
      review: i.p.r === 1,
    }));
  }, [dated, all]);

  /*
   * schedule() reaches the current draw through a ref rather than closing over
   * it, so it never changes identity, so the listeners and the observer bind
   * once for the life of the view instead of being torn down and rebuilt
   * whenever anything about the drawing changed.
   */
  const drawRef = useRef(draw);
  // Declared above the effects that schedule a frame, so it is already
  // pointing at the current draw by the time any of them run.
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

  // The turn is driven by elapsed time rather than by frame count, so it takes
  // the same forty seconds on a slow machine as on a fast one.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (spinRef.current && !drag.current) {
        yaw.current += (Math.PI * 2 * dt) / TURN_SECONDS;
        drawRef.current();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // A new drawing -- a different filter, a different topic -- asks for a frame.
  useEffect(() => {
    schedule();
  }, [schedule, draw]);

  /*
   * The backing store is sized inside draw(), from the box's laid-out size.
   * Nothing redrew when that size changed, so resizing the window left the
   * old bitmap stretched across the new box until something else happened to
   * trigger a frame.
   */
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

    const onDown = (e: MouseEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, yaw: yaw.current, pitch: pitch.current };
      setHover(null);
      /*
       * Turning it by hand stops it turning by itself.
       *
       * Reaching an article already stopped the spin, for the same reason:
       * you cannot work with a moving target. Dragging did not, so the view
       * carried on rotating out from under the angle just set -- and "Save
       * this angle" then stored wherever the spin had reached by the time the
       * mouse got to the button, which is not the angle anyone chose.
       */
      if (spinRef.current) setSpinning(false);
    };
    const onUp = () => {
      drag.current = null;
    };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (drag.current) {
        yaw.current = drag.current.yaw + (e.clientX - drag.current.x) * 0.008;
        // Clamped short of straight down, where the cone collapses to a disc
        // and the years stop being readable.
        pitch.current = Math.max(
          -1.3,
          Math.min(1.3, drag.current.pitch + (e.clientY - drag.current.y) * 0.006),
        );
        schedule();
        return;
      }
      let best: { title: string; d: number } | null = null;
      for (const p of projectedRef.current) {
        const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
        if (d < 30 && (!best || d < best.d)) best = { title: p.title, d };
      }
      /*
       * Reaching an article stops the turn. A moving target cannot be clicked,
       * and a student who has found something wants to read it rather than
       * chase it -- the same behavior as the history landscape.
       */
      if (best && spinRef.current) setSpinning(false);
      setHover((prev) => {
        if (!best) return prev === null ? prev : null;
        if (prev && prev.title === best.title) return prev;
        return { title: best.title, ...place(mx, my, rect.width, 320) };
      });
    };
    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let best: { title: string; doi: string | null; d: number } | null = null;
      for (const p of projectedRef.current) {
        const d = (p.sx - mx) ** 2 + (p.sy - my) ** 2;
        if (d < 40 && (!best || d < best.d)) best = { title: p.title, doi: p.doi, d };
      }
      setPicked(
        best
          ? { title: best.title, doi: best.doi, ...place(mx, my, rect.width, 384) }
          : null,
      );
      if (best) setSpinning(false);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom.current = Math.min(6, Math.max(0.5, zoom.current * (e.deltaY < 0 ? 1.1 : 0.91)));
      schedule();
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      /*
       * Clearing the id is the whole of the fix for the freeze.
       *
       * schedule() treats a non-null frame id as "a redraw is already
       * pending" and returns. This cleanup canceled the pending frame but
       * left its id in place, so from then on every schedule() call did
       * nothing at all: zoom, the All/Reviews filter and Reset view stopped
       * redrawing, permanently. The spin loop calls draw() directly and so
       * papered over it -- which is why it only showed up after clicking an
       * article, because clicking an article stops the spin.
       */
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [schedule]);

  const years = dated.map((p) => p.y0 as number);

  return (
    <div className="relative">
      <p className="mb-2 text-sm text-neutral-900 dark:text-neutral-100">{label}</p>
      {/*
        * Every control on one line directly above the box: the filter that
        * changes what is drawn, then what is drawn, then what to do with the
        * view. Splitting them left the counts and the buttons stranded up by
        * the topic name, a long way from the thing they act on.
        */}
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex overflow-hidden rounded-md border border-neutral-300 dark:border-neutral-700 text-[0.7rem]">
          {(
            [
              ["all", "All"],
              ["reviews", "Reviews"],
              ["articles", "Non-reviews"],
              ["open", "Not in a review"],
            ] as const
          ).map(([value, name]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setKind(value);
                setPicked(null);
              }}
              className={`px-2 py-0.5 transition ${
                kind === value ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
            >
              {name}
            </button>
          ))}
        </span>
        <span className="flex flex-wrap items-center gap-3 text-[0.7rem] text-neutral-500 dark:text-neutral-400">
          {dated.length.toLocaleString()} shown
          {years.length > 0 && `, ${Math.min(...years)} to ${Math.max(...years)}`}
          <button
            type="button"
            onClick={() => setSpinning(!spinning)}
            className="underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            {spinning ? "Stop" : "Spin"}
          </button>
          <button
            type="button"
            onClick={() => {
              yaw.current = openYaw;
              pitch.current = openPitch;
              zoom.current = openZoom;
              setPicked(null);
              setHover(null);
              schedule();
            }}
            className="underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Reset view
          </button>
          <button
            type="button"
           
            onClick={onClose}
            className="underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
          >
            Back to the map
          </button>
        </span>
      </div>
      {/*
        * The box and whatever sits beside it share a row, so the panel starts
        * level with the top of the box rather than with the heading above it.
        * The row is also what the tooltips are positioned against, which lets
        * them use canvas coordinates directly instead of an offset guessed
        * from the height of a heading that wraps at some widths and not
        * others.
        */}
      <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
      <canvas
        ref={canvasRef}
       
        className="h-[min(72vh,44rem)] w-full min-w-0 cursor-grab rounded-[0.875rem] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 active:cursor-grabbing sm:flex-1"
        aria-label={`${label}, plotted with time as the vertical axis`}
      />
      {hover && !picked && (
        <span
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-[0.7rem] leading-snug text-neutral-900 dark:text-neutral-100 shadow"
          style={{ left: hover.x, top: hover.y }}
        >
          {hover.title}
        </span>
      )}
      {picked && (
        <div
          className="absolute z-20 max-w-sm rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 shadow-lg"
          style={{ left: picked.x, top: picked.y }}
        >
          <p className="text-[0.8rem] leading-snug text-neutral-900 dark:text-neutral-100">{picked.title}</p>
          <p className="mt-1.5 flex items-center gap-3 text-[0.7rem]">
            {picked.doi ? (
              <a
                href={`https://doi.org/${picked.doi}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 dark:text-blue-400 underline underline-offset-4"
              >
                Open the article
              </a>
            ) : (
              <span className="text-neutral-500 dark:text-neutral-400">No DOI on record</span>
            )}
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="text-neutral-500 dark:text-neutral-400 underline underline-offset-4 transition hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              Close
            </button>
          </p>
        </div>
      )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "#2f9bff" }}
          />
          reviews
        </span>
        {/* Only when there is something to tell apart. A corpus packed before
            the citations were fetched carries no counts, and a legend entry
            for a color nothing is drawn in is a legend entry that lies. */}
        {anyCited && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "#4d7398" }}
            />
            cited by a review here
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: "#8b96a3" }}
          />
          {anyCited ? "not cited by one" : "everything else"}
        </span>
        <span>
          Height is the year. Drag to turn, scroll to zoom, hover for a title,
          click for the article.
        </span>
      </div>
    </div>
  );
}

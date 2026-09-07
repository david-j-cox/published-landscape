"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PLACEMENT_STORAGE_KEY } from "@/lib/constants";
import {
  FALLBACK_JOURNAL_COLOR,
  JOURNAL_COLORS,
  REACH_BANDS,
  REACH_DARK,
  REACH_LIGHT,
  REACH_UNKNOWN,
  colorOf,
  reachBand,
  reachColorOf,
  type ColorMode,
} from "@/lib/map-colors";
import type { ArticleDetail, Cluster, Journal, MapPoint, PendingPlacement } from "@/lib/types";
import { YearRangeSlider } from "@/components/year-range-slider";
import { TopicLandscape, type Cone, type Spot } from "@/components/topic-landscape";

const MODES = ["topic", "journal", "reach"] as const;

// Sentinel id for the ephemeral "place a submission" marker (src/app/(app)/submit)
// which isn't a real article, so it can't collide with a real OpenAlex id.
const PENDING_ID = "__pending__";

type PendingMarker = {
  point: MapPoint;
  clusterLabel: string;
  neighbors: PendingPlacement["neighbors"];
};

type View = { scale: number; ox: number; oy: number };

function wrapLabel(text: string, maxChars: number): string[] {
  const words = text.split(", ").join(" ").split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function TopicMap({
  points,
  clusters,
  journals,
  reachAvailable = false,
}: {
  points: MapPoint[];
  clusters: Cluster[];
  journals: Journal[];
  /** False when the citation graph could not be read; the mode is then absent. */
  reachAvailable?: boolean;
}) {
  /*
   * Flat or standing.
   *
   * One page and one set of controls, because they are two drawings of the
   * same thing: the colour mode, the legend and the year range mean exactly
   * what they meant before, and switching between them should not lose where
   * you had got to. The flat map answers what is near what; the field adds
   * when it happened.
   */
  /*
   * The field opens first. It is the map with time in it, and the flat one is
   * the special case now rather than the other way round.
   */
  const [view, setView] = useState<"flat" | "field">("field");
  /*
   * The panel sits over the drawing, and the field fills far more of the frame
   * than the flat map ever did -- the cones behind the panel are simply not
   * viewable. There is nowhere on a full-bleed canvas to put it that is not
   * over something, so it folds away instead, and the map remembers that the
   * reader folded it.
   */
  const [controlsOpen, setControlsOpen] = useState(true);
  const router = useRouter();
  /** How the aside's Reset view reaches the field's camera. */
  const fieldReset = useRef<(() => void) | null>(null);

  /*
   * The field is derived from the same points the flat map draws, not fetched
   * again.
   *
   * It was a second query and a second array over the wire, which put the page
   * at 3.4 MB for nine thousand articles sent twice. Everything the cones need
   * is already here: a cluster's centre and radius are two passes over its
   * members, and an article's bearing and distance follow from its map
   * position. Computed once and kept, because it depends on nothing a control
   * changes -- filtering and colouring happen at draw time.
   */
  const field = useMemo(() => {
    const byCluster = new Map<number, MapPoint[]>();
    for (const p of points) {
      const list = byCluster.get(p.cluster_id) ?? [];
      list.push(p);
      byCluster.set(p.cluster_id, list);
    }
    const cones: Cone[] = [];
    const spots: Spot[] = [];
    let min = Infinity;
    let max = -Infinity;
    const labelOf = new Map(clusters.map((c) => [c.id, c.label]));
    for (const [clusterId, members] of [...byCluster.entries()].sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      const cx = members.reduce((t, m) => t + m.x, 0) / members.length;
      const cy = members.reduce((t, m) => t + m.y, 0) / members.length;
      /*
       * The ninetieth percentile of the distances, not the largest of them.
       *
       * A cluster is a region of the map, but a few of its members sit far
       * outside that region -- an embedding puts them near their neighbours,
       * not inside a circle. Taking the furthest one let a diffuse topic claim
       * a radius spanning most of the map, and its cone then enclosed every
       * other cone: the field looked like one giant funnel with the topics
       * inside it, a containment the data does not have. The percentile sizes
       * a cone to the body of its topic and lets the stragglers sit outside
       * the wall, which is where they are.
       */
      const spread = members
        .map((m) => Math.hypot(m.x - cx, m.y - cy))
        .sort((a, b) => a - b);
      const radius = spread[Math.floor(spread.length * 0.9)] || spread.at(-1) || 0.02;
      const cone = cones.length;
      cones.push({
        clusterId,
        label: labelOf.get(clusterId) ?? `Topic ${clusterId}`,
        cx,
        cy,
        radius,
        count: members.length,
      });
      for (const m of members) {
        if (m.year === null) continue;
        if (m.year < min) min = m.year;
        if (m.year > max) max = m.year;
        spots.push({
          cone,
          angle: Math.atan2(m.y - cy, m.x - cx),
          spread: Math.min(1, Math.hypot(m.x - cx, m.y - cy) / radius),
          year: m.year,
          isReview: m.isReview ?? false,
          reviewedBy: m.reviewedBy ?? 0,
          journalId: m.journal_id,
          reach: m.reach ?? 0,
        });
      }
    }
    return {
      cones,
      spots,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
    };
  }, [points, clusters]);
  const hasField = field.cones.length > 0;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hiddenClusters, setHiddenClusters] = useState<Set<number>>(new Set());
  const [hiddenJournals, setHiddenJournals] = useState<Set<number>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMode>("topic");
  // Year range filter over the whole map. Bounds come from the data; default
  // spans everything (i.e. no filtering until the user narrows it).
  const mapYears = points.map((p) => p.year).filter((y): y is number => y != null);
  const minYear = mapYears.length ? Math.min(...mapYears) : 0;
  const maxYear = mapYears.length ? Math.max(...mapYears) : 0;
  const [yearRange, setYearRange] = useState<[number, number]>([minYear, maxYear]);
  const yearRangeRef = useRef<[number, number]>([minYear, maxYear]);
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [detail, setDetail] = useState<ArticleDetail | null>(null);
  const detailLoading = Boolean(selected && selected.id !== PENDING_ID && detail?.id !== selected.id);
  const [pending, setPending] = useState<PendingMarker | null>(null);
  // Mirrors `pending` for the imperative canvas draw loop, which runs outside
  // React's render cycle and can't depend on state directly (see the sync
  // effect below, same pattern as hiddenClusters/hiddenRef).
  const pendingRef = useRef<PendingMarker | null>(null);

  const viewRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const fitRef = useRef<View>({ scale: 1, ox: 0, oy: 0 });
  const hoveredRef = useRef<MapPoint | null>(null);
  const selectedRef = useRef<MapPoint | null>(null);
  const hiddenRef = useRef<Set<number>>(new Set());
  const hiddenJournalsRef = useRef<Set<number>>(new Set());
  const colorModeRef = useRef<ColorMode>("topic");

  const journalColorById = new Map(
    journals.map((j) => [j.id, JOURNAL_COLORS[j.issn_l] ?? FALLBACK_JOURNAL_COLOR]),
  );
  const journalColorOf = (journalId: number) =>
    journalColorById.get(journalId) ?? FALLBACK_JOURNAL_COLOR;

  const journalCounts = new Map<number, number>();
  points.forEach((p) => journalCounts.set(p.journal_id, (journalCounts.get(p.journal_id) ?? 0) + 1));

  // One count per reach band, with the articles the graph knows nothing about
  // in a slot of their own at the end.
  const reachCounts = new Array<number>(REACH_BANDS.length + 1).fill(0);
  points.forEach((p) => {
    const band = reachBand(p.reach);
    reachCounts[band === null ? REACH_BANDS.length : band] += 1;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!canvas || !container || !tooltip) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    const W = () => container.clientWidth;
    const H = () => container.clientHeight;

    function resize() {
      dpr = window.devicePixelRatio || 1;
      canvas!.width = W() * dpr;
      canvas!.height = H() * dpr;
      canvas!.style.width = `${W()}px`;
      canvas!.style.height = `${H()}px`;
    }

    function computeFit() {
      const xs = points.map((d) => d.x);
      const ys = points.map((d) => d.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad = 90;
      const w = W() - pad * 2, h = H() - pad * 2;
      const scale = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      fitRef.current = { scale, ox: W() / 2 - cx * scale, oy: H() / 2 + cy * scale };
      viewRef.current = { ...fitRef.current };
    }

    const sx = (wx: number) => wx * viewRef.current.scale + viewRef.current.ox;
    const sy = (wy: number) => -wy * viewRef.current.scale + viewRef.current.oy;

    // Each cluster's center and its top edge, so a label can sit above the
    // dots rather than on them. The top is the 95th percentile of y, not the
    // maximum: one stray point would otherwise push the label into space.
    // Largest first, which is the order labels are placed in below.
    const centroids = clusters
      .map((c) => {
        const mem = points.filter((d) => d.cluster_id === c.id);
        const mx = mem.reduce((s, d) => s + d.x, 0) / (mem.length || 1);
        const my = mem.reduce((s, d) => s + d.y, 0) / (mem.length || 1);
        const ys = mem.map((d) => d.y).sort((a, b) => a - b);
        const top = ys.length ? ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.95))] : my;
        const bottom = ys.length ? ys[Math.floor(ys.length * 0.05)] : my;
        return { id: c.id, x: mx, y: my, top, bottom, size: mem.length };
      })
      .sort((a, b) => b.size - a.size);

    function roundRectPath(x: number, y: number, w: number, h: number, r: number) {
      ctx!.beginPath();
      ctx!.moveTo(x + r, y);
      ctx!.arcTo(x + w, y, x + w, y + h, r);
      ctx!.arcTo(x + w, y + h, x, y + h, r);
      ctx!.arcTo(x, y + h, x, y, r);
      ctx!.arcTo(x, y, x + w, y, r);
      ctx!.closePath();
    }

    // The "you are here" pulse for a fresh placement: animates until the
    // user clicks the marker, so it can't get lost among ~4k dots.
    let pulsing = false;
    let pulseRAF = 0;
    function pulseLoop() {
      draw();
      if (pulsing) pulseRAF = requestAnimationFrame(pulseLoop);
    }
    function setPulse(on: boolean) {
      if (pulsing === on) return;
      pulsing = on;
      cancelAnimationFrame(pulseRAF);
      if (on) pulseRAF = requestAnimationFrame(pulseLoop);
      else draw();
    }

    function hiddenPoint(d: MapPoint) {
      if (hiddenRef.current.has(d.cluster_id) || hiddenJournalsRef.current.has(d.journal_id))
        return true;
      // Year filter: only applies once the range is narrowed from full extent,
      // so undated points stay visible in the default (unfiltered) view.
      const [ylo, yhi] = yearRangeRef.current;
      if (ylo > minYear || yhi < maxYear) {
        if (d.year == null || d.year < ylo || d.year > yhi) return true;
      }
      return false;
    }

    function draw() {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const bgPill = isDark ? "rgba(10,10,10,0.88)" : "rgba(250,250,250,0.88)";
      const inkColor = isDark ? "#fbbf24" : "#18181b";
      const inkStroke = isDark ? "#18181b" : "#fbbf24";

      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.clearRect(0, 0, W(), H());

      ctx!.textAlign = "center";
      ctx!.font = "600 12px Inter, sans-serif";
      ctx!.lineJoin = "round";
      const lineHeight = 14;

      // Dots grow with the zoom. A fixed radius that suited 7,000 points
      // turned 16,000 into blobs at full extent; at two pixels the shape of
      // each cluster shows, and zooming in brings back the size to click on.
      const zoom = viewRef.current.scale / (fitRef.current.scale || 1);
      const dot = Math.min(4.5, 2 * Math.sqrt(zoom));
      points.forEach((d) => {
        if (hiddenPoint(d)) return;
        const x = sx(d.x), y = sy(d.y);
        const on = d === hoveredRef.current || d === selectedRef.current;
        const r = dot * (on ? 1.8 : 1);
        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.globalAlpha = on ? 1 : 0.3;
        ctx!.fillStyle =
          colorModeRef.current === "journal"
            ? journalColorOf(d.journal_id)
            : colorModeRef.current === "reach"
              ? reachColorOf(d.reach, isDark)
              : colorOf(d.cluster_id);
        ctx!.fill();
        if (on) {
          ctx!.lineWidth = 2;
          ctx!.strokeStyle = "#fff";
          ctx!.stroke();
        }
        ctx!.globalAlpha = 1;
      });

      // Labels draw last (on top of the dots), above their cluster rather
      // than across it, with a short leader down to the dots. Largest
      // cluster first, and a label that would overlap one already placed is
      // skipped at this zoom: forty-four labels at full extent covered the
      // map they were naming. Zooming in spreads the clusters out and the
      // skipped labels appear. The cluster under the cursor goes first, so
      // its name is never the one that lost the draw.
      const focus = hoveredRef.current?.cluster_id ?? selectedRef.current?.cluster_id;
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const collides = (b: { x: number; y: number; w: number; h: number }) =>
        placed.some(
          (p) => !(b.x + b.w < p.x || p.x + p.w < b.x || b.y + b.h < p.y || p.y + p.h < b.y),
        );
      const ordered =
        focus === undefined
          ? centroids
          : [...centroids.filter((c) => c.id === focus), ...centroids.filter((c) => c.id !== focus)];
      ordered.forEach((c) => {
        if (hiddenRef.current.has(c.id)) return;
        const cl = clusters.find((k) => k.id === c.id);
        if (!cl) return;
        const lines = wrapLabel(cl.label, 20);
        const cx = sx(c.x);
        const maxWidth = Math.max(...lines.map((ln) => ctx!.measureText(ln).width));
        const boxW = maxWidth + 12;
        const boxH = lines.length * lineHeight + 8;
        // Above the cluster, or below it if above is taken. The leader runs
        // from the box to the edge of the dots on whichever side it landed.
        const candidates = [
          { edge: sy(c.top) - 6, dir: -1, dots: sy(c.top) + 4 },
          { edge: sy(c.bottom) + 6, dir: 1, dots: sy(c.bottom) - 4 },
        ];
        let box: { x: number; y: number; w: number; h: number } | null = null;
        let cy = 0;
        let leader: { from: number; to: number } | null = null;
        for (const cand of candidates) {
          const center = cand.edge + (cand.dir * boxH) / 2;
          const attempt = { x: cx - boxW / 2, y: center - boxH / 2, w: boxW, h: boxH };
          if (collides(attempt)) continue;
          box = attempt;
          cy = center;
          leader = { from: cand.edge, to: cand.dots };
          break;
        }
        if (!box || !leader) return;
        placed.push(box);
        const ink =
          colorModeRef.current === "topic" ? colorOf(c.id) : isDark ? "#d4d4d4" : "#404040";
        ctx!.strokeStyle = ink;
        ctx!.globalAlpha = 0.6;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(cx, leader.from);
        ctx!.lineTo(cx, leader.to);
        ctx!.stroke();
        ctx!.globalAlpha = 1;
        ctx!.fillStyle = bgPill;
        roundRectPath(box.x, box.y, boxW, boxH, 5);
        ctx!.fill();
        // In journal mode topic colors no longer mean anything, so labels
        // fall back to neutral ink instead of the cluster hue.
        ctx!.fillStyle = ink;
        lines.forEach((ln, j) =>
          ctx!.fillText(ln, cx, cy + 4 + j * lineHeight - (lines.length - 1) * (lineHeight / 2)),
        );
      });

      const pending = pendingRef.current?.point;
      if (pending) {
        const x = sx(pending.x), y = sy(pending.y);
        const on = hoveredRef.current?.id === PENDING_ID || selectedRef.current?.id === PENDING_ID;
        const r = on ? 14 : 11;
        if (pulsing) {
          // Two expanding rings half a period apart, fading as they grow.
          const t = (performance.now() % 1600) / 1600;
          for (const phase of [0, 0.5]) {
            const p = (t + phase) % 1;
            ctx!.beginPath();
            ctx!.arc(x, y, r + 3 + p * 34, 0, Math.PI * 2);
            ctx!.strokeStyle = "#f59e0b";
            ctx!.lineWidth = 2.5;
            ctx!.globalAlpha = (1 - p) * 0.7;
            ctx!.stroke();
          }
          ctx!.globalAlpha = 1;
        }
        ctx!.beginPath();
        ctx!.moveTo(x, y - r);
        ctx!.lineTo(x + r, y);
        ctx!.lineTo(x, y + r);
        ctx!.lineTo(x - r, y);
        ctx!.closePath();
        ctx!.fillStyle = inkColor;
        ctx!.fill();
        ctx!.lineWidth = 2;
        ctx!.strokeStyle = inkStroke;
        ctx!.stroke();
        ctx!.font = "700 11px Inter, sans-serif";
        const labelW = ctx!.measureText("Your submission").width;
        ctx!.fillStyle = bgPill;
        roundRectPath(x - labelW / 2 - 6, y - r - 8 - 11, labelW + 12, 18, 5);
        ctx!.fill();
        ctx!.fillStyle = inkColor;
        ctx!.fillText("Your submission", x, y - r - 8);
      }
      ctx!.restore();
    }

    function nodeAt(px: number, py: number): MapPoint | null {
      const pending = pendingRef.current?.point;
      if (pending) {
        const dist = Math.hypot(px - sx(pending.x), py - sy(pending.y));
        if (dist < 18) return pending;
      }
      let best: MapPoint | null = null;
      let bestD = 12;
      for (const d of points) {
        if (hiddenPoint(d)) continue;
        const dist = Math.hypot(px - sx(d.x), py - sy(d.y));
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    }

    function localXY(clientX: number, clientY: number): [number, number] {
      const r = canvas!.getBoundingClientRect();
      return [clientX - r.left, clientY - r.top];
    }

    function showTooltip(d: MapPoint, px: number, py: number) {
      tooltip!.innerHTML = `<div class="font-medium">${escapeHtml(d.title)}</div>
        <div class="text-neutral-400">${escapeHtml(d.authorsShort)}${d.authorsShort ? " &middot; " : ""}${d.year ?? ""}</div>`;
      tooltip!.hidden = false;
      let x = px + 14, y = py + 14;
      const rect = tooltip!.getBoundingClientRect();
      if (x + rect.width > W() - 10) x = px - rect.width - 14;
      if (y + rect.height > H() - 10) y = py - rect.height - 14;
      tooltip!.style.left = `${x}px`;
      tooltip!.style.top = `${y}px`;
    }

    let dragging = false, moved = false, last = { x: 0, y: 0 };

    function onMouseDown(e: MouseEvent) {
      dragging = true;
      moved = false;
      last = { x: e.clientX, y: e.clientY };
    }
    function onMouseUp() {
      dragging = false;
    }
    function onMouseMove(e: MouseEvent) {
      if (dragging) {
        const dx = e.clientX - last.x, dy = e.clientY - last.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        viewRef.current.ox += dx;
        viewRef.current.oy += dy;
        last = { x: e.clientX, y: e.clientY };
        draw();
        return;
      }
      const [px, py] = localXY(e.clientX, e.clientY);
      const hit = nodeAt(px, py);
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        draw();
      }
      if (hit) showTooltip(hit, px, py);
      else tooltip!.hidden = true;
    }
    function onClick(e: MouseEvent) {
      if (moved) return;
      const [px, py] = localXY(e.clientX, e.clientY);
      const hit = nodeAt(px, py);
      if (hit) {
        selectedRef.current = hit;
        setSelected(hit);
        if (hit.id === PENDING_ID) setPulse(false);
        draw();
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const [mx, my] = localXY(e.clientX, e.clientY);
      const wx = (mx - viewRef.current.ox) / viewRef.current.scale;
      const wy = -(my - viewRef.current.oy) / viewRef.current.scale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      viewRef.current.scale = Math.max(
        fitRef.current.scale * 0.5,
        Math.min(fitRef.current.scale * 12, viewRef.current.scale * factor),
      );
      viewRef.current.ox = mx - wx * viewRef.current.scale;
      viewRef.current.oy = my + wy * viewRef.current.scale;
      draw();
    }
    function onResize() {
      resize();
      computeFit();
      draw();
    }

    resize();
    computeFit();
    draw();

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("resize", onResize);

    (canvas as unknown as { __redraw?: () => void }).__redraw = draw;
    (canvas as unknown as { __resetView?: () => void }).__resetView = () => {
      computeFit();
      draw();
    };
    (canvas as unknown as { __setPulse?: (on: boolean) => void }).__setPulse = setPulse;
    // Center + zoom the view on a world coordinate. The detail panel covers
    // the left ~28rem, so on wide screens the target is centered in the
    // visible remainder, not the full canvas.
    (canvas as unknown as { __focusOn?: (wx: number, wy: number) => void }).__focusOn = (
      wx: number,
      wy: number,
    ) => {
      const fit = fitRef.current.scale;
      const scale = Math.min(fit * 12, fit * 2.5);
      const panelW = W() >= 768 ? 448 : 0;
      viewRef.current.scale = scale;
      viewRef.current.ox = panelW + (W() - panelW) / 2 - wx * scale;
      viewRef.current.oy = H() / 2 + wy * scale;
      draw();
    };

    return () => {
      cancelAnimationFrame(pulseRAF);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
    };
    /*
     * points/clusters are static for the page's lifetime, but the canvas is
     * not: the field replaces it, so this has to run again each time the flat
     * view comes back to a freshly mounted element. Running once at mount --
     * which, now that the field is the default, meant running against no
     * canvas at all -- left the flat view black.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Redraw when hiddenClusters changes (legend toggles).
  useEffect(() => {
    hiddenRef.current = hiddenClusters;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
  }, [hiddenClusters]);

  useEffect(() => {
    hiddenJournalsRef.current = hiddenJournals;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
  }, [hiddenJournals]);

  useEffect(() => {
    colorModeRef.current = colorMode;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
  }, [colorMode]);

  useEffect(() => {
    yearRangeRef.current = yearRange;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
  }, [yearRange]);

  // One-shot: pick up a placement stashed by /submit's "View on topic map".
  useEffect(() => {
    const raw = sessionStorage.getItem(PLACEMENT_STORAGE_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PLACEMENT_STORAGE_KEY);
    try {
      const parsed = JSON.parse(raw) as PendingPlacement;
      const marker: PendingMarker = {
        point: {
          id: PENDING_ID,
          x: parsed.x,
          y: parsed.y,
          cluster_id: parsed.clusterId,
          journal_id: -1,
          year: null,
          title: parsed.title,
          authorsShort: "Draft submission",
        },
        clusterLabel: parsed.clusterLabel,
        neighbors: parsed.neighbors,
      };
      // One-time hydration from sessionStorage on mount, not a fetch -
      // there's no async boundary to defer these through.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(marker);
      selectedRef.current = marker.point;
      setSelected(marker.point);
    } catch {
      // malformed sessionStorage entry - ignore
    }
  }, []);

  // Mirror `pending` into the ref the imperative canvas code reads. A fresh
  // placement also gets focused and pulsed - it used to sit unannounced in
  // the full-corpus view and was genuinely hard to spot.
  useEffect(() => {
    pendingRef.current = pending;
    const canvas = canvasRef.current as
      | (HTMLCanvasElement & {
          __redraw?: () => void;
          __focusOn?: (wx: number, wy: number) => void;
          __setPulse?: (on: boolean) => void;
        })
      | null;
    if (pending) {
      canvas?.__focusOn?.(pending.point.x, pending.point.y);
      canvas?.__setPulse?.(true);
    } else {
      canvas?.__redraw?.();
    }
  }, [pending]);

  useEffect(() => {
    if (!selected || selected.id === PENDING_ID) return;
    let cancelled = false;
    fetch(`/api/articles/${selected.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setDetail(d.error ? null : d);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function closeDetail() {
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
  }

  // Clicking a topic solos it (hides every other topic); clicking the same
  // one again restores all topics. Clicking a different topic while soloed
  // switches the solo to the new one.
  function toggleCluster(id: number) {
    setHiddenClusters((prev) => {
      const isSoloed = clusters.every((c) => (c.id === id ? !prev.has(c.id) : prev.has(c.id)));
      if (isSoloed) return new Set();
      return new Set(clusters.map((c) => c.id).filter((cid) => cid !== id));
    });
  }

  // Same solo behavior as toggleCluster, over journals.
  function toggleJournal(id: number) {
    setHiddenJournals((prev) => {
      const isSoloed = journals.every((j) => (j.id === id ? !prev.has(j.id) : prev.has(j.id)));
      if (isSoloed) return new Set();
      return new Set(journals.map((j) => j.id).filter((jid) => jid !== id));
    });
  }

  // Filters from the mode being left would keep hiding dots with no visible
  // legend explaining why, so switching modes clears both.
  function switchColorMode(mode: ColorMode) {
    setColorMode(mode);
    setHiddenClusters(new Set());
    setHiddenJournals(new Set());
  }

  // The placement is ephemeral: /submit stashes it, the map consumes it on
  // mount, and until now the only way to get rid of it was to navigate away
  // and back. Nothing to revoke - just drop the state and repaint.
  function clearPlacement() {
    setPending(null);
    if (selectedRef.current?.id === PENDING_ID) closeDetail();
    // The pulse otherwise only stops when the marker is clicked, so removing
    // an unclicked placement would leave its rAF loop redrawing forever.
    const canvas = canvasRef.current as
      | (HTMLCanvasElement & { __setPulse?: (on: boolean) => void })
      | null;
    canvas?.__setPulse?.(false);
  }

  function resetView() {
    setHiddenClusters(new Set());
    setHiddenJournals(new Set());
    setYearRange([minYear, maxYear]);
    const canvas = canvasRef.current as (HTMLCanvasElement & { __resetView?: () => void }) | null;
    canvas?.__resetView?.();
    // The field is a different canvas with its own camera, and in field view
    // the one above is not even mounted.
    fieldReset.current?.();
  }

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-57px)] w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      {view === "field" && hasField ? (
        <div className="absolute inset-0 overflow-auto p-4">
          <TopicLandscape
            cones={field.cones}
            points={field.spots}
            minYear={field.min}
            maxYear={field.max}
            colorMode={colorMode}
            hiddenClusters={hiddenClusters}
            hiddenJournals={hiddenJournals}
            yearRange={yearRange}
            journalColor={journalColorOf}
            resetRef={fieldReset}
          />
        </div>
      ) : (
        <canvas ref={canvasRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      )}

      <div
        ref={tooltipRef}
        hidden
        className="pointer-events-none absolute z-20 max-w-64 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
      />

      {!controlsOpen && (
        <button
          onClick={() => setControlsOpen(true)}
          className="absolute right-3 top-3 z-10 rounded-lg border border-neutral-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-neutral-600 shadow-sm hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900/95 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Controls
        </button>
      )}

      <aside
        hidden={!controlsOpen}
        className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 p-3 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95"
      >
        <button
          onClick={() => setControlsOpen(false)}
          className="mb-2 w-full rounded-md py-1 text-right text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          Hide controls
        </button>
        {pending && (
          <div className="mb-2 flex flex-col gap-1.5">
            <Link
              href="/submit"
              className="w-full rounded-md border border-neutral-300 py-1 text-center text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Back to reviewer list
            </Link>
            <button
              onClick={clearPlacement}
              className="w-full rounded-md border py-1 font-medium"
              style={{ borderColor: "#b4530966", background: "#fbbf2418", color: "#b45309" }}
            >
              Remove submission
            </button>
          </div>
        )}
        <button
          onClick={resetView}
          className="mb-2 w-full rounded-md border border-neutral-300 py-1 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Reset view
        </button>
        {hasField && (
          <div className="mb-2 flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
            {(["flat", "field"] as const).map((which) => (
              <button
                key={which}
                onClick={() => setView(which)}
                className={`flex-1 py-1 font-semibold ${
                  view === which
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                {which === "flat" ? "Flat" : "Over time"}
              </button>
            ))}
          </div>
        )}
        <div className="mb-2 flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
          {MODES.filter((mode) => mode !== "reach" || reachAvailable).map((mode) => (
            <button
              key={mode}
              onClick={() => switchColorMode(mode)}
              className={`flex-1 py-1 font-semibold ${
                colorMode === mode
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {mode === "topic" ? "Topics" : mode === "journal" ? "Journals" : "Reach"}
            </button>
          ))}
        </div>
        {maxYear > minYear && (
          <div className="mb-2 border-b border-neutral-200 pb-2.5 dark:border-neutral-800">
            <YearRangeSlider min={minYear} max={maxYear} value={yearRange} onChange={setYearRange} />
          </div>
        )}
        {colorMode === "reach" ? (
          <div>
            <ul className="flex flex-col gap-1">
              {REACH_BANDS.map((band, i) => (
                <li key={band.floor} className="flex items-center gap-2 px-1.5 py-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full dark:hidden"
                    style={{ background: REACH_LIGHT[i] }}
                  />
                  <span
                    className="hidden h-2.5 w-2.5 shrink-0 rounded-full dark:block"
                    style={{ background: REACH_DARK[i] }}
                  />
                  <span className="flex-1 text-neutral-700 dark:text-neutral-300">
                    {band.label}
                  </span>
                  <span className="text-neutral-400">{reachCounts[i]}</span>
                </li>
              ))}
              {reachCounts[REACH_BANDS.length] > 0 && (
                <li className="flex items-center gap-2 px-1.5 py-1">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: REACH_UNKNOWN }}
                  />
                  <span className="flex-1 text-neutral-700 dark:text-neutral-300">not known</span>
                  <span className="text-neutral-400">{reachCounts[REACH_BANDS.length]}</span>
                </li>
              )}
            </ul>
            <p className="mt-2 border-t border-neutral-200 pt-2 text-neutral-400 dark:border-neutral-800">
              Citations from outside these journals.
            </p>
          </div>
        ) : colorMode === "topic" ? (
          <ul className="flex max-h-[15.5rem] flex-col gap-1 overflow-y-auto">
            {clusters.map((c) => (
              <li
                key={c.id}
                onClick={() =>
                  view === "field"
                    ? /*
                       * In the field a topic name opens that topic.
                       *
                       * Hiding it there leaves one cone standing in a scene
                       * built for forty-four, too small to turn or read, which
                       * is not isolating a topic so much as losing it. The
                       * topic's own page is where a single cone belongs, and
                       * it comes back with "Back to the map". The flat map
                       * keeps hiding, which is what it is good for.
                       */
                      router.push(`/trends?topic=${c.id}`)
                    : toggleCluster(c.id)
                }
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  hiddenClusters.has(c.id) ? "opacity-35" : ""
                }`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                <span className="flex-1 text-neutral-700 dark:text-neutral-300">{c.label}</span>
                <span className="text-neutral-400">{c.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-1">
            {journals.map((j) => (
              <li
                key={j.id}
                onClick={() => toggleJournal(j.id)}
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                  hiddenJournals.has(j.id) ? "opacity-35" : ""
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: journalColorOf(j.id) }}
                />
                <span className="flex-1 text-neutral-700 dark:text-neutral-300">{j.name}</span>
                <span className="text-neutral-400">{journalCounts.get(j.id) ?? 0}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="absolute bottom-3 left-3 z-10 rounded-md bg-white/90 px-2.5 py-1 text-[11px] text-neutral-500 shadow-sm dark:bg-neutral-900/90 dark:text-neutral-400">
        scroll to zoom &middot; drag to pan &middot; click a point to open it
      </div>

      {selected && (
        <section className="absolute inset-y-0 left-0 z-20 flex w-full max-w-md flex-col overflow-y-auto border-r border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
          <button
            onClick={closeDetail}
            className="self-end text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Close"
          >
            &times;
          </button>
          {pending && selected.id !== PENDING_ID && (
            <button
              onClick={() => {
                selectedRef.current = pending.point;
                setSelected(pending.point);
                setDetail(null);
              }}
              className="mb-2 self-start text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              &larr; Back to your submission
            </button>
          )}
          {selected.id === PENDING_ID && pending ? (
            <>
              <div
                className="mb-2 w-fit rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: "#fbbf2422", color: "#b45309" }}
              >
                Draft submission &middot; {pending.clusterLabel}
              </div>
              <button
                onClick={clearPlacement}
                className="mb-1 self-start text-xs text-neutral-500 underline hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                Remove from map
              </button>
              <h2 className="text-lg font-semibold leading-snug">{pending.point.title}</h2>
              <p className="mt-2 text-sm text-neutral-500">
                Not yet published - placed based on the title/abstract submitted on the{" "}
                <Link href="/submit" className="text-blue-600 underline dark:text-blue-400">
                  Place a submission
                </Link>{" "}
                page.
              </p>
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Nearest existing articles
                </div>
                <ul className="flex flex-col gap-2">
                  {pending.neighbors.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => {
                          const pt = points.find((p) => p.id === n.id);
                          if (pt) {
                            setHiddenClusters((prev) => (prev.has(pt.cluster_id) ? new Set() : prev));
                            selectedRef.current = pt;
                            setSelected(pt);
                          }
                        }}
                        className="flex w-full items-start justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <span>
                          {n.title} <span className="text-neutral-400">({n.year})</span>
                        </span>
                        <span className="shrink-0 text-xs text-neutral-400">
                          {Math.round(n.similarity * 100)}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <>
              {detailLoading && <p className="text-sm text-neutral-400">Loading...</p>}
              {detail && detail.id === selected.id && (
            <>
              <div
                className="mb-2 w-fit rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: colorOf(detail.cluster_id) + "22", color: colorOf(detail.cluster_id) }}
              >
                {detail.cluster.label}
              </div>
              <h2 className="text-lg font-semibold leading-snug">{detail.title}</h2>
              <div className="mt-1 text-sm text-neutral-500">
                {detail.authors.map((a) => a.display_name).join(", ")}
              </div>
              <div className="mt-1 text-sm text-neutral-400">
                {detail.journal.name} &middot; {detail.year}
              </div>
              {detail.abstract ? (
                <p className="mt-4 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
                  {detail.abstract}
                </p>
              ) : (
                <p className="mt-4 text-sm italic text-neutral-400">
                  No abstract available, so its position on the map is based only on its title and
                  general subject tags - treat its placement here as approximate. Tags:{" "}
                  {detail.openalex_topics.map((t) => t.display_name).join(", ")}
                </p>
              )}
              <div className="mt-4 flex gap-3 text-sm">
                {detail.doi && (
                  <a
                    href={`https://doi.org/${detail.doi.replace(/^https?:\/\/doi\.org\//, "")}`}
                    target="_blank"
                    rel="noopener"
                    className="text-blue-600 underline dark:text-blue-400"
                  >
                    View paper (DOI)
                  </a>
                )}
                <Link href={`/articles/${detail.id}`} className="text-blue-600 underline dark:text-blue-400">
                  Full detail page
                </Link>
              </div>
              {detail.relatedArticles.length > 0 && (
                <div className="mt-6">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Related work
                  </div>
                  <ul className="flex flex-col gap-2">
                    {detail.relatedArticles.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => {
                            const pt = points.find((p) => p.id === r.id);
                            if (pt) {
                              setHiddenClusters((prev) => (prev.has(pt.cluster_id) ? new Set() : prev));
                              selectedRef.current = pt;
                              setSelected(pt);
                            }
                          }}
                          className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: colorOf(r.cluster_id) }}
                          />
                          <span>
                            {r.title} <span className="text-neutral-400">({r.year})</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PLACEMENT_STORAGE_KEY } from "@/lib/constants";
import type { ArticleDetail, Cluster, MapPoint, PendingPlacement } from "@/lib/types";

const PALETTE = [
  "#6cc5ff", "#a98bff", "#5fd6a4", "#ffb454", "#ff7a9c", "#7ce0e0",
  "#c3a3ff", "#ffd166", "#8fd694", "#f4978e", "#9aa6bd",
];
const colorOf = (clusterId: number) => PALETTE[clusterId % PALETTE.length];

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

export function TopicMap({ points, clusters }: { points: MapPoint[]; clusters: Cluster[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hiddenClusters, setHiddenClusters] = useState<Set<number>>(new Set());
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

    const centroids = clusters.map((c) => {
      const mem = points.filter((d) => d.cluster_id === c.id);
      const mx = mem.reduce((s, d) => s + d.x, 0) / (mem.length || 1);
      const my = mem.reduce((s, d) => s + d.y, 0) / (mem.length || 1);
      return { id: c.id, x: mx, y: my };
    });

    function draw() {
      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.clearRect(0, 0, W(), H());

      ctx!.textAlign = "center";
      ctx!.font = "600 12px Inter, sans-serif";
      centroids.forEach((c) => {
        if (hiddenRef.current.has(c.id)) return;
        const cl = clusters.find((k) => k.id === c.id);
        if (!cl) return;
        ctx!.fillStyle = colorOf(c.id) + "cc";
        const lines = wrapLabel(cl.label, 20);
        lines.forEach((ln, j) =>
          ctx!.fillText(ln, sx(c.x), sy(c.y) + j * 14 - ((lines.length - 1) * 7)),
        );
      });

      points.forEach((d) => {
        if (hiddenRef.current.has(d.cluster_id)) return;
        const x = sx(d.x), y = sy(d.y);
        const on = d === hoveredRef.current || d === selectedRef.current;
        const r = 4.5 * (on ? 1.8 : 1);
        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.globalAlpha = on ? 1 : 0.82;
        ctx!.fillStyle = colorOf(d.cluster_id);
        ctx!.fill();
        if (on) {
          ctx!.lineWidth = 2;
          ctx!.strokeStyle = "#fff";
          ctx!.stroke();
        }
        ctx!.globalAlpha = 1;
      });

      const pending = pendingRef.current?.point;
      if (pending) {
        const x = sx(pending.x), y = sy(pending.y);
        const on = hoveredRef.current?.id === PENDING_ID || selectedRef.current?.id === PENDING_ID;
        const r = on ? 9 : 6.5;
        ctx!.beginPath();
        ctx!.moveTo(x, y - r);
        ctx!.lineTo(x + r, y);
        ctx!.lineTo(x, y + r);
        ctx!.lineTo(x - r, y);
        ctx!.closePath();
        ctx!.fillStyle = "#18181b";
        ctx!.fill();
        ctx!.lineWidth = 2;
        ctx!.strokeStyle = "#fbbf24";
        ctx!.stroke();
        ctx!.fillStyle = "#18181b";
        ctx!.font = "700 11px Inter, sans-serif";
        ctx!.fillText("Your submission", x, y - r - 8);
      }
      ctx!.restore();
    }

    function nodeAt(px: number, py: number): MapPoint | null {
      const pending = pendingRef.current?.point;
      if (pending) {
        const dist = Math.hypot(px - sx(pending.x), py - sy(pending.y));
        if (dist < 14) return pending;
      }
      let best: MapPoint | null = null;
      let bestD = 12;
      for (const d of points) {
        if (hiddenRef.current.has(d.cluster_id)) continue;
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

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
    };
    // points/clusters are static for the page's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw when hiddenClusters changes (legend toggles).
  useEffect(() => {
    hiddenRef.current = hiddenClusters;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
  }, [hiddenClusters]);

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

  // Mirror `pending` into the ref the imperative canvas code reads, and redraw.
  useEffect(() => {
    pendingRef.current = pending;
    const canvas = canvasRef.current as (HTMLCanvasElement & { __redraw?: () => void }) | null;
    canvas?.__redraw?.();
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

  function resetView() {
    setHiddenClusters(new Set());
    const canvas = canvasRef.current as (HTMLCanvasElement & { __resetView?: () => void }) | null;
    canvas?.__resetView?.();
  }

  return (
    <div ref={containerRef} className="relative h-[calc(100vh-57px)] w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950">
      <canvas ref={canvasRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

      <div
        ref={tooltipRef}
        hidden
        className="pointer-events-none absolute z-20 max-w-64 rounded-md bg-neutral-900 px-2.5 py-1.5 text-xs text-white shadow-lg"
      />

      <aside className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white/95 p-3 text-xs shadow-sm dark:border-neutral-800 dark:bg-neutral-900/95">
        <div className="mb-2 font-semibold text-neutral-700 dark:text-neutral-300">Topics</div>
        <ul className="flex flex-col gap-1">
          {clusters.map((c) => (
            <li
              key={c.id}
              onClick={() => toggleCluster(c.id)}
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
        <button
          onClick={resetView}
          className="mt-3 w-full rounded-md border border-neutral-300 py-1 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Reset view
        </button>
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
          {selected.id === PENDING_ID && pending ? (
            <>
              <div
                className="mb-2 w-fit rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ background: "#fbbf2422", color: "#b45309" }}
              >
                Draft submission &middot; {pending.clusterLabel}
              </div>
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
                  No abstract available. Topics: {detail.openalex_topics.map((t) => t.display_name).join(", ")}
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

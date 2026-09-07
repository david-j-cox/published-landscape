import "server-only";
import { scope, sql } from "@/lib/corpus-db";

/**
 * The whole map as a field of cones.
 *
 * A single topic's cone answers "when did this happen" for one group. Standing
 * all of them at their map positions answers it for the field: every cone
 * rises through one shared year axis, so a topic that stopped is a stump and a
 * topic still being published is a full funnel, and the difference is visible
 * without opening either.
 *
 * The clusters are already disjoint discs on the map -- 946 pairs checked, no
 * two overlapping, the tightest separated by 1.02 -- so a cone whose widest
 * point matches its cluster's disc occupies exactly the footprint the flat map
 * already gives it, and the field does not intersect itself.
 */
export type LandscapeCone = {
  clusterId: number;
  label: string;
  /** Centre on the map, which is where the cone stands. */
  cx: number;
  cy: number;
  /** The cluster's own radius on the map: the cone at its widest. */
  radius: number;
  count: number;
};

export type LandscapePoint = {
  /** Which cone it belongs to, as an index into the cones array. */
  cone: number;
  /**
   * Bearing from its cluster's centre, in radians, taken straight off the map.
   * The cone keeps the map's local arrangement in its angle and spends only
   * the radius on time, so a region of a topic stays a region.
   */
  angle: number;
  year: number;
  isReview: boolean;
  reviewedBy: number;
};

export type Landscape = {
  cones: LandscapeCone[];
  points: LandscapePoint[];
  minYear: number;
  maxYear: number;
};

/**
 * Everything the field needs, in one round trip.
 *
 * The geometry is derived here rather than in the browser: it is two passes
 * over the same rows, and doing it on the server means the payload carries an
 * angle and a year per article instead of two coordinates and a cluster id.
 */
export async function landscape(): Promise<Landscape> {
  const inScope = (await scope()).where;
  const [rows, labels] = await Promise.all([
    sql<{ cluster_id: number; map_x: number; map_y: number; year: number;
          is_review: boolean; reviewed_by: number }[]>`
      select a.cluster_id, a.map_x, a.map_y, a.year, a.is_review, a.reviewed_by
      from corpus_article a
      where a.cluster_id is not null and a.map_x is not null and a.map_y is not null
        and a.year is not null and ${inScope}`,
    sql<{ id: number; label: string }[]>`select id, label from corpus_cluster`,
  ]);

  const labelOf = new Map(labels.map((c) => [c.id, c.label]));
  const byCluster = new Map<number, { x: number; y: number; year: number;
                                      isReview: boolean; reviewedBy: number }[]>();
  for (const r of rows) {
    const list = byCluster.get(r.cluster_id) ?? [];
    list.push({
      x: Number(r.map_x),
      y: Number(r.map_y),
      year: Number(r.year),
      isReview: r.is_review,
      reviewedBy: Number(r.reviewed_by ?? 0),
    });
    byCluster.set(r.cluster_id, list);
  }

  const cones: LandscapeCone[] = [];
  const points: LandscapePoint[] = [];
  let minYear = Infinity;
  let maxYear = -Infinity;

  // Largest first, so the biggest topics are drawn and labelled first when
  // something has to give.
  const ordered = [...byCluster.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [clusterId, members] of ordered) {
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
    const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    let radius = 0;
    for (const m of members) radius = Math.max(radius, Math.hypot(m.x - cx, m.y - cy));
    const cone = cones.length;
    cones.push({
      clusterId,
      label: labelOf.get(clusterId) ?? `Topic ${clusterId}`,
      cx: Math.round(cx * 1e4) / 1e4,
      cy: Math.round(cy * 1e4) / 1e4,
      radius: Math.round((radius || 0.02) * 1e4) / 1e4,
      count: members.length,
    });
    for (const m of members) {
      if (m.year < minYear) minYear = m.year;
      if (m.year > maxYear) maxYear = m.year;
      points.push({
        cone,
        /*
         * Four decimals. A radian is the whole circle over 6.28, so 0.0001 of
         * one is a ten-thousandth of a turn -- far under a pixel at any zoom
         * this draws at, and the full float was the largest thing in an
         * 840 KB payload.
         */
        angle: Math.round(Math.atan2(m.y - cy, m.x - cx) * 1e4) / 1e4,
        year: m.year,
        isReview: m.isReview,
        reviewedBy: m.reviewedBy,
      });
    }
  }

  return {
    cones,
    points,
    minYear: Number.isFinite(minYear) ? minYear : 0,
    maxYear: Number.isFinite(maxYear) ? maxYear : 0,
  };
}

import "server-only";
import { scope, sql } from "@/lib/corpus-db";

/**
 * One topic's articles, with the year kept as a coordinate.
 *
 * The map answers "what is near what" and cannot answer "when did this
 * happen", which is half the question: a literature that stopped in 2019 and
 * one still being published are the same cloud of dots seen from above. These
 * are the same points the map draws, plus the year, plus the two facts that
 * say what kind of thing each one is -- whether it is itself a review, and
 * how many reviews here cite it.
 *
 * "Cited by a review", never "covered by one". A synthesis cites what it
 * synthesised and what it read to write its introduction, and nothing in the
 * data separates them.
 */
export type ConePoint = {
  /** Map coordinates, which become the radial position. */
  x: number;
  y: number;
  /** Publication year, which becomes the height. */
  year: number;
  title: string;
  doi: string | null;
  isReview: boolean;
  /** Reviews in this corpus that cite it. Zero for most. */
  reviewedBy: number;
};

/**
 * Everything the cone draws, in one query.
 *
 * Sent whole to the client rather than paged: a topic is a few hundred
 * articles, the projection runs per frame while the view turns, and a round
 * trip in the middle of that is not something a redraw can wait for. The
 * largest topic in scope is under a thousand points, which is well inside
 * what the batched canvas renderer handles at sixty frames.
 */
export async function conePoints(clusterId: number): Promise<ConePoint[]> {
  const rows = await sql<
    {
      map_x: number;
      map_y: number;
      year: number;
      title: string;
      doi: string | null;
      is_review: boolean;
      reviewed_by: number;
    }[]
  >`
    select a.map_x, a.map_y, a.year, a.title, a.doi, a.is_review, a.reviewed_by
    from corpus_article a
    where a.cluster_id = ${clusterId}
      and a.map_x is not null and a.map_y is not null and a.year is not null
      and ${(await scope()).where}`;
  return rows.map((r) => ({
    x: Number(r.map_x),
    y: Number(r.map_y),
    year: Number(r.year),
    title: r.title,
    doi: r.doi ? r.doi.replace(/^https?:\/\/doi\.org\//, "") : null,
    isReview: r.is_review,
    reviewedBy: Number(r.reviewed_by ?? 0),
  }));
}

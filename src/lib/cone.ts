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
  /** OpenAlex id, which is what the citation edges are written in. */
  id: string;
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
      openalex_id: string;
      map_x: number;
      map_y: number;
      year: number;
      title: string;
      doi: string | null;
      is_review: boolean;
      reviewed_by: number;
    }[]
  >`
    select a.openalex_id, a.map_x, a.map_y, a.year, a.title, a.doi, a.is_review, a.reviewed_by
    from corpus_article a
    where a.cluster_id = ${clusterId}
      and a.map_x is not null and a.map_y is not null and a.year is not null
      and a.openalex_id is not null
      and ${(await scope()).where}`;
  return rows.map((r) => ({
    id: r.openalex_id,
    x: Number(r.map_x),
    y: Number(r.map_y),
    year: Number(r.year),
    title: r.title,
    doi: r.doi ? r.doi.replace(/^https?:\/\/doi\.org\//, "") : null,
    isReview: r.is_review,
    reviewedBy: Number(r.reviewed_by ?? 0),
  }));
}

/**
 * Which articles in a topic cite which, as index pairs into the point array.
 *
 * The topic map groups by what a paper is about. This is the other structure
 * in the same set: what it was built on. They are not the same shape --
 * articles that share vocabulary need not cite each other, and a line of work
 * that does cite itself may span several vocabularies.
 */
export type ConeEdge = [from: number, to: number];

/**
 * Citation groups within a topic, by greedy modularity over its edges.
 *
 * Connected components are useless here: in the largest topic 573 of 666
 * articles are connected to something, so nearly all of them land in one
 * component. Label propagation was tried and collapses the same way -- 564 of
 * 666 in a single group, measured. Modularity splits that same graph into
 * groups of 86, 63, 40, 37 and 27, which is the structure the citing actually
 * has.
 *
 * One level of local moving, no aggregation: at a few hundred nodes the
 * second level buys nothing a reader would see, and the pass is milliseconds.
 * Resolution is left at 1 -- raising it produced more and smaller groups
 * without making any of them more meaningful, and a knob set by eye is a knob
 * that has to be defended.
 *
 * Deterministic, which matters more than the quality of the partition: a
 * layout that reshuffled on every page load would stop the cone being a
 * stable object. Nodes are visited in index order and ties break low.
 */
function citationGroups(count: number, edges: ConeEdge[]): number[] {
  const neighbours: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  const degree = new Array<number>(count).fill(0);
  for (const [a, b] of edges) {
    neighbours[a].set(b, (neighbours[a].get(b) ?? 0) + 1);
    neighbours[b].set(a, (neighbours[b].get(a) ?? 0) + 1);
    degree[a] += 1;
    degree[b] += 1;
  }
  const twiceEdges = edges.length * 2 || 1;
  const group = Array.from({ length: count }, (_, i) => i);
  const groupDegree = degree.slice();

  for (let pass = 0; pass < 20; pass += 1) {
    let moved = false;
    for (let i = 0; i < count; i += 1) {
      if (neighbours[i].size === 0) continue;
      const from = group[i];
      groupDegree[from] -= degree[i];
      const links = new Map<number, number>();
      for (const [j, weight] of neighbours[i]) {
        links.set(group[j], (links.get(group[j]) ?? 0) + weight);
      }
      let best = from;
      let bestGain = (links.get(from) ?? 0) - (groupDegree[from] * degree[i]) / twiceEdges;
      for (const [candidate, weight] of links) {
        const gain = weight - (groupDegree[candidate] * degree[i]) / twiceEdges;
        if (gain > bestGain || (gain === bestGain && candidate < best)) {
          best = candidate;
          bestGain = gain;
        }
      }
      groupDegree[best] += degree[i];
      if (best !== from) {
        group[i] = best;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return group;
}

/**
 * How many groups get a wedge of their own.
 *
 * Modularity finds 74 to 96 groups in a topic, most of them a pair or a
 * triple, and a circle cut into ninety wedges is not a set of regions -- it is
 * noise with edges. The largest few are the lines of work worth seeing apart;
 * everything below them, singletons included, shares the last wedge.
 */
const WEDGES = 10;

export type ConeGraph = {
  edges: ConeEdge[];
  /**
   * Group id per point, largest first. Anything outside the largest WEDGES
   * groups, singletons included, shares the last id.
   */
  groups: number[];
  /** How many groups got a wedge of their own; the shared id is this number. */
  groupCount: number;
  /** Articles with at least one citation inside the topic. */
  connected: number;
};

/**
 * The citation structure of one topic, aligned to the order conePoints
 * returned, so the browser can index straight into the array it already has.
 */
export async function coneGraph(
  clusterId: number,
  points: ConePoint[],
): Promise<ConeGraph | null> {
  if (points.length === 0) return null;
  const index = new Map(points.map((p, i) => [p.id, i]));
  const rows = await sql<{ citing: string; cited: string }[]>`
    select c.citing, c.cited
    from corpus_citation c
    join corpus_article a on a.openalex_id = c.citing
    join corpus_article b on b.openalex_id = c.cited
    where a.cluster_id = ${clusterId} and b.cluster_id = ${clusterId}`;

  const edges: ConeEdge[] = [];
  for (const r of rows) {
    const from = index.get(r.citing);
    const to = index.get(r.cited);
    // Both ends have to be on screen: the query is scoped by cluster, and the
    // app's year window is narrower than the cluster.
    if (from === undefined || to === undefined || from === to) continue;
    edges.push([from, to]);
  }
  if (edges.length === 0) return null;

  const raw = citationGroups(points.length, edges);
  const size = new Map<number, number>();
  for (const g of raw) size.set(g, (size.get(g) ?? 0) + 1);
  const biggest = [...size.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .filter(([, n]) => n > 1)
    .slice(0, WEDGES)
    .map(([g]) => g);

  /*
   * Neighbouring wedges for groups that cite each other.
   *
   * Wedge order was group size, which is arbitrary as far as the graph is
   * concerned: two groups that cite each other heavily could land on opposite
   * sides of the circle, and every edge between them then crossed the middle.
   * Ordered greedily instead -- start at the largest, and each time step to
   * whichever unplaced group shares the most citations with the one just
   * placed. It does not remove the crossings, but it makes the heaviest
   * pairs short.
   */
  const between = new Map<string, number>();
  const groupOf = new Map<number, number>();
  biggest.forEach((g, i) => groupOf.set(g, i));
  for (const [a, b] of edges) {
    const ga = groupOf.get(raw[a]);
    const gb = groupOf.get(raw[b]);
    if (ga === undefined || gb === undefined || ga === gb) continue;
    const key = ga < gb ? `${ga}:${gb}` : `${gb}:${ga}`;
    between.set(key, (between.get(key) ?? 0) + 1);
  }
  const weight = (a: number, b: number) =>
    between.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0;

  const order: number[] = [];
  const left = new Set(biggest.map((_, i) => i));
  let current = 0;
  while (left.size > 0) {
    if (!left.has(current)) current = [...left][0];
    order.push(current);
    left.delete(current);
    let next = -1;
    let best = -1;
    for (const candidate of left) {
      const w = weight(current, candidate);
      if (w > best || (w === best && candidate < next)) {
        best = w;
        next = candidate;
      }
    }
    current = next;
  }

  const rank = new Map(order.map((sizeRank, position) => [biggest[sizeRank], position]));
  const remainder = biggest.length;
  const groups = raw.map((g) => rank.get(g) ?? remainder);

  const touched = new Set<number>();
  for (const [a, b] of edges) {
    touched.add(a);
    touched.add(b);
  }
  return {
    edges,
    groups,
    groupCount: biggest.length,
    connected: touched.size,
  };
}

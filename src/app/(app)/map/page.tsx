import { TopicMap } from "@/components/topic-map";
import { reachByArticle } from "@/lib/citations";
import { getClusters, getJournals, getMapPoints } from "@/lib/data";

export default async function MapPage() {
  const [points, clusters, journals, reach] = await Promise.all([
    getMapPoints(),
    getClusters(),
    getJournals(),
    reachByArticle(),
  ]);
  /*
   * Reach rides along on the points rather than going down as a second
   * structure: the map is one array of 16,000 objects crossing to the client
   * already, and a parallel lookup keyed by id would send every id twice.
   * Null when the citation graph could not be read, in which case the mode
   * is not offered at all.
   */
  const withReach = reach
    ? points.map((p) => ({ ...p, reach: reach.get(p.id)?.reach ?? null }))
    : points;
  return (
    <TopicMap
      points={withReach}
      clusters={clusters}
      journals={journals}
      reachAvailable={reach !== null}
    />
  );
}

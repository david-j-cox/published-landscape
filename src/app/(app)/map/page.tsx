import { TopicMap } from "@/components/topic-map";
import { getClusters, getJournals, getMapPoints } from "@/lib/data";

export default async function MapPage() {
  const [points, clusters, journals] = await Promise.all([
    getMapPoints(),
    getClusters(),
    getJournals(),
  ]);
  return <TopicMap points={points} clusters={clusters} journals={journals} />;
}

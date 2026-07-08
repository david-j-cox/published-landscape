import { TopicMap } from "@/components/topic-map";
import { getClusters, getJournals, getMapPoints } from "@/lib/data";

export default function MapPage() {
  const points = getMapPoints();
  const clusters = getClusters();
  const journals = getJournals();
  return <TopicMap points={points} clusters={clusters} journals={journals} />;
}

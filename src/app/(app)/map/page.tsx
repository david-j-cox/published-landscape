import { TopicMap } from "@/components/topic-map";
import { getClusters, getMapPoints } from "@/lib/data";

export default function MapPage() {
  const points = getMapPoints();
  const clusters = getClusters();
  return <TopicMap points={points} clusters={clusters} />;
}

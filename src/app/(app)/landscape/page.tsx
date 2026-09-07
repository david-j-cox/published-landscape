import Link from "next/link";
import { TopicLandscape } from "@/components/topic-landscape";
import { landscape } from "@/lib/landscape";

/**
 * Every topic as a cone, standing where the map puts it.
 *
 * The flat map answers what is near what; a single cone answers when one topic
 * happened. This is both: the field seen at once, with one year axis running
 * through all of it.
 */
export default async function LandscapePage() {
  const { cones, points, minYear, maxYear } = await landscape();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">The field over time</h1>
        <Link href="/map" className="text-sm text-neutral-500 hover:underline">
          Flat map
        </Link>
      </div>
      <div className="mt-5">
        <TopicLandscape cones={cones} points={points} minYear={minYear} maxYear={maxYear} />
      </div>
    </div>
  );
}

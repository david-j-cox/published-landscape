"use client";

import { useRouter } from "next/navigation";
import TopicCone, { type Edge, type Point } from "@/components/topic-cone";

/**
 * The cone, with a way back.
 *
 * TopicCone takes onClose as a callback, which a server component cannot
 * hand it. This is the whole of the bridge: a client boundary thin enough
 * that the cone itself stays a rendering component with no opinion about
 * routing.
 */
export function TopicConeView({
  points,
  label,
  backHref,
  edges,
  groups,
  groupCount,
}: {
  points: Point[];
  label: string;
  backHref: string;
  edges?: Edge[];
  groups?: number[];
  groupCount?: number;
}) {
  const router = useRouter();
  return (
    <TopicCone
      points={points}
      label={label}
      onClose={() => router.push(backHref)}
      edges={edges}
      groups={groups}
      groupCount={groupCount}
    />
  );
}

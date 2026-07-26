"use client";

// Timestamps have to be formatted on the client: the server renders in UTC on
// Vercel, which would show the wrong day to anyone west of Greenwich. The SSR
// pass and the hydration pass therefore disagree by design, hence
// suppressHydrationWarning.
export function LocalTime({
  value,
  empty = "-",
  withTime = false,
}: {
  value: string | null;
  empty?: string;
  withTime?: boolean;
}) {
  if (!value) return <span className="text-neutral-400">{empty}</span>;

  const date = new Date(value);
  const label = withTime
    ? date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <time dateTime={value} title={date.toLocaleString()} suppressHydrationWarning>
      {label}
    </time>
  );
}

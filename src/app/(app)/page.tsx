import Link from "next/link";
import { getClusters, getJournals, getYears } from "@/lib/data";

export default function Home() {
  const journals = getJournals();
  const clusters = getClusters();
  const years = getYears();
  const totalArticles = clusters.reduce((s, c) => s + c.count, 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Published Landscape</h1>
      <p className="mt-4 text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
        Behavior-analysis journal articles are published and browsed chronologically, which
        makes it hard for editors to find who has written on a given topic beyond the names
        they already know. This organizes {totalArticles.toLocaleString()} articles from{" "}
        {journals.map((j) => j.name).join(", ")} ({years.at(-1)}&ndash;{years[0]}) by topic
        instead, so readers can find articles by theme and associate editors can find
        reviewers by expertise.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/map"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Explore the topic map
        </Link>
        <Link
          href="/articles"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
        >
          Browse articles
        </Link>
        <Link
          href="/reviewers"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium dark:border-neutral-700"
        >
          Find a reviewer
        </Link>
      </div>

      <dl className="mt-12 grid grid-cols-2 gap-6 sm:grid-cols-4">
        <Stat label="Articles" value={totalArticles.toLocaleString()} />
        <Stat label="Journals" value={String(journals.length)} />
        <Stat label="Topics" value={String(clusters.length)} />
        <Stat label="Years covered" value={String(years.length)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-neutral-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

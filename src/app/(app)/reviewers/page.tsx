import Link from "next/link";
import { getClusters, getReviewersByCluster, searchAuthors } from "@/lib/data";
import type { AuthorSummary } from "@/lib/types";

export default async function ReviewersPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const clusters = getClusters();
  const clusterId = sp.topic ? Number(sp.topic) : undefined;

  let results: AuthorSummary[] = [];
  if (sp.q) results = searchAuthors(sp.q);
  else if (clusterId !== undefined) results = getReviewersByCluster(clusterId);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-lg font-semibold">Find a reviewer</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Search by topic to find authors who have published in that area, or search by name directly.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <form action="/reviewers" className="flex flex-1 gap-2 text-sm">
          <select
            name="topic"
            defaultValue={sp.topic ?? ""}
            className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Choose a topic...</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Find by topic
          </button>
        </form>

        <form action="/reviewers" className="flex flex-1 gap-2 text-sm">
          <input
            type="text"
            name="q"
            defaultValue={sp.q}
            placeholder="Search author name"
            className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <button
            type="submit"
            className="rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
          >
            Search
          </button>
        </form>
      </div>

      {(sp.q || clusterId !== undefined) && (
        <div className="mt-6 text-sm text-neutral-500">
          {results.length} author{results.length === 1 ? "" : "s"} found
        </div>
      )}

      <ul className="mt-2 flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
        {results.map((author) => (
          <li key={author.id} className="py-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{author.display_name}</span>
              <span className="text-sm text-neutral-400">
                {author.articleCount} article{author.articleCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {author.clusters.slice(0, 4).map((c) => (
                <Link
                  key={c.id}
                  href={`/reviewers?topic=${c.id}`}
                  className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                >
                  {c.label} &middot; {c.count}
                </Link>
              ))}
            </div>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-neutral-500">
              {author.articles.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <Link href={`/articles/${a.id}`} className="hover:underline">
                    {a.title}
                  </Link>{" "}
                  <span className="text-neutral-400">({a.year})</span>
                </li>
              ))}
            </ul>
            {author.orcid && (
              <a
                href={author.orcid}
                target="_blank"
                rel="noopener"
                className="mt-1 inline-block text-xs text-blue-600 underline dark:text-blue-400"
              >
                ORCID
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
